"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { JiraKey } from "@/components/jira-link";
import { NewClientDialog } from "@/components/new-client-dialog";
import { OnboardingBadge } from "@/components/status-badges";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { formatDate } from "@/lib/utils";

export default function ClientsPage() {
  const router = useRouter();
  const { data: clients, error, loading } = useResource(() => api.clients.list(), [], 10_000);

  const live = clients?.filter((c) => c.onboarding_status === "live").length ?? 0;
  const inFlight = (clients?.length ?? 0) - live;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {clients ? `${clients.length} client${clients.length === 1 ? "" : "s"} · ${inFlight} onboarding · ${live} live` : "WhatsApp Business API onboarding across your BPO clients"}
          </p>
        </div>
        <NewClientDialog />
      </div>

      {error && !clients && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-medium">Couldn’t load clients</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Client</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Onboarding status</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Jira epic</TableHead>
              <TableHead>Go-live date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !clients && (
              <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">Loading…</TableCell></TableRow>
            )}
            {clients?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  No clients yet. Use <span className="font-medium text-foreground">Onboard New Client</span> to start the first onboarding.
                </TableCell>
              </TableRow>
            )}
            {clients?.map((c) => {
              const p = c.checklist_progress;
              return (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/dashboard/clients/${c.id}/onboarding`)}>
                  <TableCell>
                    <Link
                      href={`/dashboard/clients/${c.id}/onboarding`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {c.business_name}
                    </Link>
                    <div className="text-xs capitalize text-muted-foreground">{c.industry}</div>
                  </TableCell>
                  <TableCell>{c.country}</TableCell>
                  <TableCell><OnboardingBadge status={c.onboarding_status} /></TableCell>
                  <TableCell>
                    {p && (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${(p.done / Math.max(p.total, 1)) * 100}%` }} />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">{p.done}/{p.total}</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {c.jira_epic_key ? (
                      <span onClick={(e) => e.stopPropagation()}>
                        <JiraKey issueKey={c.jira_epic_key} url={c.jira_epic_url} className="font-mono text-xs text-primary" />
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className={c.go_live_date ? "" : "text-muted-foreground"}>{formatDate(c.go_live_date)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
