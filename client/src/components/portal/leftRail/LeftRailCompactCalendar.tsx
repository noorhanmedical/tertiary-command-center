import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import {
  buildCommandCalendarCells,
  type CommandCalendarSummaryRow,
} from "@/lib/calendar/commandCalendarViewModel";

// Compact Global Calendar — small fitted calendar tile that lives in
// the Team Portal left tools rail. NOT patient-centric. Shows the
// month grid + today highlight + selected-date highlight + canonical
// per-day ancillary service dots (BrainWave / VitalWave / Ultrasound),
// reusing the same calendar-summary feed + ANCILLARY_DOT_CLASS colors
// every other Plexus calendar uses. Clicking a date hands off to the
// caller.

export type LeftRailCompactCalendarProps = {
  selectedDate: string; // YYYY-MM-DD
  onSelectDate: (iso: string) => void;
  /** Fired when the operator clicks the header (or a date) to promote
   *  the calendar to the center playground / canvas. */
  onExpandToCanvas: () => void;
  /** Facility scope for the service dots. When set, only this facility's
   *  scheduled ancillary activity lights dots. */
  facility?: string | null;
  testId?: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfMonth(year: number, monthZero: number): Date {
  return new Date(year, monthZero, 1);
}

function endOfMonth(year: number, monthZero: number): Date {
  return new Date(year, monthZero + 1, 0);
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function LeftRailCompactCalendar({
  selectedDate,
  onSelectDate,
  onExpandToCanvas,
  facility = null,
  testId = "left-rail-compact-calendar",
}: LeftRailCompactCalendarProps) {
  // Canonical calendar-summary feed (one row per screening batch) — the same
  // source Plexus IQ / PCS / ACS use. buildCommandCalendarCells turns each
  // day's ancillary categories into the shared ANCILLARY_DOT_CLASS dots.
  const { data: summary = [] } = useQuery<CommandCalendarSummaryRow[]>({
    queryKey: ["/api/screening-batches/calendar-summary"],
    queryFn: async () => {
      const res = await fetch("/api/screening-batches/calendar-summary", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Calendar summary fetch failed (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });
  const dayCells = useMemo(
    () => buildCommandCalendarCells({ summary, facility }),
    [summary, facility],
  );
  const [cursor, setCursor] = useState<{ year: number; monthZero: number }>(() => {
    const d = new Date(selectedDate + "T00:00:00");
    if (Number.isNaN(d.getTime())) {
      const n = new Date();
      return { year: n.getFullYear(), monthZero: n.getMonth() };
    }
    return { year: d.getFullYear(), monthZero: d.getMonth() };
  });

  const today = todayIso();

  const cells = useMemo(() => {
    const first = startOfMonth(cursor.year, cursor.monthZero);
    const last = endOfMonth(cursor.year, cursor.monthZero);
    const leadDays = first.getDay(); // 0=Sun
    const totalCells = leadDays + last.getDate();
    const trailDays = (7 - (totalCells % 7)) % 7;
    const list: Array<{ iso: string | null; day: number | null }> = [];
    for (let i = 0; i < leadDays; i++) list.push({ iso: null, day: null });
    for (let d = 1; d <= last.getDate(); d++) {
      const iso = `${cursor.year}-${pad2(cursor.monthZero + 1)}-${pad2(d)}`;
      list.push({ iso, day: d });
    }
    for (let i = 0; i < trailDays; i++) list.push({ iso: null, day: null });
    return list;
  }, [cursor.year, cursor.monthZero]);

  const monthLabel = useMemo(() => {
    return new Date(cursor.year, cursor.monthZero, 1).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
  }, [cursor.year, cursor.monthZero]);

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const total = c.year * 12 + c.monthZero + delta;
      return { year: Math.floor(total / 12), monthZero: total % 12 };
    });
  }

  return (
    <div
      className="rounded-2xl border border-white/40 bg-white p-2 text-slate-900 shadow-sm"
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-1 px-1 pb-1">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
          aria-label="Previous month"
          data-testid="left-rail-compact-calendar-prev"
        >
          <ChevronLeft className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onExpandToCanvas}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-tight hover:bg-slate-100"
          data-testid="left-rail-compact-calendar-expand"
          title="Expand calendar in center canvas"
        >
          <CalendarDays className="h-3 w-3" />
          {monthLabel}
        </button>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
          aria-label="Next month"
          data-testid="left-rail-compact-calendar-next"
        >
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 px-0.5 pb-0.5 text-center">
        {WEEKDAYS.map((d, i) => (
          <div
            key={`hdr-${i}`}
            className="text-[9px] font-semibold uppercase text-slate-400"
          >
            {d}
          </div>
        ))}
        {cells.map((c, idx) => {
          if (!c.iso || !c.day) {
            return (
              <div key={`blank-${idx}`} className="h-6" aria-hidden="true" />
            );
          }
          const isToday = c.iso === today;
          const isSelected = c.iso === selectedDate;
          const dots = dayCells[c.iso]?.dots ?? [];
          return (
            <button
              key={c.iso}
              type="button"
              onClick={() => onSelectDate(c.iso!)}
              className={[
                "relative flex h-7 flex-col items-center justify-center rounded text-[10px] transition-colors",
                isSelected
                  ? "bg-slate-900 text-white"
                  : isToday
                    ? "bg-indigo-100 text-indigo-900"
                    : "text-slate-700 hover:bg-slate-100",
              ].join(" ")}
              data-testid={`left-rail-compact-calendar-day-${c.iso}`}
            >
              <span className="leading-none">{c.day}</span>
              {dots.length > 0 && (
                <span
                  className="mt-0.5 flex items-center justify-center gap-[2px]"
                  data-testid={`left-rail-compact-calendar-dots-${c.iso}`}
                >
                  {dots.slice(0, 3).map((d, di) => (
                    <span
                      key={di}
                      className={`h-1 w-1 rounded-full ${d.className}`}
                      title={d.title}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
