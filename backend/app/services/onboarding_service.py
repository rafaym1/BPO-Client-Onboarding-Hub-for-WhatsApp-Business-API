import logging
import uuid

from flask import current_app

from ..errors import ApiError
from ..extensions import db
from ..models import Client, OnboardingChecklist, WaTemplate
from ..utils import utcnow
from . import jira_service

log = logging.getLogger(__name__)

CHECKLIST_STEPS = [
    "Client Intake",
    "BM Verification Check",
    "Number Provisioning",
    "Webhook Setup",
    "Template Pack Submission",
    "Opt-in Flow Test",
    "Go-live",
]
# Step N in progress <=> client.onboarding_status == STEP_STATUS[N-1]; all steps done => "live"
STEP_STATUS = ["kickoff", "bm_verification", "number_provisioning", "webhook_setup", "template_submission", "optin_test", "go_live"]
TEMPLATE_PACK_SIZE = 3  # the healthcare starter pack; template step auto-completes once all of them are approved


def create_client(*, business_name: str, country: str, industry: str = "healthcare", waba_id: str | None = None,
                  phone_number_id: str | None = None, business_manager_id: str | None = None) -> tuple[Client, str | None]:
    """Client + 7 checklist rows + Jira epic with 7 sub-tasks. Returns (client, jira_error_or_None)."""
    cfg = current_app.config
    client = Client(
        business_name=business_name, country=country, industry=industry,
        # blank => use the Meta test number / WABA from .env (single-number demo setup)
        waba_id=waba_id or cfg["WABA_ID"] or None,
        phone_number_id=phone_number_id or cfg["PHONE_NUMBER_ID"] or None,
        business_manager_id=business_manager_id, onboarding_status="kickoff",
    )
    db.session.add(client)
    db.session.flush()
    create_checklist(client)
    db.session.commit()
    return client, provision_jira(client)


def create_checklist(client: Client) -> list[OnboardingChecklist]:
    rows = [
        OnboardingChecklist(
            client_id=client.id, step_name=name, step_order=i,
            status="in_progress" if i == 1 else "pending",
        )
        for i, name in enumerate(CHECKLIST_STEPS, start=1)
    ]
    db.session.add_all(rows)
    return rows


def provision_jira(client: Client) -> str | None:
    """Create the Jira epic + 7 tasks and save the keys. Returns an error string instead of raising:
    a Jira outage must not block client creation (use POST /api/clients/<id>/jira to retry)."""
    try:
        result = jira_service.create_onboarding_epic(client)
    except Exception as exc:  # noqa: BLE001 - external system, report and continue
        log.exception("Jira provisioning failed for %s", client.id)
        return str(exc)
    client.jira_epic_key = result["epic_key"]
    for step in client.checklist:
        step.jira_issue_key = result["tasks"].get(step.step_order)
    db.session.commit()
    return None


def _find_step(client_id, step_name: str) -> OnboardingChecklist:
    step = (
        OnboardingChecklist.query.filter(OnboardingChecklist.client_id == client_id)
        .filter(db.func.lower(OnboardingChecklist.step_name) == step_name.strip().lower())
        .first()
    )
    if not step:
        raise ApiError(f"Unknown checklist step '{step_name}'", 404, "step_not_found")
    return step


def _sync_jira(step: OnboardingChecklist):
    if not step.jira_issue_key:
        return
    try:
        jira_service.update_issue_status(step.jira_issue_key, step.status)
    except Exception:  # noqa: BLE001
        log.exception("Could not sync %s to Jira", step.jira_issue_key)


def _refresh_client_status(client: Client):
    """Derive onboarding_status from the checklist and promote the next pending step to in_progress."""
    steps = sorted(client.checklist, key=lambda s: s.step_order)
    current = next((s for s in steps if s.status != "done"), None)
    if current is None:
        client.onboarding_status = "live"
        client.go_live_date = client.go_live_date or utcnow()
        return
    client.go_live_date = None
    client.onboarding_status = STEP_STATUS[current.step_order - 1]
    if current.status == "pending":
        current.status = "in_progress"
        _sync_jira(current)


def advance_checklist_step(client_id, step_name: str, notes: str | None = None) -> OnboardingChecklist:
    """Mark a step done, sync Jira, and move the client to the next onboarding stage."""
    if isinstance(client_id, str):
        client_id = uuid.UUID(client_id)
    client = db.session.get(Client, client_id)
    if not client:
        raise ApiError("Client not found", 404, "client_not_found")
    step = _find_step(client_id, step_name)

    if step.step_name == "Go-live":
        open_steps = [s.step_name for s in client.checklist if s.step_order < step.step_order and s.status != "done"]
        if open_steps:
            raise ApiError(f"Cannot go live before completing: {', '.join(open_steps)}", 409, "steps_incomplete")

    if step.status != "done":
        step.status = "done"
        _sync_jira(step)
    if notes is not None:
        step.notes = notes
    db.session.flush()
    _refresh_client_status(client)
    db.session.commit()
    return step


def set_step_status(client_id, step_id, status: str | None, notes: str | None) -> OnboardingChecklist:
    step = db.session.get(OnboardingChecklist, step_id)
    if not step or step.client_id != client_id:
        raise ApiError("Checklist step not found", 404, "step_not_found")
    if status == "done":
        return advance_checklist_step(client_id, step.step_name, notes)
    if status and status != step.status:
        step.status = status
        _sync_jira(step)
        if step.status in ("pending", "in_progress"):
            step.client.go_live_date = None
    if notes is not None:
        step.notes = notes
    db.session.flush()
    if status in ("pending", "in_progress"):
        # re-opening a step moves the client back to that stage if it is now the earliest unfinished one
        _refresh_client_status(step.client)
    db.session.commit()
    return step


def on_templates_changed(client_id):
    """Auto-complete 'Template Pack Submission' once the whole starter pack is approved."""
    templates = WaTemplate.query.filter_by(client_id=client_id).all()
    if len(templates) >= TEMPLATE_PACK_SIZE and all(t.status == "approved" for t in templates):
        step = _find_step(client_id, "Template Pack Submission")
        if step.status != "done":
            advance_checklist_step(client_id, step.step_name, notes="Auto-completed: all templates approved by Meta")
