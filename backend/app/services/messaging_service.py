"""The only place that sends WhatsApp messages on behalf of a client: enforces GDPR opt-in and the
24h customer-service window, then calls whatsapp_service and stores the message."""
import logging
from datetime import timedelta

from flask import current_app

from ..errors import ApiError, ComplianceError
from ..extensions import db, enqueue
from ..models import Client, Contact, Message, WaTemplate
from ..utils import utcnow
from . import whatsapp_service

log = logging.getLogger(__name__)

SERVICE_WINDOW = timedelta(hours=24)


# ---- compliance ----
def window_state(contact: Contact) -> dict:
    """WhatsApp customer-service window: free-form text only within 24h of the contact's last inbound message."""
    last_inbound = (
        db.session.query(db.func.max(Message.timestamp))
        .filter(Message.contact_id == contact.id, Message.direction == "in")
        .scalar()
    )
    expires = last_inbound + SERVICE_WINDOW if last_inbound else None
    return {
        "open": bool(expires and expires > utcnow()),
        "last_inbound_at": last_inbound.isoformat() if last_inbound else None,
        "expires_at": expires.isoformat() if expires else None,
    }


def check_template_allowed(contact: Contact):
    if contact.opt_in_status != "opted_in":
        raise ComplianceError(f"{contact.name or contact.phone_e164} has not opted in (status: {contact.opt_in_status})", "not_opted_in")
    if not contact.gdpr_consent:
        raise ComplianceError(f"{contact.name or contact.phone_e164} has no recorded GDPR consent", "no_gdpr_consent")


def check_text_allowed(contact: Contact, after_opt_out: bool = False):
    if contact.opt_in_status == "opted_out" and not after_opt_out:
        raise ComplianceError("Contact has opted out - no messages may be sent", "opted_out")
    if not window_state(contact)["open"]:
        raise ComplianceError(
            "The 24h customer service window is closed - free-form text is not allowed, send an approved template instead",
            "window_closed",
        )


# ---- sending ----
def _phone_number_id(client: Client) -> str | None:
    return client.phone_number_id or None


def find_approved_template(client_id, name: str, language: str) -> WaTemplate:
    """Exact language if approved, otherwise any approved language (e.g. contact speaks de_DE, only en_GB approved)."""
    candidates = WaTemplate.query.filter_by(client_id=client_id, name=name, status="approved").all()
    if not candidates:
        raise ApiError(f"No approved template named '{name}'", 409, "template_not_approved")
    return next((t for t in candidates if t.language == language), candidates[0])


def _store(client: Client, contact: Contact, wamid: str, type_: str, content: dict) -> Message:
    message = Message(
        client_id=client.id, contact_id=contact.id, wamid=wamid, direction="out", type=type_,
        content_json=content, status="sent", timestamp=utcnow(),
    )
    db.session.add(message)
    db.session.commit()
    if whatsapp_service.is_mock():
        # mimic Meta: delivery receipt a moment later (goes through the real webhook handler)
        enqueue("mock.status_update", args=(wamid, "delivered"), countdown=2)
    enqueue("hubspot_service.log_whatsapp_conversation", args=(str(message.id),))
    return message


def send_template_to_contact(client: Client, contact: Contact, template_name: str, language: str, params: list[str]) -> Message:
    check_template_allowed(contact)
    template = find_approved_template(client.id, template_name, language)
    expected = whatsapp_service.placeholder_count(template.body_text)
    if len(params) != expected:
        raise ApiError(f"Template '{template_name}' needs {expected} parameter(s), got {len(params)}", 422, "bad_params")

    result = whatsapp_service.send_template(
        contact.phone_e164, template.name, template.language,
        whatsapp_service.build_send_components(params), phone_number_id=_phone_number_id(client),
    )
    return _store(client, contact, result["wamid"], "template", {
        "body": whatsapp_service.render_body(template.body_text, params),
        "template": template.name, "language": template.language, "params": params,
        "buttons": (template.extras_json or {}).get("buttons", []),
    })


def send_text_to_contact(client: Client, contact: Contact, text: str, after_opt_out: bool = False) -> Message:
    """`after_opt_out` is only for the unsubscribe confirmation replying to a STOP message."""
    check_text_allowed(contact, after_opt_out)
    result = whatsapp_service.send_text(contact.phone_e164, text, phone_number_id=_phone_number_id(client))
    return _store(client, contact, result["wamid"], "text", {"body": text})


def clinic_now_label(dt) -> str:
    from ..utils import format_local

    return format_local(dt, current_app.config["CLINIC_TIMEZONE"])
