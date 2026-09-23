"use client";

import Link from "next/link";
import { MessageSquareText, RotateCcw } from "lucide-react";
import { IntegrationLog } from "@/components/integration-log";
import { AppProviders, useConfig } from "@/components/providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEMO } from "@/lib/api";
import { resetDemo } from "@/lib/demo-backend";

function IntegrationChips() {
  const config = useConfig();
  if (!config) return null;
  const items: [string, boolean][] = [
    ["WhatsApp", config.mock.whatsapp],
    ["HubSpot", config.mock.hubspot],
    ["Jira", config.mock.jira],
  ];
  return (
    <div className="hidden items-center gap-2 sm:flex" title="Integrations without credentials run against a mock">
      {items.map(([name, mocked]) => (
        <Badge key={name} tone={mocked ? "yellow" : "green"}>
          {name}: {mocked ? "mock" : "live"}
        </Badge>
      ))}
    </div>
  );
}

function HeaderTools() {
  const config = useConfig();
  return (
    <div className="flex items-center gap-3">
      <IntegrationChips />
      {config?.dev_tools && <IntegrationLog />}
    </div>
  );
}

function DemoBanner() {
  return (
    <div className="border-b border-amber-200 bg-amber-50 text-amber-950">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2 text-sm sm:px-6">
        <p>
          <span className="font-semibold">Interactive demo.</span> Runs entirely in your browser with simulated Meta, Jira and HubSpot. Nothing is sent to real services;
          data stays on this device.
        </p>
        <div className="flex items-center gap-3">
          <details className="text-xs">
            <summary className="cursor-pointer font-medium underline-offset-2 hover:underline">Suggested walkthrough</summary>
            <ol className="absolute z-50 mt-2 max-w-sm list-decimal space-y-1 rounded-md border border-amber-200 bg-white p-3 pl-7 text-[13px] text-slate-800 shadow-lg">
              <li><b>Onboard New Client</b> and watch the Jira epic + 7 tasks appear (see <i>Integration log</i>).</li>
              <li>Open <b>Berlin Dental Clinic → Templates</b>, submit all 3, and watch Meta’s approvals arrive.</li>
              <li><b>Appointments → Book Test Appointment</b> for Anna Schmidt.</li>
              <li><b>Inbox → Anna</b>: confirmation with delivery ticks, opt-in state, 24h window.</li>
              <li>Click <b>RESCHEDULE</b> in the demo bar: status flips and a HubSpot task is created.</li>
              <li>Try a contact without opt-in (Markus Weber): the send is blocked by GDPR rules.</li>
            </ol>
          </details>
          <Button
            size="sm" variant="outline" className="h-7 border-amber-300 bg-transparent text-xs hover:bg-amber-100"
            onClick={() => { resetDemo(); window.location.reload(); }}
          >
            <RotateCcw /> Reset demo
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders>
      {DEMO && <DemoBanner />}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard/clients" className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <MessageSquareText className="h-4 w-4" />
            </span>
            BPO Onboarding Hub
          </Link>
          <HeaderTools />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </AppProviders>
  );
}
