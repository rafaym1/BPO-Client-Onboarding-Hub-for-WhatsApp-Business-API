"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, Clock, Loader2, Plus, Send, ShieldCheck, ShieldOff, UserPlus } from "lucide-react";
import { OptInDialog, SOURCE_LABEL } from "@/components/opt-in-dialog";
import { useClient, useConfig, useToast } from "@/components/providers";
import { MessageTicks, OptInBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { api, type Contact, type Language, type Message, type WaTemplate } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { cn, formatDateTime, formatTime, timeLeft } from "@/lib/utils";

export default function InboxPage() {
  const { client } = useClient();
  const config = useConfig();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [optInOpen, setOptInOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const inbox = useResource(() => api.clients.inbox(client.id), [client.id], 3000);
  const thread = useResource(
    () => (selectedId ? api.contacts.messages(selectedId) : Promise.resolve(null)),
    [selectedId],
    3000,
  );
  const templates = useResource(() => api.templates.list(client.id), [client.id]);
  const approved = useMemo(() => (templates.data ?? []).filter((t) => t.status === "approved"), [templates.data]);

  useEffect(() => {
    if (!selectedId && inbox.data?.length) setSelectedId(inbox.data[0].id);
  }, [inbox.data, selectedId]);

  const contact = thread.data?.contact ?? null;
  const refresh = () => Promise.all([inbox.reload(), thread.reload()]);

  async function optOut(c: Contact) {
    try {
      await api.contacts.optIn(c.id, { opt_in_status: "opted_out" });
      toast({ tone: "success", title: `${c.name ?? c.phone_e164} opted out`, description: "No further messages will be sent." });
      refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t update opt-in", description: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="space-y-3">
      <Card className="grid h-[calc(100vh-15rem)] min-h-[520px] grid-cols-1 overflow-hidden md:grid-cols-[320px_1fr]">
        {/* contacts */}
        <aside className="flex min-h-0 flex-col border-b md:border-b-0 md:border-r" aria-label="Contacts">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Contacts</h2>
            <Button size="sm" variant="ghost" onClick={() => setAddOpen(true)}><UserPlus /> Add</Button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {inbox.data?.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">No conversations yet. Add a contact, or book an appointment.</li>
            )}
            {inbox.data?.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setSelectedId(c.id)}
                  className={cn("w-full border-b px-4 py-3 text-left transition-colors hover:bg-muted/60", selectedId === c.id && "bg-accent")}
                  aria-current={selectedId === c.id}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{c.name ?? c.phone_e164}</span>
                    {c.last_message && <span className="shrink-0 text-[11px] text-muted-foreground">{formatTime(c.last_message.timestamp)}</span>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {c.last_message ? `${c.last_message.direction === "out" ? "You: " : ""}${c.last_message.body}` : c.phone_e164}
                  </p>
                  <div className="mt-1.5"><OptInBadge status={c.opt_in_status} /></div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* thread */}
        <section className="flex min-h-0 flex-col" aria-label="Conversation">
          {!contact ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">Select a contact to see the conversation.</div>
          ) : (
            <>
              <ThreadHeader contact={contact} onOptIn={() => setOptInOpen(true)} onOptOut={() => optOut(contact)} />
              <Messages messages={thread.data?.messages ?? []} />
              <Composer
                contact={contact} approved={approved} onSent={refresh}
                onOptIn={() => setOptInOpen(true)}
              />
            </>
          )}
        </section>
      </Card>

      {config?.dev_tools && config.mock.whatsapp && contact && (
        <SimulatePatient clientId={client.id} contact={contact} onDone={refresh} />
      )}

      <OptInDialog contact={contact} clinicName={client.business_name} open={optInOpen} onOpenChange={setOptInOpen} onSaved={refresh} />
      <AddContactDialog
        clientId={client.id} open={addOpen} onOpenChange={setAddOpen}
        onCreated={async (c) => { await inbox.reload(); setSelectedId(c.id); }}
      />
    </div>
  );
}

// ---------- header with the compliance state ----------
function ThreadHeader({ contact, onOptIn, onOptOut }: { contact: Contact; onOptIn: () => void; onOptOut: () => void }) {
  const win = contact.service_window;
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold">{contact.name ?? contact.phone_e164}</h2>
        <p className="font-mono text-xs text-muted-foreground">{contact.phone_e164}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        <div className="flex items-center gap-2" title={contact.gdpr_consent_text ?? undefined}>
          <OptInBadge status={contact.opt_in_status} />
          {contact.opt_in_status === "opted_in" && contact.opt_in_source && (
            <span className="text-muted-foreground">
              via {SOURCE_LABEL[contact.opt_in_source].split(" (")[0]} · {formatDateTime(contact.opt_in_timestamp)} · GDPR {contact.gdpr_consent ? "✓" : "✗"}
            </span>
          )}
        </div>
        <span className={cn("inline-flex items-center gap-1", win.open ? "text-emerald-700" : "text-muted-foreground")}>
          <Clock className="h-3.5 w-3.5" />
          {win.open ? `24h window open · ${timeLeft(win.expires_at)}` : "24h window closed · templates only"}
        </span>
        {contact.opt_in_status !== "opted_in" ? (
          <Button size="sm" variant="outline" onClick={onOptIn}><ShieldCheck /> Record opt-in</Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onOptOut}><ShieldOff /> Opt out</Button>
        )}
      </div>
    </header>
  );
}

// ---------- messages ----------
function Messages({ messages }: { messages: Message[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/40 px-4 py-4" role="log" aria-live="polite">
      {messages.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No messages yet.</p>}
      {messages.map((m) => {
        const out = m.direction === "out";
        const c = m.content_json as { template?: string; buttons?: string[] };
        return (
          <div key={m.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[78%] rounded-lg px-3 py-2 text-sm shadow-sm", out ? "rounded-br-sm bg-emerald-100 text-emerald-950" : "rounded-bl-sm border bg-background")}>
              {m.type === "template" && c.template && (
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-emerald-800/70">Template · {c.template}</p>
              )}
              {m.type === "button" && <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Button reply</p>}
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              {c.buttons && c.buttons.length > 0 && (
                <div className="mt-2 flex gap-1.5">
                  {c.buttons.map((b) => <span key={b} className="rounded-md border border-emerald-300 bg-white/70 px-3 py-0.5 text-xs font-medium text-emerald-800">{b}</span>)}
                </div>
              )}
              <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
                {formatTime(m.timestamp)}
                {out && <MessageTicks status={m.status} />}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

// ---------- composer: free text only inside the 24h window, otherwise an approved template ----------
function Composer({
  contact, approved, onSent, onOptIn,
}: { contact: Contact; approved: WaTemplate[]; onSent: () => void; onOptIn: () => void }) {
  const toast = useToast();
  const windowOpen = contact.service_window.open;
  const optedOut = contact.opt_in_status === "opted_out";
  const canTemplate = contact.opt_in_status === "opted_in" && contact.gdpr_consent;
  const [mode, setMode] = useState<"text" | "template">(windowOpen ? "text" : "template");
  const [text, setText] = useState("");
  const [tplKey, setTplKey] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setMode(windowOpen ? "text" : "template"); }, [contact.id, windowOpen]);

  const tpl = approved.find((t) => `${t.name}|${t.language}` === tplKey) ?? null;
  const varCount = tpl ? Math.max(0, ...Array.from(tpl.body_text.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1]))) : 0;
  useEffect(() => {
    setParams(Array.from({ length: varCount }, (_, i) => (i === 0 ? (contact.name ?? "").split(" ")[0] : "")));
  }, [tplKey, varCount, contact.id, contact.name]);

  async function send() {
    setBusy(true);
    try {
      if (mode === "text") await api.contacts.send(contact.id, { type: "text", text: text.trim() });
      else if (tpl) await api.contacts.send(contact.id, { type: "template", template_name: tpl.name, language: tpl.language as Language, params });
      setText("");
      onSent();
    } catch (e) {
      toast({ tone: "error", title: "Message blocked", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (optedOut) {
    return (
      <div className="flex items-center gap-2 border-t bg-red-50 px-4 py-3 text-sm text-red-900">
        <Ban className="h-4 w-4" /> This contact opted out. No messages can be sent until they opt in again.
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t bg-background p-3">
      <div className="flex items-center gap-1 text-xs">
        <button
          disabled={!windowOpen} onClick={() => setMode("text")}
          className={cn("rounded-md px-2.5 py-1 font-medium", mode === "text" ? "bg-secondary" : "text-muted-foreground hover:text-foreground", !windowOpen && "cursor-not-allowed opacity-50")}
          title={windowOpen ? undefined : "The 24h customer service window is closed"}
        >
          Text reply
        </button>
        <button onClick={() => setMode("template")} className={cn("rounded-md px-2.5 py-1 font-medium", mode === "template" ? "bg-secondary" : "text-muted-foreground hover:text-foreground")}>
          Template
        </button>
        {!windowOpen && <span className="ml-2 text-muted-foreground">Free text is disabled: last patient message is older than 24h.</span>}
      </div>

      {mode === "text" ? (
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) send(); }} className="flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a reply…" aria-label="Message" />
          <Button type="submit" disabled={busy || !text.trim()}>{busy ? <Loader2 className="animate-spin" /> : <Send />} Send</Button>
        </form>
      ) : (
        <div className="space-y-2">
          {!canTemplate && (
            <p className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Templates need a recorded opt-in and GDPR consent for this contact.
              <button className="font-medium underline" onClick={onOptIn}>Record opt-in</button>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Select value={tplKey} onChange={(e) => setTplKey(e.target.value)} className="w-full sm:w-72" aria-label="Approved template">
              <option value="">{approved.length ? "Choose an approved template…" : "No approved templates yet"}</option>
              {approved.map((t) => <option key={t.id} value={`${t.name}|${t.language}`}>{t.name} · {t.language}</option>)}
            </Select>
            {params.map((p, i) => (
              <Input key={i} className="w-40" value={p} placeholder={`{{${i + 1}}}`} aria-label={`Variable ${i + 1}`}
                onChange={(e) => setParams((cur) => cur.map((v, j) => (j === i ? e.target.value : v)))} />
            ))}
            <Button onClick={send} disabled={busy || !tpl || !canTemplate || params.some((p) => !p.trim())}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />} Send template
            </Button>
          </div>
          {tpl && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{tpl.body_text}</p>}
        </div>
      )}
    </div>
  );
}

// ---------- mock helper: play the patient ----------
function SimulatePatient({ clientId, contact, onDone }: { clientId: string; contact: Contact; onDone: () => void }) {
  const toast = useToast();
  const [custom, setCustom] = useState("");
  async function fire(text: string, asButton = false) {
    try {
      await api.dev.simulateInbound({ client_id: clientId, from_phone: contact.phone_e164, name: contact.name ?? undefined, text, as_button: asButton });
      onDone();
    } catch (e) {
      toast({ tone: "error", title: "Simulation failed", description: e instanceof Error ? e.message : String(e) });
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed bg-background px-3 py-2 text-sm">
      <span className="font-medium">Demo: reply as {contact.name ?? contact.phone_e164}</span>
      <span className="text-xs text-muted-foreground">(mock WhatsApp — goes through the real webhook handler)</span>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={() => fire("Yes", true)}>Yes</Button>
        <Button size="sm" variant="outline" onClick={() => fire("No", true)}>No</Button>
        <Button size="sm" variant="outline" onClick={() => fire("RESCHEDULE")}>RESCHEDULE</Button>
        <Button size="sm" variant="outline" onClick={() => fire("STOP")}>STOP</Button>
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) { fire(custom.trim()); setCustom(""); } }}>
          <Input className="h-8 w-40" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Free text…" aria-label="Simulated patient message" />
          <Button size="sm" type="submit" disabled={!custom.trim()}>Send</Button>
        </form>
      </div>
    </div>
  );
}

// ---------- add contact ----------
function AddContactDialog({
  clientId, open, onOpenChange, onCreated,
}: { clientId: string; open: boolean; onOpenChange: (o: boolean) => void; onCreated: (c: Contact) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const c = await api.contacts.create({ client_id: clientId, phone, name: name.trim() || undefined });
      toast({ tone: "success", title: `${c.name ?? c.phone_e164} added`, description: "No opt-in yet — record consent before sending templates." });
      onOpenChange(false);
      setName(""); setPhone("");
      onCreated(c);
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t add contact", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add contact</DialogTitle>
            <DialogDescription>Contacts start with no opt-in. You can record consent afterwards.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="c-name">Name</Label>
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Anna Schmidt" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-phone">Phone (E.164)</Label>
            <Input id="c-phone" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+49 151 23456789" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !phone.trim()}>{busy ? <Loader2 className="animate-spin" /> : <Plus />} Add contact</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
