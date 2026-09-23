import json
from datetime import timedelta
from uuid import UUID

from app.extensions import db
from app.models import Appointment, Contact, Message, WaTemplate
from app.services import mock_store
from app.utils import utcnow

from conftest import APP_SECRET, book, inbound_payload, post_webhook


# ---------- clients / Jira ----------
def test_create_client_builds_checklist_and_jira_epic(clinic):
    steps = clinic["checklist"]
    assert [s["step_name"] for s in steps] == [
        "Client Intake", "BM Verification Check", "Number Provisioning", "Webhook Setup",
        "Template Pack Submission", "Opt-in Flow Test", "Go-live",
    ]
    assert [s["step_order"] for s in steps] == list(range(1, 8))
    assert all(s["jira_issue_key"] for s in steps)
    assert len({s["jira_issue_key"] for s in steps}) == 7
    assert clinic["jira_epic_key"] and clinic["jira_epic_key"] not in {s["jira_issue_key"] for s in steps}
    assert steps[0]["status"] == "in_progress" and steps[1]["status"] == "pending"
    assert clinic["onboarding_status"] == "kickoff"
    assert clinic["waba_id"] == "999888777" and clinic["phone_number_id"] == "111222333"  # defaulted from env


def test_jira_epic_summary_and_subtasks_logged(app, clinic):
    log = mock_store.read("jira")
    epic = [e for e in log if e["action"] == "create_epic"][0]
    assert epic["summary"] == "Onboard Berlin Dental Clinic to WhatsApp API"
    assert len([e for e in log if e["action"] == "create_task" and e["parent"] == epic["key"]]) == 7


def test_advancing_steps_updates_status_jira_and_go_live(api, clinic):
    cid = clinic["id"]
    for i, step in enumerate(clinic["checklist"]):
        r = api.patch(f"/api/clients/{cid}/checklist/{step['id']}", json={"status": "done"})
        assert r.status_code == 200, r.get_json()
        client = r.get_json()["client"]
        if i < 6:
            expected = ["bm_verification", "number_provisioning", "webhook_setup", "template_submission", "optin_test", "go_live"][i]
            assert client["onboarding_status"] == expected
            assert client["checklist"][i + 1]["status"] == "in_progress"
    assert client["onboarding_status"] == "live" and client["go_live_date"]
    done = [e for e in mock_store.read("jira") if e["action"] == "transition" and e["to"] == "Done"]
    assert len(done) == 7


def test_cannot_go_live_early(api, clinic):
    go_live = clinic["checklist"][6]
    r = api.patch(f"/api/clients/{clinic['id']}/checklist/{go_live['id']}", json={"status": "done"})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "steps_incomplete"


# ---------- templates ----------
def test_template_create_submits_to_meta_and_webhook_approves(api, clinic):
    r = api.post("/api/templates", json={
        "client_id": clinic["id"], "name": "appointment_confirmation", "language": "en_GB", "category": "utility",
        "body_text": "Hi {{1}}, your appointment on {{2}} is confirmed.",
    })
    assert r.status_code == 201
    body = r.get_json()
    assert body["meta_template_id"] and body["status"] == "approved"  # eager mode ran the mock review inline
    submit = [e for e in mock_store.read("whatsapp") if e["action"] == "submit_template"][0]
    assert submit["request"]["category"] == "UTILITY"
    assert submit["request"]["components"][0]["example"]["body_text"] == [["Anna", "Mon 12 May 2026, 10:30"]]


def test_template_rejection_webhook_stores_reason(api, clinic):
    r = api.post("/api/templates", json={
        "client_id": clinic["id"], "name": "promo", "category": "utility", "body_text": "Get 20% off cleaning, {{1}}!",
    })
    body = r.get_json()
    assert body["status"] == "rejected" and body["rejection_reason"] == "INCORRECT_CATEGORY"


def test_template_status_webhook_real_payload_shape(api, clinic):
    r = api.post("/api/templates", json={"client_id": clinic["id"], "name": "later", "body_text": "Hi {{1}}", "submit": False})
    tid = r.get_json()["id"]
    assert r.get_json()["status"] == "draft"
    api.post(f"/api/templates/{tid}/submit")
    template = db.session.get(WaTemplate, UUID(tid))
    template.status = "pending"
    db.session.commit()
    payload = {"object": "whatsapp_business_account", "entry": [{"id": clinic["waba_id"], "changes": [{
        "field": "message_template_status_update",
        "value": {"event": "REJECTED", "message_template_id": int(template.meta_template_id),
                  "message_template_name": "later", "message_template_language": "en_GB", "reason": "INVALID_FORMAT"}}]}]}
    assert post_webhook(api, payload).status_code == 200
    db.session.expire_all()
    assert template.status == "rejected" and template.rejection_reason == "INVALID_FORMAT"


def test_starter_pack_approval_completes_template_step(api, clinic, approved_pack):
    assert {t["status"] for t in approved_pack} == {"approved"}
    steps = api.get(f"/api/clients/{clinic['id']}/checklist").get_json()
    assert steps[4]["status"] == "done"


def test_bad_template_variables_rejected(api, clinic):
    r = api.post("/api/templates", json={"client_id": clinic["id"], "name": "x", "body_text": "Hi {{2}}"})
    assert r.status_code == 422


# ---------- webhook security ----------
def test_webhook_verification(api):
    ok = api.get("/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345")
    assert ok.status_code == 200 and ok.data == b"12345"
    assert api.get("/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1").status_code == 403


def test_webhook_rejects_bad_signature(api, clinic):
    payload = inbound_payload(clinic)
    assert post_webhook(api, payload, secret="wrong").status_code == 403
    assert api.post("/webhooks/whatsapp", json=payload).status_code == 403
    assert Message.query.count() == 0


def test_inbound_message_saved_deduped_and_logged_to_hubspot(api, clinic):
    payload = inbound_payload(clinic, text="Hello!", wamid="wamid.ONE")
    assert post_webhook(api, payload).status_code == 200
    assert post_webhook(api, payload).status_code == 200  # Meta retry
    msgs = Message.query.all()
    assert len(msgs) == 1 and msgs[0].direction == "in" and msgs[0].content_json["body"] == "Hello!"
    contact = Contact.query.one()
    assert contact.phone_e164 == "+4915123456789" and contact.opt_in_status == "pending" and contact.hubspot_id
    assert [e["action"] for e in mock_store.read("hubspot")].count("log_engagement") == 1


# ---------- GDPR + 24h window ----------
def test_template_blocked_without_opt_in_or_consent(api, clinic, approved_pack):
    stranger = api.post("/api/contacts", json={"client_id": clinic["id"], "phone": "+491700000001", "name": "No Consent"}).get_json()
    r = api.post(f"/api/contacts/{stranger['id']}/messages", json={"type": "template", "template_name": "appointment_confirmation", "params": ["A", "B"]})
    assert r.status_code == 403 and r.get_json()["error"]["code"] == "not_opted_in"

    contact = db.session.get(Contact, UUID(stranger["id"]))
    contact.opt_in_status = "opted_in"  # opted in but consent flag missing
    db.session.commit()
    r = api.post(f"/api/contacts/{stranger['id']}/messages", json={"type": "template", "template_name": "appointment_confirmation", "params": ["A", "B"]})
    assert r.status_code == 403 and r.get_json()["error"]["code"] == "no_gdpr_consent"


def test_opt_in_requires_consent_and_source(api, clinic):
    r = api.post("/api/contacts", json={"client_id": clinic["id"], "phone": "+491700000002", "opt_in": {"opt_in_status": "opted_in", "opt_in_source": "qr"}})
    assert r.status_code == 422 and r.get_json()["error"]["code"] == "consent_required"
    r = api.post("/api/contacts", json={"client_id": clinic["id"], "phone": "+491700000003", "opt_in": {"opt_in_status": "opted_in", "gdpr_consent": True}})
    assert r.status_code == 422 and r.get_json()["error"]["code"] == "source_required"


def test_opt_in_records_source_and_timestamp(patient):
    assert patient["opt_in_source"] == "qr" and patient["opt_in_timestamp"] and patient["gdpr_consent"] is True


def test_free_text_only_inside_24h_window(api, clinic, patient):
    r = api.post(f"/api/contacts/{patient['id']}/messages", json={"type": "text", "text": "Hello"})
    assert r.status_code == 403 and r.get_json()["error"]["code"] == "window_closed"

    post_webhook(api, inbound_payload(clinic, text="Hi, question about my visit"))
    assert api.post(f"/api/contacts/{patient['id']}/messages", json={"type": "text", "text": "Sure, how can we help?"}).status_code == 201

    old = utcnow() - timedelta(hours=25)
    Message.query.filter_by(direction="in").update({"timestamp": old})
    db.session.commit()
    r = api.post(f"/api/contacts/{patient['id']}/messages", json={"type": "text", "text": "Still there?"})
    assert r.status_code == 403 and r.get_json()["error"]["code"] == "window_closed"


# ---------- appointments / reminders ----------
def test_booking_sends_confirmation_template_and_syncs_hubspot(api, clinic, patient, approved_pack):
    appt = book(api, clinic, patient)
    assert appt["warning"] is None and appt["confirmation_template_sent"] is True and appt["reminder_sent_24h"] is False
    out = Message.query.filter_by(direction="out").one()
    assert out.type == "template" and out.content_json["template"] == "appointment_confirmation"
    assert out.content_json["body"].startswith("Hi Anna, your appointment at Berlin Dental Clinic on ")
    assert out.content_json["body"].endswith("is confirmed. Reply YES to confirm, RESCHEDULE to change.")
    actions = [e["action"] for e in mock_store.read("hubspot")]
    assert "create_deal" in actions and "upsert_contact" in actions
    sent = [e for e in mock_store.read("whatsapp") if e["action"] == "send_template"][0]
    assert sent["request"]["template"]["components"][0]["parameters"][0]["text"] == "Anna"


def test_delivery_status_progression_via_webhook(api, clinic, patient, approved_pack):
    book(api, clinic, patient)
    db.session.expire_all()
    assert Message.query.filter_by(direction="out").one().status == "read"  # eager mock: sent -> delivered -> read

    out = Message.query.filter_by(direction="out").one()
    out.status = "sent"
    db.session.commit()
    status = lambda s: {"object": "whatsapp_business_account", "entry": [{"id": "x", "changes": [{"field": "messages", "value": {
        "metadata": {"phone_number_id": clinic["phone_number_id"]}, "statuses": [{"id": out.wamid, "status": s, "timestamp": "1"}]}}]}]}
    post_webhook(api, status("delivered"))
    db.session.expire_all()
    assert out.status in ("delivered", "read")


def test_booking_without_opt_in_still_books_but_warns(api, clinic, approved_pack):
    r = api.post("/api/appointments", json={
        "client_id": clinic["id"], "contact": {"phone": "+491700000009", "name": "Phone Patient"},
        "booking_time": (utcnow() + timedelta(days=3)).isoformat(),
    })
    body = r.get_json()
    assert r.status_code == 201 and body["confirmation_template_sent"] is False
    assert body["warning"]["code"] == "not_opted_in"
    assert Message.query.count() == 0


def test_hourly_sweep_sends_reminder_once(api, clinic, patient, approved_pack):
    from app.tasks import sweep_due_reminders

    book(api, clinic, patient, hours_ahead=60)                       # not due
    due = book(api, clinic, patient, hours_ahead=20)                 # due
    assert sweep_due_reminders.apply().get() == 1
    db.session.expire_all()
    assert Appointment.query.filter_by(reminder_sent_24h=True).count() == 1
    reminder = [m for m in Message.query.filter_by(direction="out").all() if m.content_json.get("template") == "appointment_reminder_24h"]
    assert len(reminder) == 1 and reminder[0].content_json["buttons"] == ["Yes", "No"]
    assert sweep_due_reminders.apply().get() == 0                    # idempotent
    assert db.session.get(Appointment, UUID(due["id"])).reminder_sent_24h is True


def test_no_or_reschedule_reply_reschedules_and_creates_hubspot_task(api, clinic, patient, approved_pack):
    appt = book(api, clinic, patient)
    post_webhook(api, inbound_payload(clinic, text="No", button=True))
    db.session.expire_all()
    assert db.session.get(Appointment, UUID(appt["id"])).status == "rescheduled"
    tasks = [e for e in mock_store.read("hubspot") if e["action"] == "create_task"]
    assert len(tasks) == 1 and "Anna Schmidt" in tasks[0]["subject"]
    ack = Message.query.filter_by(direction="out", type="text").one()  # free-form ack allowed: patient just wrote
    assert "new appointment time" in ack.content_json["body"]


def test_reschedule_keyword_case_insensitive(api, clinic, patient, approved_pack):
    appt = book(api, clinic, patient)
    post_webhook(api, inbound_payload(clinic, text=" reschedule! "))
    db.session.expire_all()
    assert db.session.get(Appointment, UUID(appt["id"])).status == "rescheduled"


def test_yes_keeps_confirmed(api, clinic, patient, approved_pack):
    appt = book(api, clinic, patient)
    post_webhook(api, inbound_payload(clinic, text="YES"))
    db.session.expire_all()
    assert db.session.get(Appointment, UUID(appt["id"])).status == "confirmed"
    assert not [e for e in mock_store.read("hubspot") if e["action"] == "create_task"]


def test_stop_opts_out_and_blocks_further_templates(api, clinic, patient, approved_pack):
    post_webhook(api, inbound_payload(clinic, text="STOP"))
    db.session.expire_all()
    contact = db.session.get(Contact, UUID(patient["id"]))
    assert contact.opt_in_status == "opted_out" and contact.gdpr_consent is False
    r = api.post(f"/api/contacts/{patient['id']}/messages", json={"type": "template", "template_name": "appointment_confirmation", "params": ["A", "B"]})
    assert r.status_code == 403
    confirm = Message.query.filter_by(direction="out", type="text").one()
    assert "unsubscribed" in confirm.content_json["body"]


def test_inbox_lists_contacts_with_window_state(api, clinic, patient, approved_pack):
    post_webhook(api, inbound_payload(clinic, text="Hallo"))
    rows = api.get(f"/api/clients/{clinic['id']}/inbox").get_json()
    assert rows[0]["last_message"]["body"] == "Hallo" and rows[0]["service_window"]["open"] is True
    thread = api.get(f"/api/contacts/{patient['id']}/messages").get_json()
    assert thread["messages"][-1]["direction"] == "in"


def test_dev_simulator_routes_through_real_handler(api, clinic, patient, approved_pack):
    book(api, clinic, patient)
    r = api.post("/api/dev/simulate/inbound", json={"client_id": clinic["id"], "from_phone": patient["phone_e164"], "text": "RESCHEDULE", "as_button": True})
    assert r.status_code == 200 and r.get_json()["messages"] == 1
    assert Appointment.query.filter_by(status="rescheduled").count() == 1
