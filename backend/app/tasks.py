"""Celery tasks. Names are explicit so callers can enqueue by string without importing this module."""
import logging
import uuid
from datetime import datetime, timezone

from .extensions import celery, db, enqueue
from .models import Appointment, Contact, Message, WaTemplate
from .services import (
    appointment_service, hubspot_service, messaging_service, onboarding_service, whatsapp_service,
)
from .services.hubspot_service import HubSpotError
from .services.whatsapp_service import WhatsAppError
from .errors import ApiError

log = logging.getLogger(__name__)

_RETRY = dict(autoretry_for=(HubSpotError, WhatsAppError), retry_backoff=30, retry_backoff_max=900, max_retries=5)


# ---- HubSpot ----
@celery.task(name="hubspot_service.log_whatsapp_conversation", **_RETRY)
def log_whatsapp_conversation(message_id: str):
    return hubspot_service.log_whatsapp_conversation(message_id)


@celery.task(name="hubspot_service.create_reschedule_task", **_RETRY)
def create_reschedule_task(appointment_id: str):
    appointment = db.session.get(Appointment, uuid.UUID(appointment_id))
    if not appointment:
        return None
    contact = appointment.contact
    hubspot_id = hubspot_service.ensure_contact_synced(contact)
    when = messaging_service.clinic_now_label(appointment.booking_time)
    return hubspot_service.create_task(
        hubspot_id,
        subject=f"Reschedule appointment: {contact.name or contact.phone_e164} ({when})",
        body="Patient replied NO / RESCHEDULE to the WhatsApp reminder. Call or message to agree a new time.",
    )


# ---- appointments ----
@celery.task(name="appointments.send_reminder_24h", **_RETRY)
def send_reminder_24h(appointment_id: str):
    return appointment_service.send_reminder(appointment_id)


@celery.task(name="appointments.sweep_due_reminders")
def sweep_due_reminders():
    """Celery beat, hourly: every confirmed appointment starting within 24h that hasn't had its reminder yet."""
    ids = appointment_service.due_reminder_ids()
    for appointment_id in ids:
        enqueue("appointments.send_reminder_24h", args=(appointment_id,))
    log.info("reminder sweep: %d appointment(s) due", len(ids))
    return len(ids)


@celery.task(name="appointments.post_booking", **_RETRY)
def post_booking(appointment_id: str):
    """Sync the patient to HubSpot and open a deal for the booking."""
    appointment = db.session.get(Appointment, uuid.UUID(appointment_id))
    if not appointment:
        return None
    hubspot_id = hubspot_service.ensure_contact_synced(appointment.contact)
    label = messaging_service.clinic_now_label(appointment.booking_time)
    return hubspot_service.create_deal_for_appointment(hubspot_id, appointment, appointment.client.business_name, label)


# ---- inbound replies ----
@celery.task(name="inbound.follow_up")
def inbound_follow_up(message_id: str, intent: str, appointment_id: str | None):
    """After the webhook has applied the state change: acknowledge the patient and raise the HubSpot task."""
    message = db.session.get(Message, uuid.UUID(message_id))
    if not message:
        return
    contact, client = message.contact, message.client
    if intent == "reschedule" and appointment_id:
        enqueue("hubspot_service.create_reschedule_task", args=(appointment_id,))
        reply = "No problem - our team will contact you shortly to find a new appointment time."
    elif intent == "confirm":
        reply = "Thank you, your appointment is confirmed. See you soon!"
    elif intent == "stop":
        reply = "You have been unsubscribed and will not receive further WhatsApp messages from us."
    else:
        return
    try:
        # the patient wrote <24h ago, so free-form is allowed; the STOP confirmation is the one send permitted after opt-out
        messaging_service.send_text_to_contact(client, contact, reply, after_opt_out=(intent == "stop"))
    except (ApiError, WhatsAppError) as exc:
        log.warning("follow-up reply not sent: %s", exc)


@celery.task(name="onboarding.templates_changed")
def templates_changed(client_id: str):
    onboarding_service.on_templates_changed(uuid.UUID(client_id))


# ---- mock Meta (only enqueued when WhatsApp runs in mock mode) ----
@celery.task(name="mock.status_update")
def mock_status_update(wamid: str, status: str):
    """Play Meta: deliver a statuses webhook for a message we 'sent'."""
    from .services import webhook_service

    message = Message.query.filter_by(wamid=wamid).first()
    if not message:
        return
    payload = {"object": "whatsapp_business_account", "entry": [{"id": message.client.waba_id or "mock", "changes": [{
        "field": "messages", "value": {
            "messaging_product": "whatsapp",
            "metadata": {"phone_number_id": message.client.phone_number_id},
            "statuses": [{"id": wamid, "status": status, "timestamp": str(int(datetime.now(timezone.utc).timestamp())),
                          "recipient_id": message.contact.phone_e164.lstrip("+")}],
        }}]}]}
    webhook_service.process_payload(payload, client_hint=message.client)


_PROMO_WORDS = ("discount", "% off", "offer", "free ", "sale", "voucher")


@celery.task(name="mock.template_review")
def mock_template_review(template_id: str):
    """Play Meta's template review. Approves, except utility templates that read like marketing (a real
    Meta rejection reason), which lets you demo the rejection path by writing e.g. '20% off'."""
    from .services import webhook_service

    template = db.session.get(WaTemplate, uuid.UUID(template_id))
    if not template or template.status != "pending":
        return
    promo = template.category == "utility" and any(w in template.body_text.lower() for w in _PROMO_WORDS)
    payload = build_template_status_payload(template, "REJECTED" if promo else "APPROVED", "INCORRECT_CATEGORY" if promo else "NONE")
    webhook_service.process_payload(payload)


def build_template_status_payload(template: WaTemplate, event: str, reason: str | None) -> dict:
    return {"object": "whatsapp_business_account", "entry": [{
        "id": template.client.waba_id or "mock", "time": int(datetime.now(timezone.utc).timestamp()),
        "changes": [{"field": "message_template_status_update", "value": {
            "event": event, "message_template_id": template.meta_template_id,
            "message_template_name": template.name, "message_template_language": template.language,
            "reason": reason or "NONE",
        }}]}]}
