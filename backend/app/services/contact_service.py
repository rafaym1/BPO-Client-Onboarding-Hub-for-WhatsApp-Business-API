import logging

from ..errors import ApiError
from ..extensions import db
from ..models import Contact
from ..utils import normalize_e164, utcnow

log = logging.getLogger(__name__)


def get_or_create_contact(client_id, phone: str, name: str | None = None) -> tuple[Contact, bool]:
    phone_e164 = normalize_e164(phone)
    contact = Contact.query.filter_by(client_id=client_id, phone_e164=phone_e164).first()
    created = contact is None
    if created:
        contact = Contact(client_id=client_id, phone_e164=phone_e164, name=name, opt_in_status="pending", gdpr_consent=False)
        db.session.add(contact)
        db.session.flush()
    elif name and not contact.name:
        contact.name = name
    return contact, created


def record_opt_in(contact: Contact, status: str, source: str | None, gdpr_consent: bool, consent_text: str | None) -> Contact:
    """Every opt-in is stored with its source + timestamp (GDPR Art. 7(1): controller must be able to demonstrate consent)."""
    if status == "opted_in":
        if not gdpr_consent:
            raise ApiError("Opt-in requires explicit GDPR consent (gdpr_consent=true)", 422, "consent_required")
        if not source:
            raise ApiError("Opt-in requires opt_in_source (qr, keyword or api)", 422, "source_required")
        contact.opt_in_status = "opted_in"
        contact.opt_in_source = source
        contact.opt_in_timestamp = utcnow()
        contact.gdpr_consent = True
        contact.gdpr_consent_text = consent_text or contact.gdpr_consent_text
    else:
        # withdrawal of consent: stop all messaging; keep source/timestamp of the original opt-in as an audit trail
        contact.opt_in_status = "opted_out"
        contact.gdpr_consent = False
    log.info("opt-in change contact=%s status=%s source=%s", contact.id, contact.opt_in_status, contact.opt_in_source)
    return contact
