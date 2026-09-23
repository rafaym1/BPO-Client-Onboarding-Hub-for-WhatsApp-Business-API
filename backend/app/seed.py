"""Seed the demo client.

    python -m app.seed                       # Berlin Dental Clinic at 'kickoff', 3 draft templates, 2 contacts
    python -m app.seed --approve-templates   # ...templates already submitted + approved (mock review), ready to book
    python -m app.seed --advance 4           # ...first 4 onboarding steps already done (client at template_submission)
    python -m app.seed --reset               # delete an existing 'Berlin Dental Clinic' first
"""
import argparse

from . import create_app
from .extensions import db
from .models import Client
from .services import contact_service, onboarding_service, template_service

CLINIC = "Berlin Dental Clinic"
CONSENT_TEXT = (
    "I agree to receive appointment confirmations and reminders from Berlin Dental Clinic via WhatsApp. "
    "I can withdraw consent at any time by replying STOP."
)


def seed(reset: bool = False, approve_templates: bool = False, advance: int = 0) -> Client:
    from flask import current_app

    existing = Client.query.filter_by(business_name=CLINIC).first()
    if existing and not reset:
        print(f"'{CLINIC}' already exists ({existing.id}); use --reset to recreate it.")
        return existing
    if existing:
        db.session.delete(existing)
        db.session.commit()

    client, jira_error = onboarding_service.create_client(
        business_name=CLINIC, country="DE", industry="healthcare", business_manager_id="1234567890123456",
    )
    if jira_error:
        print(f"Warning: Jira provisioning failed: {jira_error}")

    # run queued work inline so the seed doesn't need Redis/Celery
    current_app.config["CELERY_EAGER"] = True
    templates = template_service.create_starter_pack(client, submit=approve_templates)

    anna, _ = contact_service.get_or_create_contact(client.id, "+49 151 23456789", "Anna Schmidt")
    contact_service.record_opt_in(anna, "opted_in", "qr", True, CONSENT_TEXT)
    get_pending, _ = contact_service.get_or_create_contact(client.id, "+49 151 98765432", "Markus Weber")  # stays 'pending'
    db.session.commit()

    for step_name in onboarding_service.CHECKLIST_STEPS[:advance]:
        onboarding_service.advance_checklist_step(client.id, step_name)

    db.session.refresh(client)
    print(f"Seeded {client.business_name} ({client.id})")
    print(f"  status={client.onboarding_status} jira_epic={client.jira_epic_key}")
    print(f"  templates={len(templates)} contacts: {anna.name} (opted in), {get_pending.name} (no opt-in)")
    return client


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--approve-templates", action="store_true")
    parser.add_argument("--advance", type=int, default=0, choices=range(0, 8), metavar="0-7")
    args = parser.parse_args()
    with create_app().app_context():
        seed(args.reset, args.approve_templates, args.advance)
