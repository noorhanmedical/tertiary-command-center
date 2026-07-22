// Phase 2D-C2 — pure view-model derivation for canonical appointment
// presentation. No React, no @/ aliases — importable by both the
// component and unit tests. The server projection is the ONLY source of
// truth; nothing here re-decides eligibility or active/history.

import type { AncillaryAppointmentProjection, CanonicalAppointmentView } from "@shared/types/canonicalAppointment";

export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
  rescheduled: "Rescheduled",
};

export const APPOINTMENT_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  scheduled: "default",
  completed: "secondary",
  cancelled: "destructive",
  no_show: "destructive",
  rescheduled: "outline",
};

export type CanonicalAppointmentSummaryViewModel = {
  hasActive: boolean;
  notScheduled: boolean;
  serviceType: string | null;
  statusLabel: string | null;
  statusVariant: "default" | "secondary" | "destructive" | "outline";
  whenLabel: string | null;
  location: string | null;
  globalScheduleEventId: number | null;
  historyCount: number;
  rescheduledFromEventId: number | null;
  eligibleForOrderNote: boolean;
  eligibilityReason: string;
};

export function formatAppointmentWhen(view: CanonicalAppointmentView): string | null {
  if (!view.startsAt) return null;
  const d = new Date(view.startsAt);
  if (Number.isNaN(d.getTime())) return view.startsAt;
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/** Pure derivation from the server projection — no rendering side effects. */
export function deriveAppointmentSummary(
  projection: AncillaryAppointmentProjection,
  serviceTypeHint?: string | null,
): CanonicalAppointmentSummaryViewModel {
  const active = projection.activeAppointment;
  return {
    hasActive: active != null,
    notScheduled: active == null,
    serviceType: active?.serviceType ?? serviceTypeHint ?? null,
    statusLabel: active ? APPOINTMENT_STATUS_LABELS[active.status] ?? active.status : null,
    statusVariant: active ? APPOINTMENT_STATUS_VARIANT[active.status] ?? "outline" : "outline",
    whenLabel: active ? formatAppointmentWhen(active) : null,
    location: active?.location ?? active?.facilityId ?? null,
    globalScheduleEventId: active?.globalScheduleEventId ?? null,
    historyCount: projection.appointmentHistory.length,
    rescheduledFromEventId: active?.parentEventId ?? null,
    eligibleForOrderNote: projection.appointmentEligibleForOrderNote,
    eligibilityReason: projection.appointmentEligibilityReason,
  };
}
