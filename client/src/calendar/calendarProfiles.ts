// Canonical calendar profiles.
//
// A profile bundles the filter set, dimensions, add actions, and default
// scope for a particular surface (Plexus IQ, Patient Care Specialist,
// Technician, Manager, Admin, Facility). Pages opt in by passing a
// profileId — they never assemble their own filter list.
//
// Code owns the universe of allowed filters/dimensions/add-actions.
// admin_settings can override which of those allowed values are visible or
// default per profile (resolved by calendarSettings.ts).

import type { CalendarViewMode } from "./calendarEventTypes";
import type { CalendarDimensionId, CalendarFilterId } from "./calendarFilters";

export const CALENDAR_PROFILE_IDS = [
  "plexusIq",
  "patientCareSpecialist",
  "technician",
  "manager",
  "admin",
  "facility",
] as const;

export type CalendarProfileId = typeof CALENDAR_PROFILE_IDS[number];

export const CALENDAR_ADD_ACTION_IDS = [
  "addPatient",
  "importPatients",
  "addCallListItem",
  "addCallback",
  "addAncillaryAppointment",
  "addSameDayAncillary",
  "markProcedureCompleted",
  "addTeamAvailabilityBlock",
] as const;

export type CalendarAddActionId = typeof CALENDAR_ADD_ACTION_IDS[number];

export type CalendarProfile = {
  id: CalendarProfileId;
  label: string;
  description: string;
  defaultView: CalendarViewMode;
  defaultFilters: CalendarFilterId[];
  availableFilters: CalendarFilterId[];
  availableDimensions: CalendarDimensionId[];
  addActions: CalendarAddActionId[];
  defaultScope: "global" | "facility" | "teamMember" | "user";
  allowFacilityOverride: boolean;
  allowAllFacilities: boolean;
  allowPhysicianClinicianFilter: boolean;
  allowTeamMemberFilter: boolean;
  readOnly?: boolean;
};

export const CALENDAR_PROFILES: Record<CalendarProfileId, CalendarProfile> = {
  plexusIq: {
    id: "plexusIq",
    label: "Plexus IQ",
    description:
      "Multi-day, multi-facility intake + qualification overview. Surfaces incomplete and final qualification across all facilities/dates.",
    defaultView: "month",
    defaultFilters: [
      "qualificationIncomplete",
      "qualificationFinal",
      "clinicVisits",
      "ancillaryScheduled",
      "dailyCallList",
    ],
    availableFilters: [
      "qualificationIncomplete",
      "qualificationFinal",
      "clinicVisits",
      "qualifiedVisitPatients",
      "ancillaryScheduled",
      "dailyCallList",
      "myDailyCallList",
      "completedCalls",
      "procedureCompleted",
      "teamAvailability",
    ],
    availableDimensions: ["facility", "physicianClinician", "teamMember"],
    addActions: [
      "addPatient",
      "importPatients",
      "addCallListItem",
      "addAncillaryAppointment",
    ],
    defaultScope: "global",
    allowFacilityOverride: true,
    allowAllFacilities: true,
    allowPhysicianClinicianFilter: true,
    allowTeamMemberFilter: true,
  },
  patientCareSpecialist: {
    id: "patientCareSpecialist",
    label: "Patient Care Specialist",
    description:
      "Day-by-day calendar focused on the specialist's own call list, scheduled visits, and ancillaries.",
    defaultView: "day",
    defaultFilters: [
      "clinicVisits",
      "qualifiedVisitPatients",
      "ancillaryScheduled",
      "myDailyCallList",
    ],
    availableFilters: [
      "clinicVisits",
      "qualifiedVisitPatients",
      "ancillaryScheduled",
      "dailyCallList",
      "myDailyCallList",
      "completedCalls",
    ],
    availableDimensions: ["facility", "physicianClinician", "teamMember"],
    addActions: [
      "addPatient",
      "addCallListItem",
      "addCallback",
      "addAncillaryAppointment",
    ],
    defaultScope: "teamMember",
    allowFacilityOverride: true,
    allowAllFacilities: true,
    allowPhysicianClinicianFilter: true,
    allowTeamMemberFilter: false,
  },
  technician: {
    id: "technician",
    label: "Technician / Liaison",
    description:
      "Facility-scoped day calendar for ancillary execution and same-day adds.",
    defaultView: "day",
    defaultFilters: ["clinicVisits", "ancillaryScheduled", "procedureCompleted"],
    availableFilters: [
      "clinicVisits",
      "qualifiedVisitPatients",
      "ancillaryScheduled",
      "dailyCallList",
      "myDailyCallList",
      "procedureCompleted",
      "teamAvailability",
    ],
    availableDimensions: ["facility", "physicianClinician", "teamMember"],
    addActions: [
      "addSameDayAncillary",
      "addCallListItem",
      "markProcedureCompleted",
    ],
    defaultScope: "facility",
    allowFacilityOverride: true,
    allowAllFacilities: false,
    allowPhysicianClinicianFilter: true,
    allowTeamMemberFilter: false,
  },
  manager: {
    id: "manager",
    label: "Manager",
    description:
      "Cross-facility week view with full filter set, all dimensions, and every approved add action.",
    defaultView: "week",
    defaultFilters: [
      "clinicVisits",
      "ancillaryScheduled",
      "dailyCallList",
      "procedureCompleted",
      "teamAvailability",
    ],
    availableFilters: [
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
    ],
    availableDimensions: ["facility", "physicianClinician", "teamMember"],
    addActions: [
      "addPatient",
      "addCallListItem",
      "addCallback",
      "addAncillaryAppointment",
      "addSameDayAncillary",
      "markProcedureCompleted",
      "addTeamAvailabilityBlock",
    ],
    defaultScope: "global",
    allowFacilityOverride: true,
    allowAllFacilities: true,
    allowPhysicianClinicianFilter: true,
    allowTeamMemberFilter: true,
  },
  admin: {
    id: "admin",
    label: "Admin Calendar",
    description:
      "Same broad access as Manager with admin-grade defaults; reserved for platform-level views.",
    defaultView: "week",
    defaultFilters: [
      "clinicVisits",
      "ancillaryScheduled",
      "dailyCallList",
      "procedureCompleted",
      "teamAvailability",
    ],
    availableFilters: [
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
    ],
    availableDimensions: ["facility", "physicianClinician", "teamMember"],
    addActions: [
      "addPatient",
      "addCallListItem",
      "addCallback",
      "addAncillaryAppointment",
      "addSameDayAncillary",
      "markProcedureCompleted",
      "addTeamAvailabilityBlock",
    ],
    defaultScope: "global",
    allowFacilityOverride: true,
    allowAllFacilities: true,
    allowPhysicianClinicianFilter: true,
    allowTeamMemberFilter: true,
  },
  facility: {
    id: "facility",
    label: "Facility Calendar",
    description:
      "Single-facility week view for clinic operations.",
    defaultView: "week",
    defaultFilters: [
      "clinicVisits",
      "ancillaryScheduled",
      "procedureCompleted",
      "teamAvailability",
    ],
    availableFilters: [
      "clinicVisits",
      "qualifiedVisitPatients",
      "ancillaryScheduled",
      "dailyCallList",
      "completedCalls",
      "procedureCompleted",
      "teamAvailability",
    ],
    availableDimensions: ["physicianClinician", "teamMember"],
    addActions: [
      "addPatient",
      "addAncillaryAppointment",
      "addTeamAvailabilityBlock",
    ],
    defaultScope: "facility",
    allowFacilityOverride: false,
    allowAllFacilities: false,
    allowPhysicianClinicianFilter: true,
    allowTeamMemberFilter: true,
  },
};

export function getCalendarProfile(profileId: CalendarProfileId): CalendarProfile {
  return CALENDAR_PROFILES[profileId];
}
