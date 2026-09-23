import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });

export const formatDate = (iso?: string | null) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const formatTime = (iso?: string | null) => (iso ? timeFmt.format(new Date(iso)) : "—");
export const formatDay = (iso: string) => dayFmt.format(new Date(iso));
export const formatDateTime = (iso?: string | null) => (iso ? `${formatDate(iso)}, ${formatTime(iso)}` : "—");
export const dayKey = (iso: string) => new Date(iso).toDateString();

export function timeLeft(iso?: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

/** value for <input type="datetime-local"> in the browser's local time */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
