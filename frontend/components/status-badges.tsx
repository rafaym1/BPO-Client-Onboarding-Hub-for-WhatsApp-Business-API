import { AlertCircle, Check, CheckCheck, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AppointmentStatus, ChecklistStatus, MessageStatus, OnboardingStatus, OptInStatus, TemplateStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "green" | "yellow" | "red" | "blue" | "violet";

export const ONBOARDING_LABEL: Record<OnboardingStatus, string> = {
  kickoff: "Kickoff",
  bm_verification: "BM verification",
  number_provisioning: "Number provisioning",
  webhook_setup: "Webhook setup",
  template_submission: "Template submission",
  optin_test: "Opt-in test",
  go_live: "Go-live",
  live: "Live",
};
const ONBOARDING_TONE: Record<OnboardingStatus, Tone> = {
  kickoff: "neutral",
  bm_verification: "yellow",
  number_provisioning: "yellow",
  webhook_setup: "blue",
  template_submission: "blue",
  optin_test: "violet",
  go_live: "violet",
  live: "green",
};

export const OnboardingBadge = ({ status }: { status: OnboardingStatus }) => (
  <Badge tone={ONBOARDING_TONE[status]}>{ONBOARDING_LABEL[status]}</Badge>
);

const TEMPLATE_TONE: Record<TemplateStatus, Tone> = { draft: "neutral", pending: "yellow", approved: "green", rejected: "red" };
export const TemplateStatusBadge = ({ status }: { status: TemplateStatus }) => (
  <Badge tone={TEMPLATE_TONE[status]} className="capitalize">{status}</Badge>
);

const OPTIN_META: Record<OptInStatus, { tone: Tone; label: string }> = {
  opted_in: { tone: "green", label: "Opted in" },
  opted_out: { tone: "red", label: "Opted out" },
  pending: { tone: "yellow", label: "No opt-in" },
};
export const OptInBadge = ({ status }: { status: OptInStatus }) => (
  <Badge tone={OPTIN_META[status].tone}>{OPTIN_META[status].label}</Badge>
);

const APPT_TONE: Record<AppointmentStatus, Tone> = { confirmed: "green", cancelled: "neutral", no_show: "red", rescheduled: "yellow" };
export const AppointmentBadge = ({ status }: { status: AppointmentStatus }) => (
  <Badge tone={APPT_TONE[status]}>{status.replace("_", " ")}</Badge>
);

const STEP_TONE: Record<ChecklistStatus, Tone> = { pending: "neutral", in_progress: "blue", done: "green", blocked: "red" };
export const StepBadge = ({ status }: { status: ChecklistStatus }) => (
  <Badge tone={STEP_TONE[status]}>{status.replace("_", " ")}</Badge>
);

/** WhatsApp-style delivery ticks: ✓ sent, ✓✓ delivered, blue ✓✓ read */
export function MessageTicks({ status, className }: { status: MessageStatus; className?: string }) {
  if (status === "failed")
    return <AlertCircle aria-label="failed" className={cn("h-3.5 w-3.5 text-red-500", className)} />;
  if (status === "read") return <CheckCheck aria-label="read" className={cn("h-3.5 w-3.5 text-sky-500", className)} />;
  if (status === "delivered") return <CheckCheck aria-label="delivered" className={cn("h-3.5 w-3.5 text-slate-400", className)} />;
  return <Check aria-label="sent" className={cn("h-3.5 w-3.5 text-slate-400", className)} />;
}

export const PendingClock = () => <Clock className="h-3.5 w-3.5 text-slate-400" aria-label="scheduled" />;
