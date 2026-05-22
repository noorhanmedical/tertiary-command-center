// Universal calendar surface.
//
// Resolves the requested profile, owns activeFilters state from the
// profile's defaults, and renders the filter bar + add-action button on
// top of a profile-appropriate body.
//
// Profile bodies in this batch:
//   plexusIq   → CanonicalMonthCalendar (month grid; receives `cells` +
//                onSelectDate from the page)
//   others     → placeholder body until later migration batches wire them
//
// The component remains generic: it does not import anything Plexus-IQ
// specific, only the shared CanonicalMonthCalendar view. Pages supply
// already-shaped cell data.

import { useMemo, useState } from "react";
import { CalendarFilterBar } from "./CalendarFilterBar";
import { CalendarAddActionButton } from "./CalendarAddActionButton";
import {
  CanonicalMonthCalendar,
  type CanonicalMonthCellSummary,
  type CanonicalCalendarUnscheduledItem,
} from "./views/CanonicalMonthCalendar";
import { type CalendarFilterId } from "./calendarFilters";
import { type CalendarProfileId } from "./calendarProfiles";
import {
  resolveCalendarProfileSettings,
  type CalendarAdminSettingLike,
} from "./calendarSettings";
import type { CalendarContext } from "./calendarEventTypes";

export type UniversalCalendarProps = {
  profileId: CalendarProfileId;
  context?: CalendarContext;
  settings?: CalendarAdminSettingLike[];
  // Optional pre-mapped per-date cells. The view treats these as opaque —
  // callers shape their own data into CanonicalMonthCellSummary so the
  // primitive layer stays profile-agnostic.
  cells?: Record<string, CanonicalMonthCellSummary>;
  // Reserved for future view-mode adapters that consume raw rows. Kept as
  // unknown[] so callers don't need to import canonical types.
  summary?: unknown[];
  onSelectDate?: (isoDate: string) => void;
  // Optional unscheduled-items panel rendered alongside the month grid.
  unscheduledItems?: CanonicalCalendarUnscheduledItem[];
  onUnscheduledItemAction?: (item: CanonicalCalendarUnscheduledItem) => void;
  // Initial month displayed; defaults to today. Useful when the
  // calendar is being shown in a patient-scoped context that pre-loads
  // the patient's appointment month.
  initialMonth?: Date;
};

export function UniversalCalendar({
  profileId,
  context = {},
  settings = [],
  cells,
  // `summary` is reserved for upcoming week/day/agenda views — accept it now
  // so callers don't have to refactor signatures when those views land.
  summary: _summary,
  onSelectDate,
  unscheduledItems,
  onUnscheduledItemAction,
  initialMonth,
}: UniversalCalendarProps) {
  const profile = useMemo(
    () => resolveCalendarProfileSettings(profileId, context, settings),
    [profileId, context, settings],
  );

  const [activeFilters, setActiveFilters] = useState<CalendarFilterId[]>(
    () => profile.defaultFilters,
  );

  // The month grid is profile-agnostic: each profile supplies its own
  // `cells` data and the canonical view renders consistently across
  // Plexus IQ, PCS, ACS, manager, admin, and facility surfaces. Filter
  // bar + add-action button above the grid are profile-driven.
  const renderBody = () => (
    <CanonicalMonthCalendar
      cells={cells}
      onSelectDate={onSelectDate}
      unscheduledItems={unscheduledItems}
      onUnscheduledItemAction={onUnscheduledItemAction}
      initialMonth={initialMonth}
    />
  );

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="canonical-universal-calendar"
      data-profile-id={profile.id}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-slate-900 truncate">
            {profile.label}
          </h2>
          <p className="text-[11px] text-slate-500">
            Canonical calendar profile active · default view:{" "}
            {profile.defaultView}
          </p>
        </div>
        <CalendarAddActionButton profile={profile} context={context} />
      </div>

      <CalendarFilterBar
        profile={profile}
        activeFilters={activeFilters}
        onChange={setActiveFilters}
      />

      {renderBody()}
    </div>
  );
}
