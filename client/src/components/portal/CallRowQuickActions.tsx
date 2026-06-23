import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Phone,
  Calendar as CalendarIcon,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Clock,
  Check,
  PhoneCall,
  CalendarPlus,
} from "lucide-react";
import {
  schedulePatientAncillary,
  type TeamWorkspaceCallListItem,
} from "@/lib/workflow/teamMemberWorkspaceApi";
import { invalidateTeamPortalScheduleQueries } from "@/lib/portal/scheduleInvalidations";

// Premium quick-action cluster for a call-list row: a phone pop-up and a
// calendar pop-up (day -> time -> schedule), each with a small corner
// "expand" control that pulls the patient into the center Playground.
// PopoverContent must sit at z-[90] because the Team Portal renders as a
// full-screen overlay at z-[80]; lower z-index content opens behind it.

const ACCENT = "#4863A0";

const SERVICE_OPTIONS = [
  "BrainWave",
  "VitalWave",
  "Bilateral Carotid Duplex (93880)",
  "Echocardiogram TTE (93306)",
  "Renal Artery Doppler (93975)",
  "Lower Extremity Arterial Doppler (93925)",
  "Abdominal Aortic Aneurysm Duplex (93978)",
  "Lower Extremity Venous Duplex (93971)",
];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function combineLocalDateAndTimeToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!t) return null;
  const local = new Date(`${date}T${time.padStart(5, "0")}:00`);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

function prettyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function prettyTime(time: string): string {
  const iso = combineLocalDateAndTimeToIso(todayIso(), time);
  if (!iso) return time;
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

// 8:00 AM – 4:30 PM in 30-minute steps.
const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 8; h <= 16; h++) {
    for (const m of [0, 30]) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

function MiniMonth({
  facility,
  value,
  onSelect,
}: {
  facility: string;
  value: string | null;
  onSelect: (d: string) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const base = value ? new Date(`${value}T00:00:00`) : new Date();
    return { y: base.getFullYear(), m: base.getMonth() };
  });
  const monthIso = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;
  const { data } = useQuery<{ days: { date: string; appointmentCount: number }[] }>({
    queryKey: ["/api/portal/month-summary", facility, monthIso],
    queryFn: async () => {
      const u = new URL("/api/portal/month-summary", window.location.origin);
      u.searchParams.set("facility", facility);
      u.searchParams.set("month", monthIso);
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      return res.json();
    },
    enabled: !!facility,
  });

  const counts = new Map<string, number>();
  for (const d of data?.days ?? []) counts.set(d.date, d.appointmentCount);
  const first = new Date(cursor.y, cursor.m, 1);
  const startOffset = first.getDay();
  const lastDate = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const today = todayIso();
  const cells: Array<{ date: string | null; count: number }> = [];
  for (let i = 0; i < startOffset; i++) cells.push({ date: null, count: 0 });
  for (let day = 1; day <= lastDate; day++) {
    const ds = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ date: ds, count: counts.get(ds) ?? 0 });
  }
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() =>
            setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { ...c, m: c.m - 1 }))
          }
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
          data-testid="button-quickcal-prev"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-slate-900">{monthLabel}</span>
        <button
          type="button"
          onClick={() =>
            setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { ...c, m: c.m + 1 }))
          }
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
          data-testid="button-quickcal-next"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-[10px] font-medium text-slate-400">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c.date) return <div key={i} />;
          const isSelected = c.date === value;
          const isToday = c.date === today;
          const hasAppts = c.count > 0;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(c.date!)}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-lg text-xs font-medium transition-colors ${
                isSelected
                  ? "text-white shadow-sm"
                  : hasAppts
                    ? "bg-slate-50 text-slate-800 hover:bg-slate-100"
                    : "text-slate-600 hover:bg-slate-100"
              } ${isToday && !isSelected ? "ring-1 ring-inset ring-[color:var(--accent)]" : ""}`}
              style={
                isSelected
                  ? ({ backgroundColor: ACCENT } as React.CSSProperties)
                  : ({ ["--accent" as string]: ACCENT } as React.CSSProperties)
              }
              data-testid={`quickcal-day-${c.date}`}
            >
              <span>{parseInt(c.date.slice(-2), 10)}</span>
              {hasAppts && (
                <span
                  className={`mt-0.5 h-1 w-1 rounded-full ${
                    isSelected ? "bg-white/80" : ""
                  }`}
                  style={isSelected ? undefined : { backgroundColor: ACCENT }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ExpandBadge({
  onClick,
  label,
  testId,
}: {
  onClick: () => void;
  label: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className="absolute -right-1.5 -top-1.5 z-10 inline-flex h-4 w-4 items-center justify-center rounded-full border border-white bg-slate-900 text-white shadow hover:bg-slate-700"
      data-testid={testId}
    >
      <Maximize2 className="h-2.5 w-2.5" />
    </button>
  );
}

export type CallRowQuickActionsProps = {
  row: TeamWorkspaceCallListItem;
  idx: number | string;
  facility: string;
  selectedDate: string;
  canCall: boolean;
  callReason: string;
  /** Open the full call-logging sheet (DispositionSheet). */
  onLogCall: () => void;
  /** Pull this patient/case into the center Playground. */
  onExpandToPlayground: () => void;
};

export function CallRowQuickActions({
  row,
  idx,
  facility,
  selectedDate,
  canCall,
  callReason,
  onLogCall,
  onExpandToPlayground,
}: CallRowQuickActionsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const key = row.id ?? idx;

  const [callOpen, setCallOpen] = useState(false);
  const [schedOpen, setSchedOpen] = useState(false);

  const [day, setDay] = useState<string | null>(selectedDate || null);
  const [time, setTime] = useState<string>("");
  const [serviceType, setServiceType] = useState<string>(
    row.selectedServices?.[0] ?? "",
  );

  // Keep the popover's default day in sync with the portal's selected date
  // until the user picks a day inside the popover for this session.
  useEffect(() => {
    if (!schedOpen) setDay(selectedDate || null);
  }, [selectedDate, schedOpen]);

  // Reset transient choices each time the schedule popover opens so stale
  // time/service selections don't carry across rows or date changes.
  useEffect(() => {
    if (schedOpen) {
      setDay(selectedDate || null);
      setTime("");
      setServiceType(row.selectedServices?.[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedOpen]);

  const canSubmit = useMemo(
    () =>
      !!(row.patientScreeningId ?? row.executionCaseId) &&
      !!serviceType.trim() &&
      !!day &&
      !!combineLocalDateAndTimeToIso(day, time),
    [row, serviceType, day, time],
  );

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      const startsAt = day ? combineLocalDateAndTimeToIso(day, time) : null;
      if (!startsAt) throw new Error("Pick a valid date and time");
      return schedulePatientAncillary({
        executionCaseId: row.executionCaseId ?? null,
        patientScreeningId: row.patientScreeningId ?? null,
        serviceType: serviceType.trim(),
        startsAt,
        facilityId: row.facilityId ?? facility ?? null,
        metadata: { source: "call_row_quick_schedule" },
      });
    },
    onSuccess: () => {
      invalidateTeamPortalScheduleQueries(queryClient, {
        facility: row.facilityId ?? facility ?? null,
        selectedDate: day ?? selectedDate,
        patientScreeningId: row.patientScreeningId ?? null,
      });
      toast({
        title: "Scheduled",
        description: `${serviceType.trim()} · ${row.patientName ?? "patient"} · ${day ? prettyDate(day) : ""} ${prettyTime(time)}`,
      });
      setSchedOpen(false);
      setTime("");
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not schedule",
        description: err instanceof Error ? err.message : "Schedule write failed.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex items-center gap-2 shrink-0">
      {/* Phone → quick-call pop-up */}
      <div className="relative">
        <Popover open={callOpen} onOpenChange={setCallOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={!canCall}
              aria-label={`Call ${row.patientName ?? "patient"}`}
              title="Quick call"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-emerald-600 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid={`button-call-phone-${key}`}
            >
              <Phone className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={10}
            className="z-[90] w-72 overflow-hidden rounded-2xl border-slate-200 p-0 shadow-2xl"
            data-testid={`popover-call-${key}`}
          >
            <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 px-4 py-3 text-white">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
                  <PhoneCall className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {row.patientName ?? "Patient"}
                  </div>
                  <div className="truncate text-[11px] text-emerald-50/90">
                    {callReason}
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-2 p-3">
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                {row.facilityId ?? facility ?? "—"}
                {row.patientDob ? ` · DOB ${row.patientDob}` : ""}
              </div>
              <Button
                type="button"
                className="w-full gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                onClick={() => {
                  setCallOpen(false);
                  onLogCall();
                }}
                data-testid={`button-call-log-${key}`}
              >
                <Phone className="h-4 w-4" />
                Log call outcome
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full gap-1.5 text-slate-600"
                onClick={() => {
                  setCallOpen(false);
                  onExpandToPlayground();
                }}
                data-testid={`button-call-expand-inline-${key}`}
              >
                <Maximize2 className="h-3.5 w-3.5" />
                Open in Playground
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <ExpandBadge
          label={`Pull ${row.patientName ?? "patient"} call into Playground`}
          onClick={onExpandToPlayground}
          testId={`button-call-phone-expand-${key}`}
        />
      </div>

      {/* Calendar → day → time → schedule pop-up */}
      <div className="relative">
        <Popover open={schedOpen} onOpenChange={setSchedOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Schedule ${row.patientName ?? "patient"}`}
              title="Quick schedule"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition-colors hover:bg-blue-50"
              style={{ color: ACCENT }}
              data-testid={`button-call-schedule-${key}`}
            >
              <CalendarIcon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={10}
            className="z-[90] w-80 overflow-hidden rounded-2xl border-slate-200 p-0 shadow-2xl"
            data-testid={`popover-schedule-${key}`}
          >
            <div
              className="px-4 py-3 text-white"
              style={{
                backgroundImage: `linear-gradient(135deg, ${ACCENT}, #36507f)`,
              }}
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
                  <CalendarPlus className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    Schedule ancillary
                  </div>
                  <div className="truncate text-[11px] text-white/85">
                    {row.patientName ?? "Patient"}
                  </div>
                </div>
              </div>
            </div>

            <div className="max-h-[70vh] space-y-3 overflow-auto p-3">
              <MiniMonth
                facility={row.facilityId ?? facility}
                value={day}
                onSelect={setDay}
              />

              {day && (
                <>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <Clock className="h-3.5 w-3.5" />
                    Time · {prettyDate(day)}
                  </div>
                  <div className="grid max-h-32 grid-cols-3 gap-1.5 overflow-auto pr-0.5">
                    {TIME_SLOTS.map((slot) => {
                      const active = slot === time;
                      return (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setTime(slot)}
                          className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                            active
                              ? "border-transparent text-white shadow-sm"
                              : "border-slate-200 text-slate-700 hover:bg-slate-50"
                          }`}
                          style={active ? { backgroundColor: ACCENT } : undefined}
                          data-testid={`quickcal-slot-${slot}`}
                        >
                          {prettyTime(slot)}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2"
                    style={{ ["--tw-ring-color" as string]: ACCENT }}
                    data-testid={`quickcal-custom-time-${key}`}
                  />

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Service
                    </label>
                    <select
                      value={serviceType}
                      onChange={(e) => setServiceType(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2"
                      style={{ ["--tw-ring-color" as string]: ACCENT }}
                      data-testid={`quickcal-service-${key}`}
                    >
                      <option value="">— Select service —</option>
                      {(serviceType && !SERVICE_OPTIONS.includes(serviceType)
                        ? [serviceType, ...SERVICE_OPTIONS]
                        : SERVICE_OPTIONS
                      ).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <Button
                    type="button"
                    disabled={!canSubmit || scheduleMutation.isPending}
                    onClick={() => scheduleMutation.mutate()}
                    className="w-full gap-1.5"
                    style={{ backgroundColor: ACCENT }}
                    data-testid={`button-quickcal-submit-${key}`}
                  >
                    {scheduleMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Schedule {time ? `at ${prettyTime(time)}` : ""}
                  </Button>
                </>
              )}

              <button
                type="button"
                onClick={() => {
                  setSchedOpen(false);
                  onExpandToPlayground();
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
                data-testid={`button-schedule-expand-inline-${key}`}
              >
                <Maximize2 className="h-3.5 w-3.5" />
                Open full scheduler in Playground
              </button>
            </div>
          </PopoverContent>
        </Popover>
        <ExpandBadge
          label={`Pull ${row.patientName ?? "patient"} scheduler into Playground`}
          onClick={onExpandToPlayground}
          testId={`button-call-schedule-expand-${key}`}
        />
      </div>
    </div>
  );
}
