import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, CalendarPlus, ChevronLeft, ChevronRight, Check } from "lucide-react";
import type { GlobalScheduleEvent } from "@shared/schema/globalSchedule";
import type { AncillaryCategory } from "@shared/ancillaryCategory";

// LEGACY — Plexus IQ no longer mounts this component.
//
// The canonical calendar primitive layer (client/src/calendar/) now powers
// the /plexus-iq drawer via <UniversalCalendarDrawer profileId="plexusIq">.
// The Plexus IQ page builds CanonicalMonthCellSummary entries from the same
// summary feed used here and passes them through the canonical primitive.
//
// This file is kept temporarily so the `CalendarSummaryRow` type export is
// still importable from existing call sites; once all consumers move that
// type into a shared module, this file is safe to delete.
//
// Reads from canonical endpoints only:
//   - /api/screening-batches/calendar-summary — single aggregated payload
//     (one row per batch with patientCount + categories + scheduleDate).
//   - /api/global-schedule-events?eventType=procedure_complete — drives
//     the green checkmark for completed ancillaries.
//
// Known migration gap: the legacy "Assign date" affordance for unscheduled
// batches lived inside this component. The Plexus IQ page still mounts the
// PlexusIQAssignDateDialog, but the trigger needs to be re-attached when
// UniversalCalendar's add-action layer is wired in a later batch.

export type CalendarSummaryRow = {
  id: number;
  name: string;
  facility: string | null;
  scheduleDate: string | null;
  status: string;
  patientCount: number;
  categories: string[]; // subset of "brainwave" | "vitalwave" | "ultrasound"
};

const ANCILLARY_CATEGORIES: AncillaryCategory[] = ["brainwave", "vitalwave", "ultrasound"];

const ANCILLARY_DOT_COLOR: Record<AncillaryCategory, string> = {
  brainwave: "bg-violet-500",
  vitalwave: "bg-red-500",
  ultrasound: "bg-emerald-500",
  other: "bg-slate-400",
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function buildMonthGrid(monthStart: Date): Date[] {
  const grid: Date[] = [];
  const first = startOfMonth(monthStart);
  const startWeekday = first.getDay();
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startWeekday);
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    grid.push(d);
  }
  return grid;
}

export function PlexusIQCalendar({
  summary,
  onSelectDate,
  onAssignDate,
}: {
  // Aggregated rows from /api/screening-batches/calendar-summary. One row
  // per batch, regardless of whether scheduleDate is set.
  summary: CalendarSummaryRow[];
  onSelectDate: (isoDate: string) => void;
  onAssignDate: (batchId: number, batchLabel: string) => void;
}) {
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));

  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const rangeStart = useMemo(() => {
    const d = new Date(cursor);
    d.setDate(1);
    d.setDate(d.getDate() - 7);
    return d;
  }, [cursor]);
  const rangeEnd = useMemo(() => {
    const d = endOfMonth(cursor);
    d.setDate(d.getDate() + 7);
    return d;
  }, [cursor]);

  const { data: completedEvents = [] } = useQuery<GlobalScheduleEvent[]>({
    queryKey: ["/api/global-schedule-events", { eventType: "procedure_complete", startDate: rangeStart.toISOString(), endDate: rangeEnd.toISOString() }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("eventType", "procedure_complete");
      params.set("startDate", rangeStart.toISOString());
      params.set("endDate", rangeEnd.toISOString());
      params.set("limit", "500");
      const res = await fetch(`/api/global-schedule-events?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Calendar fetch failed (${res.status})`);
      return res.json();
    },
  });

  const completedDays = useMemo(() => {
    const set = new Set<string>();
    for (const evt of completedEvents) {
      const startsAt = evt.startsAt ? new Date(evt.startsAt as unknown as string) : null;
      if (startsAt && !isNaN(startsAt.getTime())) set.add(ymd(startsAt));
    }
    return set;
  }, [completedEvents]);

  // Bucket the summary rows into dated cells + an unscheduled list.
  const { perDate, unscheduled } = useMemo(() => {
    const map: Record<string, { count: number; cats: Set<AncillaryCategory> }> = {};
    const orphans: CalendarSummaryRow[] = [];
    for (const row of summary) {
      if (!row.scheduleDate) {
        orphans.push(row);
        continue;
      }
      const key = row.scheduleDate;
      if (!map[key]) map[key] = { count: 0, cats: new Set() };
      map[key].count += row.patientCount;
      for (const c of row.categories) {
        if (c === "brainwave" || c === "vitalwave" || c === "ultrasound") {
          map[key].cats.add(c as AncillaryCategory);
        }
      }
    }
    orphans.sort((a, b) => (a.facility ?? "").localeCompare(b.facility ?? ""));
    return { perDate: map, unscheduled: orphans };
  }, [summary]);

  const grid = buildMonthGrid(cursor);
  const todayKey = ymd(new Date());
  const cursorMonth = cursor.getMonth();

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
          className="inline-flex items-center justify-center h-9 w-9 rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          aria-label="Previous month"
          data-testid="button-plexus-iq-prev-month"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-base font-semibold text-slate-900" data-testid="text-plexus-iq-month-label">
          {monthLabel}
        </div>
        <button
          type="button"
          onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
          className="inline-flex items-center justify-center h-9 w-9 rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          aria-label="Next month"
          data-testid="button-plexus-iq-next-month"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-slate-400 px-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="text-center py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map((d) => {
          const key = ymd(d);
          const inMonth = d.getMonth() === cursorMonth;
          const isToday = key === todayKey;
          const day = perDate[key];
          const count = day?.count ?? 0;
          const cats = day?.cats ?? new Set<AncillaryCategory>();
          const hasCompleted = completedDays.has(key);
          const hasAny = count > 0 || cats.size > 0 || hasCompleted;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate(key)}
              className={`min-h-[100px] rounded-xl border text-left p-2.5 transition-colors flex flex-col ${
                inMonth ? "border-slate-200 bg-white hover:border-plexus-navy-800/40 hover:bg-slate-50 cursor-pointer" : "border-transparent bg-slate-50/50 text-slate-400 cursor-pointer hover:bg-slate-100/60"
              } ${isToday ? "ring-1 ring-plexus-navy-800 ring-offset-1" : ""}`}
              data-testid={`plexus-iq-day-${key}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className={`text-sm font-semibold ${inMonth ? "text-slate-900" : "text-slate-400"}`}>
                  {d.getDate()}
                </span>
                {hasCompleted && (
                  <span
                    className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-emerald-100 text-emerald-700"
                    title="Completed ancillary"
                    data-testid={`plexus-iq-day-completed-${key}`}
                  >
                    <Check className="w-3 h-3" strokeWidth={3} />
                  </span>
                )}
              </div>
              {hasAny && (
                <div className="mt-auto space-y-1.5">
                  {count > 0 && (
                    <div className="text-[11px] font-medium text-slate-700">
                      {count} {count === 1 ? "patient" : "patients"}
                    </div>
                  )}
                  {cats.size > 0 && (
                    <div className="flex items-center gap-1">
                      {ANCILLARY_CATEGORIES.map((c) => (
                        cats.has(c) ? (
                          <span
                            key={c}
                            className={`inline-block h-1.5 w-1.5 rounded-full ${ANCILLARY_DOT_COLOR[c]}`}
                            title={c}
                            data-testid={`plexus-iq-day-dot-${key}-${c}`}
                          />
                        ) : null
                      ))}
                    </div>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {unscheduled.length > 0 && (
        <section
          className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3"
          data-testid="plexus-iq-unscheduled-panel"
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">
              Unscheduled batches · {unscheduled.length}
            </h3>
            <span className="text-[10px] text-amber-700/80">
              These batches don&apos;t have a date yet, so they don&apos;t appear on the calendar.
            </span>
          </div>
          <ul className="divide-y divide-amber-200/60">
            {unscheduled.map((row) => {
              const label = row.facility
                ? `${row.facility} · ${row.name}`
                : row.name;
              return (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 py-2"
                  data-testid={`plexus-iq-unscheduled-row-${row.id}`}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <Building2 className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                    <span className="truncate text-sm text-slate-900" title={label}>
                      {label}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-500">
                      {row.patientCount} {row.patientCount === 1 ? "patient" : "patients"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAssignDate(row.id, label)}
                    className="shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium text-amber-900 bg-white border border-amber-200 hover:bg-amber-100 transition-colors"
                    data-testid={`button-plexus-iq-assign-${row.id}`}
                  >
                    <CalendarPlus className="w-3.5 h-3.5" />
                    Assign date
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
