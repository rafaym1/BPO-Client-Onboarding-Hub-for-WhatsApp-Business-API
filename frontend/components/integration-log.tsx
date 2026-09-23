"use client";

import { useEffect, useState } from "react";
import { RefreshCw, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api, type LogEntry } from "@/lib/api";
import { cn, formatTime } from "@/lib/utils";

const SERVICES = [
  { id: "jira", label: "Jira" },
  { id: "hubspot", label: "HubSpot" },
  { id: "whatsapp", label: "WhatsApp" },
] as const;

function summary(e: LogEntry): string {
  const pick = ["key", "parent", "to", "summary", "subject", "name", "template", "body", "phone", "contact_id"]
    .filter((k) => e[k] !== undefined && e[k] !== null && e[k] !== "")
    .map((k) => (k === "to" || k === "key" || k === "parent" || k === "contact_id" ? `${k}: ${e[k]}` : String(e[k])));
  return pick.join(" · ");
}

/** What the mocked Jira / HubSpot / WhatsApp integrations "did" — the CRM side of the demo. */
export function IntegrationLog() {
  const [open, setOpen] = useState(false);
  const [service, setService] = useState<(typeof SERVICES)[number]["id"]>("hubspot");
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.dev.mockLog(service).then((r) => { setEntries(r); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    if (!open) return;
    setEntries(null);
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, service]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><ScrollText /> Integration log</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Integration log</DialogTitle>
          <DialogDescription>Every call made to Jira, HubSpot and WhatsApp, newest first. With live credentials these are real API calls.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1" role="tablist">
            {SERVICES.map((s) => (
              <button
                key={s.id} role="tab" aria-selected={service === s.id} onClick={() => setService(s.id)}
                className={cn("rounded-md px-3 py-1.5 text-sm font-medium", service === s.id ? "bg-secondary" : "text-muted-foreground hover:text-foreground")}
              >
                {s.label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={load}><RefreshCw /> Refresh</Button>
        </div>
        <div className="max-h-[50vh] min-h-[200px] overflow-y-auto rounded-md border">
          {error && <p className="p-4 text-sm text-red-800">{error}</p>}
          {!error && entries?.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nothing yet. Onboard a client, submit a template or book an appointment.</p>}
          <ul className="divide-y">
            {entries?.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex gap-3 px-3 py-2 text-sm">
                <span className="w-12 shrink-0 tabular-nums text-xs text-muted-foreground">{formatTime(e.at)}</span>
                <span className="w-32 shrink-0 font-mono text-xs font-medium">{e.action}</span>
                <span className="min-w-0 break-words text-[13px] text-muted-foreground">{summary(e)}</span>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
