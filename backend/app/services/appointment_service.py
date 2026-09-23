import logging
import uuid
from datetime import timedelta

from ..errors import ApiError
from ..extensions import db, enqueue
from ..models import Appointment, Client, Contact
from ..utils import utcnow
from . import contact_service, messaging_service
from .whatsapp_service import WhatsAppError

log = logging.getLogger(__name__)

CONFIRMATION_TEMPLATE = "appointment_confirmation"
REMINDER_TEMPLATE = "appointment_reminder_24h"
REMINDER_LEAD = timedelta(hours=24)


def _first_name(contact: Contact) -> str:
    return (contact.name or "there").split()[0]


def _params(contact: Contact, appointment: Appointment) -> list[str]:
    return [_first_name(contact), messaging_service.clinic_now_label(appointment.booking_time)]


def create_appointment(data) -> tuple[Appointment, dict | None]:
    """Book, send the confirmation template, and schedule the 24h reminder.

    The booking itself never fails because messaging is blocked (a patient can book by phone without
    consenting to WhatsApp): the compliance/API problem is returned as a warning instead.
    """
    client = db.session.get(Client, data.client_id)
    if not client:
        raise ApiError("Client not found", 404, "client_not_found")
    if data.booking_time <= utcnow():
        raise ApiError("booking_time must be in the future", 422, "booking_in_past")

    if data.contact_id:
        contact = db.session.get(Contact, data.contact_id)
        if not contact or contact.client_id != client.id:
            raise ApiError("Contact not found for this client", 404, "contact_not_found")
    else:
        contact, _ = contact_service.get_or_create_contact(client.id, data.contact.phone, data.contact.name)
        opt_in = data.contact.opt_in
        if opt_in:
            contact_service.record_opt_in(contact, opt_in.opt_in_status, opt_in.opt_in_source, opt_in.gdpr_consent, opt_in.gdpr_consent_text)

    appointment = Appointment(client_id=client.id, contact_id=contact.id, booking_time=data.booking_time, status="confirmed")
    db.session.add(appointment)
    db.session.commit()

    warning = None
    try:
        messaging_service.send_template_to_contact(client, contact, CONFIRMATION_TEMPLATE, data.language, _params(contact, appointment))
        appointment.confirmation_template_sent = True
        db.session.commit()
    except ApiError as exc:
        warning = {"code": exc.code, "message": f"Confirmation not sent: {exc.message}"}
    except WhatsAppError as exc:
        warning = {"code": "whatsapp_error", "message": f"Confirmation not sent: {exc}"}
    if warning:
        log.warning("appointment %s: %s", appointment.id, warning["message"])

    reminder_at = appointment.booking_time - REMINDER_LEAD
    if reminder_at > utcnow():
        enqueue("appointments.send_reminder_24h", args=(str(appointment.id),), eta=reminder_at)
    enqueue("appointments.post_booking", args=(str(appointment.id),))
    return appointment, warning


def send_reminder(appointment_id: str) -> str:
    """Send the 24h reminder once. Safe to call from both the ETA task and the hourly sweep."""
    appt_id = uuid.UUID(appointment_id)
    appointment = db.session.get(Appointment, appt_id)
    if not appointment:
        return "missing"
    now = utcnow()
    if appointment.status != "confirmed":
        return "skipped_status"
    if appointment.booking_time <= now:
        return "past"
    if appointment.booking_time - now > REMINDER_LEAD + timedelta(minutes=5):
        return "too_early"  # stale ETA task from before the appointment was moved

    # atomic claim so the ETA task and the sweep can't both send
    claimed = Appointment.query.filter_by(id=appt_id, reminder_sent_24h=False).update({"reminder_sent_24h": True})
    db.session.commit()
    if not claimed:
        return "already_sent"

    try:
        messaging_service.send_template_to_contact(
            appointment.client, appointment.contact, REMINDER_TEMPLATE,
            "en_GB", _params(appointment.contact, appointment),
        )
    except (ApiError, WhatsAppError) as exc:
        Appointment.query.filter_by(id=appt_id).update({"reminder_sent_24h": False})
        db.session.commit()
        log.warning("reminder for %s not sent: %s", appt_id, exc)
        if isinstance(exc, WhatsAppError):
            raise  # let Celery retry transient API failures
        return f"blocked:{exc.code}"
    return "sent"


def due_reminder_ids(now=None) -> list[str]:
    now = now or utcnow()
    rows = Appointment.query.filter(
        Appointment.status == "confirmed",
        Appointment.reminder_sent_24h.is_(False),
        Appointment.booking_time > now,
        Appointment.booking_time <= now + REMINDER_LEAD,
    ).all()
    return [str(a.id) for a in rows]


def next_open_appointment(contact: Contact) -> Appointment | None:
    return (
        Appointment.query.filter(
            Appointment.contact_id == contact.id, Appointment.status == "confirmed", Appointment.booking_time > utcnow()
        ).order_by(Appointment.booking_time).first()
    )


def update_appointment(appointment: Appointment, status: str | None, booking_time) -> Appointment:
    if booking_time and booking_time != appointment.booking_time:
        if booking_time <= utcnow():
            raise ApiError("booking_time must be in the future", 422, "booking_in_past")
        appointment.booking_time = booking_time
        appointment.status = status or "confirmed"
        appointment.reminder_sent_24h = False
        reminder_at = booking_time - REMINDER_LEAD
        db.session.commit()
        if reminder_at > utcnow():
            enqueue("appointments.send_reminder_24h", args=(str(appointment.id),), eta=reminder_at)
        return appointment
    if status:
        appointment.status = status
    db.session.commit()
    return appointment
