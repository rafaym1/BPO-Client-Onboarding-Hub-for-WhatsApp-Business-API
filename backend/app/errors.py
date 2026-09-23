import logging

from flask import jsonify
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from werkzeug.exceptions import HTTPException

log = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "bad_request", details=None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.details = details


class ComplianceError(ApiError):
    """Raised when a send would violate GDPR opt-in rules or the WhatsApp 24h service window."""

    def __init__(self, message: str, code: str):
        super().__init__(message, status=403, code=code)


def register_error_handlers(app):
    from .extensions import db
    from .services.whatsapp_service import WhatsAppError

    @app.errorhandler(ApiError)
    def _api_error(e: ApiError):
        body = {"error": {"code": e.code, "message": e.message}}
        if e.details:
            body["error"]["details"] = e.details
        return jsonify(body), e.status

    @app.errorhandler(ValidationError)
    def _validation(e: ValidationError):
        details = [
            {"field": ".".join(str(p) for p in err["loc"]), "message": err["msg"]}
            for err in e.errors(include_url=False, include_context=False, include_input=False)
        ]
        return jsonify({"error": {"code": "validation_error", "message": "Invalid request", "details": details}}), 422

    @app.errorhandler(IntegrityError)
    def _integrity(e: IntegrityError):
        db.session.rollback()
        log.warning("integrity error: %s", e.orig)
        return jsonify({"error": {"code": "conflict", "message": "Record conflicts with an existing one"}}), 409

    @app.errorhandler(WhatsAppError)
    def _whatsapp(e: WhatsAppError):
        return jsonify({"error": {"code": "whatsapp_error", "message": str(e), "details": e.payload}}), 502

    @app.errorhandler(HTTPException)
    def _http(e: HTTPException):
        return jsonify({"error": {"code": e.name.lower().replace(" ", "_"), "message": e.description}}), e.code

    @app.errorhandler(Exception)
    def _unhandled(e: Exception):
        db.session.rollback()
        log.exception("unhandled error")
        return jsonify({"error": {"code": "internal_error", "message": "Internal server error"}}), 500
