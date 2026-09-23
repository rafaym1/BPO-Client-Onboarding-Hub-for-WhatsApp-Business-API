"""Processes Meta webhook payloads: inbound messages, delivery statuses, template review results.

Also used by the mock simulators, so mocked events exercise exactly the same code path as real ones.
"""
import logging
import re
from datetime import datetime, timezone

from ..extensions import db, enqueue
from ..models import Client, Message, WaTemplate
from . import appointment_service, contact_service, whatsapp_service

log = logging.getLogger(__name__)

_STATUS_RANK = {"sent": 1, "delivered": 2, "read": 3}
_YES = {"yes", "ja"}
_RESCHEDULE = {"no", "nein", "reschedule", "umbuchen"}
_STOP = {"stop", "stopp", "abmelden"}


def classify_intent(text: str) -> str | None:
    word = re.sub(r"[^\w\s]", "", (text or "").lower()).strip()
    if word in _RESCHEDULE:
        return "reschedule"
    if word in _YES:
        return "confirm"
    if word in _STOP:
        return "stop"
    return None


def process_payload(payload: dict, client_hint: Client | None = None) -> dict:
    stats = {"messages": 0, "statuses": 0, "template_updates": 0, "ignored": 0}
    follow_ups: list[tuple] = []  # (task name, args[, countdown]); enqueued only after the DB commit

    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            field, value = change.get("field"), change.get("value", {})
            if field == "messages":
                _handle_messages(value, client_hint, stats, follow_ups)
                _handle_statuses(value, stats, follow_ups)
            elif field == "message_template_status_update":
                _handle_template_status(entry.get("id"), value, stats, follow_ups)
            else:
                stats["ignored"] += 1
                log.info("ignoring webhook field %s", field)
    db.session.commit()

    for name, args, *countdown in follow_ups:
        enqueue(name, args=args, countdown=countdown[0] if countdown else None)
    return stats


def _resolve_client(phone_number_id: str | None, hint: Client | None) -> Client | None:
    if hint:
        return hint
    if not phone_number_id:
        return None
    # A Meta test number can be shared by several demo clients; real tenants have unique numbers.
    # Newest first, so the client you just created in the demo wins.
    return Client.query.filter_by(phone_number_id=phone_number_id).order_by(Client.created_at.desc()).first()


def _handle_messages(value: dict, hint: Client | None, stats: dict, follow_ups: list):
    inbound = value.get("messages") or []
    if not inbound:
        return
    client = _resolve_client(value.get("metadata", {}).get("phone_number_id"), hint)
    if not client:
        log.warning("inbound message for unknown phone_number_id=%s", value.get("metadata"))
        stats["ignored"] += len(inbound)
        return
    names = {c.get("wa_id"): (c.get("profile") or {}).get("name") for c in value.get("contacts", [])}

    for m in inbound:
        kind, body, extra = _parse_inbound(m)
        if kind is None:
            log.info("ignoring inbound type=%s", m.get("type"))
            stats["ignored"] += 1
            continue
        if Message.query.filter_by(wamid=m["id"]).first():
            continue  # Meta retries webhooks; dedupe on wamid

        contact, _ = contact_service.get_or_create_contact(client.id, m["from"], names.get(m["from"]))
        message = Message(
            client_id=client.id, contact_id=contact.id, wamid=m["id"], direction="in", type=kind,
            content_json={"body": body, **extra}, status="delivered",
            timestamp=datetime.fromtimestamp(int(m["timestamp"]), tz=timezone.utc),
        )
        db.session.add(message)
        db.session.flush()
        stats["messages"] += 1

        intent = classify_intent(body)
        appointment_id = None
        if intent == "reschedule":
            appointment = appointment_service.next_open_appointment(contact)
            if appointment:
                appointment.status = "rescheduled"
                appointment_id = str(appointment.id)
        elif intent == "stop":
            contact_service.record_opt_in(contact, "opted_out", None, False, None)
        db.session.flush()
        follow_ups.append(("hubspot_service.log_whatsapp_conversation", (str(message.id),)))
        if intent:
            follow_ups.append(("inbound.follow_up", (str(message.id), intent, appointment_id)))


def _parse_inbound(m: dict) -> tuple[str | None, str, dict]:
    mtype = m.get("type")
    if mtype == "text":
        return "text", m["text"]["body"], {}
    if mtype == "button":  # tap on a template quick-reply button
        b = m["button"]
        return "button", b.get("text") or b.get("payload", ""), {"payload": b.get("payload")}
    if mtype == "interactive" and (m.get("interactive") or {}).get("button_reply"):
        b = m["interactive"]["button_reply"]
        return "button", b.get("title", ""), {"payload": b.get("id")}
    return None, "", {}


def _handle_statuses(value: dict, stats: dict, follow_ups: list):
    for s in value.get("statuses") or []:
        new = s.get("status")
        message = Message.query.filter_by(wamid=s.get("id")).first()
        if new not in (*_STATUS_RANK, "failed") or not message:
            stats["ignored"] += 1
            continue
        if new == "failed":
            message.status = "failed"
            message.content_json = {**message.content_json, "error": (s.get("errors") or [{}])[0]}
        elif message.status != "failed" and _STATUS_RANK[new] > _STATUS_RANK.get(message.status, 0):
            message.status = new
        stats["statuses"] += 1
        if new == "delivered" and message.direction == "out" and whatsapp_service.is_mock():
            follow_ups.append(("mock.status_update", (message.wamid, "read"), 4))  # mock patient 'reads' it


def _handle_template_status(waba_id: str | None, value: dict, stats: dict, follow_ups: list):
    event = str(value.get("event", "")).upper()
    meta_id = str(value.get("message_template_id", ""))
    template = WaTemplate.query.filter_by(meta_template_id=meta_id).first() if meta_id else None
    if not template:
        client = Client.query.filter_by(waba_id=waba_id).order_by(Client.created_at.desc()).first()
        if client:
            template = WaTemplate.query.filter_by(
                client_id=client.id, name=value.get("message_template_name"), language=value.get("message_template_language"),
            ).first()
    if not template:
        log.warning("template status update for unknown template %s / %s", meta_id, value.get("message_template_name"))
        stats["ignored"] += 1
        return

    reason = value.get("reason")
    reason = None if not reason or reason == "NONE" else reason
    if event == "APPROVED":
        template.status, template.rejection_reason = "approved", None
    elif event == "REJECTED":
        template.status, template.rejection_reason = "rejected", reason or "REJECTED"
    elif event in ("PAUSED", "DISABLED"):
        template.status, template.rejection_reason = "rejected", f"{event}{f': {reason}' if reason else ''}"
    elif event == "PENDING":
        template.status = "pending"
    else:
        stats["ignored"] += 1
        return
    stats["template_updates"] += 1
    db.session.flush()
    follow_ups.append(("onboarding.templates_changed", (str(template.client_id),)))
