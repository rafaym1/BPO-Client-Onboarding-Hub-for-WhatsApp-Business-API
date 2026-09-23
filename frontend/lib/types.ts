// ---------- types (mirror backend to_dict()) ----------
export type OnboardingStatus =
  | "kickoff" | "bm_verification" | "number_provisioning" | "webhook_setup"
  | "template_submission" | "optin_test" | "go_live" | "live";
export type ChecklistStatus = "pending" | "in_progress" | "done" | "blocked";
export type TemplateStatus = "draft" | "pending" | "approved" | "rejected";
export type OptInStatus = "opted_in" | "opted_out" | "pending";
export type OptInSource = "qr" | "keyword" | "api";
export type MessageStatus = "sent" | "delivered" | "read" | "failed";
export type AppointmentStatus = "confirmed" | "cancelled" | "no_show" | "rescheduled";
export type Language = "en_GB" | "de_DE";

export interface ChecklistStep {
  id: string;
  client_id: string;
  step_name: string;
  step_order: number;
  status: ChecklistStatus;
  jira_issue_key: string | null;
  jira_url: string | null;
  notes: string | null;
}

export interface Client {
  id: string;
  business_name: string;
  country: string;
  waba_id: string | null;
  phone_number_id: string | null;
  business_manager_id: string | null;
  onboarding_status: OnboardingStatus;
  industry: string;
  created_at: string;
  jira_epic_key: string | null;
  jira_epic_url: string | null;
  go_live_date: string | null;
  checklist_progress?: { done: number; total: number };
  checklist?: ChecklistStep[];
  jira_error?: string | null;
}

export interface WaTemplate {
  id: string;
  client_id: string;
  name: string;
  language: Language;
  category: "utility" | "marketing" | "authentication";
  body_text: string;
  header_type: "none" | "text";
  header_text: string | null;
  footer_text: string | null;
  buttons: string[];
  status: TemplateStatus;
  meta_template_id: string | null;
  rejection_reason: string | null;
  submit_error?: string | null;
}

export interface ServiceWindow {
  open: boolean;
  last_inbound_at: string | null;
  expires_at: string | null;
}

export interface Contact {
  id: string;
  client_id: string;
  hubspot_id: string | null;
  phone_e164: string;
  name: string | null;
  opt_in_status: OptInStatus;
  opt_in_source: OptInSource | null;
  opt_in_timestamp: string | null;
  gdpr_consent: boolean;
  gdpr_consent_text: string | null;
  service_window: ServiceWindow;
}

export interface Message {
  id: string;
  contact_id: string;
  wamid: string | null;
  direction: "in" | "out";
  type: "text" | "template" | "button";
  content_json: Record<string, unknown>;
  body: string;
  status: MessageStatus;
  timestamp: string;
}

export interface InboxRow extends Contact {
  last_message: Message | null;
}

export interface Appointment {
  id: string;
  client_id: string;
  contact_id: string;
  contact: Omit<Contact, "service_window"> | null;
  booking_time: string;
  status: AppointmentStatus;
  reminder_sent_24h: boolean;
  confirmation_template_sent: boolean;
  warning?: { code: string; message: string } | null;
}

export interface PublicConfig {
  mock: { whatsapp: boolean; hubspot: boolean; jira: boolean };
  dev_tools: boolean;
  clinic_timezone: string;
}

export interface OptInInput {
  opt_in_status: "opted_in" | "opted_out";
  opt_in_source?: OptInSource | null;
  gdpr_consent?: boolean;
  gdpr_consent_text?: string | null;
}

export interface LogEntry {
  at: string;
  service: string;
  action: string;
  [k: string]: unknown;
}

// ---------- fetch wrapper ----------
export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string, public details?: unknown) {
    super(message);
  }
}

