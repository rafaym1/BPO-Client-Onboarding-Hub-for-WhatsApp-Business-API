from flask import Blueprint, jsonify, request

from ..errors import ApiError
from ..extensions import db
from ..models import Client
from ..schemas import ChecklistPatch, ClientCreate, ClientUpdate
from ..services import onboarding_service, template_service

bp = Blueprint("clients", __name__, url_prefix="/api/clients")


def _get_client(client_id) -> Client:
    client = db.session.get(Client, client_id)
    if not client:
        raise ApiError("Client not found", 404, "client_not_found")
    return client


def _detail(client: Client) -> dict:
    return {**client.to_dict(), "checklist": [s.to_dict() for s in client.checklist]}


@bp.get("")
def list_clients():
    clients = Client.query.order_by(Client.created_at.desc()).all()
    return jsonify([c.to_dict() for c in clients])


@bp.post("")
def create_client():
    data = ClientCreate.model_validate(request.get_json(silent=True) or {})
    client, jira_error = onboarding_service.create_client(**data.model_dump())
    body = _detail(client)
    body["jira_error"] = jira_error
    return jsonify(body), 201


@bp.get("/<uuid:client_id>")
def get_client(client_id):
    return jsonify(_detail(_get_client(client_id)))


@bp.patch("/<uuid:client_id>")
def update_client(client_id):
    client = _get_client(client_id)
    data = ClientUpdate.model_validate(request.get_json(silent=True) or {})
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(client, field, value)
    db.session.commit()
    return jsonify(_detail(client))


@bp.delete("/<uuid:client_id>")
def delete_client(client_id):
    db.session.delete(_get_client(client_id))
    db.session.commit()
    return "", 204


# ---- onboarding checklist ----
@bp.get("/<uuid:client_id>/checklist")
def get_checklist(client_id):
    return jsonify([s.to_dict() for s in _get_client(client_id).checklist])


@bp.patch("/<uuid:client_id>/checklist/<uuid:step_id>")
def patch_checklist_step(client_id, step_id):
    _get_client(client_id)
    data = ChecklistPatch.model_validate(request.get_json(silent=True) or {})
    step = onboarding_service.set_step_status(client_id, step_id, data.status, data.notes)
    client = _get_client(client_id)
    return jsonify({"step": step.to_dict(), "client": _detail(client)})


@bp.post("/<uuid:client_id>/jira")
def retry_jira(client_id):
    """Retry epic creation if Jira was down when the client was created."""
    client = _get_client(client_id)
    if client.jira_epic_key:
        raise ApiError("Client already has a Jira epic", 409, "jira_exists")
    error = onboarding_service.provision_jira(client)
    if error:
        raise ApiError(error, 502, "jira_error")
    return jsonify(_detail(client))


@bp.post("/<uuid:client_id>/starter-pack")
def create_starter_pack(client_id):
    """Create the 3 healthcare booking templates as drafts (submit them from the Templates page)."""
    client = _get_client(client_id)
    created = template_service.create_starter_pack(client, submit=bool((request.get_json(silent=True) or {}).get("submit")))
    return jsonify([t.to_dict() for t in created]), 201
