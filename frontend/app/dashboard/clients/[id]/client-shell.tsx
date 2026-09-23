"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { JiraKey } from "@/components/jira-link";
import { ClientContext } from "@/components/providers";
import { OnboardingBadge } from "@/components/status-badges";
import { api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const TABS = [
  { slug: "onboarding", label: "Onboarding" },
  { slug: "templates", label: "Templates" },
  { slug: "inbox", label: "Inbox" },
  { slug: "appointments", label: "Appointments" },
];

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const { data: client, error, reload, setData } = useResource(() => api.clients.get(id), [id]);

  if (error && !client) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <p className="font-medium">Couldn’t load this client</p>
        <p className="mt-1">{error}</p>
        <Link href="/dashboard/clients" className="mt-3 inline-block underline">Back to clients</Link>
      </div>
    );
  }
  if (!client) return <div className="h-24 animate-pulse rounded-lg bg-muted" aria-label="Loading client" />;

  return (
    <ClientContext.Provider value={{ client, reload: async () => void (await reload()), setClient: setData }}>
      <div className="mb-6">
        <Link href="/dashboard/clients" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> All clients
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{client.business_name}</h1>
          <OnboardingBadge status={client.onboarding_status} />
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{client.country} · {client.industry}</span>
          {client.jira_epic_key && <JiraKey issueKey={client.jira_epic_key} url={client.jira_epic_url} className="text-primary" />}
          <span className="font-mono text-xs">WABA {client.waba_id ?? "—"} · Phone ID {client.phone_number_id ?? "—"}</span>
        </p>
        <nav className="mt-4 flex gap-1 border-b" aria-label="Client sections">
          {TABS.map((tab) => {
            const href = `/dashboard/clients/${id}/${tab.slug}`;
            const active = pathname?.replace(/\/$/, "") === href;
            return (
              <Link
                key={tab.slug}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </ClientContext.Provider>
  );
}
