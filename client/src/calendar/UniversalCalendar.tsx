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
} from "./views/CanonicalMonthCalendar";
import { CALENDAR_FILTERS, type CalendarFilterId } from "./calendarFilters";
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
}: UniversalCalendarProps) {
  const profile = useMemo(
    () => resolveCalendarProfileSettings(profileId, context, settings),
    [profileId, context, settings],
  );

  const [activeFilters, setActiveFilters] = useState<CalendarFilterId[]>(
    () => profile.defaultFilters,
  );

  const renderBody = () => {
    if (profileId === "plexusIq") {
      return (
        <CanonicalMonthCalendar
          cells={cells}
          onSelectDate={onSelectDate}
        />
      );
    }
    return (
      <div
        className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600 space-y-2"
        data-testid="canonical-universal-calendar-placeholder"
      >
        <p className="font-medium text-slate-900">Calendar surface</p>
        <p>
          The universal calendar primitive is registered. Active filters
          ({activeFilters.length}):
        </p>
        <ul className="list-disc pl-5 space-y-0.5">
          {activeFilters.map((id) => (
            <li key={id}>{CALENDAR_FILTERS[id]?.label ?? id}</li>
          ))}
          {activeFilters.length === 0 && (
            <li className="italic text-slate-400">No filters active.</li>
          )}
        </ul>
        <p className="text-slate-400 italic">
          Month / week / day / agenda views and event hydration land in a
          later batch.
        </p>
      </div>
    );
  };

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
