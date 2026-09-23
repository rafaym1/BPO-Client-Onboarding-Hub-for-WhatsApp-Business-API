import hashlib
import hmac
import json
import os
import sys
import time
from datetime import timedelta

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.utils import utcnow  # noqa: E402

APP_SECRET = "test-app-secret"


@pytest.fixture()
def app(tmp_path):
    app = create_app({
        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'test.db'}",
        "CELERY_EAGER": True,
        "MOCK_DATA_DIR": str(tmp_path / "mock"),
        "MOCK_WHATSAPP": True, "MOCK_HUBSPOT": True, "MOCK_JIRA": True,
        "WHATSAPP_APP_SECRET": APP_SECRET, "VERIFY_TOKEN": "verify-me",
        "PHONE_NUMBER_ID": "111222333", "WABA_ID": "999888777",
        "TESTING": True,
    })
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()


@pytest.fixture()
def api(app):
    return app.test_client()


@pytest.fixture()
def clinic(api):
    resp = api.post("/api/clients", json={"business_name": "Berlin Dental Clinic", "country": "DE"})
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()


@pytest.fixture()
def approved_pack(api, clinic):
    """Starter pack created + submitted; eager mock review approves everything."""
    resp = api.post(f"/api/clients/{clinic['id']}/starter-pack", json={"submit": True})
    assert resp.status_code == 201
    return resp.get_json()


@pytest.fixture()
def patient(api, clinic):
    resp = api.post("/api/contacts", json={
        "client_id": clinic["id"], "phone": "+49 151 23456789", "name": "Anna Schmidt",
        "opt_in": {"opt_in_status": "opted_in", "opt_in_source": "qr", "gdpr_consent": True, "gdpr_consent_text": "I agree"},
    })
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()


def book(api, clinic, contact, hours_ahead=48):
    when = (utcnow() + timedelta(hours=hours_ahead)).isoformat()
    resp = api.post("/api/appointments", json={"client_id": clinic["id"], "contact_id": contact["id"], "booking_time": when})
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()


def inbound_payload(clinic, phone="4915123456789", text="Hello", wamid=None, button=False):
    message = {"from": phone, "id": wamid or f"wamid.IN{time.time_ns()}", "timestamp": str(int(time.time()))}
    message |= {"type": "button", "button": {"text": text, "payload": text}} if button else {"type": "text", "text": {"body": text}}
    return {"object": "whatsapp_business_account", "entry": [{"id": clinic["waba_id"], "changes": [{"field": "messages", "value": {
        "messaging_product": "whatsapp",
        "metadata": {"phone_number_id": clinic["phone_number_id"]},
        "contacts": [{"profile": {"name": "Anna Schmidt"}, "wa_id": phone}],
        "messages": [message],
    }}]}]}


def post_webhook(api, payload, secret=APP_SECRET):
    raw = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return api.post("/webhooks/whatsapp", data=raw, headers={"X-Hub-Signature-256": sig, "Content-Type": "application/json"})
