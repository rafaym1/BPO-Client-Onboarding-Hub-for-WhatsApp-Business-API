import logging

from flask import current_app

from ..errors import ApiError
from ..extensions import db, enqueue
from ..models import Client, WaTemplate
from . import whatsapp_service

log = logging.getLogger(__name__)

_META_TO_STATUS = {"APPROVED": "approved", "REJECTED": "rejected", "PENDING": "pending"}


def healthcare_starter_pack(clinic: str) -> list[dict]:
    """The three templates the booking demo needs: EN + DE confirmation and a 24h reminder with Yes/No buttons."""
    return [
        {
            "name": "appointment_confirmation", "language": "en_GB", "category": "utility",
            "body_text": f"Hi {{{{1}}}}, your appointment at {clinic} on {{{{2}}}} is confirmed. Reply YES to confirm, RESCHEDULE to change.",
            "buttons": [],
        },
        {
            "name": "appointment_reminder_24h", "language": "en_GB", "category": "utility",
            "body_text": f"Hi {{{{1}}}}, this is a reminder of your appointment at {clinic} on {{{{2}}}}. Can you still make it?",
            "buttons": ["Yes", "No"],
        },
        {
            "name": "appointment_confirmation", "language": "de_DE", "category": "utility",
            "body_text": f"Hallo {{{{1}}}}, Ihr Termin in der {clinic} am {{{{2}}}} ist bestätigt. Antworten Sie JA zur Bestätigung oder UMBUCHEN, um den Termin zu ändern.",
            "buttons": [],
        },
    ]


def create_template(client: Client, *, name: str, language: str, category: str, body_text: str,
                    header_type: str = "none", header_text: str | None = None, footer_text: str | None = None,
                    buttons: list[str] | None = None) -> WaTemplate:
    template = WaTemplate(
        client_id=client.id, name=name, language=language, category=category, body_text=body_text,
        header_type=header_type, status="draft",
        extras_json={"header_text": header_text, "footer_text": footer_text, "buttons": buttons or []},
    )
    db.session.add(template)
    db.session.commit()
    return template


def submit_to_meta(template: WaTemplate) -> WaTemplate:
    """POST the template to Meta (via whatsapp_service.submit_template) and mark it pending.
    The approval / rejection arrives later on /webhooks/whatsapp (message_template_status_update)."""
    if template.status not in ("draft", "rejected"):
        raise ApiError(f"Template is already {template.status}", 409, "already_submitted")
    client = template.client
    waba_id = client.waba_id or current_app.config["WABA_ID"]
    components = whatsapp_service.build_submission_components(template.body_text, template.header_type, template.extras_json)
    result = whatsapp_service.submit_template(waba_id, template.name, template.category, components, template.language)

    template.meta_template_id = str(result["id"])
    template.status = _META_TO_STATUS.get(str(result.get("status", "PENDING")).upper(), "pending")
    template.rejection_reason = None
    db.session.commit()

    if whatsapp_service.is_mock() and template.status == "pending":
        enqueue("mock.template_review", args=(str(template.id),), countdown=current_app.config["MOCK_TEMPLATE_REVIEW_SECONDS"])
    return template


def create_starter_pack(client: Client, submit: bool = False) -> list[WaTemplate]:
    created = []
    for spec in healthcare_starter_pack(client.business_name):
        exists = WaTemplate.query.filter_by(client_id=client.id, name=spec["name"], language=spec["language"]).first()
        if exists:
            continue
        template = create_template(client, **spec)
        if submit:
            submit_to_meta(template)
        created.append(template)
    return created
