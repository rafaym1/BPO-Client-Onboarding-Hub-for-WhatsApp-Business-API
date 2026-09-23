import hashlib
import hmac
import logging

from flask import Blueprint, current_app, request

from ..services import webhook_service

log = logging.getLogger(__name__)
bp = Blueprint("webhooks", __name__, url_prefix="/webhooks")


@bp.get("/whatsapp")
def verify():
    """Meta's one-off subscription handshake: echo hub.challenge if hub.verify_token matches VERIFY_TOKEN."""
    mode = request.args.get("hub.mode")
    token = request.args.get("hub.verify_token", "")
    challenge = request.args.get("hub.challenge", "")
    if mode == "subscribe" and hmac.compare_digest(token, current_app.config["VERIFY_TOKEN"]):
        return challenge, 200, {"Content-Type": "text/plain"}
    log.warning("webhook verification failed (mode=%s)", mode)
    return "Forbidden", 403


def _valid_signature(raw_body: bytes, header: str | None) -> bool:
    secret = current_app.config["WHATSAPP_APP_SECRET"]
    if not secret:
        # No app secret: only tolerated in mock mode, never when talking to the real API
        allowed = current_app.config["MOCK_WHATSAPP"]
        if allowed:
            log.warning("WHATSAPP_APP_SECRET not set - accepting unsigned webhook (mock mode)")
        return allowed
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header or "")


@bp.post("/whatsapp")
def receive():
    raw = request.get_data()  # signature is over the exact bytes, so read before parsing
    if not _valid_signature(raw, request.headers.get("X-Hub-Signature-256")):
        log.warning("rejected webhook with invalid X-Hub-Signature-256")
        return "Invalid signature", 403

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return "Bad payload", 400
    stats = webhook_service.process_payload(payload)
    log.info("webhook processed: %s", stats)
    return "", 200  # always 200 quickly, otherwise Meta retries and eventually disables the subscription
