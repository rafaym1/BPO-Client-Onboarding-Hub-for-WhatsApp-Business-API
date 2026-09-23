"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { DEFAULT_CONSENT_TEXT, SOURCE_LABEL } from "@/components/opt-in-dialog";
import { useToast } from "@/components/providers";
import { OptInBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { api, type Contact, type Language, type OptInSource } from "@/lib/api";
import { toLocalInput } from "@/lib/utils";

/** default: ~23h from now, so the 24h-reminder sweep picks it up right away in the demo */
function defaultBookingTime() {
  const d = new Date(Date.now() + 23 * 3_600_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return toLocalInput(d);
}

export function BookAppointmentDialog({
  clientId, clinicName, onBooked,
}: { clientId: string; clinicName: string; onBooked: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(true);
  const [source, setSource] = useState<OptInSource>("qr");
  const [when, setWhen] = useState(defaultBookingTime);
  const [language, setLanguage] = useState<Language>("en_GB");

  useEffect(() => {
    if (!open) return;
    setWhen(defaultBookingTime());
    api.contacts.list(clientId).then(setContacts).catch(() => setContacts([]));
  }, [open, clientId]);

  const selected = contacts.find((c) => c.id === contactId) ?? null;
  const sendable = selected ? selected.opt_in_status === "opted_in" && selected.gdpr_consent : consent;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const booking_time = new Date(when).toISOString();
      const appt = await api.appointments.create(
        selected
          ? { client_id: clientId, contact_id: selected.id, booking_time, language }
          : {
              client_id: clientId, booking_time, language,
              contact: {
                phone, name: name.trim() || undefined,
                opt_in: consent
                  ? { opt_in_status: "opted_in", opt_in_source: source, gdpr_consent: true, gdpr_consent_text: DEFAULT_CONSENT_TEXT(clinicName) }
                  : undefined,
              },
            },
      );
      if (appt.warning) toast({ tone: "warning", title: "Appointment booked, WhatsApp confirmation NOT sent", description: appt.warning.message });
      else toast({ tone: "success", title: "Appointment booked", description: "Confirmation template sent · 24h reminder scheduled · deal logged to HubSpot." });
      setOpen(false);
      onBooked();
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t book appointment", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><CalendarPlus /> Book Test Appointment</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Book test appointment</DialogTitle>
            <DialogDescription>Sends the <code>appointment_confirmation</code> template and schedules the 24h reminder.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="b-contact">Patient</Label>
            <Select id="b-contact" value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">+ New patient…</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name ?? c.phone_e164} ({c.phone_e164})</option>)}
            </Select>
          </div>

          {selected ? (
            <div className="flex items-center gap-2 text-sm">
              <OptInBadge status={selected.opt_in_status} />
              {!sendable && <span className="text-xs text-amber-800">No consent on file: the booking is saved but no WhatsApp message is sent.</span>}
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="b-name">Name</Label>
                  <Input id="b-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Anna Schmidt" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="b-phone">WhatsApp number</Label>
                  <Input id="b-phone" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+49 151 23456789" />
                </div>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>Patient consented to WhatsApp appointment messages <span className="text-muted-foreground">(GDPR opt-in, stored with source + timestamp)</span></span>
                </label>
                {consent && (
                  <Select aria-label="Opt-in source" value={source} onChange={(e) => setSource(e.target.value as OptInSource)}>
                    {(Object.keys(SOURCE_LABEL) as OptInSource[]).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
                  </Select>
                )}
              </div>
            </>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="b-when">Date &amp; time</Label>
              <Input id="b-when" type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="b-lang">Message language</Label>
              <Select id="b-lang" value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
                <option value="en_GB">English (UK)</option>
                <option value="de_DE">German</option>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Book &amp; send confirmation</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
