// Canonical calendar filters.
//
// Workflow reasons (needs new date, needs insurance review, manager review,
// wrong number, needs records, transportation issue, facility issue,
// technician unavailable, …) belong in the Engagement Center / Scheduling
// Triage / Manager Review queues — NOT on the calendar — unless they have a
// scheduled date/time. Calendar filters must always represent date-bound
// events, scheduled work, due-today work, or date-bound patient groups.

import type { CanonicalCalendarEventKind } from "./calendarEventTypes";

export const CALENDAR_FILTER_IDS = [
  "clinicVisits",
  "qualifiedVisitPatients",
  "qualificationIncomplete",
  "qualificationFinal",
  "ancillaryScheduled",
  "dailyCallList",
  "myDailyCallList",
  "completedCalls",
  "procedureCompleted",
  "teamAvailability",
] as const;

export type CalendarFilterId = typeof CALENDAR_FILTER_IDS[number];

export const CALENDAR_DIMENSION_IDS = [
  "facility",
  "physicianClinician",
  "teamMember",
] as const;

export type CalendarDimensionId = typeof CALENDAR_DIMENSION_IDS[number];

export type CalendarFilterDefinition = {
  id: CalendarFilterId;
  label: string;
  description: string;
  eventKinds: CanonicalCalendarEventKind[];
  // Every approved filter is constrained to date-bound data; this flag is
  // a literal marker, never false, to make the constraint explicit at
  // call-sites and during settings validation.
  requiresDateBoundData: true;
};

export const CALENDAR_FILTERS: Record<CalendarFilterId, CalendarFilterDefinition> = {
  clinicVisits: {
    id: "clinicVisits",
    label: "Clinic Visits",
    description:
      "Scheduled doctor visits at a facility on a specific date.",
    eventKinds: ["clinic_visit"],
    requiresDateBoundData: true,
  },
  qualifiedVisitPatients: {
    id: "qualifiedVisitPatients",
    label: "Qualified Visit Patients",
    description:
      "Visit-day patients whose qualification has reached Final.",
    eventKinds: ["qualified_visit_patient"],
    requiresDateBoundData: true,
  },
  qualificationIncomplete: {
    id: "qualificationIncomplete",
    label: "Incomplete Qualification",
    description:
      "Patients on a date whose required intake is not yet complete.",
    eventKinds: ["qualification_incomplete"],
    requiresDateBoundData: true,
  },
  qualificationFinal: {
    id: "qualificationFinal",
    label: "Final Qualification",
    description:
      "Patients on a date whose qualification has been generated and finalized.",
    eventKinds: ["qualification_final"],
    requiresDateBoundData: true,
  },
  ancillaryScheduled: {
    id: "ancillaryScheduled",
    label: "Ancillary Tests Scheduled",
    description:
      "BrainWave / VitalWave / Ultrasound and other ancillary appointments scheduled on a date.",
    eventKinds: ["ancillary_scheduled"],
    requiresDateBoundData: true,
  },
  dailyCallList: {
    id: "dailyCallList",
    label: "Daily Call List",
    description:
      "Patient-care call-list items due on the date.",
    eventKinds: ["call_list_item"],
    requiresDateBoundData: true,
  },
  myDailyCallList: {
    id: "myDailyCallList",
    label: "My Daily Call List",
    description:
      "Daily call-list items assigned to the current team member.",
    eventKinds: ["call_list_item"],
    requiresDateBoundData: true,
  },
  completedCalls: {
    id: "completedCalls",
    label: "Completed Calls",
    description:
      "Patient outreach calls completed on a date.",
    eventKinds: ["completed_call"],
    requiresDateBoundData: true,
  },
  procedureCompleted: {
    id: "procedureCompleted",
    label: "Procedure Performed",
    description:
      "Procedures recorded as performed on a date. Report upload, document completion and billing readiness are separate stages.",
    eventKinds: ["procedure_completed"],
    requiresDateBoundData: true,
  },
  teamAvailability: {
    id: "teamAvailability",
    label: "Team Availability",
    description:
      "Team-member availability blocks (PTO, sick days, unavailable blocks) on a date.",
    eventKinds: ["team_availability"],
    requiresDateBoundData: true,
  },
};
