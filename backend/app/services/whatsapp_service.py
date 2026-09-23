"""Thin wrapper over the WhatsApp Cloud API (Graph v20.0).

Real calls are used when WHATSAPP_TOKEN is set; otherwise (or with MOCK_WHATSAPP=true) every call is
faked and recorded in the mock store. Compliance (opt-in, 24h window) lives in messaging_service, not here.
"""
import logging
import re
import uuid

import requests
from flask import current_app

from . import mock_store

log = logging.getLogger(__name__)

_PLACEHOLDER = re.compile(r"\{\{(\d+)\}\}")
_SAMPLE_VALUES = ["Anna", "Mon 12 May 2026, 10:30", "Dr. Weber", "Berlin", "12345"]


class WhatsAppError(Exception):
    def __init__(self, message: str, payload: dict | None = None, status_code: int | None = None):
        super().__init__(message)
        self.payload = payload or {}
        self.status_code = status_code


def is_mock() -> bool:
    return current_app.config["MOCK_WHATSAPP"]


def _headers() -> dict:
    return {"Authorization": f"Bearer {current_app.config['WHATSAPP_TOKEN']}", "Content-Type": "application/json"}


def _post(path: str, body: dict) -> dict:
    url = f"{current_app.config['GRAPH_API_BASE']}/{path}"
    try:
        resp = requests.post(url, json=body, headers=_headers(), timeout=15)
    except requests.RequestException as exc:
        raise WhatsAppError(f"Could not reach Graph API: {exc}") from exc
    data = resp.json() if resp.content else {}
    if not resp.ok:
        err = data.get("error", {})
        raise WhatsAppError(err.get("error_user_msg") or err.get("message") or "Graph API error", data, resp.status_code)
    return data


def _digits(phone: str) -> str:
    return phone.lstrip("+")


def _phone_number_id(phone_number_id: str | None) -> str:
    pid = phone_number_id or current_app.config["PHONE_NUMBER_ID"]
    if not pid and not is_mock():
        raise WhatsAppError("No phone_number_id configured for this client or in PHONE_NUMBER_ID")
    return pid or "mock-phone-number-id"


def _mock_wamid() -> str:
    return f"wamid.MOCK{uuid.uuid4().hex[:24].upper()}"


def send_template(to: str, template_name: str, language: str, components: list | None = None,
                  phone_number_id: str | None = None) -> dict:
    """POST /{phone_number_id}/messages with type=template. Returns {'wamid': ..., 'raw': ...}."""
    pid = _phone_number_id(phone_number_id)
    body = {
        "messaging_product": "whatsapp",
        "to": _digits(to),
        "type": "template",
        "template": {"name": template_name, "language": {"code": language}, "components": components or []},
    }
    if is_mock():
        wamid = _mock_wamid()
        mock_store.record("whatsapp", "send_template", phone_number_id=pid, wamid=wamid, request=body)
        return {"wamid": wamid, "raw": {"mock": True}}
    data = _post(f"{pid}/messages", body)
    return {"wamid": data["messages"][0]["id"], "raw": data}


def send_text(to: str, text: str, phone_number_id: str | None = None) -> dict:
    pid = _phone_number_id(phone_number_id)
    body = {
        "messaging_product": "whatsapp",
        "to": _digits(to),
        "type": "text",
        "text": {"preview_url": False, "body": text},
    }
    if is_mock():
        wamid = _mock_wamid()
        mock_store.record("whatsapp", "send_text", phone_number_id=pid, wamid=wamid, request=body)
        return {"wamid": wamid, "raw": {"mock": True}}
    data = _post(f"{pid}/messages", body)
    return {"wamid": data["messages"][0]["id"], "raw": data}


def submit_template(waba_id: str, name: str, category: str, components: list, language: str = "en_GB") -> dict:
    """POST /{waba_id}/message_templates. Returns {'id': meta_template_id, 'status': 'PENDING'|...}."""
    if not waba_id and not is_mock():
        raise WhatsAppError("No waba_id configured for this client or in WABA_ID")
    body = {"name": name, "category": category.upper(), "language": language, "components": components}
    if is_mock():
        meta_id = str(uuid.uuid4().int)[:15]
        mock_store.record("whatsapp", "submit_template", waba_id=waba_id, meta_template_id=meta_id, request=body)
        return {"id": meta_id, "status": "PENDING", "category": category.upper()}
    return _post(f"{waba_id}/message_templates", body)


# ---- template helpers ----
def placeholder_count(body_text: str) -> int:
    nums = [int(n) for n in _PLACEHOLDER.findall(body_text)]
    return max(nums) if nums else 0


def render_body(body_text: str, params: list[str]) -> str:
    return _PLACEHOLDER.sub(lambda m: params[int(m.group(1)) - 1] if int(m.group(1)) <= len(params) else m.group(0), body_text)


def build_submission_components(body_text: str, header_type: str = "none", extras: dict | None = None) -> list:
    """Meta template `components` array from our flattened template fields (with the mandatory body examples)."""
    extras = extras or {}
    components: list[dict] = []
    if header_type == "text" and extras.get("header_text"):
        components.append({"type": "HEADER", "format": "TEXT", "text": extras["header_text"]})
    body: dict = {"type": "BODY", "text": body_text}
    n = placeholder_count(body_text)
    if n:
        body["example"] = {"body_text": [[_SAMPLE_VALUES[i % len(_SAMPLE_VALUES)] for i in range(n)]]}
    components.append(body)
    if extras.get("footer_text"):
        components.append({"type": "FOOTER", "text": extras["footer_text"]})
    if extras.get("buttons"):
        components.append({"type": "BUTTONS", "buttons": [{"type": "QUICK_REPLY", "text": b} for b in extras["buttons"]]})
    return components


def build_send_components(params: list[str]) -> list:
    if not params:
        return []
    return [{"type": "body", "parameters": [{"type": "text", "text": p} for p in params]}]
