// Calendar event mappers — pure read-model adapters from canonical backend
// rows to CanonicalCalendarEvent. These are shells used by later batches
// when the universal calendar is wired to data; they do no fetching of
// their own.

import type {
  CanonicalCalendarEvent,
  CalendarContext,
} from "./calendarEventTypes";
import type { CalendarProfile } from "./calendarProfiles";
import {
  CALENDAR_FILTERS,
  type CalendarFilterId,
} from "./calendarFilters";
import { isCanonicalAppointmentUiEnabled } from "@/lib/canonicalAppointmentUiFlag";

// Loose row shapes — kept as Record<string, unknown> projections so callers
// can pass either Drizzle-inferred row types or already-serialized JSON
// from the existing /api/* responses without us having to import the full
// schema graph here.
type LooseRow = Record<string, unknown> & {
  [k: string]: unknown;
};

function s(row: LooseRow, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function n(row: LooseRow, key: string): number | null {
  const v = row[key];
  return typeof v === "number" ? v : null;
}

function isoFromUnknown(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  return null;
}

export function mapGlobalScheduleEventToCalendarEvent(
  row: unknown,
): CanonicalCalendarEvent | null {
  if (!row || typeof row !== "object") return null;
  const r = row as LooseRow;
  const startsAt = isoFromUnknown(r.startsAt);
  if (!startsAt) return null;

  const eventType = s(r, "eventType");
  const status = s(r, "status");

  let kind: CanonicalCalendarEvent["kind"] | null = null;
  switch (eventType) {
    case "doctor_visit":
      kind = "clinic_visit";
      break;
    case "ancillary_appointment":
    case "same_day_add":
      kind = "ancillary_scheduled";
      break;
    case "procedure_complete":
      kind = "procedure_completed";
      break;
    case "team_member_availability":
    case "pto_block":
    case "sick_day":
    case "unavailable_block":
      kind = "team_availability";
      break;
    case "no_show":
    case "cancellation":
    case "reschedule":
      // These keep their canonical source row but only show up on the
      // calendar when they have a usable startsAt — which is required at
      // the top of this function.
      kind = "clinic_visit";
      break;
    default:
      return null;
  }

  const sourceId = n(r, "id") ?? s(r, "id") ?? "";
  if (sourceId === "" || sourceId === null) return null;

  const patientName = s(r, "patientName");

  // Phase 2D-D1 — for canonical ancillary events (server-tagged
  // canonicalAncillary), title by service using existing conventions and
  // carry ancillaryCaseId/parentEventId. doctor_visit and general events
  // keep their existing title/appearance. Flag OFF preserves the mapper.
  const serviceType = s(r, "serviceType");
  const isCanonicalAncillary = r.canonicalAncillary === true;
  const canonicalTitle =
    isCanonicalAppointmentUiEnabled() && isCanonicalAncillary && serviceType
      ? patientName
        ? `${serviceType} – ${patientName}`
        : serviceType
      : (patientName ?? eventType ?? "Event");

  return {
    id: `global_schedule_events:${sourceId}`,
    kind,
    title: canonicalTitle,
    startsAt,
    endsAt: isoFromUnknown(r.endsAt) ?? null,
    facilityId: s(r, "facilityId"),
    physicianId: null,
    clinicianId: null,
    teamMemberId: s(r, "assignedUserId"),
    userId: s(r, "assignedUserId"),
    patientName,
    patientDob: s(r, "patientDob"),
    patientScreeningId: n(r, "patientScreeningId"),
    executionCaseId: n(r, "executionCaseId"),
    globalScheduleEventId: typeof sourceId === "number" ? sourceId : null,
    procedureEventId: null,
    serviceType,
    status,
    sourceTable: "global_schedule_events",
    sourceId,
    metadata: {
      eventType,
      assignedRole: s(r, "assignedRole"),
      canonicalAncillary: isCanonicalAncillary,
      ancillaryCaseId: n(r, "ancillaryCaseId"),
      parentEventId: n(r, "parentEventId"),
    },
  };
}

export function mapExecutionCaseToCallListCalendarEvent(
  row: unknown,
): CanonicalCalendarEvent | null {
  if (!row || typeof row !== "object") return null;
  const r = row as LooseRow;
  const startsAt = isoFromUnknown(r.nextActionAt);
  if (!startsAt) return null;
  const sourceId = n(r, "id") ?? s(r, "id") ?? "";
  if (sourceId === "" || sourceId === null) return null;

  const teamMemberId =
    s(r, "assignedTeamMemberId") ?? s(r, "teamMemberId") ?? null;

  return {
    id: `patient_execution_cases:${sourceId}`,
    kind: "call_list_item",
    title: s(r, "patientName") ?? s(r, "title") ?? "Call list item",
    startsAt,
    endsAt: null,
    facilityId: s(r, "facilityId"),
    physicianId: s(r, "physicianId"),
    clinicianId: s(r, "clinicianId"),
    teamMemberId,
    userId: teamMemberId,
    patientName: s(r, "patientName"),
    patientDob: s(r, "patientDob"),
    patientScreeningId: n(r, "patientScreeningId"),
    executionCaseId: typeof sourceId === "number" ? sourceId : null,
    globalScheduleEventId: null,
    procedureEventId: null,
    serviceType: s(r, "serviceType"),
    status: s(r, "status"),
    sourceTable: "patient_execution_cases",
    sourceId,
    metadata: {
      stage: s(r, "stage"),
    },
  };
}

export function mapPatientScreeningToQualificationCalendarEvent(
  row: unknown,
  scheduleDate?: string | null,
): CanonicalCalendarEvent | null {
  if (!row || typeof row !== "object") return null;
  const r = row as LooseRow;
  const dateRaw = scheduleDate ?? s(r, "scheduleDate") ?? s(r, "scheduledDate");
  if (!dateRaw) return null;
  // Normalize to ISO midnight for the date so the read model always carries
  // a startsAt; rendering decides how to display.
  const startsAt = /T\d/.test(dateRaw) ? dateRaw : `${dateRaw}T00:00:00`;
  const sourceId = n(r, "id") ?? s(r, "id") ?? "";
  if (sourceId === "" || sourceId === null) return null;

  const status = s(r, "status");
  const isFinal = status === "completed";
  const kind = isFinal ? "qualification_final" : "qualification_incomplete";

  return {
    id: `patient_screenings:${sourceId}`,
    kind,
    title: s(r, "name") ?? "Patient",
    startsAt,
    endsAt: null,
    facilityId: s(r, "facility"),
    physicianId: null,
    clinicianId: null,
    teamMemberId: null,
    userId: null,
    patientName: s(r, "name"),
    patientDob: s(r, "dob"),
    patientScreeningId: typeof sourceId === "number" ? sourceId : null,
    executionCaseId: null,
    globalScheduleEventId: null,
    procedureEventId: null,
    serviceType: null,
    status,
    sourceTable: "patient_screenings",
    sourceId,
    metadata: {
      patientType: s(r, "patientType"),
      batchId: n(r, "batchId"),
    },
  };
}

export function filterCalendarEventsByProfile(
  events: CanonicalCalendarEvent[],
  profile: CalendarProfile,
  activeFilters: CalendarFilterId[],
  context: CalendarContext,
): CanonicalCalendarEvent[] {
  // Resolve the union of event kinds covered by the active filters. If no
  // active filter, no events match (callers should ensure at least one is
  // active when they want anything visible).
  const allowed = new Set(profile.availableFilters);
  const effective = activeFilters.filter((f) => allowed.has(f));
  if (effective.length === 0) return [];

  const allowedKinds = new Set<CanonicalCalendarEvent["kind"]>();
  for (const f of effective) {
    const def = CALENDAR_FILTERS[f];
    if (!def) continue;
    for (const k of def.eventKinds) allowedKinds.add(k);
  }

  // myDailyCallList is a context-narrowed variant of dailyCallList — when
  // active, restrict call_list_item events to the current user/team member.
  const myCallListActive = effective.includes("myDailyCallList");

  return events.filter((evt) => {
    if (!allowedKinds.has(evt.kind)) return false;

    if (context.facilityId && evt.facilityId && evt.facilityId !== context.facilityId) {
      return false;
    }
    if (context.physicianId && evt.physicianId && evt.physicianId !== context.physicianId) {
      return false;
    }
    if (context.clinicianId && evt.clinicianId && evt.clinicianId !== context.clinicianId) {
      return false;
    }
    if (context.teamMemberId && evt.teamMemberId && evt.teamMemberId !== context.teamMemberId) {
      return false;
    }

    if (
      evt.kind === "call_list_item" &&
      myCallListActive &&
      context.userId &&
      evt.userId &&
      evt.userId !== context.userId
    ) {
      return false;
    }

    return true;
  });
}
