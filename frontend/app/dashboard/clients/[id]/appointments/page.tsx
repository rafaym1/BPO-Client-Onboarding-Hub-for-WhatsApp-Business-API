"use client";

import { useMemo, useState } from "react";
import { BellRing, Check, Clock, Loader2, X } from "lucide-react";
import { BookAppointmentDialog } from "@/components/book-appointment-dialog";
import { useClient, useConfig, useToast } from "@/components/providers";
import { AppointmentBadge, OptInBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { api, type Appointment, type AppointmentStatus } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { dayKey, formatDateTime, formatTime } from "@/lib/utils";

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });
const REMINDER_LEAD_MS = 24 * 3_600_000;

function dayHeading(iso: string) {
  const d = new Date(iso);
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);
  const prefix = days === 0 ? "Today · " : days === 1 ? "Tomorrow · " : "";
  return prefix + DAY_LABEL.format(d);
}

function ReminderState({ a }: { a: Appointment }) {
  if (a.reminder_sent_24h) return <Badge tone="green"><Check className="h-3 w-3" /> 24h reminder sent</Badge>;
  if (a.status !== "confirmed") return <Badge>No reminder</Badge>;
  const at = new Date(a.booking_time).getTime() - REMINDER_LEAD_MS;
  if (new Date(a.booking_time).getTime() < Date.now()) return <Badge>Not sent</Badge>;
  if (at <= Date.now()) return <Badge tone="yellow"><BellRing className="h-3 w-3" /> Due · next hourly sweep</Badge>;
  return <Badge tone="blue"><Clock className="h-3 w-3" /> Scheduled {formatDateTime(new Date(at).toISOString())}</Badge>;
}

export default function AppointmentsPage() {
  const { client } = useClient();
  const config = useConfig();
  const toast = useToast();
  const [sweeping, setSweeping] = useState(false);
  const { data: appointments, error, loading, reload } = useResource(() => api.appointments.list(client.id), [client.id], 4000);

  const groups = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments ?? []) {
      const key = dayKey(a.booking_time);
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return [...map.values()];
  }, [appointments]);

  async function setStatus(a: Appointment, status: AppointmentStatus) {
    try {
      await api.appointments.update(a.id, { status });
      reload();
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t update appointment", description: e instanceof Error ? e.message : String(e) });
    }
  }

  async function sweep() {
    setSweeping(true);
    try {
      const { due } = await api.dev.runReminders();
      toast({ tone: due ? "success" : "warning", title: due ? `${due} reminder${due === 1 ? "" : "s"} queued` : "Nothing due", description: due ? "The 24h reminder template (Yes / No buttons) is on its way." : "Only confirmed appointments starting within 24h, with no reminder yet, are picked up." });
      setTimeout(reload, 1500);
    } catch (e) {
      toast({ tone: "error", title: "Sweep failed", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSweeping(false);
    }
  }

  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Appointments</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Booking sends the confirmation template. The Celery beat sweep runs hourly and sends the 24h reminder (Yes / No buttons). A “No” or “RESCHEDULE” reply flags the appointment and opens a HubSpot task.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {config?.dev_tools && (
            <Button variant="outline" onClick={sweep} disabled={sweeping} title="Run the hourly Celery beat task now">
              {sweeping ? <Loader2 className="animate-spin" /> : <BellRing />} Run reminder sweep now
            </Button>
          )}
          <BookAppointmentDialog clientId={client.id} clinicName={client.business_name} onBooked={reload} />
        </div>
      </div>

      {error && !appointments && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
      {loading && !appointments && <div className="h-24 animate-pulse rounded-lg bg-muted" />}
      {appointments?.length === 0 && (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No appointments yet. <span className="font-medium text-foreground">Book Test Appointment</span> to trigger the confirmation template.
        </Card>
      )}

      <div className="space-y-5">
        {groups.map((items) => (
          <section key={dayKey(items[0].booking_time)} aria-label={dayHeading(items[0].booking_time)}>
            <h3 className="mb-2 text-sm font-semibold">{dayHeading(items[0].booking_time)}</h3>
            <Card className="divide-y">
              {items.map((a) => (
                <div key={a.id} className="grid items-center gap-3 p-4 md:grid-cols-[72px_minmax(0,1.3fr)_minmax(0,1.5fr)_150px]">
                  <div className="text-lg font-semibold tabular-nums">{formatTime(a.booking_time)}</div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.contact?.name ?? a.contact?.phone_e164}</p>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{a.contact?.phone_e164}</span>
                      {a.contact && <OptInBadge status={a.contact.opt_in_status} />}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <AppointmentBadge status={a.status} />
                    {a.confirmation_template_sent
                      ? <Badge tone="green"><Check className="h-3 w-3" /> Confirmation sent</Badge>
                      : <Badge tone="red"><X className="h-3 w-3" /> Confirmation not sent</Badge>}
                    <ReminderState a={a} />
                  </div>
                  <Select
                    aria-label={`Status for ${a.contact?.name ?? "appointment"}`} className="h-8 text-xs"
                    value={a.status} onChange={(e) => setStatus(a, e.target.value as AppointmentStatus)}
                  >
                    <option value="confirmed">Confirmed</option>
                    <option value="rescheduled">Rescheduled</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="no_show">No show</option>
                  </Select>
                </div>
              ))}
            </Card>
          </section>
        ))}
      </div>

      {config && browserTz && browserTz !== config.clinic_timezone && (
        <p className="text-xs text-muted-foreground">Times are shown in your browser timezone ({browserTz}); patient messages use the clinic timezone ({config.clinic_timezone}).</p>
      )}
    </div>
  );
}
