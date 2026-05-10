// Compiling placeholder for the universal calendar surface.
//
// Resolves the requested profile, owns activeFilters state seeded from the
// profile's defaults, and renders the filter bar + add-action button on top
// of a simple panel that lists which filters are currently active. Later
// batches replace the placeholder body with the real month/week/day/agenda
// views and wire data through calendarEventMapper.

import { useMemo, useState } from "react";
import { CalendarFilterBar } from "./CalendarFilterBar";
import { CalendarAddActionButton } from "./CalendarAddActionButton";
import { CALENDAR_FILTERS, type CalendarFilterId } from "./calendarFilters";
import {
  type CalendarProfileId,
} from "./calendarProfiles";
import {
  resolveCalendarProfileSettings,
  type CalendarAdminSettingLike,
} from "./calendarSettings";
import type { CalendarContext } from "./calendarEventTypes";

export type UniversalCalendarProps = {
  profileId: CalendarProfileId;
  context?: CalendarContext;
  // When this batch's caller has fetched admin_settings rows, it can pass
  // them through; otherwise the resolver falls back to the code defaults.
  settings?: CalendarAdminSettingLike[];
  onSelectDate?: (isoDate: string) => void;
};

export function UniversalCalendar({
  profileId,
  context = {},
  settings = [],
  onSelectDate: _onSelectDate,
}: UniversalCalendarProps) {
  const profile = useMemo(
    () => resolveCalendarProfileSettings(profileId, context, settings),
    [profileId, context, settings],
  );

  const [activeFilters, setActiveFilters] = useState<CalendarFilterId[]>(
    () => profile.defaultFilters,
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
            Canonical calendar profile active · default view: {profile.defaultView}
          </p>
        </div>
        <CalendarAddActionButton profile={profile} context={context} />
      </div>

      <CalendarFilterBar
        profile={profile}
        activeFilters={activeFilters}
        onChange={setActiveFilters}
      />

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
    </div>
  );
}
