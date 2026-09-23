"use client";

import { useState } from "react";
import { Ban, Check, Loader2, Play, RotateCcw } from "lucide-react";
import { JiraKey } from "@/components/jira-link";
import { useClient, useToast } from "@/components/providers";
import { StepBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { api, type ChecklistStatus, type ChecklistStep } from "@/lib/api";
import { cn } from "@/lib/utils";

const STEP_HELP: Record<string, string> = {
  "Client Intake": "Kickoff call done: business details, use cases and expected message volumes captured.",
  "BM Verification Check": "Client's Meta Business Manager exists and is business-verified (needed to lift messaging limits).",
  "Number Provisioning": "Phone number registered on the WABA, display name approved, number not active on the WhatsApp app.",
  "Webhook Setup": "Meta webhook points at /webhooks/whatsapp, verify token matches, messages + template status subscribed.",
  "Template Pack Submission": "Starter templates submitted to Meta and approved. Completes automatically when all are approved.",
  "Opt-in Flow Test": "Opt-in captured (QR / keyword / API) with GDPR consent text, then a test message round trip.",
  "Go-live": "Final sign-off. Requires every earlier step to be done.",
};

const COLUMNS: { status: ChecklistStatus; title: string; hint: string }[] = [
  { status: "pending", title: "To do", hint: "Waiting on earlier steps" },
  { status: "in_progress", title: "In progress", hint: "Being worked on now" },
  { status: "blocked", title: "Blocked", hint: "Needs client or Meta action" },
  { status: "done", title: "Done", hint: "Synced to Jira as Done" },
];

export default function OnboardingPage() {
  const { client, setClient } = useClient();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<ChecklistStep | null>(null);
  const [blockNote, setBlockNote] = useState("");
  const steps = client.checklist ?? [];

  async function update(step: ChecklistStep, status: ChecklistStatus, notes?: string) {
    setBusyId(step.id);
    try {
      const res = await api.clients.updateStep(client.id, step.id, { status, ...(notes !== undefined ? { notes } : {}) });
      setClient(res.client);
      if (status === "done") {
        toast({
          tone: "success",
          title: `${step.step_name} done`,
          description: res.client.onboarding_status === "live" ? `${client.business_name} is live 🎉` : step.jira_issue_key ? `${step.jira_issue_key} moved to Done in Jira.` : undefined,
        });
      }
    } catch (e) {
      toast({ tone: "error", title: `Couldn’t update “${step.step_name}”`, description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyId(null);
    }
  }

  async function retryJira() {
    try {
      setClient(await api.clients.retryJira(client.id));
      toast({ tone: "success", title: "Jira epic created" });
    } catch (e) {
      toast({ tone: "error", title: "Jira still failing", description: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="space-y-6">
      {!client.jira_epic_key && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <span>No Jira epic yet — Jira was unreachable when this client was created.</span>
          <Button size="sm" variant="outline" onClick={retryJira}>Retry Jira sync</Button>
        </div>
      )}

      {/* timeline */}
      <Card>
        <CardHeader><CardTitle>Onboarding timeline</CardTitle></CardHeader>
        <CardContent>
          <ol className="flex min-w-0 gap-0 overflow-x-auto pb-1">
            {steps.map((s, i) => (
              <li key={s.id} className="flex min-w-[112px] flex-1 flex-col items-center text-center">
                <div className="flex w-full items-center">
                  <div className={cn("h-0.5 flex-1", i === 0 ? "bg-transparent" : steps[i - 1].status === "done" ? "bg-primary" : "bg-border")} />
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold",
                      s.status === "done" && "border-primary bg-primary text-primary-foreground",
                      s.status === "in_progress" && "border-primary bg-background text-primary",
                      s.status === "blocked" && "border-red-500 bg-red-50 text-red-600",
                      s.status === "pending" && "border-border bg-background text-muted-foreground",
                    )}
                  >
                    {s.status === "done" ? <Check className="h-4 w-4" /> : s.step_order}
                  </div>
                  <div className={cn("h-0.5 flex-1", i === steps.length - 1 ? "bg-transparent" : s.status === "done" ? "bg-primary" : "bg-border")} />
                </div>
                <span className={cn("mt-2 px-1 text-xs leading-tight", s.status === "pending" ? "text-muted-foreground" : "font-medium")}>{s.step_name}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* kanban */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = steps.filter((s) => s.status === col.status);
          return (
            <section key={col.status} className="rounded-lg bg-secondary/60 p-2" aria-label={col.title}>
              <header className="flex items-baseline justify-between px-2 pb-2 pt-1">
                <h2 className="text-sm font-semibold">{col.title} <span className="font-normal text-muted-foreground">· {items.length}</span></h2>
              </header>
              <div className="space-y-2">
                {items.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">{col.hint}</p>}
                {items.map((s) => (
                  <Card key={s.id} className="shadow-none">
                    <CardContent className="space-y-3 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Step {s.step_order}</p>
                          <h3 className="text-sm font-semibold leading-snug">{s.step_name}</h3>
                        </div>
                        <StepBadge status={s.status} />
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">{STEP_HELP[s.step_name]}</p>
                      {s.notes && <p className="rounded-md bg-muted px-2 py-1.5 text-xs">{s.notes}</p>}
                      {s.jira_issue_key && <JiraKey issueKey={s.jira_issue_key} url={s.jira_url} className="font-mono text-xs text-primary" />}
                      <div className="flex flex-wrap gap-2">
                        {busyId === s.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        {s.status === "pending" && (
                          <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => update(s, "in_progress")}><Play /> Start</Button>
                        )}
                        {(s.status === "pending" || s.status === "in_progress") && (
                          <Button size="sm" disabled={busyId === s.id} onClick={() => update(s, "done")}><Check /> Mark done</Button>
                        )}
                        {s.status === "in_progress" && (
                          <Button size="sm" variant="ghost" disabled={busyId === s.id} onClick={() => { setBlocking(s); setBlockNote(s.notes ?? ""); }}><Ban /> Block</Button>
                        )}
                        {s.status === "blocked" && (
                          <>
                            <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => update(s, "in_progress")}><Play /> Unblock</Button>
                            <Button size="sm" disabled={busyId === s.id} onClick={() => update(s, "done")}><Check /> Mark done</Button>
                          </>
                        )}
                        {s.status === "done" && (
                          <Button size="sm" variant="ghost" disabled={busyId === s.id} onClick={() => update(s, "in_progress")}><RotateCcw /> Reopen</Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <Dialog open={!!blocking} onOpenChange={(o) => !o && setBlocking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Block “{blocking?.step_name}”</DialogTitle>
            <DialogDescription>Say what it’s waiting on so the account team can chase it.</DialogDescription>
          </DialogHeader>
          <Textarea autoFocus value={blockNote} onChange={(e) => setBlockNote(e.target.value)} placeholder="e.g. Waiting for client to complete Meta business verification" />
          <DialogFooter>
            <Button
              disabled={!blockNote.trim()}
              onClick={async () => {
                if (blocking) await update(blocking, "blocked", blockNote.trim());
                setBlocking(null);
              }}
            >
              Mark as blocked
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
