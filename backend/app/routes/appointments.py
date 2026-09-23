import uuid

from flask import Blueprint, jsonify, request

from ..errors import ApiError
from ..extensions import db
from ..models import Appointment
from ..schemas import AppointmentCreate, AppointmentUpdate
from ..services import appointment_service

bp = Blueprint("appointments", __name__, url_prefix="/api/appointments")


@bp.get("")
def list_appointments():
    query = Appointment.query
    if client_id := request.args.get("client_id"):
        query = query.filter_by(client_id=uuid.UUID(client_id))
    return jsonify([a.to_dict() for a in query.order_by(Appointment.booking_time).all()])


@bp.post("")
def create_appointment():
    data = AppointmentCreate.model_validate(request.get_json(silent=True) or {})
    appointment, warning = appointment_service.create_appointment(data)
    return jsonify({**appointment.to_dict(), "warning": warning}), 201


@bp.patch("/<uuid:appointment_id>")
def update_appointment(appointment_id):
    appointment = db.session.get(Appointment, appointment_id)
    if not appointment:
        raise ApiError("Appointment not found", 404, "appointment_not_found")
    data = AppointmentUpdate.model_validate(request.get_json(silent=True) or {})
    return jsonify(appointment_service.update_appointment(appointment, data.status, data.booking_time).to_dict())
