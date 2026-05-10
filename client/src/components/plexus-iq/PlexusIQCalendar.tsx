import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import type { ScreeningBatch, PatientScreening } from "@shared/schema";
import type { GlobalScheduleEvent } from "@shared/schema/globalSchedule";
import { getAncillaryCategory, type AncillaryCategory } from "@/features/schedule/ancillaryMeta";

// Inline month calendar surface for /plexus-iq.
//
// Read-only view fed by canonical endpoints:
//   - /api/screening-batches — all batches across facilities/dates
//   - each batch detail (cached via useScreeningBatch in the page) — patient
//     ancillaries; only fetched lazily by the page when a date is opened
//   - /api/global-schedule-events — used for the "completed" checkmark via
//     procedure_complete events in the visible month
//
// The cell counts are derived from screening_batches' patientScreenings
// (joined client-side from each batch's detail). For the at-a-glance dot
// strip we read each patient's qualifyingTests, classify them via the
// shared getAncillaryCategory helper, and render one dot per category that
// appears on that date. The completed badge fires when any
// procedure_complete event lands on that date.

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

type BatchSummary = ScreeningBatch & { patients?: PatientScreening[] };

export function PlexusIQCalendar({
  batches,
  batchDetails,
  onSelectDate,
}: {
  // The list of all known batches (from /api/screening-batches).
  batches: ScreeningBatch[];
  // A keyed map of batchId -> batch detail (with patients). Only the visible
  // month's batches need to be hydrated; the page passes whatever it has.
  batchDetails: Record<number, BatchSummary>;
  onSelectDate: (isoDate: string) => void;
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

  // Completed indicator source — procedure_complete events from the canonical
  // global_schedule_events feed. We only need the date and event type.
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

  // Aggregate per-date counts and ancillary categories from batches that have
  // a scheduleDate. Outreach batches without a scheduleDate aren't placed on
  // the calendar at all (Plexus IQ keeps them in the "Outreach" type bucket
  // accessible via the day modal once committed).
  const perDate = useMemo(() => {
    const map: Record<string, { count: number; cats: Set<AncillaryCategory> }> = {};
    for (const b of batches) {
      if (!b.scheduleDate) continue;
      const key = b.scheduleDate;
      if (!map[key]) map[key] = { count: 0, cats: new Set() };
      const detail = batchDetails[b.id];
      if (detail?.patients) {
        map[key].count += detail.patients.length;
        for (const p of detail.patients) {
          for (const t of p.qualifyingTests || []) {
            const c = getAncillaryCategory(t);
            if (c !== "other") map[key].cats.add(c);
          }
        }
      } else {
        // Detail not yet loaded — fall back to a placeholder count of "?" via
        // marking the day as having activity (1) so the dot strip still
        // surfaces if/when detail loads. Here we use 0 to avoid lying;
        // the page eagerly fetches details for the visible month.
        map[key].count += 0;
      }
    }
    return map;
  }, [batches, batchDetails]);

  const grid = buildMonthGrid(cursor);
  const todayKey = ymd(new Date());
  const cursorMonth = cursor.getMonth();

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-4">
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
    </div>
  );
}
