import {
  ApiError,
  type Appointment, type AppointmentStatus, type ChecklistStatus, type ChecklistStep, type Client, type Contact,
  type InboxRow, type Language, type LogEntry, type Message, type OptInInput, type PublicConfig, type WaTemplate,
} from "./types";
import { demoApi } from "./demo-backend";
export * from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";
/** Static demo build (GitHub Pages): no server, an in-browser mock backend answers instead. */
export const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(`Cannot reach the API at ${API_URL}. Is the backend running?`, 0, "network_error");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error;
    const detail = Array.isArray(err?.details) ? ` (${err.details.map((d: { field: string; message: string }) => `${d.field}: ${d.message}`).join("; ")})` : "";
    throw new ApiError((err?.message ?? res.statusText) + detail, res.status, err?.code ?? "error", err?.details);
  }
  return data as T;
}

const post = <T>(path: string, json?: unknown) => request<T>(path, { method: "POST", json: json ?? {} });
const patch = <T>(path: string, json: unknown) => request<T>(path, { method: "PATCH", json });

const realApi = {
  config: () => request<PublicConfig>("/api/config"),

  clients: {
    list: () => request<Client[]>("/api/clients"),
    get: (id: string) => request<Client>(`/api/clients/${id}`),
    create: (body: {
      business_name: string; country: string; industry?: string;
      business_manager_id?: string | null; waba_id?: string | null; phone_number_id?: string | null;
    }) => post<Client>("/api/clients", body),
    retryJira: (id: string) => post<Client>(`/api/clients/${id}/jira`),
    updateStep: (clientId: string, stepId: string, body: { status?: ChecklistStatus; notes?: string }) =>
      patch<{ step: ChecklistStep; client: Client }>(`/api/clients/${clientId}/checklist/${stepId}`, body),
    starterPack: (id: string) => post<WaTemplate[]>(`/api/clients/${id}/starter-pack`),
    inbox: (id: string) => request<InboxRow[]>(`/api/clients/${id}/inbox`),
  },

  templates: {
    list: (clientId: string) => request<WaTemplate[]>(`/api/templates?client_id=${clientId}`),
    create: (body: Record<string, unknown>) => post<WaTemplate>("/api/templates", body),
    submit: (id: string) => post<WaTemplate>(`/api/templates/${id}/submit`),
    remove: (id: string) => request<void>(`/api/templates/${id}`, { method: "DELETE" }),
  },

  contacts: {
    list: (clientId: string) => request<Contact[]>(`/api/contacts?client_id=${clientId}`),
    create: (body: { client_id: string; phone: string; name?: string; opt_in?: OptInInput }) =>
      post<Contact>("/api/contacts", body),
    optIn: (id: string, body: OptInInput) => post<Contact>(`/api/contacts/${id}/opt-in`, body),
    messages: (id: string) => request<{ contact: Contact; messages: Message[] }>(`/api/contacts/${id}/messages`),
    send: (id: string, body: { type: "text"; text: string } | { type: "template"; template_name: string; language: Language; params: string[] }) =>
      post<Message>(`/api/contacts/${id}/messages`, body),
  },

  appointments: {
    list: (clientId: string) => request<Appointment[]>(`/api/appointments?client_id=${clientId}`),
    create: (body: {
      client_id: string; booking_time: string; language: Language; contact_id?: string;
      contact?: { phone: string; name?: string; opt_in?: OptInInput };
    }) => post<Appointment>("/api/appointments", body),
    update: (id: string, body: { status?: AppointmentStatus }) => patch<Appointment>(`/api/appointments/${id}`, body),
  },

  dev: {
    simulateInbound: (body: { client_id: string; from_phone: string; name?: string; text: string; as_button?: boolean }) =>
      post<Record<string, number>>("/api/dev/simulate/inbound", body),
    simulateTemplate: (body: { template_id: string; event: "APPROVED" | "REJECTED"; reason?: string }) =>
      post<Record<string, number>>("/api/dev/simulate/template-status", body),
    runReminders: () => post<{ due: number }>("/api/dev/run-reminders"),
    mockLog: (service: "whatsapp" | "hubspot" | "jira") => request<LogEntry[]>(`/api/dev/mock-log/${service}`),
  },
};

// In the static GitHub Pages build the same interface is served by an in-browser mock backend.
export const api: typeof realApi = DEMO ? demoApi : realApi;
