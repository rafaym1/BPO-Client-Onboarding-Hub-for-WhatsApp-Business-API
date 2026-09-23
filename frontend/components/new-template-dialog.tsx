"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/providers";
import { api, type Language } from "@/lib/api";

export function NewTemplateDialog({ clientId, onCreated }: { clientId: string; onCreated: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "", language: "en_GB" as Language, category: "utility", body_text: "", buttons: "", footer_text: "", submit: true,
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const t = await api.templates.create({
        client_id: clientId,
        name: form.name.trim(),
        language: form.language,
        category: form.category,
        body_text: form.body_text.trim(),
        footer_text: form.footer_text.trim() || null,
        buttons: form.buttons.split(",").map((b) => b.trim()).filter(Boolean),
        submit: form.submit,
      });
      if (t.submit_error) toast({ tone: "warning", title: "Saved as draft — Meta submission failed", description: t.submit_error });
      else toast({ tone: "success", title: form.submit ? `“${t.name}” submitted to Meta` : `“${t.name}” saved as draft` });
      setOpen(false);
      setForm((f) => ({ ...f, name: "", body_text: "", buttons: "", footer_text: "" }));
      onCreated();
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t create template", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Plus /> New template</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New message template</DialogTitle>
            <DialogDescription>Meta reviews every template before it can be sent outside the 24h window.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="t-name">Name</Label>
            <Input id="t-name" required pattern="[a-z0-9_]+" title="lowercase letters, digits and underscores" value={form.name} onChange={set("name")} placeholder="appointment_confirmation" className="font-mono" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="t-lang">Language</Label>
              <Select id="t-lang" value={form.language} onChange={set("language")}>
                <option value="en_GB">English (UK)</option>
                <option value="de_DE">German</option>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="t-cat">Category</Label>
              <Select id="t-cat" value={form.category} onChange={set("category")}>
                <option value="utility">Utility</option>
                <option value="marketing">Marketing</option>
                <option value="authentication">Authentication</option>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-body">Body</Label>
            <Textarea id="t-body" required rows={4} value={form.body_text} onChange={set("body_text")} placeholder="Hi {{1}}, your appointment on {{2}} is confirmed." />
            <p className="text-xs text-muted-foreground">Variables: {"{{1}}"}, {"{{2}}"}… in order.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="t-btn">Quick-reply buttons <span className="font-normal text-muted-foreground">(comma-separated)</span></Label>
              <Input id="t-btn" value={form.buttons} onChange={set("buttons")} placeholder="Yes, No" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="t-foot">Footer <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="t-foot" maxLength={60} value={form.footer_text} onChange={set("footer_text")} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={!form.submit} onChange={(e) => setForm((f) => ({ ...f, submit: !e.target.checked }))} />
            Save as draft (don’t submit to Meta yet)
          </label>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} {form.submit ? "Create & submit" : "Save draft"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
