// Unified capacity-aware Scheduler (full + quick popover share this component).
//
// SIMPLE MODEL:
//   • ONE month calendar on the left. Patient name on top.
//   • Add an ancillary from ONE dropdown (BrainWave, VitalWave, and each
//     ultrasound study individually — ultrasounds are scheduled separately).
//   • Picking an ancillary makes it ACTIVE: the calendar + Available Times +
//     duration + capacity + the SUGGESTED time all reflect that one ancillary.
//   • Pick a date (calendar) + a time (grid) → the time HIGHLIGHTS (pending).
//     Click "Schedule <ancillary>" to add it to the plan. Nothing writes yet.
//   • Repeat for the next ancillary — a different date/time is fine. The plan
//     accumulates across multiple dates.
//   • "Review & Confirm" writes the whole plan through the ONE grouped,
//     multi-date /api/scheduling/visit endpoint (shared visitGroupId).
//   • Capacity / off-day conflicts are SOFT — an authorized user overrides with
//     a reason.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Search,
  User,
  X,
  Loader2,
  Check,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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
import {
  fetchAvailability,
  pretty12h,
  type AvailabilityResult,
  type ResourceType as CapResourceType,
  type ServiceRequest as CapServiceRequest,
  type SoftConstraint,
} from "@/lib/scheduling/availabilityApi";

// ─── helpers ────────────────────────────────────────────────────────────────
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function pad2(n: number) { return String(n).padStart(2, "0"); }
function isoOf(y: number, m: number, d: number) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }
function prettyDateLong(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
function weekdayOf(iso: string): number {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? -1 : d.getDay();
}
function prettyDateShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function hmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}
function minToHm(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}
let __seq = 0;
function nextKey(): string { __seq += 1; return `p${__seq}_${Date.now().toString(36)}`; }

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

type OverrideMeta = { constraint: SoftConstraint; reason: string; category: string | null };

// One schedulable ancillary option (from the registry / qualification).
type Ancillary = { code: string; displayName: string; resourceType: CapResourceType; qualified: boolean };

// One committed line in the client plan. Each ancillary owns its OWN date/time.
type PlanItem = {
  key: string;
  code: string;
  displayName: string;
  resourceType: CapResourceType;
  isoDate: string;
  time: string;
  startMinutes: number;
  durationMin: number;
  override?: OverrideMeta | null;
};

type PatientQualification = {
  screeningId: number;
  patientName: string | null;
  facility: string | null;
  services: Array<{
    rawTest: string;
    internalCode: string;
    displayName: string;
    resourceType: CapResourceType | "other";
    cptCode: string | null;
    adminReviewStatus: string | null;
  }>;
  adminReviewSummary: "approved" | "pending" | "partially_reviewed" | "not_reviewed";
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RESOURCE_LABELS: Record<string, string> = { brainwave: "BrainWave", vitalwave: "VitalWave", ultrasound: "Ultrasound" };
const RESOURCE_DOT: Record<string, string> = { brainwave: "bg-violet-500", vitalwave: "bg-rose-600", ultrasound: "bg-emerald-600" };
const OVERRIDE_CATEGORIES = [
  "machine available despite capacity model",
  "special clinic day",
  "provider/management request",
  "patient circumstance",
  "operational adjustment",
  "other",
];

export function UnifiedScheduler({ context }: { context: UnifiedSchedulerContext }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const facility = context.facility ?? null;

  const [patient, setPatient] = useState<SelectedPatient>(() => ({
    patientScreeningId: context.patientScreeningId ?? null,
    executionCaseId: context.executionCaseId ?? null,
    name: context.patientName ?? null,
    dob: context.patientDob ?? null,
    facility: context.facility ?? null,
  }));
  const hasPatient = !!patient.name || patient.patientScreeningId != null;

  const [selectedDate, setSelectedDate] = useState<string>(
    context.initialDate && /^\d{4}-\d{2}-\d{2}$/.test(context.initialDate) ? context.initialDate : todayIso(),
  );
  const [time, setTime] = useState<string>(context.initialTime ?? "");
  // The ancillary currently being scheduled (drives calendar + times). null ⇒
  // nothing active (pick one from the dropdown).
  const [active, setActive] = useState<Ancillary | null>(null);
  // The client plan — each item is one ancillary at its OWN date/time.
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [equipmentOpen, setEquipmentOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [quickDate, setQuickDate] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastScheduled, setLastScheduled] = useState<{ label: string; isoDate: string; time: string } | null>(null);
  const [overrideCtx, setOverrideCtx] = useState<{ constraint: SoftConstraint; time: string; message: string } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideCategory, setOverrideCategory] = useState("");

  const [cursor, setCursor] = useState(() => {
    const d = new Date(`${selectedDate}T00:00:00`);
    const base = Number.isNaN(d.getTime()) ? new Date() : d;
    return { y: base.getFullYear(), m: base.getMonth() };
  });

  // Close the ancillary dropdown on outside-click / Escape.
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setMenuOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  // ── Registry services for this facility ──
  const { data: services = [], isLoading: servicesLoading } = useQuery<RegistryService[]>({
    queryKey: ["service-registry-by-facility", facility],
    queryFn: () => fetchActiveServicesForFacility(facility),
    staleTime: 5 * 60_000,
  });
  const { brainwave, vitalwave, ultrasound } = useMemo(() => bucketServices(services), [services]);

  // ── Plexus IQ qualification (patient context) — used to order/flag options ──
  const { data: qualification } = useQuery<PatientQualification>({
    queryKey: ["scheduler-qualification", patient.patientScreeningId],
    queryFn: async () => {
      const res = await fetch(`/api/scheduling/patient-qualification/${patient.patientScreeningId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Qualification failed (${res.status})`);
      return res.json();
    },
    enabled: patient.patientScreeningId != null,
    staleTime: 60_000,
  });
  const qualifiedCodes = useMemo(
    () => new Set((qualification?.services ?? []).filter((s) => s.resourceType !== "other").map((s) => s.internalCode)),
    [qualification],
  );

  // ── The flat list of schedulable ancillaries for the dropdown ──
  // Ultrasound studies are individual options (scheduled separately). Qualified
  // ancillaries (patient context) are listed first.
  const ancillaryOptions = useMemo<Ancillary[]>(() => {
    const opts: Ancillary[] = [];
    if (brainwave) opts.push({ code: brainwave.internalCode, displayName: "BrainWave", resourceType: "brainwave", qualified: qualifiedCodes.has(brainwave.internalCode) });
    if (vitalwave) opts.push({ code: vitalwave.internalCode, displayName: "VitalWave", resourceType: "vitalwave", qualified: qualifiedCodes.has(vitalwave.internalCode) });
    for (const u of ultrasound) opts.push({ code: u.internalCode, displayName: u.displayName, resourceType: "ultrasound", qualified: qualifiedCodes.has(u.internalCode) });
    // Qualified first (only meaningful when a patient is loaded).
    return hasPatient ? [...opts].sort((a, b) => Number(b.qualified) - Number(a.qualified)) : opts;
  }, [brainwave, vitalwave, ultrasound, qualifiedCodes, hasPatient]);

  const patientKey =
    patient.patientScreeningId != null ? `ps:${patient.patientScreeningId}`
      : patient.executionCaseId != null ? `ec:${patient.executionCaseId}` : null;

  const plannedCodes = useMemo(() => new Set(plan.map((p) => p.code)), [plan]);

  // ── Active-ancillary availability request (the ONE engine) ──
  const activeRequest: CapServiceRequest | null = !active
    ? null
    : active.resourceType === "ultrasound"
      ? { resourceType: "ultrasound", studyCount: 1 } // each ultrasound study scheduled on its own
      : { resourceType: active.resourceType };
  const activeResourceType: CapResourceType | null = active ? active.resourceType : null;

  const activeServices: CapServiceRequest[] = activeRequest ? [activeRequest] : [];
  const { data: availability } = useQuery<AvailabilityResult>({
    queryKey: [
      "scheduler-availability", facility, selectedDate,
      activeServices.map((s) => `${s.resourceType}:${s.studyCount ?? 1}`).join("|"),
      patientKey ?? "",
    ],
    queryFn: () => fetchAvailability({ facility, date: selectedDate, services: activeServices, patientKey, preferredTime: time || null }),
    enabled: !!facility && activeServices.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate),
    staleTime: 10_000,
  });
  const slots = availability?.slots ?? [];
  const agenda = availability?.agenda ?? [];
  const equipment = availability?.equipment ?? [];
  const operatingDays = availability?.operatingDays ?? [];
  const durations = availability?.durations ?? {};

  const activeOpDay = activeResourceType ? operatingDays.find((o) => o.resourceType === activeResourceType) ?? null : null;
  const activeIsOffDay = !!activeOpDay && !activeOpDay.isOperatingToday;
  const activeDurationMin = activeResourceType ? durations[activeResourceType] ?? null : null;

  // ── Calendar dots ──
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

  // ── Calendar eligibility — the ACTIVE ancillary ONLY (never an intersection) ──
  const operatingDaysByResource = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const o of operatingDays) m.set(o.resourceType, o.days);
    return m;
  }, [operatingDays]);
  function isNormalDay(iso: string): boolean {
    if (!activeResourceType || operatingDays.length === 0) return true;
    const days = operatingDaysByResource.get(activeResourceType) ?? [];
    if (days.length === 0) return true;
    return days.includes(weekdayOf(iso));
  }

  // ── Patient search ──
  const searchTerm = patientSearch.trim();
  const { data: matches = [], isFetching: searching } = useQuery<PatientSearchRow[]>({
    queryKey: ["scheduler-patient-search", searchTerm, facility],
    queryFn: () => searchPatients({ query: searchTerm, facility: facility ?? undefined, limit: 20 }),
    enabled: !hasPatient && searchTerm.length >= 2,
  });

  // ── Existing appointments the patient already has on the selected date ──
  const existingOnSelectedDate = useMemo(() => {
    const m = new Map<string, { time: string }>();
    if (!patient.name) return m;
    for (const a of agenda) { if (a.patient !== patient.name) continue; if (!m.has(a.resourceType)) m.set(a.resourceType, { time: a.time }); }
    return m;
  }, [agenda, patient.name]);

  // ── Suggested time for the ACTIVE ancillary (client-side smart hint) ──
  const suggestion = useMemo(() => {
    if (!activeRequest) return null;
    const fitting = slots.filter((s) => s.fits);
    if (fitting.length === 0) return null;
    // Prefer a time right after this patient's last planned block on this date.
    const sameDayEnds = plan
      .filter((b) => b.isoDate === selectedDate)
      .map((b) => b.startMinutes + b.durationMin);
    if (sameDayEnds.length > 0) {
      const after = Math.max(...sameDayEnds);
      const seq = fitting.find((s) => s.startMinutes >= after);
      if (seq) return { time: seq.time, reason: "Right after the previous appointment" };
    }
    return { time: fitting[0].time, reason: sameDayEnds.length > 0 ? "Next open time" : "Earliest available" };
  }, [activeRequest, slots, plan, selectedDate]);

  // ── Select an ancillary from the dropdown → make it active ──
  function pickAncillary(a: Ancillary) {
    setActive(a);
    setLastScheduled(null);
    setMenuOpen(false);
    // If it's already in the plan, load its date/time for editing; else clear.
    const existing = plan.find((p) => p.code === a.code);
    if (existing) { setSelectedDate(existing.isoDate); setTime(existing.time); }
    else setTime("");
  }

  // ── Click a time = SELECT only (pending highlight). Never commits. ──
  function onPickSlot(slot: { time: string }) {
    if (!activeRequest) return;
    setLastScheduled(null);
    setTime(slot.time);
  }

  // ── Explicit commit of the pending selection into the plan ──
  function commit(at: { time: string; startMinutes?: number }, override?: OverrideMeta | null) {
    if (!active) return;
    const startMinutes = at.startMinutes ?? hmToMin(at.time);
    const durationMin = activeDurationMin ?? 0;
    setPlan((prev) => {
      const next = prev.filter((p) => p.code !== active.code); // one entry per ancillary (re-schedule replaces)
      next.push({ key: nextKey(), code: active.code, displayName: active.displayName, resourceType: active.resourceType, isoDate: selectedDate, time: at.time, startMinutes, durationMin, override: override ?? null });
      return next;
    });
    setLastScheduled({ label: active.displayName, isoDate: selectedDate, time: at.time });
    setActive(null); // back to the dropdown to pick the NEXT ancillary
    setTime("");
  }

  function scheduleActive() {
    if (!active || !time) return;
    const slot = slots.find((s) => s.time === time) ?? null;
    if (slot && !slot.fits) {
      setOverrideCtx({
        constraint: slot.constraint ?? "full",
        time,
        message:
          slot.constraint === "off_day" ? `${active.displayName} is not normally scheduled on ${prettyDateLong(selectedDate)}.`
            : slot.constraint === "outage" ? `${active.displayName} is unavailable (equipment outage) at ${pretty12h(time)}.`
              : `${active.displayName} is at capacity at ${pretty12h(time)}.`,
      });
      return;
    }
    commit({ time, startMinutes: slot?.startMinutes });
  }

  function confirmOverride() {
    if (!overrideCtx || !overrideReason.trim()) return;
    commit({ time: overrideCtx.time, startMinutes: hmToMin(overrideCtx.time) }, { constraint: overrideCtx.constraint, reason: overrideReason.trim(), category: overrideCategory || null });
    setOverrideCtx(null); setOverrideReason(""); setOverrideCategory("");
  }

  function removePlanItem(key: string) { setPlan((prev) => prev.filter((p) => p.key !== key)); }
  function editPlanItem(item: PlanItem) {
    setActive({ code: item.code, displayName: item.displayName, resourceType: item.resourceType, qualified: qualifiedCodes.has(item.code) });
    setSelectedDate(item.isoDate);
    setTime(item.time);
    setLastScheduled(null);
    const d = new Date(`${item.isoDate}T00:00:00`);
    if (!Number.isNaN(d.getTime())) setCursor({ y: d.getFullYear(), m: d.getMonth() });
  }

  // ── Write mapping → existing grouped multi-date endpoint ──
  type WriteGroup = {
    date: string;
    services: Array<{ serviceType: string; time: string }>;
    overrides?: Record<string, { constraint: SoftConstraint; reason: string; category?: string | null; capacityState?: Record<string, unknown> }>;
  };
  function buildGroups(): WriteGroup[] {
    const byDate = new Map<string, WriteGroup>();
    const get = (date: string) => { let g = byDate.get(date); if (!g) { g = { date, services: [] }; byDate.set(date, g); } return g; };
    for (const item of plan) {
      const g = get(item.isoDate);
      g.services.push({ serviceType: item.code, time: item.time });
      if (item.override) (g.overrides ??= {})[item.code] = { constraint: item.override.constraint, reason: item.override.reason, category: item.override.category, capacityState: { operatingDays } };
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  const scheduleMutation = useMutation({
    mutationFn: async (groups: WriteGroup[]) => {
      if (groups.length === 0) throw new Error("Nothing to schedule");
      const res = await fetch("/api/scheduling/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          facility,
          patientScreeningId: patient.patientScreeningId ?? null,
          executionCaseId: patient.executionCaseId ?? null,
          patientName: patient.patientScreeningId == null ? patient.name : null,
          patientDob: patient.patientScreeningId == null ? patient.dob : null,
          groups,
        }),
      });
      const body = await res.json();
      if (!res.ok && res.status !== 200) throw new Error(body?.error ?? `Visit scheduling failed (${res.status})`);
      return body as {
        overall: "all_scheduled" | "partial" | "failed";
        scheduledCount: number; totalCount: number; dates: string[]; visitGroupId?: string;
        services: Array<{ date: string; serviceType: string; status: string; error?: string }>;
      };
    },
    onSuccess: (result) => {
      invalidateTeamPortalScheduleQueries(queryClient, { facility, selectedDate, patientScreeningId: patient.patientScreeningId ?? null });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches/calendar-summary"] });
      queryClient.invalidateQueries({ queryKey: ["scheduler-availability"] });
      if (result.overall === "all_scheduled") {
        const dateNote = result.dates && result.dates.length > 1 ? ` across ${result.dates.length} dates` : "";
        toast({ title: "Scheduled", description: `${result.scheduledCount} appointment${result.scheduledCount === 1 ? "" : "s"} scheduled for ${patient.name ?? "patient"}${dateNote}.` });
        setTime(""); setActive(null); setPlan([]); setConfirmOpen(false); setQuickDate(null);
        setOverrideCtx(null); setOverrideReason(""); setOverrideCategory(""); setLastScheduled(null);
      } else if (result.overall === "partial") {
        const failed = result.services.filter((s) => s.status !== "scheduled").map((s) => s.serviceType);
        toast({ title: "Partially scheduled", description: `${result.scheduledCount} of ${result.totalCount} scheduled. Not scheduled: ${failed.join(", ")}.`, variant: "destructive" });
        setConfirmOpen(false);
      } else {
        toast({ title: "Not scheduled", description: result.services.map((s) => s.error).filter(Boolean).join("; ") || "No appointments could be scheduled.", variant: "destructive" });
      }
    },
    onError: (err: unknown) => {
      toast({ title: "Could not schedule", description: err instanceof Error ? err.message : "Schedule write failed.", variant: "destructive" });
    },
  });
  function confirmVisit() { const g = buildGroups(); if (g.length === 0) return; scheduleMutation.mutate(g); }

  // ── Month grid ──
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
  function shiftMonth(delta: number) { setCursor((c) => { const total = c.y * 12 + c.m + delta; return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 }; }); }
  function goToday() { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }); setSelectedDate(todayIso()); }

  const title = hasPatient && patient.name ? `Schedule — ${patient.name}` : "Schedule";

  const reviewTag = (() => {
    if (patient.patientScreeningId == null || !qualification) return null;
    const s = qualification.adminReviewSummary;
    const label = s === "approved" ? "Admin Review: Complete" : s === "partially_reviewed" ? "Admin reviewed — needs attention" : "Admin Review: Pending";
    const tone = s === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : s === "partially_reviewed" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-600";
    return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`} data-testid="scheduler-admin-review-tag">{label}</span>;
  })();

  // ── Patient block ──
  const patientBlock = (
    <div data-testid="scheduler-patient-block">
      {hasPatient ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-700">
              {(patient.name ?? "?").split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || <User className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900" data-testid="scheduler-patient-name">{patient.name ?? "Patient"}</div>
              <div className="truncate text-[11px] text-slate-500">{patient.dob ? `DOB ${patient.dob}` : null}{facility ? `${patient.dob ? " · " : ""}${facility}` : null}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {reviewTag}
            <button type="button" onClick={() => { setPatient({ patientScreeningId: null, executionCaseId: null, name: null, dob: null, facility }); setPatientSearch(""); setPlan([]); setActive(null); setTime(""); setLastScheduled(null); }} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Change patient" data-testid="scheduler-change-patient">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} placeholder="Search patient…" className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300" data-testid="scheduler-patient-search" autoFocus={!hasPatient} />
          </div>
          {searchTerm.length >= 2 && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white" data-testid="scheduler-patient-results">
              {searching ? (<div className="px-3 py-2 text-xs italic text-slate-400">Searching…</div>)
                : matches.length === 0 ? (<div className="px-3 py-2 text-xs italic text-slate-400">No patients found.</div>)
                  : (matches.map((m) => (
                    <button key={m.patientScreeningId} type="button" onClick={() => { setPatient({ patientScreeningId: m.patientScreeningId, executionCaseId: null, name: m.name, dob: m.dob, facility: m.facility ?? facility }); setPlan([]); setActive(null); setTime(""); }} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-slate-50" data-testid={`scheduler-patient-result-${m.patientScreeningId}`}>
                      <span className="min-w-0"><span className="block truncate text-sm text-slate-800">{m.name}</span><span className="block truncate text-[10px] text-slate-400">{m.facility ?? "—"}{m.dob ? ` · DOB ${m.dob}` : ""}</span></span>
                    </button>
                  )))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── Ancillary dropdown ──
  const anyQualified = ancillaryOptions.some((a) => a.qualified);
  const ancillaryDropdown = (
    <div className="relative" ref={menuRef} data-testid="scheduler-ancillary">
      {servicesLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
      ) : (
        <>
          <button type="button" onClick={() => setMenuOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            data-testid="scheduler-choose-ancillary" aria-expanded={menuOpen}>
            <span className="flex items-center gap-1.5"><Plus className="h-4 w-4 text-slate-400" /> {active ? active.displayName : "Add appointment"}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
          </button>
          {menuOpen && (
            <div className="absolute z-30 mt-1 max-h-[60vh] w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg" data-testid="scheduler-ancillary-menu">
              {ancillaryOptions.length === 0 ? <div className="px-3 py-2 text-xs italic text-slate-400">No appointment types available.</div> : null}
              {ancillaryOptions.map((a) => {
                const scheduled = plannedCodes.has(a.code);
                const testId = a.resourceType === "ultrasound" ? `scheduler-pick-${a.code}` : `scheduler-pick-${a.resourceType}`;
                return (
                  <button key={a.code} type="button" onClick={() => pickAncillary(a)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-slate-50 ${active?.code === a.code ? "bg-slate-50 text-slate-900" : "text-slate-700"}`}
                    data-testid={testId}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RESOURCE_DOT[a.resourceType]}`} />
                      <span className="truncate">{a.displayName}</span>
                      {hasPatient && a.qualified ? <Sparkles className="h-3 w-3 shrink-0 text-indigo-400" aria-label="Qualified by Plexus IQ" /> : null}
                    </span>
                    {scheduled ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" data-testid={`scheduler-pick-scheduled-${a.code}`} /> : null}
                  </button>
                );
              })}
            </div>
          )}
          {hasPatient && anyQualified ? (
            <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-indigo-500" data-testid="scheduler-plexus-hint"><Sparkles className="h-3 w-3" /> ✦ = qualified by Plexus IQ</div>
          ) : null}
        </>
      )}
    </div>
  );

  // ── Active-ancillary indicator (near Available Times) ──
  const activeIndicator = active ? (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500" data-testid="scheduler-active-service">
      <span className={`h-2 w-2 rounded-full ${RESOURCE_DOT[active.resourceType]}`} />
      {active.displayName}{activeDurationMin ? ` · ${activeDurationMin} min` : ""}
    </span>
  ) : null;

  // ── Time grid ──
  const timeGrid = !activeRequest ? (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs italic text-slate-400" data-testid="scheduler-times-empty">Add an appointment above to see available times.</p>
  ) : slots.length === 0 ? (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs italic text-slate-400">Loading availability…</p>
  ) : (
    <div className="grid grid-cols-4 gap-1.5" data-testid="scheduler-time-slots">
      {slots.map((slot) => {
        const isSel = time === slot.time;
        const offDay = slot.constraint === "off_day";
        const full = slot.constraint === "full" || slot.constraint === "outage";
        return (
          <button key={slot.time} type="button" onClick={() => onPickSlot(slot)}
            className={`relative flex items-center justify-center gap-1 rounded-lg border px-1 py-1.5 text-center text-[12px] font-medium tabular-nums transition-colors ${
              isSel ? "border-slate-900 bg-slate-900 text-white ring-2 ring-slate-900/20"
                : full ? "border-red-100 bg-red-50/50 text-red-400 hover:bg-red-100"
                  : offDay ? "border-amber-100 bg-amber-50/50 text-amber-500 hover:bg-amber-100"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
            title={full ? "At capacity — selecting will prompt an override" : offDay ? "Not a normal service day — selecting will prompt an override" : undefined}
            data-testid={`scheduler-slot-${slot.time}`} aria-pressed={isSel}>
            <span className="leading-none">{pretty12h(slot.time)}</span>
            {isSel ? <Check className="h-3 w-3 shrink-0" data-testid={`scheduler-slot-selected-${slot.time}`} /> : null}
            {full && !isSel ? <span className="text-[8px] font-semibold uppercase text-red-400" data-testid={`scheduler-slot-full-${slot.time}`}>full</span> : null}
          </button>
        );
      })}
    </div>
  );

  // ── Off-day banner + its OWN next eligible day (suggested scheduling) ──
  const offDayBanner = activeIsOffDay && activeOpDay && active ? (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800" data-testid="scheduler-offday-banner">
      <div className="flex items-start gap-1.5">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          {active.displayName} isn’t normally scheduled on {WEEKDAYS[weekdayOf(selectedDate)] ?? "this day"}s.
          {activeOpDay.nextEligibleDay ? (
            <div className="mt-1">
              <button type="button" onClick={() => { setSelectedDate(activeOpDay.nextEligibleDay!); setTime(""); const d = new Date(`${activeOpDay.nextEligibleDay!}T00:00:00`); if (!Number.isNaN(d.getTime())) setCursor({ y: d.getFullYear(), m: d.getMonth() }); }} className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-semibold text-amber-700 hover:bg-amber-100" data-testid="scheduler-offday-choose-next">
                Use {prettyDateLong(activeOpDay.nextEligibleDay)}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  // ── Suggested time (kept) — populates the pending time, does NOT commit ──
  const suggestionBlock = active && !time && suggestion ? (
    <button type="button" onClick={() => { setLastScheduled(null); setTime(suggestion.time); }}
      className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:bg-slate-50"
      data-testid="scheduler-recommended-use">
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Suggested</span>
        <span className="block text-sm font-semibold text-slate-900">{pretty12h(suggestion.time)}</span>
        <span className="block truncate text-[11px] text-slate-500">{suggestion.reason}</span>
      </span>
      <span className="shrink-0 rounded-full border border-slate-300 px-2 py-0.5 text-[9px] font-semibold uppercase text-slate-600">Use</span>
    </button>
  ) : null;

  // ── Selected (pending) appointment + explicit Schedule button ──
  const pendingSlot = activeRequest && time ? slots.find((s) => s.time === time) ?? null : null;
  const pendingConflict = !!pendingSlot && !pendingSlot.fits;
  const pendingEnd = time && activeDurationMin ? minToHm(hmToMin(time) + activeDurationMin) : null;
  const alreadyScheduled = !!active && plannedCodes.has(active.code);
  const selectedBlock = active && time ? (
    <div className={`rounded-lg border px-3 py-2.5 ${pendingConflict ? "border-red-200 bg-red-50" : "border-slate-300 bg-slate-50"}`} data-testid="scheduler-selected-appointment">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Selected</div>
      <div className="mt-0.5 flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${RESOURCE_DOT[active.resourceType]}`} />
        <span className="text-sm font-semibold text-slate-900">{active.displayName}</span>
      </div>
      <div className="text-[12px] text-slate-600">{prettyDateLong(selectedDate)}</div>
      <div className="text-[13px] font-semibold tabular-nums text-slate-900" data-testid="scheduler-selected-time">{pretty12h(time)}{pendingEnd ? `–${pretty12h(pendingEnd)}` : ""}</div>
      {pendingConflict ? (
        <div className="mt-1 text-[11px] font-medium text-red-700" data-testid="scheduler-selected-conflict">
          {pendingSlot?.constraint === "off_day" ? "Not a normal service day." : pendingSlot?.constraint === "outage" ? "Equipment outage." : "At capacity."} An override reason is required.
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={() => setTime("")} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-100" data-testid="scheduler-selected-change">Clear</button>
        <button type="button" disabled={scheduleMutation.isPending} onClick={scheduleActive} className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white ${pendingConflict ? "bg-amber-600 hover:bg-amber-700" : "bg-slate-900 hover:bg-slate-800"}`} data-testid="scheduler-schedule-active">
          <Check className="h-3.5 w-3.5" /> {pendingConflict ? "Override & Schedule" : alreadyScheduled ? "Update time" : `Schedule ${active.displayName}`}
        </button>
      </div>
    </div>
  ) : null;

  // ── Success line (what was just added) ──
  const successBlock = lastScheduled && !active && !time ? (
    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800" data-testid="scheduler-scheduled-success">
      <Check className="h-4 w-4 shrink-0 text-emerald-600" />
      <span><span className="font-semibold">{lastScheduled.label}</span> · {prettyDateShort(lastScheduled.isoDate)} · {pretty12h(lastScheduled.time)} — add another below.</span>
    </div>
  ) : null;

  // ── Scheduled list (the plan — multiple ancillaries across multiple dates) ──
  const sortedPlan = useMemo(() => [...plan].sort((a, b) => a.isoDate.localeCompare(b.isoDate) || a.startMinutes - b.startMinutes), [plan]);
  const planList = plan.length > 0 ? (
    <div data-testid="scheduler-plan">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-700">Scheduled ({plan.length})</div>
      <div className="flex flex-col gap-1">
        {sortedPlan.map((item) => (
          <div key={item.key} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-1.5 text-[12px]" data-testid={`scheduler-plan-item-${item.code}`}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RESOURCE_DOT[item.resourceType]}`} />
            <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{item.displayName}</span>
            <span className="shrink-0 tabular-nums text-slate-500">{prettyDateShort(item.isoDate)} · {pretty12h(item.time)}</span>
            {item.override ? <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" aria-label="Override" /> : null}
            <button type="button" onClick={() => editPlanItem(item)} className="shrink-0 rounded px-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800" data-testid={`scheduler-plan-edit-${item.code}`}>Edit</button>
            <button type="button" onClick={() => removePlanItem(item.key)} className="shrink-0 rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600" title="Remove" data-testid={`scheduler-plan-remove-${item.code}`}><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const canConfirm = hasPatient && plan.length > 0;
  const scheduleButton = (
    <button type="button" disabled={!canConfirm || scheduleMutation.isPending} onClick={() => setConfirmOpen(true)} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400" data-testid="scheduler-submit">
      {scheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
      Review &amp; Confirm{plan.length > 0 ? ` (${plan.length})` : ""}
    </button>
  );

  // ── Equipment (compact, on demand) ──
  const anyOffToday = operatingDays.some((o) => !o.isOperatingToday);
  const equipmentControl = equipment.length > 0 ? (
    <div className="relative">
      <button type="button" onClick={() => setEquipmentOpen((v) => !v)} className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-slate-600" data-testid="scheduler-equipment-toggle">
        Equipment{anyOffToday ? <span className="text-amber-500">·</span> : null}
        <ChevronDown className={`h-3 w-3 transition-transform ${equipmentOpen ? "rotate-180" : ""}`} />
      </button>
      {equipmentOpen ? (
        <div className="absolute right-0 z-30 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-2 shadow-lg" data-testid="scheduler-equipment">
          {equipment.map((e) => {
            const op = operatingDays.find((o) => o.resourceType === e.resourceType);
            return (
              <div key={e.resourceType} className="flex items-center gap-1.5 px-1 py-0.5 text-[11px] text-slate-600" data-testid={`scheduler-equipment-${e.resourceType}`}>
                <span className={`h-2 w-2 rounded-full ${RESOURCE_DOT[e.resourceType]}`} />
                {e.label} · {e.total} {e.total === 1 ? "machine" : "machines"}
                {op && !op.isOperatingToday ? <span className="text-amber-500">· off today</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  ) : null;

  // ── Override dialog ──
  const overrideDialog = overrideCtx ? (
    <>
      <div className="absolute inset-0 z-40 rounded-2xl bg-slate-900/20" onClick={() => setOverrideCtx(null)} aria-hidden />
      <div className="absolute left-1/2 top-1/2 z-50 w-[360px] max-w-[94%] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl" data-testid="scheduler-override-dialog">
        <div className="mb-1 flex items-center gap-1.5 text-sm font-bold uppercase tracking-tight text-slate-900"><AlertTriangle className="h-4 w-4 text-amber-500" /> Override scheduling constraint</div>
        <p className="mb-2 text-[12px] text-slate-600">{overrideCtx.message}</p>
        {overrideCtx.time ? <p className="mb-2 text-[12px] text-slate-500">Selected: <span className="font-semibold text-slate-700">{pretty12h(overrideCtx.time)}</span></p> : null}
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Reason (required)</label>
        <textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={2} className="mb-2 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300" placeholder="Why is this override operationally necessary?" data-testid="scheduler-override-reason" />
        <select value={overrideCategory} onChange={(e) => setOverrideCategory(e.target.value)} className="mb-3 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 outline-none focus:border-slate-400" data-testid="scheduler-override-category">
          <option value="">Category (optional)…</option>
          {OVERRIDE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setOverrideCtx(null)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100" data-testid="scheduler-override-cancel">Cancel</button>
          <button type="button" disabled={!overrideReason.trim() || scheduleMutation.isPending} onClick={confirmOverride} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400" data-testid="scheduler-override-confirm">
            Add with Override
          </button>
        </div>
      </div>
    </>
  ) : null;

  // ── Confirm dialog (plan → dates) ──
  const confirmGroups = useMemo(() => {
    const byDate = new Map<string, PlanItem[]>();
    for (const b of sortedPlan) { const arr = byDate.get(b.isoDate); if (arr) arr.push(b); else byDate.set(b.isoDate, [b]); }
    return Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, items]) => ({ date, items }));
  }, [sortedPlan]);
  const confirmDialog = confirmOpen ? (
    <>
      <div className="absolute inset-0 z-40 rounded-2xl bg-slate-900/20" onClick={() => setConfirmOpen(false)} aria-hidden />
      <div className="absolute left-1/2 top-1/2 z-50 max-h-[92%] w-[380px] max-w-[94%] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl" data-testid="scheduler-confirm-dialog">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase tracking-tight text-slate-900"><CalendarDays className="h-4 w-4 text-slate-400" /> Confirm schedule</div>
        <p className="mb-3 text-[12px] text-slate-500">{patient.name ?? "Patient"}{confirmGroups.length > 1 ? ` · ${confirmGroups.length} dates` : ""}.</p>
        {confirmGroups.length === 0 ? (
          <p className="text-[12px] italic text-slate-400">Add at least one appointment first.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {confirmGroups.map(({ date, items }) => (
              <div key={date} data-testid={`scheduler-confirm-date-${date}`}>
                <div className="mb-1 text-[12px] font-bold text-slate-900">{prettyDateLong(date)}</div>
                <div className="flex flex-col gap-0.5">
                  {items.map((b) => (
                    <div key={b.key} className="flex items-center gap-2 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1 text-[12px] text-slate-700" data-testid={`scheduler-confirm-block-${b.code}`}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RESOURCE_DOT[b.resourceType]}`} />
                      <span className="w-[92px] shrink-0 tabular-nums font-semibold">{pretty12h(b.time)}–{pretty12h(minToHm(b.startMinutes + b.durationMin))}</span>
                      <span className="truncate">{b.displayName}</span>
                      {b.override ? <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0 text-[9px] font-semibold uppercase text-amber-700"><AlertTriangle className="h-2.5 w-2.5" /> Override</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100" data-testid="scheduler-confirm-cancel">Back</button>
          <button type="button" disabled={scheduleMutation.isPending || confirmGroups.length === 0} onClick={confirmVisit} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400" data-testid="scheduler-confirm-schedule">
            {scheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />} Confirm Schedule
          </button>
        </div>
      </div>
    </>
  ) : null;

  // ── The scheduling column (shared by full panel + quick popover) ──
  const schedulingColumn = (
    <div className="flex flex-col gap-2.5">
      {patientBlock}
      <div>
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-700">Appointment</div>
        {ancillaryDropdown}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Available Times</span>{activeIndicator}</span>
          {equipmentControl}
        </div>
        {timeGrid}
        {offDayBanner}
      </div>
      {(active || time || lastScheduled) ? (
        <div className="flex flex-col gap-2" data-testid="scheduler-pending-area">
          {selectedBlock}
          {suggestionBlock}
          {successBlock}
        </div>
      ) : null}
      {planList}
      {scheduleButton}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent" data-testid="unified-scheduler">
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="h-5 w-5 text-slate-400" />
          <div className="flex flex-col leading-tight">
            <span className="text-lg font-bold uppercase tracking-tight text-slate-900" data-testid="scheduler-title">{title}</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{monthLabel}</span>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 px-5 pb-5 lg:grid-cols-[1.9fr_1fr]">
        <div className="relative flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-4" data-testid="scheduler-calendar">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-base font-semibold text-slate-900" data-testid="scheduler-month-label">{monthLabel}</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={goToday} className="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100" data-testid="scheduler-today">Today</button>
              <button type="button" onClick={() => shiftMonth(-1)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="Previous month" data-testid="scheduler-prev-month"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" onClick={() => shiftMonth(1)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="Next month" data-testid="scheduler-next-month"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[11px] font-semibold uppercase text-slate-400">{WEEKDAYS.map((d) => <div key={d}>{d}</div>)}</div>
          <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1">
            {monthCells.map((c, i) => {
              if (!c.iso) return <div key={`pad-${i}`} aria-hidden />;
              const isSelected = c.iso === selectedDate;
              const isToday = c.iso === today;
              const dots = dayCells[c.iso]?.dots ?? [];
              const normal = isNormalDay(c.iso);
              return (
                <button key={c.iso} type="button"
                  onClick={() => { setSelectedDate(c.iso!); setTime(""); }}
                  onDoubleClick={() => { setSelectedDate(c.iso!); setTime(""); setQuickDate(c.iso!); }}
                  className={`flex min-h-0 flex-col items-center justify-center rounded-lg border text-sm transition-colors ${
                    isSelected ? "border-transparent bg-slate-900 text-white ring-2 ring-slate-900/20"
                      : isToday ? "border-slate-300 bg-slate-50 text-slate-900"
                        : !normal ? "border-slate-100 bg-slate-50/40 text-slate-300 hover:bg-slate-50"
                          : "border-slate-100 text-slate-700 hover:bg-slate-50"}`}
                  title={normal ? "Click to select · double-click for Quick Schedule" : `Not a normal ${active?.displayName ?? "service"} day · still selectable`}
                  data-testid={`scheduler-day-${c.iso}`}>
                  <span className="font-semibold leading-none">{c.day}</span>
                  {!normal && !isSelected ? <span className="text-[8px] leading-none text-amber-400" data-testid={`scheduler-day-offday-${c.iso}`}>·</span> : null}
                  {dots.length > 0 && (<span className="mt-0.5 flex items-center gap-[3px]" data-testid={`scheduler-day-dots-${c.iso}`}>{dots.slice(0, 3).map((d, di) => <span key={di} className={`h-1.5 w-1.5 rounded-full ${d.className}`} title={d.title} />)}</span>)}
                </button>
              );
            })}
          </div>

          {quickDate && (
            <>
              <div className="absolute inset-0 z-30 rounded-2xl bg-slate-900/10" onClick={() => setQuickDate(null)} aria-hidden />
              <div className="absolute left-1/2 top-1/2 z-40 max-h-[92%] w-[340px] max-w-[92%] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl" data-testid="scheduler-quick-popover">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quick Schedule · {prettyDateShort(quickDate)}</span>
                  <button type="button" onClick={() => setQuickDate(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" data-testid="scheduler-quick-close" aria-label="Close quick schedule"><X className="h-4 w-4" /></button>
                </div>
                {schedulingColumn}
                <button type="button" onClick={() => setQuickDate(null)} className="mt-2 w-full text-center text-[11px] font-medium text-slate-500 underline hover:text-slate-700" data-testid="scheduler-quick-expand">Expand to full Scheduler</button>
              </div>
            </>
          )}

          {overrideDialog}
          {confirmDialog}
        </div>

        <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4" data-testid="scheduler-panel">
          <div>
            <div className="text-base font-bold uppercase tracking-tight text-slate-900" data-testid="scheduler-selected-date">{prettyDateLong(selectedDate)}</div>
            {facility ? <div className="text-[11px] text-slate-500">{facility}</div> : null}
          </div>
          {schedulingColumn}
        </div>
      </div>
    </div>
  );
}
