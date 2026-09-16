// Shared, simplified iOS/Zocdoc-like SchedulingPicker.
//
// ONE component, ONE behavior — reused by the Team Portal and the permanent
// Manual Call List. It deliberately REMOVES the old UnifiedScheduler complexity
// (single-click-inspect vs double-click-schedule, click-timer, tri-state day
// cells, instructional copy). The flow is exactly:
//   open → calendar → click ONE date (navy fill) → right panel shows available
//   times → click ONE time → Confirm.
//
// It does NOT reimplement any scheduling math. Availability comes from the
// canonical engine (POST /api/scheduling/availability via fetchAvailability)
// and the booking write goes through the canonical appointment path (POST
// /api/global-schedule-events/schedule-ancillary via schedulePatientAncillary).
// All capacity / technician / duration / double-book / clinic-hours rules stay
// server-side; this surface only renders the server's decisions.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Check, Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchAvailability, type ResourceType } from "@/lib/scheduling/availabilityApi";
import { schedulePatientAncillary } from "@/lib/workflow/teamMemberWorkspaceApi";
import { invalidateTeamPortalScheduleQueries } from "@/lib/portal/scheduleInvalidations";
import { getAncillaryCategory } from "@shared/ancillaryCategory";
import {
  groupBookableSlots,
  formatSelectedDate,
  type EngineSlot,
} from "@shared/scheduling/pickerModel";

export type SchedulingPickerPatient = {
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  patientName?: string | null;
  patientDob?: string | null;
};

export type SchedulingPickerProps = {
  patient: SchedulingPickerPatient;
  facilityId: string | null;
  /** One or more candidate service names. When more than one, a simple
   *  selector is shown above the times. */
  services: string[];
  /** Optional starting date (YYYY-MM-DD). Defaults to today. */
  initialDate?: string | null;
  onScheduled?: (result: unknown) => void;
  onCancel?: () => void;
};

// ─── Local calendar helpers (presentation only) ─────────────────────────────
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoFor(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

type DayCell = { iso: string; day: number; inMonth: boolean; isPast: boolean; isToday: boolean };

function buildMonthGrid(y: number, m: number, today: string): DayCell[] {
  const first = new Date(Date.UTC(y, m, 1));
  const startWeekday = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells: DayCell[] = [];
  // Leading blanks from the previous month (kept quiet / non-interactive).
  const prevDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let i = startWeekday - 1; i >= 0; i -= 1) {
    const day = prevDays - i;
    const iso = isoFor(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, day);
    cells.push({ iso, day, inMonth: false, isPast: iso < today, isToday: iso === today });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = isoFor(y, m, day);
    cells.push({ iso, day, inMonth: true, isPast: iso < today, isToday: iso === today });
  }
  // Trailing blanks to complete the final week row.
  while (cells.length % 7 !== 0) {
    const idx = cells.length - (startWeekday + daysInMonth);
    const day = idx + 1;
    const iso = isoFor(m === 11 ? y + 1 : y, m === 11 ? 0 : m + 1, day);
    cells.push({ iso, day, inMonth: false, isPast: iso < today, isToday: iso === today });
  }
  return cells;
}

export function SchedulingPicker({
  patient,
  facilityId,
  services,
  initialDate,
  onScheduled,
  onCancel,
}: SchedulingPickerProps) {
  const today = todayIso();
  const queryClient = useQueryClient();

  const initial = initialDate && initialDate >= today ? initialDate : today;
  const [selectedDate, setSelectedDate] = useState<string>(initial);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [service, setService] = useState<string>(services[0] ?? "");
  const [cursor, setCursor] = useState(() => {
    const [y, m] = initial.split("-").map(Number);
    return { y, m: (m ?? 1) - 1 };
  });
  const [bookError, setBookError] = useState<string | null>(null);

  const resourceType = useMemo<ResourceType | null>(() => {
    const cat = getAncillaryCategory(service);
    return cat === "other" ? null : (cat as ResourceType);
  }, [service]);

  const grid = useMemo(() => buildMonthGrid(cursor.y, cursor.m, today), [cursor, today]);
  const dateParts = formatSelectedDate(selectedDate);

  // Availability — the canonical engine. Only queried once we have a facility,
  // a categorized service, and a selected date.
  const availabilityEnabled = !!facilityId && !!resourceType && !!selectedDate;
  const { data: availability, isLoading, isError } = useQuery({
    queryKey: ["scheduling-picker-availability", facilityId, selectedDate, resourceType],
    queryFn: () =>
      fetchAvailability({
        facility: facilityId,
        date: selectedDate,
        services: [{ resourceType: resourceType as ResourceType }],
      }),
    enabled: availabilityEnabled,
    staleTime: 30_000,
  });

  const sections = useMemo(
    () => groupBookableSlots((availability?.slots ?? []) as EngineSlot[]),
    [availability],
  );
  const hasTimes = sections.some((s) => s.slots.length > 0);

  const booking = useMutation({
    mutationFn: async () => {
      if (!selectedTime) throw new Error("Select a time first");
      return schedulePatientAncillary({
        executionCaseId: patient.executionCaseId ?? null,
        patientScreeningId: patient.patientScreeningId ?? null,
        patientName: patient.patientName ?? null,
        patientDob: patient.patientDob ?? null,
        serviceType: service,
        startsAt: `${selectedDate}T${selectedTime}:00`,
        facilityId,
      });
    },
    onSuccess: (result) => {
      invalidateTeamPortalScheduleQueries(queryClient, { facility: facilityId ?? undefined });
      onScheduled?.(result);
    },
    onError: (e) => setBookError(e instanceof Error ? e.message : "Could not book this time"),
  });

  function pickDate(iso: string) {
    setSelectedDate(iso);
    setSelectedTime(null);
    setBookError(null);
  }
  function pickTime(time: string) {
    setSelectedTime(time);
    setBookError(null);
  }
  function moveMonth(delta: number) {
    setCursor((c) => {
      const next = new Date(Date.UTC(c.y, c.m + delta, 1));
      return { y: next.getUTCFullYear(), m: next.getUTCMonth() };
    });
  }

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(280px,360px)_1fr]" data-testid="scheduling-picker">
      {/* ── LEFT: iOS-style month calendar ───────────────────────────────── */}
      <div className="rounded-2xl bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-base font-semibold text-slate-900">
            {MONTH_NAMES[cursor.m]} {cursor.y}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => moveMonth(-1)}
              className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Previous month"
              data-testid="scheduling-picker-prev-month"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => moveMonth(1)}
              className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Next month"
              data-testid="scheduling-picker-next-month"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mb-1 grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((w, i) => (
            <div key={i} className="py-1 text-center text-[11px] font-medium text-slate-400">
              {w}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {grid.map((c, i) => {
            const selected = c.iso === selectedDate;
            const selectable = c.inMonth && !c.isPast;
            return (
              <button
                key={`${c.iso}-${i}`}
                type="button"
                disabled={!selectable}
                onClick={() => selectable && pickDate(c.iso)}
                aria-pressed={selected}
                data-testid={`scheduling-picker-day-${c.iso}`}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-full text-sm transition-colors",
                  selected && "bg-slate-900 font-semibold text-white",
                  !selected && selectable && "text-slate-800 hover:bg-slate-100",
                  !selected && c.isToday && "font-semibold text-slate-900 ring-1 ring-slate-300",
                  !c.inMonth && "text-slate-300",
                  c.inMonth && c.isPast && "cursor-not-allowed text-slate-300",
                )}
              >
                {c.day}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── RIGHT: available times ───────────────────────────────────────── */}
      <div className="flex min-h-0 flex-col rounded-2xl bg-white p-5">
        {dateParts ? (
          <div className="mb-1">
            <div className="text-xl font-bold leading-tight text-slate-900" data-testid="scheduling-picker-selected-weekday">
              {dateParts.weekday}
            </div>
            <div className="text-sm text-slate-500" data-testid="scheduling-picker-selected-date">
              {dateParts.monthDay}
            </div>
          </div>
        ) : null}

        {services.length > 1 ? (
          <div className="mb-3 mt-2 flex flex-wrap gap-1.5" data-testid="scheduling-picker-services">
            {services.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setService(s);
                  setSelectedTime(null);
                }}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  s === service ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        ) : service ? (
          <div className="mb-3 mt-1 text-sm font-medium text-slate-700" data-testid="scheduling-picker-service">
            {service}
          </div>
        ) : null}

        <div className="mb-2 mt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Available Times
        </div>

        <div className="min-h-[220px] flex-1">
          {!facilityId ? (
            <p className="mt-6 text-center text-sm text-slate-400">Select a clinic to see availability.</p>
          ) : !resourceType ? (
            <p className="mt-6 text-center text-sm text-slate-400">Choose a service to see available times.</p>
          ) : isLoading ? (
            <div className="mt-10 flex items-center justify-center text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : isError ? (
            <p className="mt-6 text-center text-sm text-rose-500">Couldn't load availability. Try another date.</p>
          ) : !hasTimes ? (
            <div className="mt-8 flex flex-col items-center gap-2 text-slate-400">
              <CalendarIcon className="h-6 w-6" />
              <p className="text-sm">No open times on this day.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {sections.map((sec) => (
                <div key={sec.partOfDay}>
                  {sections.length > 1 ? (
                    <div className="mb-1.5 text-[11px] font-medium text-slate-400">{sec.label}</div>
                  ) : null}
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {sec.slots.map((slot) => {
                      const active = slot.time === selectedTime;
                      return (
                        <button
                          key={slot.time}
                          type="button"
                          onClick={() => pickTime(slot.time)}
                          aria-pressed={active}
                          data-testid={`scheduling-picker-time-${slot.time}`}
                          className={cn(
                            "rounded-xl py-2.5 text-center text-sm font-semibold transition-colors",
                            active
                              ? "bg-slate-900 text-white"
                              : "bg-slate-50 text-slate-800 ring-1 ring-slate-200 hover:bg-slate-100",
                          )}
                        >
                          {slot.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {bookError ? (
          <p className="mt-3 text-sm text-rose-600" data-testid="scheduling-picker-error">{bookError}</p>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
              data-testid="scheduling-picker-cancel"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            disabled={!selectedTime || booking.isPending}
            onClick={() => booking.mutate()}
            data-testid="scheduling-picker-confirm"
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors",
              selectedTime && !booking.isPending
                ? "bg-primary hover:opacity-90"
                : "cursor-not-allowed bg-slate-300 text-white",
            )}
          >
            {booking.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {selectedTime ? `Confirm ${sectionsTimeLabel(sections, selectedTime)}`.trim() : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Resolve the human label ("9:00 AM") for the selected 24h time from the
 *  already-formatted sections, so the Confirm button reads naturally. */
function sectionsTimeLabel(
  sections: ReturnType<typeof groupBookableSlots>,
  time: string,
): string {
  for (const sec of sections) {
    const hit = sec.slots.find((s) => s.time === time);
    if (hit) return hit.label;
  }
  return "";
}

export default SchedulingPicker;
