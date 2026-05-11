// Generic month-grid view used by UniversalCalendar.
//
// Stays profile-agnostic: the caller maps its raw data (Plexus IQ summary,
// global_schedule_events rows, …) into a simple per-date cell shape and
// passes it in. The view only renders prev/next nav, a 6-week grid, and
// the supplied count/dot/badge primitives.
//
// Future view modes (week/day/agenda) plug in alongside this file.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type CanonicalMonthCellSummary = {
  count?: number;
  // One dot per ancillary/qualitative bucket the day surfaces. The caller
  // owns the color via Tailwind classes so this stays profile-agnostic.
  dots?: { className: string; title?: string }[];
  // Optional small corner badge — e.g. a checkmark for "procedure
  // completed on this date". Caller supplies the glyph.
  badge?: { icon?: React.ReactNode; className?: string; title?: string };
};

export type CanonicalMonthCalendarProps = {
  // Per-date summary keyed by `YYYY-MM-DD`. Days not present render empty.
  cells?: Record<string, CanonicalMonthCellSummary>;
  onSelectDate?: (isoDate: string) => void;
  // Initial month displayed; defaults to today.
  initialMonth?: Date;
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function buildMonthGrid(monthStart: Date): Date[] {
  // 6-week (42-cell) grid starting on Sunday for stable layout.
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

export function CanonicalMonthCalendar({
  cells = {},
  onSelectDate,
  initialMonth,
}: CanonicalMonthCalendarProps) {
  const [cursor, setCursor] = useState<Date>(() =>
    startOfMonth(initialMonth ?? new Date()),
  );

  const monthLabel = cursor.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);
  const todayKey = ymd(new Date());
  const cursorMonth = cursor.getMonth();

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="canonical-month-calendar"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() =>
            setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
          }
          className="inline-flex items-center justify-center h-8 w-8 rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          aria-label="Previous month"
          data-testid="canonical-month-prev"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div
          className="text-sm font-semibold text-slate-900"
          data-testid="canonical-month-label"
        >
          {monthLabel}
        </div>
        <button
          type="button"
          onClick={() =>
            setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
          }
          className="inline-flex items-center justify-center h-8 w-8 rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          aria-label="Next month"
          data-testid="canonical-month-next"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-slate-400 px-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="text-center py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map((d) => {
          const key = ymd(d);
          const inMonth = d.getMonth() === cursorMonth;
          const isToday = key === todayKey;
          const cell = cells[key];
          const hasAny =
            (cell?.count ?? 0) > 0 ||
            (cell?.dots && cell.dots.length > 0) ||
            !!cell?.badge;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate?.(key)}
              className={`min-h-[88px] rounded-xl border text-left p-2 transition-colors flex flex-col ${
                inMonth
                  ? "border-slate-200 bg-white hover:border-plexus-navy-800/40 hover:bg-slate-50 cursor-pointer"
                  : "border-transparent bg-slate-50/50 text-slate-400 cursor-pointer hover:bg-slate-100/60"
              } ${isToday ? "ring-1 ring-plexus-navy-800 ring-offset-1" : ""}`}
              data-testid={`canonical-month-day-${key}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={`text-sm font-semibold ${
                    inMonth ? "text-slate-900" : "text-slate-400"
                  }`}
                >
                  {d.getDate()}
                </span>
                {cell?.badge && (
                  <span
                    className={`inline-flex items-center justify-center h-4 min-w-4 px-0.5 rounded-full text-[10px] ${cell.badge.className ?? ""}`}
                    title={cell.badge.title}
                    data-testid={`canonical-month-day-badge-${key}`}
                  >
                    {cell.badge.icon}
                  </span>
                )}
              </div>
              {hasAny && (
                <div className="mt-auto space-y-1">
                  {cell?.count != null && cell.count > 0 && (
                    <div className="text-[11px] font-medium text-slate-700">
                      {cell.count}{" "}
                      {cell.count === 1 ? "patient" : "patients"}
                    </div>
                  )}
                  {cell?.dots && cell.dots.length > 0 && (
                    <div className="flex items-center gap-1">
                      {cell.dots.map((dot, i) => (
                        <span
                          key={i}
                          className={`inline-block h-1.5 w-1.5 rounded-full ${dot.className}`}
                          title={dot.title}
                        />
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
