// Phase 2D-C2 — shared serializable canonical appointment contract.
//
// The ONE cross-boundary shape for canonical ancillary appointments.
// Server API responses serialize to this (JSON-safe ISO timestamps);
// portal clients render from it. Clients must NOT define independent
// appointment models that can drift from this contract.
//
// doctor_visit is never represented here — this is the ancillary
// appointment projection only.

export type CanonicalAppointmentStatus =
  | "scheduled"
  | "completed"
  | "cancelled"
  | "no_show"
  | "rescheduled";

export type CanonicalAncillaryEventType = "ancillary_appointment" | "same_day_add";

/** JSON-safe view of one canonical ancillary appointment event. */
export type CanonicalAppointmentView = {
  globalScheduleEventId: number;
  ancillaryCaseId: number | null;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  serviceType: string | null;
  eventType: string;
  status: string;
  /** ISO 8601 timestamp. */
  startsAt: string;
  endsAt: string | null;
  timezone: string | null;
  facilityId: string | null;
  location?: string | null;
  assignedUserId?: string | null;
  parentEventId: number | null;
  cancellationReason?: string | null;
  noShowReason?: string | null;
};

/** Per-ancillary-case appointment projection returned to portals. */
export type AncillaryAppointmentProjection = {
  activeAppointment: CanonicalAppointmentView | null;
  appointmentHistory: CanonicalAppointmentView[];
  appointmentEligibleForOrderNote: boolean;
  appointmentEligibilityReason: string;
};

/** Terminal statuses that belong in appointment history, never active. */
export const CANONICAL_HISTORY_STATUSES: readonly CanonicalAppointmentStatus[] = [
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
];
