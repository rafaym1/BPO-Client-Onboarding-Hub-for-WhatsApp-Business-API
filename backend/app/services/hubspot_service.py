"""HubSpot CRM API v3. Mocked (fake ids + mock log) unless HUBSPOT_TOKEN is set."""
import logging
import uuid
from datetime import datetime, timedelta

import requests
from flask import current_app

from ..extensions import db
from ..utils import utcnow
from . import mock_store

log = logging.getLogger(__name__)

BASE = "https://api.hubapi.com"
# HubSpot-defined association type ids
_ASSOC_NOTE_TO_CONTACT = 202
_ASSOC_TASK_TO_CONTACT = 204
_ASSOC_DEAL_TO_CONTACT = 3


class HubSpotError(Exception):
    pass


def is_mock() -> bool:
    return current_app.config["MOCK_HUBSPOT"]


def _request(method: str, path: str, **kwargs) -> dict:
    try:
        resp = requests.request(
            method, f"{BASE}{path}", headers={"Authorization": f"Bearer {current_app.config['HUBSPOT_TOKEN']}"},
            timeout=15, **kwargs,
        )
    except requests.RequestException as exc:
        raise HubSpotError(f"Could not reach HubSpot: {exc}") from exc
    if not resp.ok:
        raise HubSpotError(f"HubSpot {method} {path} failed: {resp.status_code} {resp.text[:300]}")
    return resp.json() if resp.content else {}


def _assoc(contact_id: str, type_id: int) -> list:
    return [{"to": {"id": contact_id}, "types": [{"associationCategory": "HUBSPOT_DEFINED", "associationTypeId": type_id}]}]


def _iso_ms(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def create_or_update_contact(phone: str, name: str | None, opt_in: bool | None = None) -> str:
    """Upsert by phone number; returns the HubSpot contact id."""
    if is_mock():
        contact_id = f"mock-hs-{uuid.uuid5(uuid.NAMESPACE_URL, phone).hex[:10]}"  # stable per phone, like a real upsert
        mock_store.record("hubspot", "upsert_contact", id=contact_id, phone=phone, name=name, whatsapp_opt_in=opt_in)
        return contact_id

    props = {"phone": phone, "hs_whatsapp_phone_number": phone}
    if name:
        first, _, last = name.partition(" ")
        props["firstname"] = first
        if last:
            props["lastname"] = last
    optin_prop = current_app.config["HUBSPOT_OPTIN_PROPERTY"]
    if optin_prop and opt_in is not None:
        props[optin_prop] = str(bool(opt_in)).lower()

    found = _request("POST", "/crm/v3/objects/contacts/search", json={
        "filterGroups": [{"filters": [{"propertyName": "phone", "operator": "EQ", "value": phone}]}], "limit": 1,
    })
    if found.get("results"):
        contact_id = found["results"][0]["id"]
        _request("PATCH", f"/crm/v3/objects/contacts/{contact_id}", json={"properties": props})
        return contact_id
    return _request("POST", "/crm/v3/objects/contacts", json={"properties": props})["id"]


def log_engagement(contact_id: str, message: dict) -> str:
    """Log a WhatsApp message as a NOTE on the contact timeline. `message` = {direction, body, timestamp}."""
    arrow = "Inbound" if message["direction"] == "in" else "Outbound"
    body = f"[WhatsApp {arrow}] {message['body']}"
    if is_mock():
        engagement_id = f"mock-note-{uuid.uuid4().hex[:8]}"
        mock_store.record("hubspot", "log_engagement", id=engagement_id, contact_id=contact_id, body=body)
        return engagement_id
    return _request("POST", "/crm/v3/objects/notes", json={
        "properties": {"hs_timestamp": message["timestamp"], "hs_note_body": body},
        "associations": _assoc(contact_id, _ASSOC_NOTE_TO_CONTACT),
    })["id"]


def create_task(contact_id: str, subject: str, body: str = "", due: datetime | None = None) -> str:
    due = due or utcnow() + timedelta(hours=4)
    if is_mock():
        task_id = f"mock-task-{uuid.uuid4().hex[:8]}"
        mock_store.record("hubspot", "create_task", id=task_id, contact_id=contact_id, subject=subject, due=due.isoformat())
        return task_id
    return _request("POST", "/crm/v3/objects/tasks", json={
        "properties": {
            "hs_timestamp": _iso_ms(due), "hs_task_subject": subject, "hs_task_body": body,
            "hs_task_status": "NOT_STARTED", "hs_task_priority": "HIGH",
        },
        "associations": _assoc(contact_id, _ASSOC_TASK_TO_CONTACT),
    })["id"]


def create_deal_for_appointment(contact_id: str, appointment, clinic_name: str, when_label: str) -> str:
    name = f"Appointment - {clinic_name} - {when_label}"
    if is_mock():
        deal_id = f"mock-deal-{uuid.uuid4().hex[:8]}"
        mock_store.record("hubspot", "create_deal", id=deal_id, contact_id=contact_id, name=name, appointment_id=str(appointment.id))
        return deal_id
    return _request("POST", "/crm/v3/objects/deals", json={
        "properties": {
            "dealname": name, "pipeline": "default", "dealstage": "appointmentscheduled",
            "closedate": _iso_ms(appointment.booking_time),
        },
        "associations": _assoc(contact_id, _ASSOC_DEAL_TO_CONTACT),
    })["id"]


# ---- helpers used by Celery tasks ----
def ensure_contact_synced(contact) -> str:
    if not contact.hubspot_id:
        contact.hubspot_id = create_or_update_contact(contact.phone_e164, contact.name, contact.opt_in_status == "opted_in")
        db.session.commit()
    return contact.hubspot_id


def log_whatsapp_conversation(message_id: str) -> str | None:
    """Sync the contact (if needed) and log one stored WhatsApp message to HubSpot."""
    from ..models import Message

    message = db.session.get(Message, uuid.UUID(message_id))
    if not message:
        log.warning("log_whatsapp_conversation: message %s not found", message_id)
        return None
    hubspot_id = ensure_contact_synced(message.contact)
    return log_engagement(hubspot_id, {
        "direction": message.direction,
        "body": (message.content_json or {}).get("body", ""),
        "timestamp": _iso_ms(message.timestamp),
    })
