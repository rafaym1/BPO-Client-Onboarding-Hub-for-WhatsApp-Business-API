import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from .errors import ApiError

_E164 = re.compile(r"^\+[1-9]\d{6,14}$")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def normalize_e164(raw: str) -> str:
    """'+49 30 1234-567' / '4930...' (Meta wa_id style) -> '+4930...'; raises on anything invalid."""
    cleaned = re.sub(r"[\s\-().]", "", raw or "")
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    if not cleaned.startswith("+"):
        cleaned = "+" + cleaned
    if not _E164.match(cleaned):
        raise ApiError(f"'{raw}' is not a valid E.164 phone number", 422, "invalid_phone")
    return cleaned


def format_local(dt: datetime, tz_name: str) -> str:
    """Patient-facing appointment time, e.g. 'Mon 12 May 2026, 10:30' in the clinic's timezone."""
    return dt.astimezone(ZoneInfo(tz_name)).strftime("%a %d %b %Y, %H:%M")
