"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Send, Sparkles, XCircle } from "lucide-react";
import { NewTemplateDialog } from "@/components/new-template-dialog";
import { useClient, useConfig, useToast } from "@/components/providers";
import { TemplateStatusBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type WaTemplate } from "@/lib/api";
import { useResource } from "@/lib/hooks";

const REASON_HELP: Record<string, string> = {
  INCORRECT_CATEGORY: "Content doesn’t match the chosen category — promotional wording in a utility template. Reword it or resubmit as marketing.",
  INVALID_FORMAT: "Variable or formatting problem — check {{n}} placeholders and examples.",
  ABUSIVE_CONTENT: "Meta flagged the wording as abusive or threatening.",
  SCAM: "Meta flagged the content as potentially deceptive.",
  TAG_CONTENT_MISMATCH: "Content doesn’t match the template’s tag/category.",
};

export default function TemplatesPage() {
  const { client } = useClient();
  const config = useConfig();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  // poll fast while Meta is reviewing something so the webhook-driven status change shows up live
  const [pollMs, setPollMs] = useState(3000);
  const { data: templates, error, loading, reload } = useResource(
    async () => {
      const list = await api.templates.list(client.id);
      setPollMs(list.some((t) => t.status === "pending") ? 2000 : 8000);
      return list;
    },
    [client.id],
    pollMs,
  );

  async function run(key: string, fn: () => Promise<unknown>, okTitle: string) {
    setBusy(key);
    try {
      await fn();
      toast({ tone: "success", title: okTitle });
      await reload();
    } catch (e) {
      toast({ tone: "error", title: "Action failed", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const drafts = templates?.filter((t) => t.status === "draft" || t.status === "rejected") ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Message templates</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Only <span className="font-medium text-emerald-700">approved</span> templates can start a conversation. Meta’s decision arrives on the webhook and updates this table automatically.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => run("pack", () => api.clients.starterPack(client.id), "Healthcare starter pack added as drafts")} disabled={busy === "pack"}>
            {busy === "pack" ? <Loader2 className="animate-spin" /> : <Sparkles />} Load healthcare starter pack
          </Button>
          <NewTemplateDialog clientId={client.id} onCreated={reload} />
        </div>
      </div>

      {error && !templates && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Template</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="w-[38%]">Body</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !templates && <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {templates?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  No templates yet. Load the healthcare starter pack, or create your own.
                </TableCell>
              </TableRow>
            )}
            {templates?.map((t) => (
              <TemplateRow
                key={t.id} t={t} busy={busy}
                devTools={!!config?.dev_tools && !!config.mock.whatsapp}
                onSubmit={() => run(t.id, () => api.templates.submit(t.id), `“${t.name}” submitted to Meta`)}
                onSimulate={(event) =>
                  run(t.id, () => api.dev.simulateTemplate({ template_id: t.id, event, reason: event === "REJECTED" ? "INVALID_FORMAT" : undefined }), `Simulated Meta webhook: ${event.toLowerCase()}`)
                }
              />
            ))}
          </TableBody>
        </Table>
      </Card>

      {drafts.length > 1 && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            disabled={busy === "all"}
            onClick={() =>
              run("all", async () => { for (const t of drafts) await api.templates.submit(t.id); }, `${drafts.length} templates submitted to Meta`)
            }
          >
            {busy === "all" ? <Loader2 className="animate-spin" /> : <Send />} Submit all {drafts.length} to Meta
          </Button>
        </div>
      )}
    </div>
  );
}

function TemplateRow({
  t, busy, devTools, onSubmit, onSimulate,
}: {
  t: WaTemplate; busy: string | null; devTools: boolean;
  onSubmit: () => void; onSimulate: (event: "APPROVED" | "REJECTED") => void;
}) {
  const canSubmit = t.status === "draft" || t.status === "rejected";
  const working = busy === t.id;
  return (
    <TableRow className="align-top">
      <TableCell>
        <div className="font-mono text-[13px] font-medium">{t.name}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{t.language}{t.meta_template_id ? ` · Meta ID ${t.meta_template_id}` : ""}</div>
      </TableCell>
      <TableCell><Badge className="capitalize">{t.category}</Badge></TableCell>
      <TableCell>
        <p className="text-[13px] leading-relaxed">{t.body_text}</p>
        {t.buttons.length > 0 && (
          <div className="mt-2 flex gap-1.5">
            {t.buttons.map((b) => <span key={b} className="rounded border bg-muted px-2 py-0.5 text-xs">{b}</span>)}
          </div>
        )}
      </TableCell>
      <TableCell>
        <TemplateStatusBadge status={t.status} />
        {t.status === "pending" && <p className="mt-1.5 text-xs text-muted-foreground">Awaiting Meta review…</p>}
        {t.status === "rejected" && t.rejection_reason && (
          <div className="mt-1.5 max-w-[240px]">
            <p className="font-mono text-xs font-medium text-red-700">{t.rejection_reason}</p>
            {REASON_HELP[t.rejection_reason] && <p className="mt-0.5 text-xs text-muted-foreground">{REASON_HELP[t.rejection_reason]}</p>}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-col items-end gap-1.5">
          {canSubmit && (
            <Button size="sm" onClick={onSubmit} disabled={working}>
              {working ? <Loader2 className="animate-spin" /> : <Send />} {t.status === "rejected" ? "Resubmit to Meta" : "Submit to Meta"}
            </Button>
          )}
          {devTools && t.status === "pending" && (
            <div className="flex gap-1" title="Mock mode: play Meta’s review result">
              <Button size="sm" variant="ghost" onClick={() => onSimulate("APPROVED")} disabled={working}><CheckCircle2 className="text-emerald-600" /> Approve</Button>
              <Button size="sm" variant="ghost" onClick={() => onSimulate("REJECTED")} disabled={working}><XCircle className="text-red-600" /> Reject</Button>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
