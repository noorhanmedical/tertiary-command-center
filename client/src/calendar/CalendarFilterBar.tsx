// Filter pill bar for the canonical calendar primitives.
// Renders one toggle pill per availableFilter on the resolved profile.

import { CALENDAR_FILTERS, type CalendarFilterId } from "./calendarFilters";
import type { CalendarProfile } from "./calendarProfiles";

export type CalendarFilterBarProps = {
  profile: CalendarProfile;
  activeFilters: CalendarFilterId[];
  onChange: (filters: CalendarFilterId[]) => void;
};

export function CalendarFilterBar({
  profile,
  activeFilters,
  onChange,
}: CalendarFilterBarProps) {
  const active = new Set(activeFilters);

  function toggle(id: CalendarFilterId) {
    const next = new Set(active);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-testid="canonical-calendar-filter-bar"
    >
      {profile.availableFilters.map((id) => {
        const def = CALENDAR_FILTERS[id];
        if (!def) return null;
        const isActive = active.has(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => toggle(id)}
            title={def.description}
            aria-pressed={isActive}
            className={`text-[11px] font-medium rounded-full px-2.5 h-7 border transition-colors ${
              isActive
                ? "bg-plexus-navy-800 text-white border-plexus-navy-800"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
            data-testid={`canonical-calendar-filter-${id}`}
          >
            {def.label}
          </button>
        );
      })}
    </div>
  );
}
