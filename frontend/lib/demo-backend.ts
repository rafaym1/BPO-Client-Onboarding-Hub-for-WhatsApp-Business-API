/**
 * In-browser stand-in for the Flask API, used by the static GitHub Pages demo (NEXT_PUBLIC_DEMO_MODE=true).
 *
 * It re-implements the backend's business rules (checklist -> client status, template review, GDPR opt-in gate,
 * 24h service window, 24h reminders, NO/RESCHEDULE/STOP handling) against localStorage. "Later" events
 * (Meta review, delivery receipts, ETA reminders) are stored with a due time and processed on the next API call,
 * so they survive page reloads. Nothing leaves the browser.
 */
import {
  ApiError,
  type Appointment, type AppointmentStatus, type ChecklistStatus, type ChecklistStep, type Client, type Contact,
  type InboxRow, type Language, type LogEntry, type Message, type MessageStatus, type OptInInput, type PublicConfig, type WaTemplate,
} from "./types";

const KEY = "bpo-demo-state-v1";
const CLINIC_TZ = "Europe/Berlin";
const H = 3_600_000;
export const MAX_DEMO_CLIENTS = 30; // static export pre-renders /clients/c1..c30

const STEPS = [
  "Client Intake", "BM Verification Check", "Number Provisioning", "Webhook Setup",
  "Template Pack Submission", "Opt-in Flow Test", "Go-live",
];
const STEP_STATUS = ["kickoff", "bm_verification", "number_provisioning", "webhook_setup", "template_submission", "optin_test", "go_live"] as const;
const PROMO_WORDS = ["discount", "% off", "offer", "free ", "sale", "voucher"];
const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
const CONSENT = (clinic: string) =>
  `I agree to receive appointment confirmations and reminders from ${clinic} via WhatsApp. I can withdraw consent at any time by replying STOP.`;

type RawContact = Omit<Contact, "service_window">;
type RawClient = Omit<Client, "checklist" | "checklist_progress">;
type RawAppt = Omit<Appointment, "contact" | "warning">;
interface Evt { at: number; kind: "template_review" | "status" | "reminder"; id: string; status?: MessageStatus }
interface State {
  jira: number; clientSeq: number;
  clients: RawClient[]; steps: ChecklistStep[]; templates: WaTemplate[]; contacts: RawContact[];
  messages: Message[]; appointments: RawAppt[]; events: Evt[]; log: LogEntry[];
}

// ---------- persistence ----------
let memory: State | null = null;

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
const iso = (ms: number) => new Date(ms).toISOString();

function load(): State {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    if (raw) return JSON.parse(raw) as State;
  } catch { /* fall through to memory / seed */ }
  return memory ?? seed();
}
function save(s: State) {
  memory = s;
  try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: memory only */ }
}
export function resetDemo() {
  memory = null;
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// ---------- helpers ----------
function fmtClinic(ms: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: CLINIC_TZ, weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  );
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}

function normalizePhone(raw: string): string {
  let c = (raw ?? "").replace(/[\s\-().]/g, "");
  if (c.startsWith("00")) c = "+" + c.slice(2);
  if (!c.startsWith("+")) c = "+" + c;
  if (!/^\+[1-9]\d{6,14}$/.test(c)) throw new ApiError(`'${raw}' is not a valid E.164 phone number`, 422, "invalid_phone");
  return c;
}

function logEvt(s: State, service: string, action: string, data: Record<string, unknown> = {}) {
  s.log.unshift({ at: iso(Date.now()), service, action, ...data });
  s.log.length = Math.min(s.log.length, 300);
}

function placeholderCount(body: string): number {
  const nums = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}
const renderBody = (body: string, params: string[]) => body.replace(/\{\{(\d+)\}\}/g, (m, n) => params[Number(n) - 1] ?? m);
const firstName = (c: RawContact) => (c.name ?? "there").split(" ")[0];

// ---------- seed ----------
function makeSteps(clientId: string, epicKeyOf: () => string): ChecklistStep[] {
  return STEPS.map((name, i) => ({
    id: uid(), client_id: clientId, step_name: name, step_order: i + 1, status: i === 0 ? "in_progress" : "pending",
    jira_issue_key: epicKeyOf(), jira_url: null, notes: null,
  }));
}

function starterPack(clinic: string, clientId: string): WaTemplate[] {
  const base = { client_id: clientId, category: "utility" as const, header_type: "none" as const, header_text: null, footer_text: null, status: "draft" as const, meta_template_id: null, rejection_reason: null };
  return [
    { ...base, id: uid(), name: "appointment_confirmation", language: "en_GB", buttons: [],
      body_text: `Hi {{1}}, your appointment at ${clinic} on {{2}} is confirmed. Reply YES to confirm, RESCHEDULE to change.` },
    { ...base, id: uid(), name: "appointment_reminder_24h", language: "en_GB", buttons: ["Yes", "No"],
      body_text: `Hi {{1}}, this is a reminder of your appointment at ${clinic} on {{2}}. Can you still make it?` },
    { ...base, id: uid(), name: "appointment_confirmation", language: "de_DE", buttons: [],
      body_text: `Hallo {{1}}, Ihr Termin in der ${clinic} am {{2}} ist bestätigt. Antworten Sie JA zur Bestätigung oder UMBUCHEN, um den Termin zu ändern.` },
  ];
}

function seed(): State {
  const s: State = { jira: 101, clientSeq: 0, clients: [], steps: [], templates: [], contacts: [], messages: [], appointments: [], events: [], log: [] };
  const now = Date.now();
  const add = (name: string, country: string, ageDays: number, done: number, bm: string) => {
    const c = createClient(s, { business_name: name, country, industry: "healthcare", business_manager_id: bm }, now - ageDays * 24 * H, true);
    s.log = []; // seed history isn't part of the demo narrative
    steps(s, c.id).slice(0, done).forEach((st) => finishStep(s, st, true));
    return c;
  };
  const berlin = add("Berlin Dental Clinic", "DE", 3, 4, "1234567890123456");
  add("Hamburg Orthodontics", "DE", 6, 2, "2234567890123456");
  add("Vienna Skin Clinic", "AT", 20, 7, "3234567890123456");
  s.templates.push(...starterPack(berlin.business_name, berlin.id));
  const anna: RawContact = {
    id: uid(), client_id: berlin.id, hubspot_id: null, phone_e164: "+4915123456789", name: "Anna Schmidt",
    opt_in_status: "opted_in", opt_in_source: "qr", opt_in_timestamp: iso(now - 2 * 24 * H), gdpr_consent: true, gdpr_consent_text: CONSENT(berlin.business_name),
  };
  const markus: RawContact = { ...anna, id: uid(), hubspot_id: null, phone_e164: "+4915198765432", name: "Markus Weber", opt_in_status: "pending", opt_in_source: null, opt_in_timestamp: null, gdpr_consent: false, gdpr_consent_text: null };
  s.contacts.push(anna, markus);
  const vienna = s.clients[2];
  vienna.go_live_date = iso(now - 12 * 24 * H);
  s.log = [];
  return s;
}

// ---------- domain logic (ports of the Flask services) ----------
const steps = (s: State, clientId: string) => s.steps.filter((x) => x.client_id === clientId).sort((a, b) => a.step_order - b.step_order);

function createClient(s: State, body: { business_name: string; country: string; industry?: string; business_manager_id?: string | null; waba_id?: string | null; phone_number_id?: string | null }, createdAt = Date.now(), force = false): RawClient {
  if (!force && s.clientSeq >= MAX_DEMO_CLIENTS) {
    throw new ApiError(`The demo holds up to ${MAX_DEMO_CLIENTS} clients. Use “Reset demo” to start over.`, 409, "demo_limit");
  }
  const id = `c${++s.clientSeq}`;
  const epic = `BPO-${s.jira++}`;
  const client: RawClient = {
    id, business_name: body.business_name, country: body.country, industry: body.industry || "healthcare",
    waba_id: body.waba_id || "104857393958127", phone_number_id: body.phone_number_id || "109384756209384",
    business_manager_id: body.business_manager_id ?? null, onboarding_status: "kickoff", created_at: iso(createdAt),
    jira_epic_key: epic, jira_epic_url: null, go_live_date: null,
  };
  s.clients.push(client);
  logEvt(s, "jira", "create_epic", { key: epic, summary: `Onboard ${client.business_name} to WhatsApp API` });
  const rows = makeSteps(id, () => `BPO-${s.jira++}`);
  rows.forEach((r) => { s.steps.push(r); logEvt(s, "jira", "create_task", { key: r.jira_issue_key, parent: epic, summary: `${r.step_name} - ${client.business_name}` }); });
  return client;
}

function syncJira(s: State, step: ChecklistStep) {
  const names: Record<ChecklistStatus, string> = { done: "Done", in_progress: "In Progress", pending: "To Do", blocked: "Blocked" };
  if (step.jira_issue_key) logEvt(s, "jira", "transition", { key: step.jira_issue_key, to: names[step.status] });
}

function refreshClientStatus(s: State, clientId: string) {
  const client = s.clients.find((c) => c.id === clientId)!;
  const rows = steps(s, clientId);
  const current = rows.find((x) => x.status !== "done");
  if (!current) {
    client.onboarding_status = "live";
    client.go_live_date = client.go_live_date ?? iso(Date.now());
    return;
  }
  client.go_live_date = null;
  client.onboarding_status = STEP_STATUS[current.step_order - 1];
  if (current.status === "pending") { current.status = "in_progress"; syncJira(s, current); }
}

function finishStep(s: State, step: ChecklistStep, silent = false, notes?: string | null) {
  if (step.step_name === "Go-live") {
    const open = steps(s, step.client_id).filter((x) => x.step_order < step.step_order && x.status !== "done").map((x) => x.step_name);
    if (open.length) throw new ApiError(`Cannot go live before completing: ${open.join(", ")}`, 409, "steps_incomplete");
  }
  if (step.status !== "done") { step.status = "done"; if (!silent) syncJira(s, step); }
  if (notes !== undefined && notes !== null) step.notes = notes;
  refreshClientStatus(s, step.client_id);
}

function onTemplatesChanged(s: State, clientId: string) {
  const list = s.templates.filter((t) => t.client_id === clientId);
  if (list.length >= 3 && list.every((t) => t.status === "approved")) {
    const step = steps(s, clientId).find((x) => x.step_name === "Template Pack Submission")!;
    if (step.status !== "done") finishStep(s, step, false, "Auto-completed: all templates approved by Meta");
  }
}

function applyReview(s: State, t: WaTemplate, event: "APPROVED" | "REJECTED" | "PENDING" | "PAUSED" | "DISABLED", reason?: string | null) {
  if (event === "APPROVED") { t.status = "approved"; t.rejection_reason = null; }
  else if (event === "REJECTED") { t.status = "rejected"; t.rejection_reason = reason || "REJECTED"; }
  else if (event === "PENDING") t.status = "pending";
  else { t.status = "rejected"; t.rejection_reason = event; }
  onTemplatesChanged(s, t.client_id);
}

function submitTemplate(s: State, t: WaTemplate) {
  if (t.status !== "draft" && t.status !== "rejected") throw new ApiError(`Template is already ${t.status}`, 409, "already_submitted");
  t.meta_template_id = String(Math.floor(1e14 + Math.random() * 9e14));
  t.status = "pending";
  t.rejection_reason = null;
  logEvt(s, "whatsapp", "submit_template", { waba_id: s.clients.find((c) => c.id === t.client_id)?.waba_id, name: t.name, language: t.language, category: t.category.toUpperCase(), meta_template_id: t.meta_template_id });
  s.events.push({ at: Date.now() + 4000, kind: "template_review", id: t.id });
}

// --- contacts / compliance ---
function serviceWindow(s: State, contactId: string) {
  const inbound = s.messages.filter((m) => m.contact_id === contactId && m.direction === "in").map((m) => Date.parse(m.timestamp));
  const last = inbound.length ? Math.max(...inbound) : null;
  const expires = last ? last + 24 * H : null;
  return { open: !!expires && expires > Date.now(), last_inbound_at: last ? iso(last) : null, expires_at: expires ? iso(expires) : null };
}
const contactOut = (s: State, c: RawContact): Contact => ({ ...c, service_window: serviceWindow(s, c.id) });

function getOrCreateContact(s: State, clientId: string, phone: string, name?: string | null): RawContact {
  const p = normalizePhone(phone);
  let c = s.contacts.find((x) => x.client_id === clientId && x.phone_e164 === p);
  if (!c) {
    c = { id: uid(), client_id: clientId, hubspot_id: null, phone_e164: p, name: name ?? null, opt_in_status: "pending", opt_in_source: null, opt_in_timestamp: null, gdpr_consent: false, gdpr_consent_text: null };
    s.contacts.push(c);
  } else if (name && !c.name) c.name = name;
  return c;
}

function recordOptIn(c: RawContact, o: OptInInput) {
  if (o.opt_in_status === "opted_in") {
    if (!o.gdpr_consent) throw new ApiError("Opt-in requires explicit GDPR consent (gdpr_consent=true)", 422, "consent_required");
    if (!o.opt_in_source) throw new ApiError("Opt-in requires opt_in_source (qr, keyword or api)", 422, "source_required");
    c.opt_in_status = "opted_in"; c.opt_in_source = o.opt_in_source; c.opt_in_timestamp = iso(Date.now());
    c.gdpr_consent = true; c.gdpr_consent_text = o.gdpr_consent_text ?? c.gdpr_consent_text;
  } else {
    c.opt_in_status = "opted_out"; c.gdpr_consent = false;
  }
}

function checkTemplateAllowed(c: RawContact) {
  const who = c.name ?? c.phone_e164;
  if (c.opt_in_status !== "opted_in") throw new ApiError(`${who} has not opted in (status: ${c.opt_in_status})`, 403, "not_opted_in");
  if (!c.gdpr_consent) throw new ApiError(`${who} has no recorded GDPR consent`, 403, "no_gdpr_consent");
}
function checkTextAllowed(s: State, c: RawContact, afterOptOut = false) {
  if (c.opt_in_status === "opted_out" && !afterOptOut) throw new ApiError("Contact has opted out - no messages may be sent", 403, "opted_out");
  if (!serviceWindow(s, c.id).open) {
    throw new ApiError("The 24h customer service window is closed - free-form text is not allowed, send an approved template instead", 403, "window_closed");
  }
}

// --- messages / CRM ---
function crmSync(s: State, c: RawContact) {
  if (!c.hubspot_id) {
    c.hubspot_id = `mock-hs-${c.phone_e164.replace(/\D/g, "").slice(-10)}`;
    logEvt(s, "hubspot", "upsert_contact", { id: c.hubspot_id, phone: c.phone_e164, name: c.name, whatsapp_opt_in: c.opt_in_status === "opted_in" });
  }
}
function addMessage(s: State, c: RawContact, direction: "in" | "out", type: Message["type"], content: Record<string, unknown>, at = Date.now()): Message {
  const m: Message = {
    id: uid(), contact_id: c.id, wamid: `wamid.${direction === "out" ? "MOCK" : "SIM"}${uid().replace(/-/g, "").slice(0, 20).toUpperCase()}`,
    direction, type, content_json: content, body: String(content.body ?? ""), status: direction === "out" ? "sent" : "delivered", timestamp: iso(at),
  };
  s.messages.push(m);
  if (direction === "out") {
    logEvt(s, "whatsapp", type === "template" ? "send_template" : "send_text", { to: c.phone_e164, template: content.template, body: m.body });
    s.events.push({ at: Date.now() + 1500, kind: "status", id: m.id, status: "delivered" });
  }
  crmSync(s, c);
  logEvt(s, "hubspot", "log_engagement", { contact_id: c.hubspot_id, body: `[WhatsApp ${direction === "in" ? "Inbound" : "Outbound"}] ${m.body}` });
  return m;
}

function findApproved(s: State, clientId: string, name: string, language: Language): WaTemplate {
  const list = s.templates.filter((t) => t.client_id === clientId && t.name === name && t.status === "approved");
  if (!list.length) throw new ApiError(`No approved template named '${name}'`, 409, "template_not_approved");
  return list.find((t) => t.language === language) ?? list[0];
}

function sendTemplateTo(s: State, c: RawContact, name: string, language: Language, params: string[]): Message {
  checkTemplateAllowed(c);
  const t = findApproved(s, c.client_id, name, language);
  const expected = placeholderCount(t.body_text);
  if (params.length !== expected) throw new ApiError(`Template '${name}' needs ${expected} parameter(s), got ${params.length}`, 422, "bad_params");
  return addMessage(s, c, "out", "template", { body: renderBody(t.body_text, params), template: t.name, language: t.language, params, buttons: t.buttons });
}
function sendTextTo(s: State, c: RawContact, text: string, afterOptOut = false): Message {
  checkTextAllowed(s, c, afterOptOut);
  return addMessage(s, c, "out", "text", { body: text });
}

// --- appointments ---
const apptOut = (s: State, a: RawAppt): Appointment => ({ ...a, contact: s.contacts.find((c) => c.id === a.contact_id) ?? null });
const apptParams = (c: RawContact, a: RawAppt) => [firstName(c), fmtClinic(Date.parse(a.booking_time))];

function sendReminder(s: State, a: RawAppt): string {
  if (a.status !== "confirmed" || a.reminder_sent_24h) return "skipped";
  const when = Date.parse(a.booking_time);
  if (when <= Date.now() || when - Date.now() > 24 * H + 5 * 60_000) return "skipped";
  const c = s.contacts.find((x) => x.id === a.contact_id)!;
  a.reminder_sent_24h = true;
  try {
    sendTemplateTo(s, c, "appointment_reminder_24h", "en_GB", apptParams(c, a));
  } catch { a.reminder_sent_24h = false; return "blocked"; }
  return "sent";
}

function reschedule(s: State, c: RawContact, apptId: string) {
  const a = s.appointments.find((x) => x.id === apptId)!;
  a.status = "rescheduled";
  crmSync(s, c);
  logEvt(s, "hubspot", "create_task", { contact_id: c.hubspot_id, subject: `Reschedule appointment: ${c.name ?? c.phone_e164} (${fmtClinic(Date.parse(a.booking_time))})` });
}

function inbound(s: State, clientId: string, phone: string, name: string | undefined, text: string, asButton: boolean) {
  const c = getOrCreateContact(s, clientId, phone, name);
  const t0 = Date.now();
  addMessage(s, c, "in", asButton ? "button" : "text", { body: text, ...(asButton ? { payload: text } : {}) }, t0);
  const word = text.toLowerCase().replace(/[^\w\s]/g, "").trim();
  const intent = ["no", "nein", "reschedule", "umbuchen"].includes(word) ? "reschedule" : ["yes", "ja"].includes(word) ? "confirm" : ["stop", "stopp", "abmelden"].includes(word) ? "stop" : null;
  if (!intent) return;
  let reply: string | null = null;
  if (intent === "reschedule") {
    const appt = s.appointments.filter((a) => a.contact_id === c.id && a.status === "confirmed" && Date.parse(a.booking_time) > Date.now())
      .sort((a, b) => Date.parse(a.booking_time) - Date.parse(b.booking_time))[0];
    if (appt) { reschedule(s, c, appt.id); reply = "No problem - our team will contact you shortly to find a new appointment time."; }
  } else if (intent === "confirm") reply = "Thank you, your appointment is confirmed. See you soon!";
  else { recordOptIn(c, { opt_in_status: "opted_out" }); reply = "You have been unsubscribed and will not receive further WhatsApp messages from us."; }
  if (reply) {
    checkTextAllowed(s, c, intent === "stop");
    addMessage(s, c, "out", "text", { body: reply }, t0 + 1);
  }
}

// ---------- event processing ("later" work) ----------
function tick(s: State) {
  const now = Date.now();
  const due = s.events.filter((e) => e.at <= now).sort((a, b) => a.at - b.at);
  if (!due.length) return;
  s.events = s.events.filter((e) => e.at > now);
  for (const e of due) {
    if (e.kind === "template_review") {
      const t = s.templates.find((x) => x.id === e.id);
      if (t && t.status === "pending") {
        const promo = t.category === "utility" && PROMO_WORDS.some((w) => t.body_text.toLowerCase().includes(w));
        applyReview(s, t, promo ? "REJECTED" : "APPROVED", promo ? "INCORRECT_CATEGORY" : null);
      }
    } else if (e.kind === "status") {
      const m = s.messages.find((x) => x.id === e.id);
      if (m && e.status && m.status !== "failed" && RANK[e.status] > (RANK[m.status] ?? 0)) {
        m.status = e.status;
        if (e.status === "delivered") s.events.push({ at: Math.max(now, e.at) + 2500, kind: "status", id: m.id, status: "read" });
      }
    } else if (e.kind === "reminder") {
      const a = s.appointments.find((x) => x.id === e.id);
      if (a) sendReminder(s, a);
    }
  }
}

// ---------- output shaping ----------
const clientOut = (s: State, c: RawClient, detail = false): Client => {
  const rows = steps(s, c.id);
  const out: Client = { ...c, checklist_progress: { done: rows.filter((x) => x.status === "done").length, total: rows.length } };
  return detail ? { ...out, checklist: rows.map((r) => ({ ...r })), jira_error: null } : out;
};
const mustClient = (s: State, id: string) => s.clients.find((c) => c.id === id) ?? (() => { throw new ApiError("Client not found", 404, "client_not_found"); })();
const mustContact = (s: State, id: string) => s.contacts.find((c) => c.id === id) ?? (() => { throw new ApiError("Contact not found", 404, "contact_not_found"); })();
const mustTemplate = (s: State, id: string) => s.templates.find((t) => t.id === id) ?? (() => { throw new ApiError("Template not found", 404, "template_not_found"); })();

/** Every call: load state, run due events, do the work, persist, return a detached copy. */
async function run<T>(fn: (s: State) => T): Promise<T> {
  const s = load();
  tick(s);
  try {
    const result = fn(s);
    return JSON.parse(JSON.stringify(result ?? null)) as T;
  } finally {
    save(s);
  }
}

export const demoApi = {
  config: () => Promise.resolve<PublicConfig>({ mock: { whatsapp: true, hubspot: true, jira: true }, dev_tools: true, clinic_timezone: CLINIC_TZ }),

  clients: {
    list: () => run((s) => [...s.clients].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((c) => clientOut(s, c))),
    get: (id: string) => run((s) => clientOut(s, mustClient(s, id), true)),
    create: (body: { business_name: string; country: string; industry?: string; business_manager_id?: string | null; waba_id?: string | null; phone_number_id?: string | null }) =>
      run((s) => clientOut(s, createClient(s, body), true)),
    retryJira: (id: string) => run((s) => clientOut(s, mustClient(s, id), true)),
    updateStep: (clientId: string, stepId: string, body: { status?: ChecklistStatus; notes?: string }) =>
      run((s) => {
        mustClient(s, clientId);
        const step = s.steps.find((x) => x.id === stepId && x.client_id === clientId);
        if (!step) throw new ApiError("Checklist step not found", 404, "step_not_found");
        if (body.status === "done") finishStep(s, step, false, body.notes ?? null);
        else {
          if (body.status && body.status !== step.status) { step.status = body.status; syncJira(s, step); }
          if (body.notes !== undefined) step.notes = body.notes;
          if (body.status === "pending" || body.status === "in_progress") refreshClientStatus(s, clientId);
        }
        return { step: { ...step }, client: clientOut(s, mustClient(s, clientId), true) };
      }),
    starterPack: (id: string) =>
      run((s) => {
        const client = mustClient(s, id);
        const fresh = starterPack(client.business_name, id).filter((t) => !s.templates.some((x) => x.client_id === id && x.name === t.name && x.language === t.language));
        s.templates.push(...fresh);
        return fresh;
      }),
    inbox: (id: string) =>
      run((s): InboxRow[] => {
        mustClient(s, id);
        return s.contacts.filter((c) => c.client_id === id).map((c) => {
          const last = s.messages.filter((m) => m.contact_id === c.id).sort((a, b) => a.timestamp.localeCompare(b.timestamp)).pop() ?? null;
          return { ...contactOut(s, c), last_message: last };
        }).sort((a, b) => (b.last_message?.timestamp ?? "").localeCompare(a.last_message?.timestamp ?? ""));
      }),
  },

  templates: {
    list: (clientId: string) => run((s) => s.templates.filter((t) => t.client_id === clientId).sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language))),
    create: (body: Record<string, unknown>) =>
      run((s) => {
        const b = body as { client_id: string; name: string; language: Language; category: WaTemplate["category"]; body_text: string; footer_text?: string | null; buttons?: string[]; submit?: boolean };
        mustClient(s, b.client_id);
        if (!/^[a-z0-9_]{1,200}$/.test(b.name ?? "")) throw new ApiError("Invalid request (name: use lowercase letters, digits and underscores)", 422, "validation_error");
        const nums = [...(b.body_text ?? "").matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
        if (!b.body_text?.trim()) throw new ApiError("Invalid request (body_text: required)", 422, "validation_error");
        if (nums.length && [...new Set(nums)].sort((x, y) => x - y).some((n, i) => n !== i + 1)) throw new ApiError("Invalid request (body variables must be sequential: {{1}}, {{2}}, ...)", 422, "validation_error");
        if (s.templates.some((t) => t.client_id === b.client_id && t.name === b.name && t.language === b.language)) throw new ApiError(`Template '${b.name}' (${b.language}) already exists`, 409, "template_exists");
        const t: WaTemplate = {
          id: uid(), client_id: b.client_id, name: b.name, language: b.language, category: b.category, body_text: b.body_text.trim(), header_type: "none", header_text: null,
          footer_text: b.footer_text ?? null, buttons: b.buttons ?? [], status: "draft", meta_template_id: null, rejection_reason: null, submit_error: null,
        };
        s.templates.push(t);
        if (b.submit !== false) submitTemplate(s, t);
        return t;
      }),
    submit: (id: string) => run((s) => { const t = mustTemplate(s, id); submitTemplate(s, t); return t; }),
    remove: (id: string) => run((s) => { mustTemplate(s, id); s.templates = s.templates.filter((t) => t.id !== id); }) as Promise<void>,
  },

  contacts: {
    list: (clientId: string) => run((s) => s.contacts.filter((c) => c.client_id === clientId).map((c) => contactOut(s, c))),
    create: (body: { client_id: string; phone: string; name?: string; opt_in?: OptInInput }) =>
      run((s) => {
        mustClient(s, body.client_id);
        const c = getOrCreateContact(s, body.client_id, body.phone, body.name);
        if (body.opt_in) recordOptIn(c, body.opt_in);
        return contactOut(s, c);
      }),
    optIn: (id: string, body: OptInInput) => run((s) => { const c = mustContact(s, id); recordOptIn(c, body); return contactOut(s, c); }),
    messages: (id: string) =>
      run((s) => {
        const c = mustContact(s, id);
        return { contact: contactOut(s, c), messages: s.messages.filter((m) => m.contact_id === id).sort((a, b) => a.timestamp.localeCompare(b.timestamp)) };
      }),
    send: (id: string, body: { type: "text"; text: string } | { type: "template"; template_name: string; language: Language; params: string[] }) =>
      run((s) => {
        const c = mustContact(s, id);
        return body.type === "text" ? sendTextTo(s, c, body.text) : sendTemplateTo(s, c, body.template_name, body.language, body.params);
      }),
  },

  appointments: {
    list: (clientId: string) => run((s) => s.appointments.filter((a) => a.client_id === clientId).sort((a, b) => a.booking_time.localeCompare(b.booking_time)).map((a) => apptOut(s, a))),
    create: (body: { client_id: string; booking_time: string; language: Language; contact_id?: string; contact?: { phone: string; name?: string; opt_in?: OptInInput } }) =>
      run((s): Appointment => {
        const client = mustClient(s, body.client_id);
        const when = Date.parse(body.booking_time);
        if (Number.isNaN(when) || when <= Date.now()) throw new ApiError("booking_time must be in the future", 422, "booking_in_past");
        let contact: RawContact;
        if (body.contact_id) {
          contact = mustContact(s, body.contact_id);
        } else if (body.contact) {
          contact = getOrCreateContact(s, client.id, body.contact.phone, body.contact.name);
          if (body.contact.opt_in) recordOptIn(contact, body.contact.opt_in);
        } else throw new ApiError("Invalid request (provide contact_id or contact)", 422, "validation_error");

        const appt: RawAppt = { id: uid(), client_id: client.id, contact_id: contact.id, booking_time: iso(when), status: "confirmed", reminder_sent_24h: false, confirmation_template_sent: false };
        s.appointments.push(appt);
        let warning: Appointment["warning"] = null;
        try {
          sendTemplateTo(s, contact, "appointment_confirmation", body.language, apptParams(contact, appt));
          appt.confirmation_template_sent = true;
        } catch (e) {
          if (e instanceof ApiError) warning = { code: e.code, message: `Confirmation not sent: ${e.message}` };
          else throw e;
        }
        crmSync(s, contact);
        logEvt(s, "hubspot", "create_deal", { contact_id: contact.hubspot_id, name: `Appointment - ${client.business_name} - ${fmtClinic(when)}` });
        if (when - 24 * H > Date.now()) s.events.push({ at: when - 24 * H, kind: "reminder", id: appt.id });
        return { ...apptOut(s, appt), warning };
      }),
    update: (id: string, body: { status?: AppointmentStatus }) =>
      run((s) => {
        const a = s.appointments.find((x) => x.id === id);
        if (!a) throw new ApiError("Appointment not found", 404, "appointment_not_found");
        if (body.status) a.status = body.status;
        return apptOut(s, a);
      }),
  },

  dev: {
    simulateInbound: (body: { client_id: string; from_phone: string; name?: string; text: string; as_button?: boolean }) =>
      run((s) => { mustClient(s, body.client_id); inbound(s, body.client_id, body.from_phone, body.name, body.text, !!body.as_button); return { messages: 1 }; }),
    simulateTemplate: (body: { template_id: string; event: "APPROVED" | "REJECTED"; reason?: string }) =>
      run((s) => { applyReview(s, mustTemplate(s, body.template_id), body.event, body.reason); return { template_updates: 1 }; }),
    runReminders: () =>
      run((s) => {
        const now = Date.now();
        const due = s.appointments.filter((a) => a.status === "confirmed" && !a.reminder_sent_24h && Date.parse(a.booking_time) > now && Date.parse(a.booking_time) <= now + 24 * H);
        due.forEach((a) => sendReminder(s, a));
        return { due: due.length };
      }),
    mockLog: (service: "whatsapp" | "hubspot" | "jira") => run((s) => s.log.filter((e) => e.service === service).slice(0, 100)),
  },
};
