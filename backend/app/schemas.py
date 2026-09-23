import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_PLACEHOLDER = re.compile(r"\{\{(\d+)\}\}")


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# ---- clients ----
class ClientCreate(_Base):
    business_name: str = Field(min_length=1, max_length=255)
    country: str = Field(min_length=2, max_length=64)
    industry: str = Field(default="healthcare", max_length=100)
    waba_id: str | None = None
    phone_number_id: str | None = None
    business_manager_id: str | None = None


class ClientUpdate(_Base):
    business_name: str | None = Field(default=None, min_length=1, max_length=255)
    country: str | None = Field(default=None, min_length=2, max_length=64)
    industry: str | None = None
    waba_id: str | None = None
    phone_number_id: str | None = None
    business_manager_id: str | None = None


class ChecklistPatch(_Base):
    status: Literal["pending", "in_progress", "done", "blocked"] | None = None
    notes: str | None = None


# ---- templates ----
class TemplateCreate(_Base):
    client_id: uuid.UUID
    name: str = Field(pattern=r"^[a-z0-9_]{1,200}$", description="Meta: lowercase letters, digits, underscores")
    language: Literal["en_GB", "de_DE"] = "en_GB"
    category: Literal["utility", "marketing", "authentication"] = "utility"
    body_text: str = Field(min_length=1, max_length=1024)
    header_type: Literal["none", "text"] = "none"
    header_text: str | None = Field(default=None, max_length=60)
    footer_text: str | None = Field(default=None, max_length=60)
    buttons: list[str] = Field(default_factory=list, max_length=3)
    submit: bool = True

    @field_validator("buttons")
    @classmethod
    def _button_len(cls, v):
        for label in v:
            if not 1 <= len(label) <= 25:
                raise ValueError("button labels must be 1-25 characters")
        return v

    @model_validator(mode="after")
    def _check(self):
        _validate_placeholders(self.body_text)
        if self.header_type == "text" and not self.header_text:
            raise ValueError("header_text is required when header_type is 'text'")
        return self


class TemplateUpdate(_Base):
    body_text: str | None = Field(default=None, min_length=1, max_length=1024)
    category: Literal["utility", "marketing", "authentication"] | None = None
    header_type: Literal["none", "text"] | None = None
    header_text: str | None = Field(default=None, max_length=60)
    footer_text: str | None = Field(default=None, max_length=60)
    buttons: list[str] | None = Field(default=None, max_length=3)

    @field_validator("body_text")
    @classmethod
    def _body(cls, v):
        if v is not None:
            _validate_placeholders(v)
        return v


def _validate_placeholders(body: str):
    nums = [int(n) for n in _PLACEHOLDER.findall(body)]
    if nums and sorted(set(nums)) != list(range(1, max(nums) + 1)):
        raise ValueError("body variables must be sequential: {{1}}, {{2}}, ...")


# ---- contacts / opt-in ----
class OptInIn(_Base):
    opt_in_status: Literal["opted_in", "opted_out"] = "opted_in"
    opt_in_source: Literal["qr", "keyword", "api"] | None = None
    gdpr_consent: bool = False
    gdpr_consent_text: str | None = Field(default=None, max_length=2000)


class ContactCreate(_Base):
    client_id: uuid.UUID
    phone: str
    name: str | None = None
    opt_in: OptInIn | None = None


# ---- messaging ----
class SendMessage(_Base):
    type: Literal["text", "template"]
    text: str | None = Field(default=None, min_length=1, max_length=4096)
    template_name: str | None = None
    language: Literal["en_GB", "de_DE"] = "en_GB"
    params: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self):
        if self.type == "text" and not self.text:
            raise ValueError("text is required for type 'text'")
        if self.type == "template" and not self.template_name:
            raise ValueError("template_name is required for type 'template'")
        return self


# ---- appointments ----
class InlineContact(_Base):
    phone: str
    name: str | None = None
    opt_in: OptInIn | None = None


class AppointmentCreate(_Base):
    client_id: uuid.UUID
    contact_id: uuid.UUID | None = None
    contact: InlineContact | None = None
    booking_time: datetime
    language: Literal["en_GB", "de_DE"] = "en_GB"

    @model_validator(mode="after")
    def _check(self):
        if not self.contact_id and not self.contact:
            raise ValueError("provide contact_id or contact")
        return self


class AppointmentUpdate(_Base):
    status: Literal["confirmed", "cancelled", "no_show", "rescheduled"] | None = None
    booking_time: datetime | None = None


# ---- dev simulators ----
class SimulateInbound(_Base):
    client_id: uuid.UUID
    from_phone: str
    name: str | None = None
    text: str
    as_button: bool = False


class SimulateTemplateStatus(_Base):
    template_id: uuid.UUID
    event: Literal["APPROVED", "REJECTED", "PENDING", "PAUSED", "DISABLED"]
    reason: str | None = None
