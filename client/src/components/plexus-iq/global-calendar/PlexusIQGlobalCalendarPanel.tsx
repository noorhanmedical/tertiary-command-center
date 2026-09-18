// Plexus IQ global calendar panel (ADMIN-ONLY).
//
// A refined, classy month calendar for the Plexus IQ page. Reuses the
// canonical month grid (CanonicalMonthCalendar) fed by the existing
// calendar-summary cells, and layers a minimal header with two small circular
// icons:
//   - PLUS (left)  → opens the admin scheduling popup
//                    (GlobalCalendarScheduleDialog).
//   - GEAR (right) → opens a compact filter popover to scope the calendar by
//                    facility OR team member. No big filter bars by default;
//                    the search bar only appears inside the popover.
//
// Clicking a date opens a small popover listing that day's procedures across
// facilities (GlobalCalendarDayProcedures), scoped by the active filter.
//
// This component is rendered ONLY for admins by the parent page; it does not
// gate itself.

import { useMemo, useState } from "react";
import { Plus, Settings, Search, X } from "lucide-react";
import type { CanonicalMonthCellSummary } from "@/calendar";
import { CanonicalMonthCalendar } from "@/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { useFacilities, useClinicians } from "@/hooks/api/organization";
import { GlobalCalendarScheduleDialog } from "./GlobalCalendarScheduleDialog";
import { GlobalCalendarDayProcedures } from "./GlobalCalendarDayProcedures";

export type GlobalCalendarFilter =
  | { kind: "facility"; value: string }
  | { kind: "teamMember"; value: string }
  | null;

export function PlexusIQGlobalCalendarPanel({
  cells,
  onScheduled,
}: {
  // Per-date cells from the existing calendar-summary feed. When a facility
  // filter is active the parent may pass facility-scoped cells; this panel
  // renders whatever it's given.
  cells: Record<string, CanonicalMonthCellSummary>;
  onScheduled?: () => void;
}) {
  const [filter, setFilter] = useState<GlobalCalendarFilter>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<string | null>(null);

  const facilityScope = filter?.kind === "facility" ? filter.value : null;

  // Day-click → open the schedule popup pre-targeted to that day is a separate
  // action (the plus). Clicking a date shows procedures via the per-day
  // popover rendered by the month grid; we keep the last clicked date so the
  // plus button can default to it.
  const [lastClickedDate, setLastClickedDate] = useState<string | null>(null);

  return (
    <div
      className="rounded-[14px] border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="plexus-iq-global-calendar-panel"
    >
      {/* Refined header: title + two small circular icons */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-slate-900">Global Calendar</h2>
          {filter && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
              {filter.value}
              <button
                type="button"
                onClick={() => setFilter(null)}
                aria-label="Clear filter"
                className="text-slate-400 hover:text-slate-700"
                data-testid="global-cal-clear-filter"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <CircleIconButton
            label="Schedule"
            testId="global-cal-open-schedule"
            onClick={() => {
              setScheduleDate(lastClickedDate);
              setScheduleOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
          </CircleIconButton>
          <GearFilterPopover filter={filter} onChange={setFilter} />
        </div>
      </div>

      <CanonicalMonthCalendar
        cells={cells}
        onSelectDate={(d) => setLastClickedDate(d)}
        renderDayPopoverContent={(iso) => (
          <GlobalCalendarDayProcedures isoDate={iso} facility={facilityScope} />
        )}
      />

      <GlobalCalendarScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        isoDate={scheduleDate}
        defaultFacility={facilityScope}
        onScheduled={onScheduled}
      />
    </div>
  );
}

// A small, classy circular icon button used for the plus + gear controls.
function CircleIconButton({
  children,
  label,
  testId,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  testId: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-plexus-navy-800 hover:text-plexus-navy-800"
      data-testid={testId}
    >
      {children}
    </button>
  );
}

// The gear → compact filter popover. A single search input toggles between
// facility and team-member matches; selecting one scopes the calendar. Bars
// only exist inside this popover.
function GearFilterPopover({
  filter,
  onChange,
}: {
  filter: GlobalCalendarFilter;
  onChange: (f: GlobalCalendarFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data: facilities = [] } = useFacilities();
  const { data: clinicians = [] } = useClinicians();

  const term = q.trim().toLowerCase();
  const facilityMatches = useMemo(
    () =>
      (term
        ? facilities.filter((f) => f.name.toLowerCase().includes(term))
        : facilities
      ).slice(0, 6),
    [facilities, term],
  );
  const memberMatches = useMemo(
    () =>
      (term
        ? clinicians.filter((c) => c.displayName.toLowerCase().includes(term))
        : clinicians
      ).slice(0, 6),
    [clinicians, term],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Filter calendar"
          title="Filter"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-plexus-navy-800 hover:text-plexus-navy-800"
          data-testid="global-cal-open-filter"
        >
          <Settings className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3" data-testid="global-cal-filter-popover">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Facility or team member"
            className="h-9 pl-9"
            autoFocus
            data-testid="global-cal-filter-search"
          />
        </div>

        <div className="mt-3 max-h-64 space-y-3 overflow-y-auto">
          {facilityMatches.length > 0 && (
            <FilterGroup label="Facilities">
              {facilityMatches.map((f) => (
                <FilterRow
                  key={`f-${f.id}`}
                  active={filter?.kind === "facility" && filter.value === f.name}
                  onClick={() => {
                    onChange({ kind: "facility", value: f.name });
                    setOpen(false);
                  }}
                  testId={`global-cal-filter-facility-${f.id}`}
                >
                  {f.name}
                </FilterRow>
              ))}
            </FilterGroup>
          )}
          {memberMatches.length > 0 && (
            <FilterGroup label="Team members">
              {memberMatches.map((c) => (
                <FilterRow
                  key={`c-${c.id}`}
                  active={filter?.kind === "teamMember" && filter.value === c.displayName}
                  onClick={() => {
                    onChange({ kind: "teamMember", value: c.displayName });
                    setOpen(false);
                  }}
                  testId={`global-cal-filter-member-${c.id}`}
                >
                  {c.displayName}
                </FilterRow>
              ))}
            </FilterGroup>
          )}
          {facilityMatches.length === 0 && memberMatches.length === 0 && (
            <div className="py-3 text-center text-[12px] text-slate-400">No matches</div>
          )}
        </div>

        {filter && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="mt-3 w-full rounded-lg border border-slate-200 py-1.5 text-[12px] font-medium text-slate-500 hover:text-slate-800"
            data-testid="global-cal-filter-reset"
          >
            Show everything
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function FilterRow({
  children,
  active,
  onClick,
  testId,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center rounded-md px-2 py-1.5 text-left text-[13px] transition",
        active
          ? "bg-plexus-navy-800 text-white"
          : "text-slate-700 hover:bg-slate-100",
      ].join(" ")}
      data-testid={testId}
    >
      <span className="truncate">{children}</span>
    </button>
  );
}
