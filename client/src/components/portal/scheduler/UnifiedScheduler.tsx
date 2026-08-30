// UnifiedScheduler — the ONE full scheduler surface for the Team Portal.
//
// Rendered inside the Playground "schedule"/"calendar" workspace. Every full
// scheduling entry point (dock Calendar, left-rail Calendar tile, right-rail
// patient calendar, EHR schedule) opens THIS component; only the entry CONTEXT
// differs (patient/facility/service preselected or not). The UI never changes.
//
// Layout: full month calendar (~65%) + scheduling panel (~35%), sized to fit
// the Playground viewport without page scroll. Service selection is
// BrainWave / VitalWave / Ultrasound(dropdown) sourced from the canonical
// ancillary service registry. Time is a grid of slot buttons. The write goes
// through the canonical schedulePatientAncillary path.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Search,
  User,
  X,
  Loader2,
  ChevronDown,
  Check,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { schedulePatientAncillary } from "@/lib/workflow/teamMemberWorkspaceApi";
import { invalidateTeamPortalScheduleQueries } from "@/lib/portal/scheduleInvalidations";
import { searchPatients, type PatientSearchRow } from "@/lib/portal/commandCenterApi";
import {
  fetchActiveServicesForFacility,
  bucketServices,
  type RegistryService,
} from "@/lib/scheduling/serviceRegistry";
import {
  buildCommandCalendarCells,
  type CommandCalendarSummaryRow,
} from "@/lib/calendar/commandCalendarViewModel";

// 08:00–16:30 in 30-min steps (the platform's fixed clinic interval).
const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 8; h <= 16; h++) for (const m of [0, 30]) out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  return out;
})();

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function pad2(n: number) { return String(n).padStart(2, "0"); }
function isoOf(y: number, m: number, d: number) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }
function prettyTime(t: string): string {
  const d = new Date(`2000-01-01T${t.padStart(5, "0")}:00`);
  return Number.isNaN(d.getTime()) ? t : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function prettyDateLong(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
function combineToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const local = new Date(`${date}T${time.padStart(5, "0")}:00`);
  return Number.isNaN(local.getTime()) ? null : local.toISOString();
}

export type UnifiedSchedulerContext = {
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  patientName?: string | null;
  patientDob?: string | null;
  facility?: string | null;
  serviceType?: string | null;
  initialDate?: string | null;
  initialTime?: string | null;
};

type SelectedPatient = {
  patientScreeningId: number | null;
  executionCaseId: number | null;
  name: string | null;
  dob: string | null;
  facility: string | null;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function UnifiedScheduler({
  context,
}: {
  context: UnifiedSchedulerContext;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const facility = context.facility ?? null;

  // Selected patient — seeded from context, or chosen via the search picker.
  const [patient, setPatient] = useState<SelectedPatient>(() => ({
    patientScreeningId: context.patientScreeningId ?? null,
    executionCaseId: context.executionCaseId ?? null,
    name: context.patientName ?? null,
    dob: context.patientDob ?? null,
    facility: context.facility ?? null,
  }));
  const hasPatient = !!patient.name || patient.patientScreeningId != null;

  const [selectedDate, setSelectedDate] = useState<string>(
    context.initialDate && /^\d{4}-\d{2}-\d{2}$/.test(context.initialDate)
      ? context.initialDate
      : todayIso(),
  );
  const [time, setTime] = useState<string>(context.initialTime ?? "");
  const [serviceCode, setServiceCode] = useState<string>(context.serviceType ?? "");
  const [ultrasoundOpen, setUltrasoundOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  // Quick Schedule popover (double-click a date). Anchored near the cell; it
  // reuses the SAME scheduler fields in compact form and completes inline.
  const [quickDate, setQuickDate] = useState<string | null>(null);

  // Calendar month cursor.
  const [cursor, setCursor] = useState(() => {
    const d = new Date(`${selectedDate}T00:00:00`);
    const base = Number.isNaN(d.getTime()) ? new Date() : d;
    return { y: base.getFullYear(), m: base.getMonth() };
  });

  // ── Canonical active services for this facility (registry) ──
  const { data: services = [], isLoading: servicesLoading } = useQuery<RegistryService[]>({
    queryKey: ["service-registry-by-facility", facility],
    queryFn: () => fetchActiveServicesForFacility(facility),
    staleTime: 5 * 60_000,
  });
  const { brainwave, vitalwave, ultrasound } = useMemo(() => bucketServices(services), [services]);
  const selectedService = useMemo(
    () => services.find((s) => s.internalCode === serviceCode) ?? null,
    [services, serviceCode],
  );
  const selectedIsUltrasound = !!selectedService && ultrasound.some((u) => u.internalCode === selectedService.internalCode);

  // ── Canonical calendar markers (dots) ──
  const { data: summary = [] } = useQuery<CommandCalendarSummaryRow[]>({
    queryKey: ["/api/screening-batches/calendar-summary"],
    queryFn: async () => {
      const res = await fetch("/api/screening-batches/calendar-summary", { credentials: "include" });
      if (!res.ok) throw new Error(`Calendar summary failed (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });
  const dayCells = useMemo(() => buildCommandCalendarCells({ summary, facility }), [summary, facility]);

  // ── Patient search ──
  const searchTerm = patientSearch.trim();
  const { data: matches = [], isFetching: searching } = useQuery<PatientSearchRow[]>({
    queryKey: ["scheduler-patient-search", searchTerm, facility],
    queryFn: () => searchPatients({ query: searchTerm, facility: facility ?? undefined, limit: 20 }),
    enabled: !hasPatient && searchTerm.length >= 2,
  });

  // Clear a stale service selection when the service list changes and no longer
  // contains it.
  useEffect(() => {
    if (serviceCode && services.length > 0 && !services.some((s) => s.internalCode === serviceCode)) {
      setServiceCode("");
    }
  }, [services, serviceCode]);

  const startsAtIso = combineToIso(selectedDate, time);
  const canSubmit = hasPatient && !!serviceCode && !!startsAtIso;

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      if (!startsAtIso) throw new Error("Pick a valid date and time");
      if (!serviceCode) throw new Error("Choose an appointment type");
      return schedulePatientAncillary({
        executionCaseId: patient.executionCaseId ?? null,
        patientScreeningId: patient.patientScreeningId ?? null,
        patientName: patient.patientScreeningId == null ? patient.name : null,
        patientDob: patient.patientScreeningId == null ? patient.dob : null,
        serviceType: serviceCode, // canonical internalCode
        startsAt: startsAtIso,
        facilityId: facility,
        metadata: { source: "unified_scheduler" },
      });
    },
    onSuccess: (result) => {
      invalidateTeamPortalScheduleQueries(queryClient, {
        facility,
        selectedDate,
        patientScreeningId: patient.patientScreeningId ?? null,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches/calendar-summary"] });
      // The canonical endpoint returns { deferred: true } (HTTP 202) for
      // walk-ins with no resolvable clinic/identity — the appointment did NOT
      // persist. Be honest rather than showing a false "Scheduled".
      const deferred = !!(result && typeof result === "object" && (result as { deferred?: boolean }).deferred);
      if (deferred) {
        toast({
          title: "Not scheduled yet",
          description: "This patient has no resolved clinic/identity, so the appointment was deferred. Select a clinic or complete the patient record.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Scheduled",
        description: `${selectedService?.displayName ?? serviceCode} for ${patient.name ?? "patient"} on ${prettyDateLong(selectedDate)} at ${prettyTime(time)}.`,
      });
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

  // ── Calendar cells ──
  const monthCells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const lead = first.getDay();
    const lastDate = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const cells: Array<{ iso: string | null; day: number | null }> = [];
    for (let i = 0; i < lead; i++) cells.push({ iso: null, day: null });
    for (let d = 1; d <= lastDate; d++) cells.push({ iso: isoOf(cursor.y, cursor.m, d), day: d });
    while (cells.length % 7 !== 0) cells.push({ iso: null, day: null });
    return cells;
  }, [cursor]);
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  const today = todayIso();

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const total = c.y * 12 + c.m + delta;
      return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 };
    });
  }
  function goToday() {
    const d = new Date();
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
    setSelectedDate(todayIso());
  }

  const title = hasPatient && patient.name ? `Schedule — ${patient.name}` : "Schedule";

  // ── Service selector (shared by full + compact) ──
  const serviceSelector = (
    <div data-testid="scheduler-service-selector">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Appointment Type</div>
      {servicesLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading services…</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            {brainwave && (
              <button
                type="button"
                onClick={() => { setServiceCode(brainwave.internalCode); setUltrasoundOpen(false); }}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${serviceCode === brainwave.internalCode ? "border-violet-400 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                data-testid="scheduler-service-brainwave"
              >
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-violet-500 align-middle" />
                BrainWave
              </button>
            )}
            {vitalwave && (
              <button
                type="button"
                onClick={() => { setServiceCode(vitalwave.internalCode); setUltrasoundOpen(false); }}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${serviceCode === vitalwave.internalCode ? "border-red-400 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                data-testid="scheduler-service-vitalwave"
              >
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-500 align-middle" />
                VitalWave
              </button>
            )}
          </div>
          {/* Ultrasound — one dropdown of all active configured studies. */}
          {ultrasound.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setUltrasoundOpen((v) => !v)}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${selectedIsUltrasound ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                data-testid="scheduler-service-ultrasound"
                aria-expanded={ultrasoundOpen}
              >
                <span className="flex items-center gap-1.5 truncate">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  {selectedIsUltrasound ? selectedService!.displayName : "Ultrasound"}
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${ultrasoundOpen ? "rotate-180" : ""}`} />
              </button>
              {ultrasoundOpen && (
                <div
                  className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                  data-testid="scheduler-ultrasound-menu"
                >
                  {ultrasound.map((u) => (
                    <button
                      key={u.internalCode}
                      type="button"
                      onClick={() => { setServiceCode(u.internalCode); setUltrasoundOpen(false); }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-emerald-50 ${serviceCode === u.internalCode ? "text-emerald-700" : "text-slate-700"}`}
                      data-testid={`scheduler-ultrasound-option-${u.internalCode}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{u.displayName}</span>
                        {u.cptCode ? <span className="block text-[10px] text-slate-400">CPT {u.cptCode}</span> : null}
                      </span>
                      {serviceCode === u.internalCode ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── Time slots (shared) ──
  const timeSlots = (
    <div data-testid="scheduler-time-slots">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Available Times</div>
      <div className="grid grid-cols-4 gap-1.5">
        {TIME_SLOTS.map((slot) => (
          <button
            key={slot}
            type="button"
            onClick={() => setTime(slot)}
            className={`rounded-lg border px-1 py-1.5 text-[12px] font-medium tabular-nums transition-colors ${time === slot ? "border-transparent bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
            data-testid={`scheduler-slot-${slot}`}
          >
            {prettyTime(slot)}
          </button>
        ))}
      </div>
    </div>
  );

  // ── Patient block (summary or search) ──
  const patientBlock = (
    <div data-testid="scheduler-patient-block">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Patient</div>
      {hasPatient ? (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-700">
              {(patient.name ?? "?").split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || <User className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900" data-testid="scheduler-patient-name">{patient.name ?? "Patient"}</div>
              <div className="truncate text-[11px] text-slate-500">
                {patient.dob ? `DOB ${patient.dob}` : null}
                {facility ? `${patient.dob ? " · " : ""}${facility}` : null}
              </div>
            </div>
          </div>
          {/* Allow changing the patient (clears context selection). */}
          <button
            type="button"
            onClick={() => { setPatient({ patientScreeningId: null, executionCaseId: null, name: null, dob: null, facility }); setPatientSearch(""); }}
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="Change patient"
            data-testid="scheduler-change-patient"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              placeholder="Search patient…"
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
              data-testid="scheduler-patient-search"
              autoFocus={!hasPatient}
            />
          </div>
          {searchTerm.length >= 2 && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white" data-testid="scheduler-patient-results">
              {searching ? (
                <div className="px-3 py-2 text-xs italic text-slate-400">Searching…</div>
              ) : matches.length === 0 ? (
                <div className="px-3 py-2 text-xs italic text-slate-400">No patients found.</div>
              ) : (
                matches.map((m) => (
                  <button
                    key={m.patientScreeningId}
                    type="button"
                    onClick={() => setPatient({ patientScreeningId: m.patientScreeningId, executionCaseId: null, name: m.name, dob: m.dob, facility: m.facility ?? facility })}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-slate-50"
                    data-testid={`scheduler-patient-result-${m.patientScreeningId}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-800">{m.name}</span>
                      <span className="block truncate text-[10px] text-slate-400">{m.facility ?? "—"}{m.dob ? ` · DOB ${m.dob}` : ""}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const scheduleButton = (
    <button
      type="button"
      disabled={!canSubmit || scheduleMutation.isPending}
      onClick={() => scheduleMutation.mutate()}
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
      data-testid="scheduler-submit"
    >
      {scheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
      Schedule
    </button>
  );

  // Full scheduler — calendar (left ~65%) + panel (right ~35%). Sized to fit
  // the workspace viewport without page scroll (min-h-0 + internal overflow on
  // the panel only if truly needed).
  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent" data-testid="unified-scheduler">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-slate-500" />
          <span className="text-lg font-bold text-slate-900" data-testid="scheduler-title">{title}</span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 px-5 pb-5 lg:grid-cols-[1.9fr_1fr]">
        {/* Calendar — sized to fill available height, no page scroll. */}
        <div className="relative flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-4" data-testid="scheduler-calendar">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-base font-semibold text-slate-900" data-testid="scheduler-month-label">{monthLabel}</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={goToday} className="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100" data-testid="scheduler-today">Today</button>
              <button type="button" onClick={() => shiftMonth(-1)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="Previous month" data-testid="scheduler-prev-month"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" onClick={() => shiftMonth(1)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="Next month" data-testid="scheduler-next-month"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[11px] font-semibold uppercase text-slate-400">
            {WEEKDAYS.map((d) => <div key={d}>{d}</div>)}
          </div>
          {/* Grid fills remaining height; rows share it so a 6-row month never scrolls. */}
          <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1">
            {monthCells.map((c, i) => {
              if (!c.iso) return <div key={`pad-${i}`} aria-hidden />;
              const isSelected = c.iso === selectedDate;
              const isToday = c.iso === today;
              const dots = dayCells[c.iso]?.dots ?? [];
              return (
                <button
                  key={c.iso}
                  type="button"
                  onClick={() => { setSelectedDate(c.iso!); setTime(""); }}
                  onDoubleClick={() => { setSelectedDate(c.iso!); setTime(""); setQuickDate(c.iso!); }}
                  className={`flex min-h-0 flex-col items-center justify-center rounded-lg border text-sm transition-colors ${
                    isSelected ? "border-transparent bg-slate-900 text-white" : isToday ? "border-slate-300 bg-slate-50 text-slate-900" : "border-slate-100 text-slate-700 hover:bg-slate-50"
                  }`}
                  title="Click to select · double-click for Quick Schedule"
                  data-testid={`scheduler-day-${c.iso}`}
                >
                  <span className="font-semibold leading-none">{c.day}</span>
                  {dots.length > 0 && (
                    <span className="mt-1 flex items-center gap-[3px]" data-testid={`scheduler-day-dots-${c.iso}`}>
                      {dots.slice(0, 3).map((d, di) => <span key={di} className={`h-1.5 w-1.5 rounded-full ${d.className}`} title={d.title} />)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Quick Schedule popover — opened by DOUBLE-CLICKING a date. Compact,
              overlays the calendar, completes inline (no second scheduler). */}
          {quickDate && (
            <>
              <div
                className="absolute inset-0 z-30 rounded-2xl bg-slate-900/10"
                onClick={() => setQuickDate(null)}
                aria-hidden
              />
              <div
                className="absolute left-1/2 top-1/2 z-40 w-[320px] max-w-[92%] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
                data-testid="scheduler-quick-popover"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quick Schedule</span>
                  <button
                    type="button"
                    onClick={() => setQuickDate(null)}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    data-testid="scheduler-quick-close"
                    aria-label="Close quick schedule"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {/* Reuse the SAME scheduler fields in compact form. Since the
                    surrounding scheduler already holds patient/service/time
                    state, the popover shares it and completes via the same
                    Schedule action. */}
                <div className="flex flex-col gap-3">
                  <div className="text-sm font-semibold text-slate-900">{prettyDateLong(quickDate)}</div>
                  {patientBlock}
                  {serviceSelector}
                  {timeSlots}
                  <button
                    type="button"
                    disabled={!canSubmit || scheduleMutation.isPending}
                    onClick={() => scheduleMutation.mutate(undefined, { onSuccess: () => setQuickDate(null) })}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                    data-testid="scheduler-quick-submit"
                  >
                    {scheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
                    Schedule
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Scheduling panel — internal overflow fallback only. */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4" data-testid="scheduler-panel">
          {patientBlock}
          {serviceSelector}
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Date</div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700" data-testid="scheduler-selected-date">{prettyDateLong(selectedDate)}</div>
          </div>
          {timeSlots}
          <div className="mt-auto pt-1">{scheduleButton}</div>
        </div>
      </div>
    </div>
  );
}
