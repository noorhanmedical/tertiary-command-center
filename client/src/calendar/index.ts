// Canonical calendar primitive layer — public exports.
//
// Pages should import only from "@/calendar". Direct imports from the
// individual files inside this folder are allowed but discouraged so the
// module boundary stays clean.

export {
  CANONICAL_CALENDAR_EVENT_KINDS,
  type CanonicalCalendarEvent,
  type CanonicalCalendarEventKind,
  type CalendarContext,
  type CalendarSourceTable,
  type CalendarViewMode,
} from "./calendarEventTypes";

export {
  CALENDAR_FILTER_IDS,
  CALENDAR_DIMENSION_IDS,
  CALENDAR_FILTERS,
  type CalendarFilterDefinition,
  type CalendarFilterId,
  type CalendarDimensionId,
} from "./calendarFilters";

export {
  CALENDAR_PROFILE_IDS,
  CALENDAR_ADD_ACTION_IDS,
  CALENDAR_PROFILES,
  getCalendarProfile,
  type CalendarProfile,
  type CalendarProfileId,
  type CalendarAddActionId,
} from "./calendarProfiles";

export {
  CALENDAR_SETTINGS_DOMAIN,
  CALENDAR_SETTINGS_KEY,
  resolveCalendarProfileSettings,
  type CalendarAdminSettingLike,
  type CalendarProfileSettingsOverride,
} from "./calendarSettings";

export {
  mapGlobalScheduleEventToCalendarEvent,
  mapExecutionCaseToCallListCalendarEvent,
  mapPatientScreeningToQualificationCalendarEvent,
  filterCalendarEventsByProfile,
} from "./calendarEventMapper";

export { CanonicalCalendarIcon, type CanonicalCalendarIconProps } from "./CanonicalCalendarIcon";
export {
  UniversalCalendarDrawer,
  type UniversalCalendarDrawerProps,
} from "./UniversalCalendarDrawer";
export { UniversalCalendar, type UniversalCalendarProps } from "./UniversalCalendar";
export { CalendarFilterBar, type CalendarFilterBarProps } from "./CalendarFilterBar";
export {
  CalendarAddActionButton,
  type CalendarAddActionButtonProps,
} from "./CalendarAddActionButton";
export {
  CanonicalMonthCalendar,
  type CanonicalMonthCalendarProps,
  type CanonicalMonthCellSummary,
} from "./views/CanonicalMonthCalendar";
