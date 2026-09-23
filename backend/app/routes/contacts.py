import uuid

from flask import Blueprint, jsonify, request

from ..errors import ApiError
from ..extensions import db
from ..models import Client, Contact, Message
from ..schemas import ContactCreate, OptInIn, SendMessage
from ..services import contact_service, messaging_service

bp = Blueprint("contacts", __name__, url_prefix="/api")


def _get_contact(contact_id) -> Contact:
    contact = db.session.get(Contact, contact_id)
    if not contact:
        raise ApiError("Contact not found", 404, "contact_not_found")
    return contact


def _contact_view(contact: Contact) -> dict:
    return {**contact.to_dict(), "service_window": messaging_service.window_state(contact)}


@bp.get("/contacts")
def list_contacts():
    query = Contact.query
    if client_id := request.args.get("client_id"):
        query = query.filter_by(client_id=uuid.UUID(client_id))
    return jsonify([_contact_view(c) for c in query.order_by(Contact.name).all()])


@bp.post("/contacts")
def create_contact():
    data = ContactCreate.model_validate(request.get_json(silent=True) or {})
    if not db.session.get(Client, data.client_id):
        raise ApiError("Client not found", 404, "client_not_found")
    contact, created = contact_service.get_or_create_contact(data.client_id, data.phone, data.name)
    if data.opt_in:
        contact_service.record_opt_in(
            contact, data.opt_in.opt_in_status, data.opt_in.opt_in_source, data.opt_in.gdpr_consent, data.opt_in.gdpr_consent_text
        )
    db.session.commit()
    return jsonify(_contact_view(contact)), 201 if created else 200


@bp.post("/contacts/<uuid:contact_id>/opt-in")
def set_opt_in(contact_id):
    """Record opt-in (source + timestamp + GDPR consent text) or opt-out."""
    contact = _get_contact(contact_id)
    data = OptInIn.model_validate(request.get_json(silent=True) or {})
    contact_service.record_opt_in(contact, data.opt_in_status, data.opt_in_source, data.gdpr_consent, data.gdpr_consent_text)
    db.session.commit()
    return jsonify(_contact_view(contact))


# ---- inbox ----
@bp.get("/clients/<uuid:client_id>/inbox")
def inbox(client_id):
    """Contacts with their latest message and 24h-window state, most recent conversation first."""
    if not db.session.get(Client, client_id):
        raise ApiError("Client not found", 404, "client_not_found")
    rows = []
    for contact in Contact.query.filter_by(client_id=client_id).all():
        last = Message.query.filter_by(contact_id=contact.id).order_by(Message.timestamp.desc()).first()
        rows.append({**_contact_view(contact), "last_message": last.to_dict() if last else None})
    rows.sort(key=lambda r: (r["last_message"] or {}).get("timestamp") or "", reverse=True)
    return jsonify(rows)


@bp.get("/contacts/<uuid:contact_id>/messages")
def list_messages(contact_id):
    contact = _get_contact(contact_id)
    messages = Message.query.filter_by(contact_id=contact.id).order_by(Message.timestamp).all()
    return jsonify({"contact": _contact_view(contact), "messages": [m.to_dict() for m in messages]})


@bp.post("/contacts/<uuid:contact_id>/messages")
def send_message(contact_id):
    """Send free-form text (only inside the 24h window) or an approved template (only to opted-in contacts)."""
    contact = _get_contact(contact_id)
    data = SendMessage.model_validate(request.get_json(silent=True) or {})
    client = contact.client
    if data.type == "text":
        message = messaging_service.send_text_to_contact(client, contact, data.text)
    else:
        message = messaging_service.send_template_to_contact(client, contact, data.template_name, data.language, data.params)
    return jsonify(message.to_dict()), 201
