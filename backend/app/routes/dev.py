"""Demo helpers. They feed Meta-shaped payloads through the real webhook processor, so with mocks on you can
show the whole flow without a phone. Registered only when DEV_TOOLS=true."""
import time

from flask import Blueprint, current_app, jsonify, request

from ..errors import ApiError
from ..extensions import db
from ..models import Client, WaTemplate
from ..schemas import SimulateInbound, SimulateTemplateStatus
from ..services import appointment_service, mock_store, webhook_service
from ..tasks import build_template_status_payload
from ..utils import normalize_e164

bp = Blueprint("dev", __name__, url_prefix="/api/dev")


@bp.post("/simulate/inbound")
def simulate_inbound():
    """Pretend the patient sent a WhatsApp text (or tapped a quick-reply button)."""
    data = SimulateInbound.model_validate(request.get_json(silent=True) or {})
    client = db.session.get(Client, data.client_id)
    if not client:
        raise ApiError("Client not found", 404, "client_not_found")
    phone = normalize_e164(data.from_phone).lstrip("+")
    message = {"from": phone, "id": f"wamid.SIM{int(time.time() * 1000)}", "timestamp": str(int(time.time()))}
    if data.as_button:
        message |= {"type": "button", "button": {"text": data.text, "payload": data.text}}
    else:
        message |= {"type": "text", "text": {"body": data.text}}
    payload = {"object": "whatsapp_business_account", "entry": [{"id": client.waba_id or "mock", "changes": [{
        "field": "messages", "value": {
            "messaging_product": "whatsapp",
            "metadata": {"display_phone_number": "15550000000", "phone_number_id": client.phone_number_id},
            "contacts": [{"profile": {"name": data.name or "Patient"}, "wa_id": phone}],
            "messages": [message],
        }}]}]}
    return jsonify(webhook_service.process_payload(payload, client_hint=client))


@bp.post("/simulate/template-status")
def simulate_template_status():
    """Force a template approval / rejection, e.g. to demo the rejection_reason path."""
    data = SimulateTemplateStatus.model_validate(request.get_json(silent=True) or {})
    template = db.session.get(WaTemplate, data.template_id)
    if not template:
        raise ApiError("Template not found", 404, "template_not_found")
    payload = build_template_status_payload(template, data.event, data.reason)
    return jsonify(webhook_service.process_payload(payload))


@bp.post("/run-reminders")
def run_reminders():
    """Run the hourly Celery-beat sweep right now."""
    from ..tasks import sweep_due_reminders

    return jsonify({"due": sweep_due_reminders.apply().get()})


@bp.get("/mock-log/<service>")
def mock_log(service):
    if service not in ("whatsapp", "hubspot", "jira"):
        raise ApiError("Unknown service", 404, "unknown_service")
    return jsonify(mock_store.read(service, int(request.args.get("limit", 100))))
