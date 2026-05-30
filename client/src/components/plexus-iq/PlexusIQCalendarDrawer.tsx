import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ChevronLeft,
  ChevronRight,
  ChevronRight as ChevronRightIcon,
  X,
} from "lucide-react";
import { PatientSilhouette } from "@/components/PatientSilhouette";
import { VALID_FACILITIES } from "@shared/plexus";
import type { GlobalScheduleEvent } from "@shared/schema/globalSchedule";

// Plexus IQ calendar drawer.
//
// Read-only view over the canonical /api/global-schedule-events feed. Uses
// only `startDate`/`endDate`/`facilityId`/`eventType` filters supported by
// the existing route — no new backend route. Click a date cell to drill into
// a date detail panel that lists each event in the premium navy/white bar
// style. The bar visual is replicated minimally here (rather than extracted
// from ResultsView) to keep this batch contained; an extraction refactor is
// a clean follow-up.

type EventTypeFilter = "all" | "visit" | "ancillary";

const EVENT_TYPE_LABEL: Record<string, string> = {
  doctor_visit: "Visit Appointment",
  ancillary_appointment: "Ancillary",
  same_day_add: "Same-day add",
  procedure_complete: "Completed",
  no_show: "No-show",
  cancellation: "Cancelled",
  reschedule: "Rescheduled",
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
  // 6-week grid starting on Sunday so layout is stable across months.
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

function classifyEvent(eventType: string): "visit" | "ancillary" | "other" {
  if (eventType === "doctor_visit") return "visit";
  if (
    eventType === "ancillary_appointment" ||
    eventType === "same_day_add" ||
    eventType === "procedure_complete"
  ) {
    return "ancillary";
  }
  return "other";
}

export function PlexusIQCalendarDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));
  const [facilityFilter, setFacilityFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<EventTypeFilter>("all");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const monthLabel = cursor.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Pull a slightly padded range so the 6-week grid always has data for the
  // leading/trailing days from neighboring months.
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

  const queryKey = [
    "/api/global-schedule-events",
    {
      startDate: rangeStart.toISOString(),
      endDate: rangeEnd.toISOString(),
      facilityId: facilityFilter === "all" ? null : facilityFilter,
    },
  ] as const;

  const { data: events = [], isLoading } = useQuery<GlobalScheduleEvent[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("startDate", rangeStart.toISOString());
      params.set("endDate", rangeEnd.toISOString());
      params.set("limit", "500");
      if (facilityFilter !== "all") params.set("facilityId", facilityFilter);
      const res = await fetch(`/api/global-schedule-events?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Calendar fetch failed (${res.status})`);
      return res.json();
    },
    enabled: open,
  });

  const eventsByDay = useMemo(() => {
    const map: Record<string, GlobalScheduleEvent[]> = {};
    for (const evt of events) {
      const startsAt = evt.startsAt ? new Date(evt.startsAt as unknown as string) : null;
      if (!startsAt || isNaN(startsAt.getTime())) continue;
      const key = ymd(startsAt);
      if (!map[key]) map[key] = [];
      map[key].push(evt);
    }
    return map;
  }, [events]);

  const filteredEventsByDay = useMemo(() => {
    if (typeFilter === "all") return eventsByDay;
    const out: Record<string, GlobalScheduleEvent[]> = {};
    for (const [key, list] of Object.entries(eventsByDay)) {
      const filtered = list.filter((e) => classifyEvent(e.eventType) === typeFilter);
      if (filtered.length > 0) out[key] = filtered;
    }
    return out;
  }, [eventsByDay, typeFilter]);

  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);
  const todayKey = ymd(new Date());
  const cursorMonth = cursor.getMonth();

  const selectedEvents = selectedDate ? filteredEventsByDay[selectedDate] ?? [] : [];

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 gap-0 flex flex-col"
        data-testid="plexus-iq-calendar-drawer"
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="text-base font-semibold tracking-tight">
              Calendar
            </SheetTitle>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center h-8 w-8 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              aria-label="Close calendar"
              data-testid="button-close-plexus-iq-calendar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </SheetHeader>

        {selectedDate ? (
          <DateDetail
            isoDate={selectedDate}
            events={selectedEvents}
            onBack={() => setSelectedDate(null)}
          />
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                className="inline-flex items-center justify-center h-8 w-8 rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                aria-label="Previous month"
                data-testid="button-plexus-iq-prev-month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="text-sm font-semibold text-slate-900" data-testid="text-plexus-iq-month-label">
                {monthLabel}
              </div>
              <button
                type="button"
                onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                className="inline-flex items-center justify-center h-8 w-8 rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                aria-label="Next month"
                data-testid="button-plexus-iq-next-month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={facilityFilter}
                onChange={(e) => setFacilityFilter(e.target.value)}
                className="text-xs h-7 rounded-lg border border-slate-200 bg-white px-2"
                data-testid="select-plexus-iq-facility"
              >
                <option value="all">All facilities</option>
                {VALID_FACILITIES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                {(["all", "visit", "ancillary"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTypeFilter(t)}
                    className={`px-2.5 h-7 text-[11px] font-medium ${
                      typeFilter === t
                        ? "bg-plexus-navy-800 text-white"
                        : "bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                    data-testid={`button-plexus-iq-type-${t}`}
                  >
                    {t === "all" ? "All" : t === "visit" ? "Visit" : "Ancillary"}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-slate-400 px-1">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div key={i} className="text-center py-1">{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {grid.map((d) => {
                const key = ymd(d);
                const inMonth = d.getMonth() === cursorMonth;
                const isToday = key === todayKey;
                const dayEvents = filteredEventsByDay[key] ?? [];
                const visitCount = dayEvents.filter((e) => e.eventType === "doctor_visit").length;
                const ancScheduled = dayEvents.filter(
                  (e) =>
                    (e.eventType === "ancillary_appointment" || e.eventType === "same_day_add") &&
                    e.status === "scheduled",
                ).length;
                const ancCompleted = dayEvents.filter(
                  (e) => e.status === "completed" || e.eventType === "procedure_complete",
                ).length;
                const hasAny = dayEvents.length > 0;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDate(key)}
                    disabled={!hasAny}
                    className={`min-h-[64px] rounded-lg border text-left p-1.5 transition-colors ${
                      inMonth ? "border-slate-200 bg-white" : "border-transparent bg-slate-50/40 text-slate-400"
                    } ${isToday ? "ring-1 ring-plexus-navy-800 ring-offset-1" : ""} ${
                      hasAny ? "hover:border-plexus-navy-800/40 hover:bg-slate-50 cursor-pointer" : "cursor-default"
                    }`}
                    data-testid={`plexus-iq-day-${key}`}
                  >
                    <div className={`text-[11px] font-semibold ${inMonth ? "text-slate-700" : "text-slate-400"}`}>
                      {d.getDate()}
                    </div>
                    {hasAny && (
                      <div className="mt-1 space-y-0.5 text-[9px] leading-tight">
                        {visitCount > 0 && (
                          <div className="text-plexus-navy-800 font-medium">{visitCount} visit</div>
                        )}
                        {ancScheduled > 0 && (
                          <div className="text-violet-700">{ancScheduled} sched</div>
                        )}
                        {ancCompleted > 0 && (
                          <div className="text-emerald-700">{ancCompleted} done</div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {isLoading && (
              <div className="text-xs text-slate-500 italic px-1">Loading events…</div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DateDetail({
  isoDate,
  events,
  onBack,
}: {
  isoDate: string;
  events: GlobalScheduleEvent[];
  onBack: () => void;
}) {
  const [yyyy, mm, dd] = isoDate.split("-").map(Number);
  const labelDate = new Date(yyyy, (mm ?? 1) - 1, dd ?? 1);
  const label = labelDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" data-testid="plexus-iq-date-detail">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onBack}
          className="gap-1.5 rounded-xl"
          data-testid="button-plexus-iq-date-back"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </Button>
        <div className="text-sm font-semibold text-slate-900 truncate" data-testid="text-plexus-iq-date-label">
          {label}
        </div>
        <span className="w-[68px]" />
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-xs text-slate-500">
          No scheduled events for this date.
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((evt) => (
            <DateDetailBar key={evt.id} event={evt} />
          ))}
        </div>
      )}

      <p className="text-[10px] text-slate-400 italic px-1 pt-2">
        Read-only view from canonical schedule events. Open the originating
        Final Schedule to send to scheduler or generate PDFs.
      </p>
    </div>
  );
}

function DateDetailBar({ event }: { event: GlobalScheduleEvent }) {
  const startsAt = event.startsAt ? new Date(event.startsAt as unknown as string) : null;
  const time = startsAt && !isNaN(startsAt.getTime())
    ? startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    : null;
  const cls = classifyEvent(event.eventType);
  const typeLabel = EVENT_TYPE_LABEL[event.eventType] ?? event.eventType;
  const showTime = cls === "visit" && !!time;
  const status = event.status;
  const isCompleted = status === "completed" || event.eventType === "procedure_complete";
  const isCancelled = status === "cancelled" || event.eventType === "cancellation";

  return (
    <div
      className="rounded-2xl border-0 shadow-sm overflow-hidden bg-white"
      data-testid={`plexus-iq-event-${event.id}`}
    >
      <div className="flex items-stretch">
        <div className="bg-plexus-navy-800 text-white flex items-center gap-3 px-4 py-3 shrink-0 w-[60%] min-w-[200px]">
          <div
            aria-hidden="true"
            className="shrink-0 inline-flex items-center justify-center h-10 w-10 rounded-full bg-white/10 ring-1 ring-white/20 text-white"
          >
            <PatientSilhouette gender={null} className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            {showTime ? (
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold tabular-nums text-white">{time}</span>
                <span className="text-[9px] uppercase tracking-[0.14em] text-white/60 font-medium">
                  {typeLabel}
                </span>
              </div>
            ) : (
              <span className="text-[9px] uppercase tracking-[0.14em] text-white/60 font-medium block">
                {typeLabel}
              </span>
            )}
            <p className="min-w-0 text-base font-light tracking-tight text-white truncate">
              {event.patientName ?? "Unnamed patient"}
            </p>
          </div>
        </div>
        <div className="flex-1 min-w-0 bg-white px-4 py-3 flex items-center justify-between gap-2">
          <div className="text-[11px] text-slate-700 truncate">
            {event.facilityId ?? "—"}
          </div>
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${
              isCompleted
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : isCancelled
                ? "bg-slate-50 text-slate-500 border border-slate-200"
                : "bg-sky-50 text-sky-700 border border-sky-200"
            }`}
          >
            {isCompleted ? "Completed" : isCancelled ? "Cancelled" : status}
          </span>
        </div>
      </div>
    </div>
  );
}
