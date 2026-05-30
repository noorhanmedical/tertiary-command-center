// Canonical calendar primitive — read-model event types.
//
// This module defines the FRONTEND-only normalized event shape used by the
// universal calendar primitives. It is not a new source of truth: every
// CanonicalCalendarEvent must trace back to a real row in one of the
// canonical backend tables (sourceTable + sourceId).
//
// Plexus IQ qualification has only TWO calendar-visible states:
//   qualification_incomplete
//   qualification_final
// There is no "Ready", no "Pending Final", no "Ready to Generate".

export const CANONICAL_CALENDAR_EVENT_KINDS = [
  "clinic_visit",
  "qualified_visit_patient",
  "qualification_incomplete",
  "qualification_final",
  "ancillary_scheduled",
  "call_list_item",
  "completed_call",
  "procedure_completed",
  "team_availability",
] as const;

export type CanonicalCalendarEventKind =
  typeof CANONICAL_CALENDAR_EVENT_KINDS[number];

// Canonical backend tables a CanonicalCalendarEvent can trace back to. Used
// to keep the read model honest — every entry in the calendar references a
// real row in the backend, never an invented one.
export type CalendarSourceTable =
  | "screening_batches"
  | "patient_screenings"
  | "patient_execution_cases"
  | "patient_journey_events"
  | "global_schedule_events"
  | "procedure_events"
  | "case_document_readiness"
  | "billing_readiness_checks"
  | "completed_billing_packages"
  | "invoice_line_items"
  | "invoices"
  | "projected_invoice_rows"
  | "manual_derived";

export type CanonicalCalendarEvent = {
  // Stable composite id — typically `${sourceTable}:${sourceId}` so React
  // keys stay unique across overlapping rows.
  id: string;
  kind: CanonicalCalendarEventKind;
  title: string;
  startsAt: string;
  endsAt?: string | null;

  facilityId?: string | null;
  physicianId?: string | null;
  clinicianId?: string | null;
  teamMemberId?: string | null;
  userId?: string | null;

  patientName?: string | null;
  patientDob?: string | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  globalScheduleEventId?: number | null;
  procedureEventId?: number | null;

  serviceType?: string | null;
  status?: string | null;

  sourceTable: CalendarSourceTable;
  sourceId: string | number;
  metadata?: Record<string, unknown>;
};

export type CalendarContext = {
  facilityId?: string | null;
  physicianId?: string | null;
  clinicianId?: string | null;
  teamMemberId?: string | null;
  userId?: string | null;
  role?: string | null;
  date?: string | null;
};

export type CalendarViewMode = "month" | "week" | "day" | "agenda";
