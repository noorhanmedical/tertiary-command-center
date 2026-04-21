import type { OutreachCall } from "@shared/schema";
import { isBrainWave, formatTime12 } from "@/components/clinic-calendar";
import type { CallBucket, OutreachCallItem } from "./types";

export type DateInput = Date | string | number | null | undefined;

export function toDate(value: DateInput): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toTime(value: DateInput): number {
  return toDate(value)?.getTime() ?? NaN;
}

export function statusBadgeClass(status?: string | null) {
  const n = String(status || "pending").toLowerCase();
  if (n.includes("scheduled") || n.includes("booked")) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (n.includes("complete")) return "bg-blue-100 text-blue-700 border-blue-200";
  if (n.includes("decline") || n.includes("cancel")) return "bg-red-100 text-red-700 border-red-200";
  if (n === "no_answer") return "bg-slate-100 text-slate-600 border-slate-200";
  if (n === "callback") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

export function statusLabel(status?: string | null) {
  const n = String(status || "pending").toLowerCase();
  if (n === "no_answer") return "No answer";
  if (n === "callback") return "Callback";
  if (n === "pending") return "Not called";
  if (n === "scheduled") return "Scheduled";
  if (n === "declined") return "Declined";
  return status || "Pending";
}

export function urgencyBadgeClass(urgency: string) {
  if (urgency === "EOD") return "bg-amber-100 text-amber-700 border-amber-200";
  if (urgency === "within 3 hours") return "bg-orange-100 text-orange-700 border-orange-200";
  if (urgency === "within 1 hour") return "bg-red-100 text-red-700 border-red-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

export function urgencyShortLabel(urgency: string) {
  if (urgency === "EOD") return "EOD";
  if (urgency === "within 3 hours") return "3 hr";
  if (urgency === "within 1 hour") return "1 hr";
  return urgency;
}

export function calcTimeRemaining(urgency: string, createdAt: string): string {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  let deadline: number;
  if (urgency === "within 1 hour") deadline = created + 60 * 60 * 1000;
  else if (urgency === "within 3 hours") deadline = created + 3 * 60 * 60 * 1000;
  else {
    const eod = new Date();
    eod.setHours(17, 0, 0, 0);
    deadline = eod.getTime();
  }
  const diff = deadline - now;
  if (diff <= 0) return "Overdue";
  const hrs = Math.floor(diff / (60 * 60 * 1000));
  const mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  if (hrs > 0) return `${hrs}h ${mins}m left`;
  return `${mins}m left`;
}

export function digitsOnly(phone: string): string {
  return (phone || "").replace(/[^0-9+]/g, "");
}

export function formatAppointmentBadge(scheduledDate: string, scheduledTime: string, testType: string): string {
  const [y, m, d] = scheduledDate.split("-").map(Number);
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeLabel = formatTime12(scheduledTime);
  const typeLabel = isBrainWave(testType) ? "BrainWave" : "VitalWave";
  return `${dateLabel} · ${timeLabel} · ${typeLabel}`;
}

export function formatRelative(value: DateInput): string {
  const t = toTime(value);
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

// "Callback due" includes anything currently overdue OR coming due within
// the next 30 minutes — matches the spec for the header callback badge.
export const CALLBACK_DUE_WINDOW_MS = 30 * 60 * 1000;

export function callbackIsDueSoon(latestCall: OutreachCall | undefined): boolean {
  if (!latestCall || latestCall.outcome !== "callback" || !latestCall.callbackAt) return false;
  const due = toTime(latestCall.callbackAt);
  return due - Date.now() <= CALLBACK_DUE_WINDOW_MS;
}

export const NO_ANSWER_OUTCOMES = new Set([
  "no_answer", "voicemail", "mailbox_full", "busy", "hung_up", "disconnected",
]);

export function bucketForItem(item: OutreachCallItem, latestCall: OutreachCall | undefined): CallBucket {
  const status = item.appointmentStatus.toLowerCase();
  if (status === "scheduled") return "scheduled";
  if (status === "declined") return "declined";
  if (callbackIsDueSoon(latestCall)) return "callback_due";
  if (!latestCall) return "never_called";
  if (status === "no_answer" || NO_ANSWER_OUTCOMES.has(latestCall.outcome)) return "no_answer";
  return "contacted";
}

export const BUCKET_RANK: Record<CallBucket, number> = {
  callback_due: 0,
  never_called: 1,
  no_answer: 2,
  contacted: 3,
  scheduled: 4,
  declined: 5,
};
