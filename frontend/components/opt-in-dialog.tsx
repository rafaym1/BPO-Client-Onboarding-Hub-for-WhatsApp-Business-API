"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/providers";
import { api, type Contact, type OptInSource } from "@/lib/api";

export const DEFAULT_CONSENT_TEXT = (clinic: string) =>
  `I agree to receive appointment confirmations and reminders from ${clinic} via WhatsApp. I can withdraw consent at any time by replying STOP.`;

export const SOURCE_LABEL: Record<OptInSource, string> = {
  qr: "QR code (in clinic)",
  keyword: "Keyword (patient messaged first)",
  api: "API / website form",
};

export function OptInDialog({
  contact, clinicName, open, onOpenChange, onSaved,
}: {
  contact: Pick<Contact, "id" | "name" | "phone_e164"> | null; clinicName: string;
  open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [source, setSource] = useState<OptInSource>("qr");
  const [text, setText] = useState(DEFAULT_CONSENT_TEXT(clinicName));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!contact) return;
    setBusy(true);
    try {
      await api.contacts.optIn(contact.id, { opt_in_status: "opted_in", opt_in_source: source, gdpr_consent: true, gdpr_consent_text: text });
      toast({ tone: "success", title: `Opt-in recorded for ${contact.name ?? contact.phone_e164}`, description: "Source and timestamp stored for the GDPR audit trail." });
      onOpenChange(false);
      setConfirmed(false);
      onSaved();
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t record opt-in", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record WhatsApp opt-in</DialogTitle>
          <DialogDescription>
            {contact?.name ?? contact?.phone_e164} must have given explicit consent before any template is sent (GDPR Art. 6(1)(a) / 7).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="oi-source">How was consent collected?</Label>
          <Select id="oi-source" value={source} onChange={(e) => setSource(e.target.value as OptInSource)}>
            {(Object.keys(SOURCE_LABEL) as OptInSource[]).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="oi-text">Consent wording shown to the patient</Label>
          <Textarea id="oi-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I confirm the patient agreed to this wording.
        </label>
        <DialogFooter>
          <Button disabled={!confirmed || !text.trim() || busy} onClick={save}>
            {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Save opt-in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
