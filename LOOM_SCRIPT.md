# Loom script — BPO Onboarding Hub (≈ 6 min)

**Story:** *“An agency signs a new healthcare client. Here’s how I take them from intake to a live WhatsApp booking flow — with the onboarding tracked in Jira, templates through Meta, GDPR built in, and the CRM kept in sync.”*

Flow: **new client → Jira epic → template submission → webhook approval → appointment booking → WhatsApp message received.**

## Before you hit record

- [ ] Fresh state: `docker compose down -v && docker compose up --build` (no seed — the demo creates the client live)
- [ ] Browser at http://localhost:3000, window ~1440 px wide, other tabs closed
- [ ] **Live version:** `.env` has `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `PHONE_NUMBER_ID`, `WABA_ID`; ngrok running; webhook verified and subscribed to `messages` + `message_template_status_update`; your phone registered as a test recipient; phone visible next to the screen
- [ ] **Mock version:** nothing extra. The header chips will say `WhatsApp: mock`; say so out loud (see 0:00)
- [ ] Second tab: `http://localhost:5000/api/dev/mock-log/hubspot` (or your real HubSpot contact page)
- [ ] Optional second tab: your Jira project (live) — otherwise the epic key is enough
- [ ] Have the patient’s number ready to paste: `+49 …` (your own in the live version)

---

## 0:00 — Set the scene (20 s)

**Show:** clients page (empty).
**Say:** “This is an onboarding hub for a BPO agency putting clients on the WhatsApp Business API, the same journey a BSP like 360dialog runs: verify the business, provision a number, wire up webhooks, get templates approved, prove opt-in, go live. I’ll do it for a dental clinic in Berlin. *(Mock version: the chips top-right show WhatsApp, HubSpot and Jira are mocked — they behave like the real APIs, and flip to live the moment credentials are set.)*”

## 0:20 — 1. New client → Jira epic (60 s)

**Do:** *Onboard New Client* → name `Berlin Dental Clinic`, country Germany, industry healthcare → *Start onboarding*.
**Show:** the toast (“Jira epic BPO-1xx with 7 tasks created”), then the **Onboarding** board: timeline on top, kanban below, *Client Intake* already in progress.
**Say:** “One click creates the seven-step onboarding checklist and a Jira epic — *Onboard Berlin Dental Clinic to WhatsApp API* — with a task per step. Every card links to its Jira issue, so the account team keeps working in Jira while the client’s status here is derived from the checklist.”
**Do:** click a Jira key (opens the issue in the live version). Click *Mark done* on **Client Intake**.
**Say:** “Marking it done moves the Jira task to Done and advances the client to *BM verification*. I can also block a step with a reason — for example waiting on Meta business verification. I can’t go live until every earlier step is done.”

## 1:20 — 2. Template pack → Meta (60 s)

**Do:** **Templates** tab → *Load healthcare starter pack* → *Submit all 3 to Meta*.
**Show:** three rows: `appointment_confirmation` (en_GB), `appointment_reminder_24h` with **Yes / No** buttons, and the German `appointment_confirmation` (de_DE). Statuses turn **yellow (pending)**.
**Say:** “Three utility templates: confirmation in English and German — this is EMEA, so language matters — and a 24-hour reminder with quick-reply buttons. Submitting posts to Meta’s `message_templates` endpoint for this client’s WABA.”

## 2:20 — 3. Webhook approval (45 s)

**Show:** rows flip to **green / approved** without a refresh. *(Live: takes a few seconds to minutes; cut or speed up.)*
**Say:** “Meta’s decision comes back on the signed webhook. I validate `X-Hub-Signature-256` with the app secret, then update the template — and if Meta rejects it, the reason shows up right here.”
**Optional (15 s, mock):** create a template with body `Get 20% off cleaning, {{1}}!` as *utility* → it turns **red** with `INCORRECT_CATEGORY` and an explanation. “Promotional wording in a utility template — a classic rejection.”
**Do:** back to **Onboarding**. **Show:** *Template Pack Submission* moved itself to Done.
**Say:** “Once the whole pack is approved that step closes automatically and Jira follows.”

## 3:05 — 4. Book an appointment → WhatsApp (75 s)

**Do:** **Appointments** → *Book Test Appointment* → *New patient*: name `Anna Schmidt`, phone (your own number in the live version), **leave the GDPR consent box ticked**, source *QR code*. Leave the time (~23 h ahead) → *Book & send confirmation*.
**Say:** “Before any template goes out, the API checks two things: the contact opted in, and there’s recorded GDPR consent — with the source and a timestamp. Watch what happens without it —” *(optional 15 s: book a second patient with the box unticked → warning toast “Confirmation NOT sent”; booking saved, message withheld.)*
**Show:** **your phone** receives: *“Hi Anna, your appointment at Berlin Dental Clinic on … is confirmed. Reply YES to confirm, RESCHEDULE to change.”* *(Mock version: show the bubble in the Inbox instead.)*

## 4:20 — 5. Inbox, ticks, CRM (60 s)

**Do:** **Inbox** → Anna.
**Show:** the template bubble with ticks ✓ → ✓✓ → **blue ✓✓** as status webhooks arrive; the header: *Opted in · via QR · timestamp · GDPR ✓* and *24h window closed · templates only*.
**Say:** “Delivery statuses come back on the same webhook. Note the compliance state right in the header: opt-in, source, timestamp — and the 24-hour window. It’s closed, so free text is disabled and the composer forces an approved template.”
**Do:** switch to the HubSpot mock-log tab (or HubSpot). **Show:** `upsert_contact`, `create_deal` (“Appointment – Berlin Dental Clinic – …”), `log_engagement` notes for each message.
**Say:** “The patient is synced to HubSpot, a deal is created for the booking, and every WhatsApp message lands on their timeline — that runs in Celery so a CRM hiccup never blocks messaging.”

## 5:20 — 6. Reply → reschedule (45 s)

**Do:** reply **RESCHEDULE** on your phone (mock: click *RESCHEDULE* in the demo bar).
**Show:** inbox: patient message + automatic acknowledgement; **Appointments** → status **rescheduled**; HubSpot log → `create_task: Reschedule appointment: Anna Schmidt …`.
**Say:** “A ‘No’ or ‘Reschedule’ flips the appointment and opens a task for the front desk. Because the patient just wrote, the 24-hour window is open, so the acknowledgement can be free-form.”
**Do:** *Run reminder sweep now* (or book a second appointment first) → reminder with **Yes / No buttons** appears.
**Say:** “In production Celery beat does that sweep hourly, sending the reminder 24 hours before.”

## 5:55 — Close (15 s)

**Say:** “So: onboarding tracked in Jira, template lifecycle through Meta, GDPR consent and the 24-hour window enforced in code, and the CRM in sync. Swap the mocks for real credentials and it runs against live Meta, HubSpot and Jira — the README has the Meta test-number and ngrok setup, and the compliance notes for EMEA.”

---

## If something goes wrong on camera

| Symptom | Fix |
|---|---|
| Template stays *pending* (live) | Webhook not subscribed to `message_template_status_update`, or ngrok URL changed. Meanwhile use the **Approve** demo button (mock only) or cut the segment |
| Message not received (live) | Recipient not registered in API Setup; token expired (temporary tokens last 24 h); check the `502` toast text |
| Toast says Jira failed | Live Jira: check project key / issue type. Retry button on the Onboarding page |
| Ticks stuck at ✓ (mock) | Worker not running: `docker compose logs worker` |
| Want to reset | `docker compose down -v && docker compose up` |

## Timings cheat-sheet

0:00 intro · 0:20 client + Jira · 1:20 templates · 2:20 approval · 3:05 booking · 4:20 inbox + CRM · 5:20 reply/reschedule · 5:55 close
