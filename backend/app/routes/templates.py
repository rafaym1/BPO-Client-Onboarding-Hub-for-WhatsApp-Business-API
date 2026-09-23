import logging
import uuid

from flask import Blueprint, jsonify, request

from ..errors import ApiError
from ..extensions import db
from ..models import Client, WaTemplate
from ..schemas import TemplateCreate, TemplateUpdate
from ..services import template_service
from ..services.whatsapp_service import WhatsAppError

log = logging.getLogger(__name__)
bp = Blueprint("templates", __name__, url_prefix="/api/templates")


def _get_template(template_id) -> WaTemplate:
    template = db.session.get(WaTemplate, template_id)
    if not template:
        raise ApiError("Template not found", 404, "template_not_found")
    return template


@bp.get("")
def list_templates():
    query = WaTemplate.query
    if client_id := request.args.get("client_id"):
        query = query.filter_by(client_id=uuid.UUID(client_id))
    return jsonify([t.to_dict() for t in query.order_by(WaTemplate.name, WaTemplate.language).all()])


@bp.post("")
def create_template():
    """Create a template and (unless submit=false) immediately POST it to Meta for review."""
    data = TemplateCreate.model_validate(request.get_json(silent=True) or {})
    client = db.session.get(Client, data.client_id)
    if not client:
        raise ApiError("Client not found", 404, "client_not_found")
    if WaTemplate.query.filter_by(client_id=client.id, name=data.name, language=data.language).first():
        raise ApiError(f"Template '{data.name}' ({data.language}) already exists", 409, "template_exists")

    template = template_service.create_template(
        client, name=data.name, language=data.language, category=data.category, body_text=data.body_text,
        header_type=data.header_type, header_text=data.header_text, footer_text=data.footer_text, buttons=data.buttons,
    )
    submit_error = None
    if data.submit:
        try:
            template_service.submit_to_meta(template)
        except WhatsAppError as exc:
            log.warning("template %s created but Meta submission failed: %s", template.id, exc)
            submit_error = str(exc)
    return jsonify({**template.to_dict(), "submit_error": submit_error}), 201


@bp.get("/<uuid:template_id>")
def get_template(template_id):
    return jsonify(_get_template(template_id).to_dict())


@bp.patch("/<uuid:template_id>")
def update_template(template_id):
    template = _get_template(template_id)
    if template.status not in ("draft", "rejected"):
        raise ApiError(f"A {template.status} template can't be edited", 409, "template_locked")
    data = TemplateUpdate.model_validate(request.get_json(silent=True) or {})
    changes = data.model_dump(exclude_unset=True)
    extras = dict(template.extras_json or {})
    for key in ("header_text", "footer_text", "buttons"):
        if key in changes:
            extras[key] = changes.pop(key)
    for key, value in changes.items():
        setattr(template, key, value)
    template.extras_json = extras
    db.session.commit()
    return jsonify(template.to_dict())


@bp.delete("/<uuid:template_id>")
def delete_template(template_id):
    db.session.delete(_get_template(template_id))
    db.session.commit()
    return "", 204


@bp.post("/<uuid:template_id>/submit")
def submit_template(template_id):
    template = template_service.submit_to_meta(_get_template(template_id))
    return jsonify(template.to_dict())
