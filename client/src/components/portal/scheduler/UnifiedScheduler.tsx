// Unified capacity-aware Scheduler (full + quick popover share this component).
//
// Rendered inside the Playground "schedule"/"calendar" workspace. Every full
// scheduling entry point (dock Calendar, left-rail Calendar tile, right-rail
// patient calendar, EHR schedule) opens THIS component; only the entry CONTEXT
// differs (patient/facility preselected or not).
//
// MENTAL MODEL (redesigned):
//   • PLEXUS IQ answers WHAT THE PATIENT QUALIFIED FOR — read-only guidance.
//     It never decides what the scheduler is currently scheduling.
//   • The scheduler CHOOSES an ancillary from a single "+ Choose ancillary"
//     picker. Each chosen ancillary becomes a compact SCHEDULING TAB (a
//     scheduling context) — BrainWave, VitalWave, and ONE Ultrasound tab.
//   • The ACTIVE tab drives the ONE shared month calendar + Available Times:
//     operating-day eligibility, duration, capacity, conflicts, recommendation.
//     Eligibility is ALWAYS the active tab only — never an all-service
//     intersection, and there is no "All" mode.
//   • A time-slot click SELECTS + HIGHLIGHTS (pending) only. Nothing is written
//     or advanced until the explicit "Schedule <service>" button is clicked.
//   • Inside the Ultrasound tab, any subset of qualified studies can be grouped
//     and scheduled on one or multiple dates. Zero selected means zero.
//
// The write goes through the ONE multi-service /api/scheduling/visit
// orchestration (grouped, multi-date, shared visitGroupId). Capacity + off-day
// conflicts are SOFT — an authorized user overrides with a reason.

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
let __groupSeq = 0;
function nextGroupId(): string { __groupSeq += 1; return `g${__groupSeq}_${Date.now().toString(36)}`; }

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

// A placed block in the CLIENT-SIDE visit plan (source of truth before write).
type Placed = {
  isoDate: string;
  time: string; // "HH:MM" start
  startMinutes: number;
  durationMin: number;
  override?: OverrideMeta | null;
};
type SingleBlock = Placed & { code: string };
type UltrasoundGroupBlock = Placed & {
  id: string;
  studyCodes: string[];
  perStudyMin: number;
};
// SCHEDULED ASSIGNMENTS — the client visit plan.
type VisitPlan = {
  brainwave?: SingleBlock;
  vitalwave?: SingleBlock;
  ultrasound: UltrasoundGroupBlock[];
};
const EMPTY_PLAN: VisitPlan = { ultrasound: [] };

// A scheduling TAB kind — a scheduling context the scheduler chose to work on.
type TabKind = "brainwave" | "vitalwave" | "ultrasound";

// A flattened placed item (for the plan summary + confirm counts).
type PlacedItem = {
  key: string;
  resourceType: CapResourceType;
  label: string;
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

type StudyRef = { internalCode: string; displayName: string; cptCode: string | null };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RESOURCE_LABELS: Record<string, string> = { brainwave: "BrainWave", vitalwave: "VitalWave", ultrasound: "Ultrasound" };
// Subtle single-accent dots only — the surface stays neutral.
const RESOURCE_DOT: Record<string, string> = { brainwave: "bg-violet-500", vitalwave: "bg-rose-600", ultrasound: "bg-emerald-600" };
const OVERRIDE_CATEGORIES = [
  "machine available despite capacity model",
  "special clinic day",
  "provider/management request",
  "patient circumstance",
  "operational adjustment",
  "other",
];

// A right-panel section: strong header + content, separated by a subtle rule.
function Section({
  title,
  right,
  first,
  children,
  testId,
}: {
  title: string;
  right?: React.ReactNode;
  first?: boolean;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className={first ? "" : "border-t border-slate-100 pt-2.5"} data-testid={testId}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

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
  // PENDING SELECTION — a time chosen but NOT yet committed.
  const [time, setTime] = useState<string>(context.initialTime ?? "");

  // CHOSEN SCHEDULING TABS (ordered) + the ACTIVE tab.
  const [chosenTabs, setChosenTabs] = useState<TabKind[]>([]);
  const [activeTab, setActiveTab] = useState<TabKind | null>(null);

  // SELECTED ULTRASOUND STUDIES FOR THE CURRENT GROUP — user-controlled, starts
  // EMPTY. Never derived from qualification. Zero means zero.
  const [usGroupSel, setUsGroupSel] = useState<Set<string>>(new Set());

  // SCHEDULED ASSIGNMENTS — the client visit plan (source of truth pre-write).
  const [visitPlan, setVisitPlan] = useState<VisitPlan>(EMPTY_PLAN);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerUsOpen, setPickerUsOpen] = useState(false);
  const [addMoreOpen, setAddMoreOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [equipmentOpen, setEquipmentOpen] = useState(false);
  const [agendaExpanded, setAgendaExpanded] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [quickDate, setQuickDate] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Success marker for the most recently COMMITTED service (so the user sees
  // what they just scheduled — never an abrupt jump). Cleared on a new pending.
  const [lastScheduled, setLastScheduled] = useState<{ key: string; label: string; isoDate: string; time: string } | null>(null);
  // Override dialog — placed against the CURRENT active tab + chosen time.
  const [overrideCtx, setOverrideCtx] = useState<{ constraint: SoftConstraint; time: string; message: string } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideCategory, setOverrideCategory] = useState("");

  const [cursor, setCursor] = useState(() => {
    const d = new Date(`${selectedDate}T00:00:00`);
    const base = Number.isNaN(d.getTime()) ? new Date() : d;
    return { y: base.getFullYear(), m: base.getMonth() };
  });

  // Close the ancillary picker on outside-click / Escape.
  const pickerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setPickerOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [pickerOpen]);

  // ── Registry services for this facility ──
  const { data: services = [], isLoading: servicesLoading } = useQuery<RegistryService[]>({
    queryKey: ["service-registry-by-facility", facility],
    queryFn: () => fetchActiveServicesForFacility(facility),
    staleTime: 5 * 60_000,
  });
  const { brainwave, vitalwave, ultrasound } = useMemo(() => bucketServices(services), [services]);

  // ── Plexus IQ qualification (patient context only) — READ-ONLY guidance ──
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

  // QUALIFIED services (read-only). NEVER auto-selected for scheduling.
  const qualBrain = !!qualification?.services.some((s) => s.resourceType === "brainwave");
  const qualVital = !!qualification?.services.some((s) => s.resourceType === "vitalwave");
  const qualUsStudies = useMemo<StudyRef[]>(
    () => qualification?.services.filter((s) => s.resourceType === "ultrasound").map((s) => ({ internalCode: s.internalCode, displayName: s.displayName, cptCode: s.cptCode })) ?? [],
    [qualification],
  );

  // The ultrasound study universe the picker/tab offers: qualified studies in
  // patient context, otherwise the registry ultrasound bucket.
  const usUniverse = useMemo<StudyRef[]>(() => {
    if (hasPatient && qualUsStudies.length > 0) return qualUsStudies;
    return ultrasound.map((u) => ({ internalCode: u.internalCode, displayName: u.displayName, cptCode: u.cptCode }));
  }, [hasPatient, qualUsStudies, ultrasound]);
  const usNameOf = (code: string) => usUniverse.find((u) => u.internalCode === code)?.displayName ?? code;

  const patientKey =
    patient.patientScreeningId != null ? `ps:${patient.patientScreeningId}`
      : patient.executionCaseId != null ? `ec:${patient.executionCaseId}` : null;

  // ── Ultrasound scheduling derivations ──
  const scheduledUltrasoundCodes = useMemo(
    () => new Set(visitPlan.ultrasound.flatMap((g) => g.studyCodes)),
    [visitPlan.ultrasound],
  );
  const unscheduledUsStudies = useMemo(
    () => usUniverse.filter((u) => !scheduledUltrasoundCodes.has(u.internalCode)),
    [usUniverse, scheduledUltrasoundCodes],
  );

  // ── ACTIVE-tab derived request/meta — the calendar reflects THIS only ──
  const activeStudyCount = activeTab === "ultrasound" ? usGroupSel.size : 1;
  const activeRequest: CapServiceRequest | null = !activeTab
    ? null
    : activeTab === "ultrasound"
      ? (usGroupSel.size > 0 ? { resourceType: "ultrasound", studyCount: usGroupSel.size } : null) // 0 studies ⇒ no request (zero means zero)
      : { resourceType: activeTab };
  const primary = activeRequest;
  const activeResourceType: CapResourceType | null = activeRequest ? activeRequest.resourceType : null;
  const activeTabLabel = activeTab ? RESOURCE_LABELS[activeTab] : null;

  // ── Availability (the ONE engine) — asked about the ACTIVE tab only ──
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

  // ── Calendar eligibility — the ACTIVE tab ONLY (never an intersection) ──
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

  // ── Existing appointments (dedupe) ──
  // Resource types the patient already has on the SELECTED date (from agenda).
  const existingOnSelectedDate = useMemo(() => {
    const m = new Map<string, { time: string; endTime: string }>();
    if (!patient.name) return m;
    for (const a of agenda) {
      if (a.patient !== patient.name) continue;
      if (!m.has(a.resourceType)) m.set(a.resourceType, { time: a.time, endTime: a.endTime });
    }
    return m;
  }, [agenda, patient.name]);

  const brainPlaced = !!visitPlan.brainwave;
  const vitalPlaced = !!visitPlan.vitalwave;

  // ── Choosing / activating tabs ──
  // Choose from the picker: add the tab if new, activate it, reset pending.
  // For a NEW ultrasound choice, the current-group selection starts EMPTY.
  function chooseTab(kind: TabKind) {
    setChosenTabs((prev) => (prev.includes(kind) ? prev : [...prev, kind]));
    setActiveTab(kind);
    setTime("");
    setLastScheduled(null);
    if (kind === "ultrasound") setUsGroupSel(new Set());
    setPickerOpen(false);
    setAddMoreOpen(false);
    setPickerUsOpen(false);
  }
  // Click an existing tab: activate it. Preserve the ultrasound group selection.
  function activateTab(kind: TabKind, opts?: { date?: string; time?: string }) {
    setActiveTab(kind);
    setLastScheduled(null);
    if (opts?.date) setSelectedDate(opts.date);
    setTime(opts?.time ?? "");
  }
  // Close a tab: remove it, drop its client-plan blocks, re-point active.
  function closeTab(kind: TabKind) {
    setChosenTabs((prev) => {
      const next = prev.filter((k) => k !== kind);
      setActiveTab((cur) => (cur === kind ? next[next.length - 1] ?? null : cur));
      return next;
    });
    if (kind === "brainwave") setVisitPlan((p) => { const n = { ...p }; delete n.brainwave; return n; });
    else if (kind === "vitalwave") setVisitPlan((p) => { const n = { ...p }; delete n.vitalwave; return n; });
    else { setVisitPlan((p) => ({ ...p, ultrasound: [] })); setUsGroupSel(new Set()); }
    setTime("");
    setLastScheduled(null);
  }

  // ── Ultrasound current-group selection (user-controlled) ──
  function toggleUsStudy(code: string) {
    if (scheduledUltrasoundCodes.has(code)) return; // already scheduled — not selectable
    setUsGroupSel((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
    setTime("");
    setLastScheduled(null);
  }
  function selectAllUs() {
    setUsGroupSel(new Set(unscheduledUsStudies.map((u) => u.internalCode)));
    setTime("");
    setLastScheduled(null);
  }
  function clearUs() {
    setUsGroupSel(new Set());
    setTime("");
    setLastScheduled(null);
  }
  // "Change" a scheduled ultrasound group: pull it out of the plan and re-stage
  // its studies as the current group at its old date/time (selection, not commit).
  function changeUsGroup(g: UltrasoundGroupBlock) {
    setVisitPlan((p) => ({ ...p, ultrasound: p.ultrasound.filter((x) => x.id !== g.id) }));
    setActiveTab("ultrasound");
    setUsGroupSel(new Set(g.studyCodes));
    setSelectedDate(g.isoDate);
    setTime(g.time);
    setLastScheduled(null);
  }

  // ── Flattened placed items + plan summary ──
  const placedItems = useMemo<PlacedItem[]>(() => {
    const out: PlacedItem[] = [];
    if (visitPlan.brainwave) out.push({ key: "brainwave", resourceType: "brainwave", label: "BrainWave", ...pick(visitPlan.brainwave) });
    if (visitPlan.vitalwave) out.push({ key: "vitalwave", resourceType: "vitalwave", label: "VitalWave", ...pick(visitPlan.vitalwave) });
    for (const g of visitPlan.ultrasound) out.push({ key: `ultrasound:${g.id}`, resourceType: "ultrasound", label: g.studyCodes.map(usNameOf).join(" + "), isoDate: g.isoDate, time: g.time, startMinutes: g.startMinutes, durationMin: g.durationMin, override: g.override ?? null });
    return out;
    function pick(b: SingleBlock) { return { isoDate: b.isoDate, time: b.time, startMinutes: b.startMinutes, durationMin: b.durationMin, override: b.override ?? null }; }
  }, [visitPlan]); // eslint-disable-line react-hooks/exhaustive-deps
  const plannedCount = placedItems.length;
  const canConfirm = hasPatient && plannedCount > 0;

  // ── Commit the pending selection into the client visit plan ──
  // Called ONLY by the explicit "Schedule <service>" action — NEVER by a bare
  // time-slot click. Adds/updates the plan, clears the pending time, records a
  // success marker, and deliberately does NOT auto-advance to another tab.
  function placeActive(at: { time: string; startMinutes?: number }, override?: OverrideMeta | null) {
    if (!activeTab) return;
    const startMinutes = at.startMinutes ?? hmToMin(at.time);
    // Dedupe brainwave/vitalwave against an existing (server-written) same-day
    // appointment — but allow overwriting a client-plan block (reschedule).
    if ((activeTab === "brainwave" || activeTab === "vitalwave") && existingOnSelectedDate.has(activeTab) && !visitPlan[activeTab]) {
      toast({ title: "Already scheduled", description: `${RESOURCE_LABELS[activeTab]} already has an appointment on ${prettyDateShort(selectedDate)}.` });
      return;
    }
    if (activeTab === "brainwave") {
      const code = brainwave?.internalCode; if (!code) return;
      const durationMin = activeDurationMin ?? 0;
      setVisitPlan((p) => ({ ...p, brainwave: { code, isoDate: selectedDate, time: at.time, startMinutes, durationMin, override: override ?? null } }));
      setLastScheduled({ key: "brainwave", label: "BrainWave", isoDate: selectedDate, time: at.time });
    } else if (activeTab === "vitalwave") {
      const code = vitalwave?.internalCode; if (!code) return;
      const durationMin = activeDurationMin ?? 0;
      setVisitPlan((p) => ({ ...p, vitalwave: { code, isoDate: selectedDate, time: at.time, startMinutes, durationMin, override: override ?? null } }));
      setLastScheduled({ key: "vitalwave", label: "VitalWave", isoDate: selectedDate, time: at.time });
    } else {
      const codes = Array.from(usGroupSel);
      if (codes.length === 0) return;
      const durationMin = activeDurationMin ?? 15 * codes.length;
      const perStudyMin = Math.max(5, Math.round(durationMin / codes.length));
      setVisitPlan((p) => ({ ...p, ultrasound: [...p.ultrasound, { id: nextGroupId(), studyCodes: codes, isoDate: selectedDate, time: at.time, startMinutes, durationMin, perStudyMin, override: override ?? null }] }));
      setUsGroupSel(new Set()); // group committed — current selection empties
      setLastScheduled({ key: "ultrasound", label: `${codes.length} Ultrasound${codes.length === 1 ? "" : "s"}`, isoDate: selectedDate, time: at.time });
    }
    setTime(""); // NO auto-advance: the active tab stays put.
  }

  // ── Write mapping → existing grouped multi-date endpoint ──
  type WriteGroup = {
    date: string;
    services: Array<{ serviceType: string; time: string }>;
    overrides?: Record<string, { constraint: SoftConstraint; reason: string; category?: string | null; capacityState?: Record<string, unknown> }>;
  };
  function buildGroupsFromPlan(): WriteGroup[] {
    const byDate = new Map<string, WriteGroup>();
    const get = (date: string) => { let g = byDate.get(date); if (!g) { g = { date, services: [] }; byDate.set(date, g); } return g; };
    const addOverride = (g: WriteGroup, code: string, ov?: OverrideMeta | null) => {
      if (!ov) return;
      (g.overrides ??= {})[code] = { constraint: ov.constraint, reason: ov.reason, category: ov.category, capacityState: { operatingDays } };
    };
    if (visitPlan.brainwave) { const g = get(visitPlan.brainwave.isoDate); g.services.push({ serviceType: visitPlan.brainwave.code, time: visitPlan.brainwave.time }); addOverride(g, visitPlan.brainwave.code, visitPlan.brainwave.override); }
    if (visitPlan.vitalwave) { const g = get(visitPlan.vitalwave.isoDate); g.services.push({ serviceType: visitPlan.vitalwave.code, time: visitPlan.vitalwave.time }); addOverride(g, visitPlan.vitalwave.code, visitPlan.vitalwave.override); }
    for (const grp of visitPlan.ultrasound) {
      const g = get(grp.isoDate);
      let t = grp.startMinutes;
      for (const code of grp.studyCodes) { g.services.push({ serviceType: code, time: minToHm(t) }); addOverride(g, code, grp.override); t += grp.perStudyMin || 15; }
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
        scheduledCount: number;
        totalCount: number;
        dates: string[];
        visitGroupId?: string;
        services: Array<{ date: string; serviceType: string; status: string; error?: string }>;
      };
    },
    onSuccess: (result) => {
      invalidateTeamPortalScheduleQueries(queryClient, { facility, selectedDate, patientScreeningId: patient.patientScreeningId ?? null });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches/calendar-summary"] });
      queryClient.invalidateQueries({ queryKey: ["scheduler-availability"] });
      if (result.overall === "all_scheduled") {
        const dateNote = result.dates && result.dates.length > 1 ? ` across ${result.dates.length} dates` : "";
        toast({ title: "Scheduled", description: `${result.scheduledCount} service${result.scheduledCount === 1 ? "" : "s"} scheduled for ${patient.name ?? "patient"}${dateNote}.` });
        setTime("");
        setOverrideCtx(null);
        setOverrideReason("");
        setOverrideCategory("");
        setQuickDate(null);
        setConfirmOpen(false);
        setVisitPlan(EMPTY_PLAN);
        setUsGroupSel(new Set());
        setChosenTabs([]);
        setActiveTab(null);
      } else if (result.overall === "partial") {
        const failed = result.services.filter((s) => s.status !== "scheduled").map((s) => s.serviceType);
        toast({ title: "Partially scheduled", description: `${result.scheduledCount} of ${result.totalCount} scheduled. Not scheduled: ${failed.join(", ")}.`, variant: "destructive" });
        setConfirmOpen(false);
      } else {
        toast({ title: "Not scheduled", description: result.services.map((s) => s.error).filter(Boolean).join("; ") || "No services could be scheduled.", variant: "destructive" });
      }
    },
    onError: (err: unknown) => {
      toast({ title: "Could not schedule", description: err instanceof Error ? err.message : "Schedule write failed.", variant: "destructive" });
    },
  });

  function confirmVisit() {
    const groups = buildGroupsFromPlan();
    if (groups.length === 0) return;
    scheduleMutation.mutate(groups);
  }

  // Click a time slot for the ACTIVE tab: this ONLY SELECTS the time (pending).
  // It never commits, never advances, never switches tabs.
  function onPickSlot(slot: { time: string }) {
    if (!activeRequest) return;
    setLastScheduled(null);
    setTime(slot.time);
  }

  // Explicit commit of the pending selection (the primary Schedule button).
  function scheduleActive() {
    if (!activeRequest || !time) return;
    const slot = slots.find((s) => s.time === time) ?? null;
    if (slot && !slot.fits) {
      // Soft conflict — require an override reason before committing.
      setOverrideCtx({
        constraint: slot.constraint ?? "full",
        time,
        message:
          slot.constraint === "off_day"
            ? `${activeTabLabel} is not normally scheduled on ${prettyDateLong(selectedDate)}.`
            : slot.constraint === "outage"
              ? `${activeTabLabel} is unavailable (equipment outage) at ${pretty12h(time)}.`
              : `${activeTabLabel} capacity is full at ${pretty12h(time)}.`,
      });
      return;
    }
    placeActive({ time, startMinutes: slot?.startMinutes });
  }

  function confirmOverride() {
    if (!overrideCtx || !overrideReason.trim()) return;
    placeActive({ time: overrideCtx.time, startMinutes: hmToMin(overrideCtx.time) }, { constraint: overrideCtx.constraint, reason: overrideReason.trim(), category: overrideCategory || null });
    setOverrideCtx(null);
    setOverrideReason("");
    setOverrideCategory("");
  }

  // ── Recommendation for the ACTIVE tab (client-side smart hint) ──
  const activeRecommendation = useMemo(() => {
    if (!activeRequest) return null;
    const fitting = slots.filter((s) => s.fits);
    if (fitting.length === 0) return null;
    const sameDayEnds = placedItems
      .filter((b) => b.isoDate === selectedDate)
      .map((b) => b.startMinutes + b.durationMin);
    if (sameDayEnds.length > 0) {
      const after = Math.max(...sameDayEnds);
      const seq = fitting.find((s) => s.startMinutes >= after);
      if (seq) return { time: seq.time, startMinutes: seq.startMinutes, reason: "Right after the previous service — same visit" };
    }
    const first = fitting[0];
    return { time: first.time, startMinutes: first.startMinutes, reason: sameDayEnds.length > 0 ? "Next open time today" : "Earliest available" };
  }, [activeRequest, slots, placedItems, selectedDate]);

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
    setCursor((c) => { const total = c.y * 12 + c.m + delta; return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 }; });
  }
  function goToday() { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }); setSelectedDate(todayIso()); }

  const title = hasPatient && patient.name ? `Schedule — ${patient.name}` : "Schedule";

  // ── Admin-review tag (informational; never blocks scheduling) ──
  const reviewTag = (() => {
    if (patient.patientScreeningId == null || !qualification) return null;
    const s = qualification.adminReviewSummary;
    const label =
      s === "approved" ? "Admin Review: Complete"
        : s === "partially_reviewed" ? "Admin reviewed — needs attention"
          : "Admin Review: Pending";
    const tone =
      s === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : s === "partially_reviewed" ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-slate-200 bg-slate-50 text-slate-600";
    return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`} data-testid="scheduler-admin-review-tag">{label}</span>;
  })();

  // ── QUALIFIED FOR (patient context) — READ-ONLY, neutral, minimal ──
  const qualifiedForSection = (
    <div className="flex flex-col gap-1" data-testid="scheduler-qualified-for">
      {qualBrain ? (
        <div className="flex items-center gap-2 text-[13px] text-slate-700" data-testid="scheduler-qual-for-brainwave">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" /> BrainWave
        </div>
      ) : null}
      {qualVital ? (
        <div className="flex items-center gap-2 text-[13px] text-slate-700" data-testid="scheduler-qual-for-vitalwave">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-600" /> VitalWave
        </div>
      ) : null}
      {qualUsStudies.length > 0 ? (
        <div className="flex items-center gap-2 text-[13px] text-slate-700" data-testid="scheduler-qual-for-ultrasound">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" /> Ultrasound · {qualUsStudies.length} stud{qualUsStudies.length === 1 ? "y" : "ies"}
        </div>
      ) : null}
      {!qualBrain && !qualVital && qualUsStudies.length === 0 ? (
        <div className="text-[12px] italic text-slate-400" data-testid="scheduler-qual-for-none">No qualified ancillaries on file.</div>
      ) : null}
    </div>
  );

  // ── The ONE ancillary picker ("+ Choose ancillary") ──
  const brainAlready = chosenTabs.includes("brainwave");
  const vitalAlready = chosenTabs.includes("vitalwave");
  const usAlready = chosenTabs.includes("ultrasound");
  // In patient context, qualified services are the primary list; the rest sit
  // behind "+ Add another ancillary". In generic context, all are primary.
  const primaryBrain = hasPatient ? qualBrain : !!brainwave;
  const primaryVital = hasPatient ? qualVital : !!vitalwave;
  const primaryUs = hasPatient ? qualUsStudies.length > 0 : ultrasound.length > 0;
  const extraBrain = !!brainwave && !primaryBrain;
  const extraVital = !!vitalwave && !primaryVital;
  const extraUs = ultrasound.length > 0 && !primaryUs;
  const hasExtras = extraBrain || extraVital || extraUs;

  function PickRow({ kind, label, testId }: { kind: TabKind; label: string; testId: string }) {
    const chosen = chosenTabs.includes(kind);
    return (
      <button type="button" onClick={() => chooseTab(kind)}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
        data-testid={testId}>
        <span className="flex items-center gap-2 truncate">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RESOURCE_DOT[kind]}`} />
          {label}
        </span>
        {chosen ? <Check className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : null}
      </button>
    );
  }

  const picker = (
    <div className="relative" ref={pickerRef} data-testid="scheduler-schedule-picker">
      {servicesLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading services…</div>
      ) : (
        <>
          <button type="button" onClick={() => setPickerOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50"
            data-testid="scheduler-choose-ancillary" aria-expanded={pickerOpen}>
            <Plus className="h-3.5 w-3.5" /> Choose ancillary
            <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
          </button>
          {pickerOpen ? (
            <div className="absolute z-30 mt-1 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg" data-testid="scheduler-ancillary-menu">
              {primaryBrain ? <PickRow kind="brainwave" label="BrainWave" testId="scheduler-pick-brainwave" /> : null}
              {primaryVital ? <PickRow kind="vitalwave" label="VitalWave" testId="scheduler-pick-vitalwave" /> : null}
              {primaryUs ? (
                <div>
                  <div className="flex items-center">
                    <button type="button" onClick={() => chooseTab("ultrasound")}
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                      data-testid="scheduler-pick-ultrasound">
                      <span className="flex items-center gap-2 truncate">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" /> Ultrasound
                        {usUniverse.length > 0 ? <span className="text-[11px] text-slate-400">· {usUniverse.length} studies</span> : null}
                      </span>
                      {usAlready ? <Check className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : null}
                    </button>
                    {usUniverse.length > 0 ? (
                      <button type="button" onClick={() => setPickerUsOpen((v) => !v)} className="px-2 py-1.5 text-slate-400 hover:text-slate-600" data-testid="scheduler-pick-ultrasound-expand" aria-label="Preview ultrasound studies">
                        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${pickerUsOpen ? "rotate-90" : ""}`} />
                      </button>
                    ) : null}
                  </div>
                  {pickerUsOpen ? (
                    <div className="border-t border-slate-100 bg-slate-50/60 py-0.5" data-testid="scheduler-pick-ultrasound-studies">
                      {usUniverse.map((u) => (
                        <div key={u.internalCode} className="truncate px-3 py-0.5 pl-7 text-[11px] text-slate-500">{u.displayName}</div>
                      ))}
                      <div className="px-3 py-0.5 pl-7 text-[10px] italic text-slate-400">Choose studies to schedule inside the Ultrasound tab.</div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {hasExtras ? (
                <div className="border-t border-slate-100">
                  <button type="button" onClick={() => setAddMoreOpen((v) => !v)}
                    className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-50"
                    data-testid="scheduler-add-another" aria-expanded={addMoreOpen}>
                    <Plus className="h-3 w-3" /> Add another ancillary
                    <ChevronDown className={`ml-auto h-3.5 w-3.5 text-slate-400 transition-transform ${addMoreOpen ? "rotate-180" : ""}`} />
                  </button>
                  {addMoreOpen ? (
                    <div className="bg-slate-50/60">
                      {extraBrain ? <PickRow kind="brainwave" label="BrainWave" testId="scheduler-pick-extra-brainwave" /> : null}
                      {extraVital ? <PickRow kind="vitalwave" label="VitalWave" testId="scheduler-pick-extra-vitalwave" /> : null}
                      {extraUs ? <PickRow kind="ultrasound" label="Ultrasound" testId="scheduler-pick-extra-ultrasound" /> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  // ── Scheduling tabs (minimal, professional) with compact status ──
  function tabStatus(kind: TabKind): string {
    if (kind === "ultrasound") {
      const total = usUniverse.length;
      const done = scheduledUltrasoundCodes.size;
      if (done === 0) return "";
      if (total > 0 && done >= total) return "✓";
      return total > 0 ? `${done}/${total}` : `${done}`;
    }
    const placed = kind === "brainwave" ? brainPlaced : vitalPlaced;
    const existing = existingOnSelectedDate.has(kind);
    return placed || existing ? "✓" : "";
  }

  const tabsRow = chosenTabs.length > 0 ? (
    <div className="flex flex-wrap items-stretch gap-0.5 border-b border-slate-200" data-testid="scheduler-tabs">
      {chosenTabs.map((kind) => {
        const active = activeTab === kind;
        const status = tabStatus(kind);
        return (
          <div key={kind} className={`group -mb-px flex items-center gap-1 border-b-2 px-2.5 py-1.5 text-[12px] ${active ? "border-slate-900 font-semibold text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            <button type="button" onClick={() => activateTab(kind)} className="flex items-center gap-1.5" data-testid={`scheduler-tab-${kind}`} aria-pressed={active}>
              <span className={`h-1.5 w-1.5 rounded-full ${RESOURCE_DOT[kind]}`} />
              {RESOURCE_LABELS[kind]}
              {status ? <span className="text-[11px] font-semibold tabular-nums text-slate-500" data-testid={`scheduler-tab-status-${kind}`}>{status}</span> : null}
            </button>
            <button type="button" onClick={() => closeTab(kind)} className="rounded p-0.5 text-slate-300 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100" title={`Remove ${RESOURCE_LABELS[kind]}`} data-testid={`scheduler-tab-close-${kind}`}>
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  ) : null;

  // ── Active single-service tab status (BrainWave / VitalWave) ──
  const activeSingleStatus = (activeTab === "brainwave" || activeTab === "vitalwave") ? (() => {
    const block = activeTab === "brainwave" ? visitPlan.brainwave : visitPlan.vitalwave;
    const existing = existingOnSelectedDate.get(activeTab);
    if (block) {
      return (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5" data-testid={`scheduler-tab-scheduled-${activeTab}`}>
          <span className="flex items-center gap-1.5 text-[12px] text-slate-700"><Check className="h-3.5 w-3.5 text-emerald-600" /> Scheduled · {prettyDateShort(block.isoDate)} · {pretty12h(block.time)}{block.override ? " · override" : ""}</span>
          <button type="button" onClick={() => activateTab(activeTab!, { date: block.isoDate, time: block.time })} className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100" data-testid={`scheduler-tab-change-${activeTab}`}>Change</button>
        </div>
      );
    }
    if (existing) {
      return (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-600" data-testid={`scheduler-tab-existing-${activeTab}`}>
          Existing appointment · {pretty12h(existing.time)}
        </div>
      );
    }
    return null;
  })() : null;

  // ── Ultrasound tab body (study selection + scheduled groups) ──
  const ultrasoundTabBody = activeTab === "ultrasound" ? (
    <div className="flex flex-col gap-2" data-testid="scheduler-ultrasound-tab">
      {unscheduledUsStudies.length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-2.5 py-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Available studies</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={selectAllUs} className="text-[11px] font-medium text-slate-500 underline hover:text-slate-700" data-testid="scheduler-us-select-all">Select all</button>
              {usGroupSel.size > 0 ? <button type="button" onClick={clearUs} className="text-[11px] font-medium text-slate-500 underline hover:text-slate-700" data-testid="scheduler-us-clear">Clear</button> : null}
            </div>
          </div>
          <div className="max-h-40 overflow-y-auto py-0.5">
            {unscheduledUsStudies.map((u) => {
              const checked = usGroupSel.has(u.internalCode);
              return (
                <button key={u.internalCode} type="button" onClick={() => toggleUsStudy(u.internalCode)}
                  className={`flex w-full items-center gap-2 px-2.5 py-1 text-left text-[13px] transition-colors hover:bg-slate-50 ${checked ? "text-slate-900" : "text-slate-700"}`}
                  data-testid={`scheduler-us-study-${u.internalCode}`} aria-pressed={checked}>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`} data-testid={`scheduler-us-check-${u.internalCode}`}>{checked ? <Check className="h-3 w-3" /> : null}</span>
                  <span className="min-w-0 truncate">{u.displayName}{u.cptCode ? <span className="ml-1 text-[10px] text-slate-400">CPT {u.cptCode}</span> : null}</span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-slate-100 px-2.5 py-1 text-[11px] text-slate-500" data-testid="scheduler-us-selected-count">
            {usGroupSel.size} selected{usGroupSel.size > 0 && activeDurationMin ? ` · ${activeDurationMin} min` : ""}
            {usGroupSel.size === 0 ? " — check a study to schedule it." : " — pick a time below, then Schedule."}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-center text-[11px] text-emerald-700" data-testid="scheduler-us-all-scheduled">All ultrasound studies scheduled.</div>
      )}

      {visitPlan.ultrasound.length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white" data-testid="scheduler-us-scheduled">
          <div className="border-b border-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Scheduled groups</div>
          <div className="flex flex-col divide-y divide-slate-100">
            {visitPlan.ultrasound.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5" data-testid={`scheduler-us-group-${g.id}`}>
                <span className="min-w-0 text-[12px] text-slate-700">
                  <span className="font-semibold tabular-nums">{prettyDateShort(g.isoDate)} · {pretty12h(g.time)}</span>
                  <span className="block truncate text-slate-500">{g.studyCodes.map(usNameOf).join(" + ")}</span>
                </span>
                <button type="button" onClick={() => changeUsGroup(g)} className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100" data-testid={`scheduler-us-change-${g.id}`}>Change</button>
              </div>
            ))}
          </div>
          {unscheduledUsStudies.length > 0 ? (
            <div className="border-t border-slate-100 px-2.5 py-1 text-[11px] text-slate-500" data-testid="scheduler-us-remaining">
              Remaining: {unscheduledUsStudies.map((u) => u.displayName).join(", ")}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;

  // ── Time grid (compact, 15-min) — reflects the ACTIVE tab only ──
  const activePlacedTime = (() => {
    if (activeTab === "brainwave" && visitPlan.brainwave?.isoDate === selectedDate) return visitPlan.brainwave.time;
    if (activeTab === "vitalwave" && visitPlan.vitalwave?.isoDate === selectedDate) return visitPlan.vitalwave.time;
    return null;
  })();
  const timeGrid = !activeRequest ? (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs italic text-slate-400" data-testid="scheduler-times-empty">
      {activeTab === "ultrasound" ? "Select at least one study to see available times." : "Choose an ancillary to schedule."}
    </p>
  ) : slots.length === 0 ? (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs italic text-slate-400">Loading availability…</p>
  ) : (
    <div className="grid grid-cols-4 gap-1.5" data-testid="scheduler-time-slots">
      {slots.map((slot) => {
        const isSel = (activePlacedTime ?? time) === slot.time;
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

  // ── Off-day banner (ACTIVE tab) + its OWN next eligible day ──
  const offDayBanner = activeIsOffDay && activeOpDay && activeTabLabel ? (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800" data-testid="scheduler-offday-banner">
      <div className="flex items-start gap-1.5">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          {activeTabLabel} is not normally scheduled{facility ? ` at ${facility}` : ""} on {WEEKDAYS[weekdayOf(selectedDate)] ?? "this day"}s.
          {activeOpDay.nextEligibleDay ? (
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="button" onClick={() => { setSelectedDate(activeOpDay.nextEligibleDay!); setTime(""); }} className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-semibold text-amber-700 hover:bg-amber-100" data-testid="scheduler-offday-choose-next">
                Choose {prettyDateLong(activeOpDay.nextEligibleDay)}
              </button>
              <button type="button" onClick={() => setOverrideCtx({ constraint: "off_day", time: time || slots.find((s) => s.capacityFits)?.time || slots[0]?.time || "09:00", message: `${activeTabLabel} is not normally scheduled on ${prettyDateLong(selectedDate)}.` })} className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-semibold text-amber-700 hover:bg-amber-100" data-testid="scheduler-offday-override">
                Override this day
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  // ── Compact equipment access (secondary; not shown by default) ──
  const anyOffToday = operatingDays.some((o) => !o.isOperatingToday);
  const equipmentControl = equipment.length > 0 ? (
    <div className="relative">
      <button type="button" onClick={() => setEquipmentOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-slate-600"
        data-testid="scheduler-equipment-toggle">
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

  // Compact "what the calendar is currently showing" indicator (near times).
  const activeServiceIndicator = activeTab && activeTabLabel ? (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500" data-testid="scheduler-active-service">
      <span className={`h-2 w-2 rounded-full ${RESOURCE_DOT[activeTab]}`} />
      {activeTabLabel}{activeDurationMin ? ` · ${activeDurationMin} min` : ""}
    </span>
  ) : null;

  // ── Recommended (ACTIVE tab, concise) — populates only, never commits ──
  const recommendedBlock = !activeRequest ? null : activeRecommendation ? (
    <button type="button" onClick={() => { setLastScheduled(null); setTime(activeRecommendation.time); }}
      className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:bg-slate-50"
      data-testid="scheduler-recommended-use">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">{pretty12h(activeRecommendation.time)}</span>
        <span className="block truncate text-[11px] text-slate-500">{activeRecommendation.reason}</span>
      </span>
      <span className="shrink-0 rounded-full border border-slate-300 px-2 py-0.5 text-[9px] font-semibold uppercase text-slate-600">Use</span>
    </button>
  ) : (
    <p className="text-[11px] italic text-slate-400" data-testid="scheduler-recommended-empty">
      {activeIsOffDay ? `${activeTabLabel} isn't offered on this day — pick its next eligible day above.` : "No open times for this service today — try another day."}
    </p>
  );

  // ── Pending selection (a time is chosen but NOT yet scheduled) ──
  const pendingSlot = activeRequest && time ? slots.find((s) => s.time === time) ?? null : null;
  const pendingConflict = !!pendingSlot && !pendingSlot.fits;
  const pendingEnd = time && activeDurationMin ? minToHm(hmToMin(time) + activeDurationMin) : null;
  const activeUsNames = Array.from(usGroupSel).map(usNameOf);
  const scheduleLabel = !activeTab
    ? "Schedule"
    : activeTab === "ultrasound"
      ? `Schedule ${activeStudyCount} Ultrasound${activeStudyCount === 1 ? "" : "s"}`
      : `Schedule ${activeTabLabel}`;
  const editingPlaced =
    (activeTab === "brainwave" && brainPlaced) ||
    (activeTab === "vitalwave" && vitalPlaced);
  // Does the active tab still have unscheduled work (so a recommendation helps)?
  const activeHasWork = !activeTab
    ? false
    : activeTab === "ultrasound" ? usGroupSel.size > 0
      : activeTab === "brainwave" ? !(brainPlaced || existingOnSelectedDate.has("brainwave"))
        : !(vitalPlaced || existingOnSelectedDate.has("vitalwave"));

  // SELECTED APPOINTMENT — visible ONLY after a time is picked; the explicit
  // Schedule button here is the commit. A soft conflict routes through override.
  const selectedAppointment = activeRequest && activeTab && time ? (
    <div className={`rounded-lg border px-3 py-2.5 ${pendingConflict ? "border-red-200 bg-red-50" : "border-slate-300 bg-slate-50"}`} data-testid="scheduler-selected-appointment">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Selected</div>
      <div className="mt-0.5 flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${RESOURCE_DOT[activeTab]}`} />
        <span className="text-sm font-semibold text-slate-900">{activeTabLabel}</span>
      </div>
      {activeTab === "ultrasound" && activeUsNames.length > 0 ? (
        <div className="text-[12px] text-slate-600" data-testid="scheduler-selected-studies">{activeUsNames.join(" + ")}</div>
      ) : null}
      <div className="text-[12px] text-slate-600">{prettyDateLong(selectedDate)}</div>
      <div className="text-[13px] font-semibold tabular-nums text-slate-900" data-testid="scheduler-selected-time">{pretty12h(time)}{pendingEnd ? `–${pretty12h(pendingEnd)}` : ""}</div>
      {pendingConflict ? (
        <div className="mt-1 text-[11px] font-medium text-red-700" data-testid="scheduler-selected-conflict">
          {pendingSlot?.constraint === "off_day" ? "Not a normal service day." : pendingSlot?.constraint === "outage" ? "Equipment outage." : "At capacity."} An override reason is required.
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={() => setTime("")} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-100" data-testid="scheduler-selected-change">{pendingConflict ? "Choose another time" : "Change"}</button>
        <button type="button" disabled={scheduleMutation.isPending} onClick={scheduleActive} className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white ${pendingConflict ? "bg-amber-600 hover:bg-amber-700" : "bg-slate-900 hover:bg-slate-800"}`} data-testid="scheduler-schedule-active">
          <Check className="h-3.5 w-3.5" /> {pendingConflict ? "Override & Schedule" : editingPlaced ? "Confirm Reschedule" : scheduleLabel}
        </button>
      </div>
    </div>
  ) : null;

  // Next-unscheduled optional action (subtle; never auto-triggered).
  const nextUnscheduledTab = useMemo<TabKind | null>(() => {
    for (const k of chosenTabs) {
      if (k === activeTab) continue;
      if (k === "brainwave" && !(brainPlaced || existingOnSelectedDate.has("brainwave"))) return k;
      if (k === "vitalwave" && !(vitalPlaced || existingOnSelectedDate.has("vitalwave"))) return k;
      if (k === "ultrasound" && unscheduledUsStudies.length > 0) return k;
    }
    return null;
  }, [chosenTabs, activeTab, brainPlaced, vitalPlaced, unscheduledUsStudies.length, existingOnSelectedDate]);

  // Success confirmation — what was just added to the plan (no abrupt jump).
  const successBlock = lastScheduled && !time ? (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800" data-testid="scheduler-scheduled-success">
        <Check className="h-4 w-4 shrink-0 text-emerald-600" />
        <span><span className="font-semibold">{lastScheduled.label}</span> scheduled · {prettyDateShort(lastScheduled.isoDate)} · {pretty12h(lastScheduled.time)}</span>
      </div>
      {nextUnscheduledTab ? (
        <button type="button" onClick={() => activateTab(nextUnscheduledTab)} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-[12px] text-slate-600 hover:bg-slate-50" data-testid="scheduler-next-unscheduled">
          <span>Next unscheduled: <span className="font-semibold text-slate-800">{RESOURCE_LABELS[nextUnscheduledTab]}</span></span>
          <span className="shrink-0 rounded-full border border-slate-300 px-2 py-0.5 text-[9px] font-semibold uppercase text-slate-600">Go</span>
        </button>
      ) : null}
    </div>
  ) : null;

  // ── Day agenda (grouped by patient) ──
  const groupedAgenda = useMemo(() => {
    const groups: Array<{ patient: string; items: typeof agenda; startMin: string; endMin: string }> = [];
    for (const a of agenda) {
      const last = groups[groups.length - 1];
      if (last && last.patient === a.patient) { last.items.push(a); last.endMin = a.endTime > last.endMin ? a.endTime : last.endMin; }
      else groups.push({ patient: a.patient, items: [a], startMin: a.time, endMin: a.endTime });
    }
    return groups;
  }, [agenda]);
  const AGENDA_PREVIEW = 3;
  const agendaBody = (
    <div data-testid="scheduler-day-agenda">
      {agenda.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs italic text-slate-400">No appointments scheduled.</p>
      ) : (
        <div className={`flex flex-col gap-1 ${agendaExpanded ? "max-h-52 overflow-y-auto pr-1" : ""}`}>
          {(agendaExpanded ? groupedAgenda : groupedAgenda.slice(0, AGENDA_PREVIEW)).map((g, i) => (
            <div key={i} className="rounded-lg border border-slate-100 bg-white px-3 py-1.5" data-testid={`scheduler-agenda-item-${i}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[12px] font-semibold text-slate-800">{g.patient}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{pretty12h(g.startMin)}–{pretty12h(g.endMin)}</span>
              </div>
              <div className="mt-0.5 flex flex-col gap-0.5">
                {g.items.map((a, j) => (
                  <div key={j} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span className={`h-1.5 w-1.5 rounded-full ${RESOURCE_DOT[a.resourceType] ?? "bg-slate-300"}`} />
                    <span className="tabular-nums">{pretty12h(a.time)}–{pretty12h(a.endTime)}</span>
                    <span className="truncate">{RESOURCE_LABELS[a.resourceType] ?? a.service}</span>
                    {a.override ? (
                      <span
                        className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0 text-[9px] font-semibold uppercase text-amber-700"
                        data-testid={`scheduler-agenda-override-${i}-${j}`}
                        title={`${a.override.constraint === "off_day" ? "Off-day" : a.override.constraint === "outage" ? "Equipment" : "Capacity"} override\nReason: ${a.override.reason || "—"}${a.override.by ? `\nBy: ${a.override.by}` : ""}${a.override.at ? `\n${new Date(a.override.at).toLocaleString()}` : ""}`}
                      >
                        <AlertTriangle className="h-2.5 w-2.5" /> Override
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {groupedAgenda.length > AGENDA_PREVIEW ? (
            <button type="button" onClick={() => setAgendaExpanded((v) => !v)} className="self-start pt-0.5 text-[10px] font-medium text-slate-500 underline hover:text-slate-700" data-testid="scheduler-agenda-toggle">
              {agendaExpanded ? "Show less" : `View all ${groupedAgenda.length}`}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );

  // ── Patient block ──
  const patientBlock = (
    <div data-testid="scheduler-patient-block">
      {hasPatient ? (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-700">
              {(patient.name ?? "?").split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || <User className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900" data-testid="scheduler-patient-name">{patient.name ?? "Patient"}</div>
              <div className="truncate text-[11px] text-slate-500">{patient.dob ? `DOB ${patient.dob}` : null}{facility ? `${patient.dob ? " · " : ""}${facility}` : null}</div>
            </div>
          </div>
          <button type="button" onClick={() => { setPatient({ patientScreeningId: null, executionCaseId: null, name: null, dob: null, facility }); setPatientSearch(""); setVisitPlan(EMPTY_PLAN); setUsGroupSel(new Set()); setChosenTabs([]); setActiveTab(null); setTime(""); setLastScheduled(null); }} className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Change patient" data-testid="scheduler-change-patient">
            <X className="h-3.5 w-3.5" />
          </button>
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
                    <button key={m.patientScreeningId} type="button" onClick={() => { setPatient({ patientScreeningId: m.patientScreeningId, executionCaseId: null, name: m.name, dob: m.dob, facility: m.facility ?? facility }); setChosenTabs([]); setActiveTab(null); setUsGroupSel(new Set()); setVisitPlan(EMPTY_PLAN); }} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-slate-50" data-testid={`scheduler-patient-result-${m.patientScreeningId}`}>
                      <span className="min-w-0"><span className="block truncate text-sm text-slate-800">{m.name}</span><span className="block truncate text-[10px] text-slate-400">{m.facility ?? "—"}{m.dob ? ` · DOB ${m.dob}` : ""}</span></span>
                    </button>
                  )))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── PLAN summary (compact disclosure) ──
  const planBlock = plannedCount > 0 ? (
    <div data-testid="scheduler-plan">
      <button type="button" onClick={() => setPlanOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left" data-testid="scheduler-plan-toggle">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Plan</span>
        <span className="inline-flex items-center gap-1 text-[12px] text-slate-500">{plannedCount} appointment{plannedCount === 1 ? "" : "s"} planned <ChevronRight className={`h-3.5 w-3.5 transition-transform ${planOpen ? "rotate-90" : ""}`} /></span>
      </button>
      {planOpen ? (
        <div className="mt-1.5 flex flex-col gap-1" data-testid="scheduler-plan-list">
          {placedItems.slice().sort((a, b) => a.isoDate.localeCompare(b.isoDate) || a.startMinutes - b.startMinutes).map((b) => (
            <div key={b.key} className="flex items-center gap-2 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1 text-[12px] text-slate-700" data-testid={`scheduler-plan-item-${b.key}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RESOURCE_DOT[b.resourceType]}`} />
              <span className="w-[128px] shrink-0 tabular-nums font-semibold">{prettyDateShort(b.isoDate)} · {pretty12h(b.time)}</span>
              <span className="truncate">{b.label}</span>
              {b.override ? <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0 text-[9px] font-semibold uppercase text-amber-700"><AlertTriangle className="h-2.5 w-2.5" /> Override</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;

  const scheduleButton = (
    <button type="button" disabled={!canConfirm || scheduleMutation.isPending} onClick={() => setConfirmOpen(true)} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400" data-testid="scheduler-submit">
      {scheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
      Review &amp; Confirm{plannedCount > 0 ? ` (${plannedCount})` : ""}
    </button>
  );

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
            Place with Override
          </button>
        </div>
      </div>
    </>
  ) : null;

  // ── Confirmation summary (visit plan → one or more dates) ──
  const confirmGroups = useMemo(() => {
    const byDate = new Map<string, PlacedItem[]>();
    for (const b of placedItems) {
      const arr = byDate.get(b.isoDate);
      if (arr) arr.push(b); else byDate.set(b.isoDate, [b]);
    }
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, blocks]) => ({ date, blocks: blocks.sort((x, y) => x.startMinutes - y.startMinutes) }));
  }, [placedItems]);
  const confirmDialog = confirmOpen ? (
    <>
      <div className="absolute inset-0 z-40 rounded-2xl bg-slate-900/20" onClick={() => setConfirmOpen(false)} aria-hidden />
      <div className="absolute left-1/2 top-1/2 z-50 max-h-[92%] w-[380px] max-w-[94%] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl" data-testid="scheduler-confirm-dialog">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase tracking-tight text-slate-900"><CalendarDays className="h-4 w-4 text-slate-400" /> Confirm schedule</div>
        <p className="mb-3 text-[12px] text-slate-500">{patient.name ?? "Patient"}{confirmGroups.length > 1 ? ` · this visit spans ${confirmGroups.length} dates` : ""}.</p>
        {confirmGroups.length === 0 ? (
          <p className="text-[12px] italic text-slate-400">Assign a time to at least one service first.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {confirmGroups.map(({ date, blocks }) => (
              <div key={date} data-testid={`scheduler-confirm-date-${date}`}>
                <div className="mb-1 text-[12px] font-bold text-slate-900">{prettyDateLong(date)}</div>
                <div className="flex flex-col gap-0.5">
                  {blocks.map((b) => (
                    <div key={b.key} className="flex items-center gap-2 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1 text-[12px] text-slate-700" data-testid={`scheduler-confirm-block-${b.key}`}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RESOURCE_DOT[b.resourceType]}`} />
                      <span className="w-[92px] shrink-0 tabular-nums font-semibold">{pretty12h(b.time)}–{pretty12h(minToHm(b.startMinutes + b.durationMin))}</span>
                      <span className="truncate">{b.label}</span>
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

  // Available Times = grid + (active-tab) off-day banner. Soft conflict shows in
  // the SELECTED summary, not as a time-grid side effect.
  const availableTimesBlock = (
    <>
      {timeGrid}
      {offDayBanner ? <div className="mt-2">{offDayBanner}</div> : null}
    </>
  );

  // SCHEDULE surface: picker + tabs + active-tab body. Patient context adds the
  // read-only QUALIFIED FOR section above it; generic context does not.
  const scheduleSurface = (
    <div className="flex flex-col gap-2" data-testid="scheduler-schedule-surface">
      {picker}
      {tabsRow}
      {activeSingleStatus}
      {ultrasoundTabBody}
      {!activeTab && chosenTabs.length === 0 ? (
        <p className="text-[11px] italic text-slate-400" data-testid="scheduler-no-tab">Choose an ancillary to start scheduling.</p>
      ) : null}
    </div>
  );
  const scheduleTitle = hasPatient ? "Schedule" : "Appointment Type";

  // Pending / success / recommendation cluster (shared full + quick).
  const pendingCluster = (activeRequest || time || lastScheduled) ? (
    <div className="flex flex-col gap-2" data-testid="scheduler-pending-area">
      {selectedAppointment}
      {successBlock}
      {!time && activeRequest && activeHasWork ? recommendedBlock : null}
    </div>
  ) : null;

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
                  title={normal ? "Click to select · double-click for Quick Schedule" : `Not a normal ${activeTabLabel ?? "service"} day · still selectable`}
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
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quick Schedule</span>
                  <button type="button" onClick={() => setQuickDate(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" data-testid="scheduler-quick-close" aria-label="Close quick schedule"><X className="h-4 w-4" /></button>
                </div>
                {/* Quick Schedule uses the SAME picker + tabs + Available Times. */}
                <div className="flex flex-col gap-2.5">
                  <div className="text-sm font-semibold text-slate-900">{prettyDateLong(quickDate)}</div>
                  {patientBlock}
                  {hasPatient ? (
                    <div>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-700">Qualified For</div>
                      {qualifiedForSection}
                    </div>
                  ) : null}
                  <div className="relative">
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-700">{scheduleTitle}</div>
                    {scheduleSurface}
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Available Times</span>
                        {activeServiceIndicator}
                      </span>
                      {equipmentControl}
                    </div>
                    {availableTimesBlock}
                  </div>
                  {pendingCluster}
                  {planBlock}
                  <button type="button" disabled={!canConfirm || scheduleMutation.isPending} onClick={() => setConfirmOpen(true)} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400" data-testid="scheduler-quick-submit">
                    {scheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />} Review &amp; Confirm{plannedCount > 0 ? ` (${plannedCount})` : ""}
                  </button>
                  <button type="button" onClick={() => setQuickDate(null)} className="text-center text-[11px] font-medium text-slate-500 underline hover:text-slate-700" data-testid="scheduler-quick-expand">Expand to full Scheduler</button>
                </div>
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

          {/* PATIENT */}
          <Section title="Patient" first right={reviewTag} testId="scheduler-section-patient">
            {patientBlock}
          </Section>

          {/* QUALIFIED FOR — read-only Plexus IQ guidance (patient context only). */}
          {hasPatient ? (
            <Section title="Qualified For" testId="scheduler-section-qualified">
              {qualifiedForSection}
            </Section>
          ) : null}

          {/* SCHEDULE — the one picker + scheduling tabs + active-tab body. */}
          <Section title={scheduleTitle} testId="scheduler-section-schedule">
            {scheduleSurface}
          </Section>

          {/* AVAILABLE TIMES — driven by the ACTIVE tab, kept high. */}
          <Section title="Available Times" testId="scheduler-section-times" right={<span className="flex items-center gap-2">{activeServiceIndicator}{equipmentControl}</span>}>
            {availableTimesBlock}
          </Section>

          {/* SELECTED APPOINTMENT (pending) / success / recommendation. A time
              click lands here as a PENDING selection; the Schedule button
              commits it. Nothing advances automatically. */}
          {pendingCluster}

          {/* PLAN — compact disclosure (does not permanently occupy the panel). */}
          {planBlock ? <div className="border-t border-slate-100 pt-2.5">{planBlock}</div> : null}

          {scheduleButton}

          {/* TODAY'S SCHEDULE — context, last, collapsible. */}
          <Section title="Today's Schedule" testId="scheduler-section-agenda">
            {agendaBody}
          </Section>
        </div>
      </div>
    </div>
  );
}
