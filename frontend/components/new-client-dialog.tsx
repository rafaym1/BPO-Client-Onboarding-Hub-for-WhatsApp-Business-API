"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/providers";
import { api } from "@/lib/api";

const COUNTRIES: [string, string][] = [
  ["DE", "Germany"], ["GB", "United Kingdom"], ["FR", "France"], ["NL", "Netherlands"], ["ES", "Spain"],
  ["IT", "Italy"], ["PL", "Poland"], ["SE", "Sweden"], ["CH", "Switzerland"], ["AT", "Austria"],
  ["TR", "Türkiye"], ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"], ["ZA", "South Africa"],
];

export function NewClientDialog() {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    business_name: "", country: "DE", industry: "healthcare", business_manager_id: "", waba_id: "", phone_number_id: "",
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const client = await api.clients.create({
        business_name: form.business_name.trim(),
        country: form.country,
        industry: form.industry.trim() || "healthcare",
        business_manager_id: form.business_manager_id.trim() || null,
        waba_id: form.waba_id.trim() || null,
        phone_number_id: form.phone_number_id.trim() || null,
      });
      if (client.jira_error) {
        toast({ tone: "warning", title: `${client.business_name} created, but Jira failed`, description: client.jira_error });
      } else {
        toast({
          tone: "success",
          title: `${client.business_name} onboarding started`,
          description: `Jira epic ${client.jira_epic_key} with 7 tasks created.`,
        });
      }
      setOpen(false);
      router.push(`/dashboard/clients/${client.id}/onboarding`);
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t create client", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus /> Onboard New Client</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Onboard a new client</DialogTitle>
            <DialogDescription>
              Creates the 7-step onboarding checklist and a Jira epic “Onboard {form.business_name || "…"} to WhatsApp API”.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="business_name">Business name</Label>
            <Input id="business_name" required autoFocus value={form.business_name} onChange={set("business_name")} placeholder="Berlin Dental Clinic" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="country">Country</Label>
              <Select id="country" value={form.country} onChange={set("country")}>
                {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="industry">Industry</Label>
              <Input id="industry" value={form.industry} onChange={set("industry")} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bm">Meta Business Manager ID <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="bm" inputMode="numeric" value={form.business_manager_id} onChange={set("business_manager_id")} placeholder="1234567890123456" />
          </div>
          <details className="rounded-md border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">WhatsApp IDs</summary>
            <p className="mt-2 text-xs text-muted-foreground">
              Leave blank to use the Meta test number and WABA from your <code>.env</code>. Real clients get their own once the number is provisioned.
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="waba">WABA ID</Label>
                <Input id="waba" inputMode="numeric" value={form.waba_id} onChange={set("waba_id")} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pnid">Phone number ID</Label>
                <Input id="pnid" inputMode="numeric" value={form.phone_number_id} onChange={set("phone_number_id")} />
              </div>
            </div>
          </details>
          <DialogFooter>
            <Button type="submit" disabled={busy || !form.business_name.trim()}>
              {busy && <Loader2 className="animate-spin" />} Start onboarding
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
