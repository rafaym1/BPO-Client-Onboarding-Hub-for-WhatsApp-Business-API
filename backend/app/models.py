import uuid
from datetime import timezone

from sqlalchemy import DateTime, ForeignKey, Index, UniqueConstraint
from sqlalchemy.types import TypeDecorator, Uuid

from .extensions import db
from .utils import utcnow

# --- enums (stored as VARCHAR + CHECK so adding a value later is a plain migration, not ALTER TYPE) ---
ONBOARDING_STATUSES = (
    "kickoff", "bm_verification", "number_provisioning", "webhook_setup",
    "template_submission", "optin_test", "go_live", "live",
)
CHECKLIST_STATUSES = ("pending", "in_progress", "done", "blocked")
TEMPLATE_LANGUAGES = ("en_GB", "de_DE")
TEMPLATE_CATEGORIES = ("utility", "marketing", "authentication")
TEMPLATE_STATUSES = ("draft", "pending", "approved", "rejected")
OPT_IN_STATUSES = ("opted_in", "opted_out", "pending")
OPT_IN_SOURCES = ("qr", "keyword", "api")
MESSAGE_DIRECTIONS = ("in", "out")
MESSAGE_TYPES = ("text", "template", "button")
MESSAGE_STATUSES = ("sent", "delivered", "read", "failed")
APPOINTMENT_STATUSES = ("confirmed", "cancelled", "no_show", "rescheduled")


def _enum(name: str, values: tuple[str, ...]):
    return db.Enum(*values, name=name, native_enum=False, create_constraint=True, length=32)


class UTCDateTime(TypeDecorator):
    """Timezone-aware UTC datetimes on every backend (SQLite drops tzinfo, this puts it back)."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value


def _uuid_pk():
    return db.Column(Uuid, primary_key=True, default=uuid.uuid4)


def _iso(dt):
    return dt.isoformat() if dt else None


class Client(db.Model):
    __tablename__ = "clients"

    id = _uuid_pk()
    business_name = db.Column(db.String(255), nullable=False)
    country = db.Column(db.String(64), nullable=False)
    waba_id = db.Column(db.String(64))
    phone_number_id = db.Column(db.String(64), index=True)
    business_manager_id = db.Column(db.String(64))
    onboarding_status = db.Column(_enum("onboarding_status", ONBOARDING_STATUSES), nullable=False, default="kickoff")
    industry = db.Column(db.String(100), nullable=False, default="healthcare")
    created_at = db.Column(UTCDateTime, nullable=False, default=utcnow)
    # additions beyond the base schema: epic link for Jira, go-live date for the clients table
    jira_epic_key = db.Column(db.String(32))
    go_live_date = db.Column(UTCDateTime)

    checklist = db.relationship(
        "OnboardingChecklist", backref="client", cascade="all, delete-orphan", order_by="OnboardingChecklist.step_order"
    )
    templates = db.relationship("WaTemplate", backref="client", cascade="all, delete-orphan")
    contacts = db.relationship("Contact", backref="client", cascade="all, delete-orphan")
    messages = db.relationship("Message", backref="client", cascade="all, delete-orphan")
    appointments = db.relationship("Appointment", backref="client", cascade="all, delete-orphan")

    def to_dict(self, with_progress: bool = True):
        from .services import jira_service

        data = {
            "id": str(self.id),
            "business_name": self.business_name,
            "country": self.country,
            "waba_id": self.waba_id,
            "phone_number_id": self.phone_number_id,
            "business_manager_id": self.business_manager_id,
            "onboarding_status": self.onboarding_status,
            "industry": self.industry,
            "created_at": _iso(self.created_at),
            "jira_epic_key": self.jira_epic_key,
            "jira_epic_url": jira_service.issue_url(self.jira_epic_key),
            "go_live_date": _iso(self.go_live_date),
        }
        if with_progress:
            done = sum(1 for s in self.checklist if s.status == "done")
            data["checklist_progress"] = {"done": done, "total": len(self.checklist)}
        return data


class OnboardingChecklist(db.Model):
    __tablename__ = "onboarding_checklists"
    __table_args__ = (UniqueConstraint("client_id", "step_order", name="uq_checklist_client_order"),)

    id = _uuid_pk()
    client_id = db.Column(Uuid, ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    step_name = db.Column(db.String(100), nullable=False)
    step_order = db.Column(db.Integer, nullable=False)
    status = db.Column(_enum("checklist_status", CHECKLIST_STATUSES), nullable=False, default="pending")
    jira_issue_key = db.Column(db.String(32))
    notes = db.Column(db.Text)

    def to_dict(self):
        from .services import jira_service

        return {
            "id": str(self.id),
            "client_id": str(self.client_id),
            "step_name": self.step_name,
            "step_order": self.step_order,
            "status": self.status,
            "jira_issue_key": self.jira_issue_key,
            "jira_url": jira_service.issue_url(self.jira_issue_key),
            "notes": self.notes,
        }


class WaTemplate(db.Model):
    __tablename__ = "wa_templates"
    __table_args__ = (UniqueConstraint("client_id", "name", "language", name="uq_template_client_name_lang"),)

    id = _uuid_pk()
    client_id = db.Column(Uuid, ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    name = db.Column(db.String(512), nullable=False)
    language = db.Column(_enum("template_language", TEMPLATE_LANGUAGES), nullable=False, default="en_GB")
    category = db.Column(_enum("template_category", TEMPLATE_CATEGORIES), nullable=False, default="utility")
    body_text = db.Column(db.Text, nullable=False)
    header_type = db.Column(db.String(32), nullable=False, default="none")
    status = db.Column(_enum("template_status", TEMPLATE_STATUSES), nullable=False, default="draft")
    meta_template_id = db.Column(db.String(64))
    rejection_reason = db.Column(db.Text)
    # addition: header text, footer text and quick-reply buttons: {"header_text", "footer_text", "buttons": [str]}
    extras_json = db.Column(db.JSON, nullable=False, default=dict)

    def to_dict(self):
        extras = self.extras_json or {}
        return {
            "id": str(self.id),
            "client_id": str(self.client_id),
            "name": self.name,
            "language": self.language,
            "category": self.category,
            "body_text": self.body_text,
            "header_type": self.header_type,
            "header_text": extras.get("header_text"),
            "footer_text": extras.get("footer_text"),
            "buttons": extras.get("buttons", []),
            "status": self.status,
            "meta_template_id": self.meta_template_id,
            "rejection_reason": self.rejection_reason,
        }


class Contact(db.Model):
    __tablename__ = "contacts"
    __table_args__ = (UniqueConstraint("client_id", "phone_e164", name="uq_contact_client_phone"),)

    id = _uuid_pk()
    client_id = db.Column(Uuid, ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    hubspot_id = db.Column(db.String(64))
    phone_e164 = db.Column(db.String(20), nullable=False)
    name = db.Column(db.String(255))
    opt_in_status = db.Column(_enum("opt_in_status", OPT_IN_STATUSES), nullable=False, default="pending")
    opt_in_source = db.Column(_enum("opt_in_source", OPT_IN_SOURCES))
    opt_in_timestamp = db.Column(UTCDateTime)
    gdpr_consent = db.Column(db.Boolean, nullable=False, default=False)
    gdpr_consent_text = db.Column(db.Text)

    def to_dict(self):
        return {
            "id": str(self.id),
            "client_id": str(self.client_id),
            "hubspot_id": self.hubspot_id,
            "phone_e164": self.phone_e164,
            "name": self.name,
            "opt_in_status": self.opt_in_status,
            "opt_in_source": self.opt_in_source,
            "opt_in_timestamp": _iso(self.opt_in_timestamp),
            "gdpr_consent": self.gdpr_consent,
            "gdpr_consent_text": self.gdpr_consent_text,
        }


class Message(db.Model):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_contact_ts", "contact_id", "timestamp"),)

    id = _uuid_pk()
    client_id = db.Column(Uuid, ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    contact_id = db.Column(Uuid, ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    wamid = db.Column(db.String(255), unique=True)
    direction = db.Column(_enum("message_direction", MESSAGE_DIRECTIONS), nullable=False)
    type = db.Column(_enum("message_type", MESSAGE_TYPES), nullable=False, default="text")
    content_json = db.Column(db.JSON, nullable=False, default=dict)
    status = db.Column(_enum("message_status", MESSAGE_STATUSES), nullable=False, default="sent")
    timestamp = db.Column(UTCDateTime, nullable=False, default=utcnow)

    contact = db.relationship("Contact", backref=db.backref("messages", cascade="all, delete-orphan"))

    def to_dict(self):
        content = self.content_json or {}
        return {
            "id": str(self.id),
            "client_id": str(self.client_id),
            "contact_id": str(self.contact_id),
            "wamid": self.wamid,
            "direction": self.direction,
            "type": self.type,
            "content_json": content,
            "body": content.get("body", ""),
            "status": self.status,
            "timestamp": _iso(self.timestamp),
        }


class Appointment(db.Model):
    __tablename__ = "appointments"

    id = _uuid_pk()
    client_id = db.Column(Uuid, ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    contact_id = db.Column(Uuid, ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    booking_time = db.Column(UTCDateTime, nullable=False, index=True)
    status = db.Column(_enum("appointment_status", APPOINTMENT_STATUSES), nullable=False, default="confirmed")
    reminder_sent_24h = db.Column(db.Boolean, nullable=False, default=False)
    confirmation_template_sent = db.Column(db.Boolean, nullable=False, default=False)

    contact = db.relationship("Contact", backref=db.backref("appointments", cascade="all, delete-orphan"))

    def to_dict(self):
        return {
            "id": str(self.id),
            "client_id": str(self.client_id),
            "contact_id": str(self.contact_id),
            "contact": self.contact.to_dict() if self.contact else None,
            "booking_time": _iso(self.booking_time),
            "status": self.status,
            "reminder_sent_24h": self.reminder_sent_24h,
            "confirmation_template_sent": self.confirmation_template_sent,
        }
