// Unified capacity-aware Scheduler (full + quick popover share this component).
//
// Rendered inside the Playground "schedule"/"calendar" workspace. Every full
// scheduling entry point (dock Calendar, left-rail Calendar tile, right-rail
// patient calendar, EHR schedule) opens THIS component; only the entry CONTEXT
// differs (patient/facility/services preselected or not).
//
// Layout: full month calendar (~65%) + scheduling panel (~35%), sized to fit
// the Playground viewport without page scroll. Service selection is a
// hierarchical MULTI-SELECT (BrainWave / VitalWave checkboxes + an expandable
// Ultrasound group of studies) sourced from the canonical ancillary service
// registry. Availability, conflicts, operating-day rules, and one-visit/split-
// visit plans all come from the ONE server availability engine. The write goes
// through the multi-service /api/scheduling/visit orchestration. Capacity and
// off-day conflicts are SOFT — an authorized user overrides with a reason.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
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
import { getAncillaryCategory } from "@shared/ancillaryCategory";

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

// One selected appointment service. Ultrasound studies are individual entries.
type SelectedService = {
  internalCode: string;
  displayName: string;
  resourceType: CapResourceType;
  plexusSourced: boolean;
};

// A SCHEDULING UNIT is one actionable service the user places on the calendar.
// Multi-select decides WHAT the patient needs; the ACTIVE unit decides what the
// calendar is currently scheduling. BrainWave + VitalWave are single-service
// units; every selected ultrasound study folds into ONE "Ultrasound ×N" unit
// (a single continuous block) unless a future advanced split-studies workflow
// is added.
type SchedulingUnit = {
  key: string; // stable per resource bucket: "brainwave" | "vitalwave" | "ultrasound"
  resourceType: CapResourceType;
  label: string; // "BrainWave" | "VitalWave" | "Ultrasound ×4"
  internalCodes: string[]; // canonical service code(s) written for this unit
  studyCount: number; // 1 for brainwave/vitalwave; N for ultrasound
};

// One placed block in the CLIENT-SIDE visit plan: an active unit assigned an
// exact date + time. The plan is the source of truth before the single grouped
// write; each block may carry its own soft-constraint override.
type PlanBlock = {
  unitKey: string;
  resourceType: CapResourceType;
  label: string;
  internalCodes: string[];
  studyCount: number;
  isoDate: string;
  time: string; // "HH:MM" start
  startMinutes: number;
  durationMin: number; // whole-unit occupancy (ultrasound = studies × perStudy)
  perStudyMin: number; // ultrasound per-study step (for sequential expansion)
  override?: { constraint: SoftConstraint; reason: string; category: string | null } | null;
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
const RESOURCE_DOT: Record<string, string> = { brainwave: "bg-violet-500", vitalwave: "bg-red-500", ultrasound: "bg-emerald-500" };
const OVERRIDE_CATEGORIES = [
  "machine available despite capacity model",
  "special clinic day",
  "provider/management request",
  "patient circumstance",
  "operational adjustment",
  "other",
];

// A right-panel section: strong header + content, separated by a subtle rule.
// No nested cards — keeps the panel airy and preserves vertical room.
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
  const [time, setTime] = useState<string>(context.initialTime ?? "");
  // Multi-select: internalCode -> SelectedService. (WHAT the patient needs.)
  const [selected, setSelected] = useState<Map<string, SelectedService>>(new Map());
  const [ultrasoundOpen, setUltrasoundOpen] = useState(false);
  // Appointment-types dropdown open state (the compact multi-select control).
  const [serviceMenuOpen, setServiceMenuOpen] = useState(false);
  // Compact equipment disclosure (secondary; not shown by default).
  const [equipmentOpen, setEquipmentOpen] = useState(false);
  // Today's Schedule collapse (keeps Available Times above the fold).
  const [agendaExpanded, setAgendaExpanded] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [quickDate, setQuickDate] = useState<string | null>(null);
  // The ACTIVE scheduling unit — WHAT the calendar is currently scheduling.
  // Exactly one at a time. null until units exist (then defaulted by effect).
  const [activeUnitKey, setActiveUnitKey] = useState<string | null>(null);
  // CLIENT-SIDE visit plan: unitKey -> placed block (date + time). Source of
  // truth before the single grouped write. Editable until the user confirms.
  const [visitPlan, setVisitPlan] = useState<Record<string, PlanBlock>>({});
  // Confirmation summary open state (shows every planned date before writing).
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Override dialog state — scoped to the unit being placed (per-service).
  const [overrideCtx, setOverrideCtx] = useState<{
    unitKey: string;
    constraint: SoftConstraint;
    time: string;
    message: string;
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideCategory, setOverrideCategory] = useState("");

  const [cursor, setCursor] = useState(() => {
    const d = new Date(`${selectedDate}T00:00:00`);
    const base = Number.isNaN(d.getTime()) ? new Date() : d;
    return { y: base.getFullYear(), m: base.getMonth() };
  });

  // ── Registry services for this facility ──
  const { data: services = [], isLoading: servicesLoading } = useQuery<RegistryService[]>({
    queryKey: ["service-registry-by-facility", facility],
    queryFn: () => fetchActiveServicesForFacility(facility),
    staleTime: 5 * 60_000,
  });
  const { brainwave, vitalwave, ultrasound } = useMemo(() => bucketServices(services), [services]);

  // ── Plexus IQ preselection (patient context only) ──
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
  const preselectedRef = useRef<number | null>(null);
  useEffect(() => {
    // Preselect once per patient — never clobber user edits after that.
    if (!qualification || patient.patientScreeningId == null) return;
    if (preselectedRef.current === patient.patientScreeningId) return;
    preselectedRef.current = patient.patientScreeningId;
    const next = new Map<string, SelectedService>();
    for (const s of qualification.services) {
      if (s.resourceType === "other") continue;
      next.set(s.internalCode, {
        internalCode: s.internalCode,
        displayName: s.displayName,
        resourceType: s.resourceType as CapResourceType,
        plexusSourced: true,
      });
    }
    if (next.size > 0) setSelected(next);
  }, [qualification, patient.patientScreeningId]);

  function toggleService(svc: { internalCode: string; displayName: string }, resourceType: CapResourceType) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(svc.internalCode)) next.delete(svc.internalCode);
      else next.set(svc.internalCode, { internalCode: svc.internalCode, displayName: svc.displayName, resourceType, plexusSourced: false });
      return next;
    });
  }

  const selectedList = useMemo(() => Array.from(selected.values()), [selected]);
  const ultrasoundSelected = useMemo(() => selectedList.filter((s) => s.resourceType === "ultrasound"), [selectedList]);

  // ── Scheduling UNITS (derived from the multi-select) ──
  // Bucket order (BrainWave → VitalWave → Ultrasound) doubles as the default
  // active-service priority; the ultrasound studies collapse into ONE unit.
  const units = useMemo<SchedulingUnit[]>(() => {
    const out: SchedulingUnit[] = [];
    const bw = selectedList.find((s) => s.resourceType === "brainwave");
    if (bw) out.push({ key: "brainwave", resourceType: "brainwave", label: "BrainWave", internalCodes: [bw.internalCode], studyCount: 1 });
    const vw = selectedList.find((s) => s.resourceType === "vitalwave");
    if (vw) out.push({ key: "vitalwave", resourceType: "vitalwave", label: "VitalWave", internalCodes: [vw.internalCode], studyCount: 1 });
    if (ultrasoundSelected.length > 0) {
      out.push({
        key: "ultrasound",
        resourceType: "ultrasound",
        label: `Ultrasound ×${ultrasoundSelected.length}`,
        internalCodes: ultrasoundSelected.map((s) => s.internalCode),
        studyCount: ultrasoundSelected.length,
      });
    }
    return out;
  }, [selectedList, ultrasoundSelected]);
  const unitByKey = useMemo(() => new Map(units.map((u) => [u.key, u])), [units]);

  const activeUnit = activeUnitKey ? unitByKey.get(activeUnitKey) ?? null : null;

  // The availability engine is asked about ONLY the active unit — so the time
  // grid, duration, conflict, and (below) the calendar eligibility all reflect
  // the service being scheduled RIGHT NOW, never the intersection of all
  // selected services.
  const activeRequest: CapServiceRequest | null = activeUnit
    ? activeUnit.resourceType === "ultrasound"
      ? { resourceType: "ultrasound", studyCount: activeUnit.studyCount }
      : { resourceType: activeUnit.resourceType }
    : null;
  const primary = activeRequest;

  const patientKey =
    patient.patientScreeningId != null ? `ps:${patient.patientScreeningId}`
      : patient.executionCaseId != null ? `ec:${patient.executionCaseId}` : null;

  // ── Availability (the ONE engine) — asked about the ACTIVE service only ──
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
  const selectedSlot = slots.find((s) => s.time === time) ?? null;

  // Off-day + duration info for the ACTIVE service on the selected date.
  const activeOpDay = activeUnit ? operatingDays.find((o) => o.resourceType === activeUnit.resourceType) ?? null : null;
  const activeIsOffDay = !!activeOpDay && !activeOpDay.isOperatingToday;
  const activeDurationMin = activeUnit ? durations[activeUnit.resourceType] ?? null : null;

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

  // ── Calendar eligibility — the ACTIVE service ONLY ──
  // A date is "normal" when the ACTIVE service is offered that weekday. We
  // deliberately do NOT intersect all selected services: the visible date
  // eligibility belongs to the service being scheduled right now. A patient can
  // need BrainWave (Mon–Fri) + Ultrasound (Tue/Thu) at once; the calendar must
  // not gray out Mon/Wed/Fri just because ultrasound is limited.
  const operatingDaysByResource = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const o of operatingDays) m.set(o.resourceType, o.days);
    return m;
  }, [operatingDays]);
  function isNormalDay(iso: string): boolean {
    if (!activeUnit || operatingDays.length === 0) return true;
    const days = operatingDaysByResource.get(activeUnit.resourceType) ?? [];
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

  // Drop any selected service that vanished from the registry.
  useEffect(() => {
    if (services.length === 0 || selected.size === 0) return;
    const codes = new Set(services.map((s) => s.internalCode));
    let changed = false;
    const next = new Map(selected);
    for (const code of next.keys()) if (!codes.has(code)) { next.delete(code); changed = true; }
    if (changed) setSelected(next);
  }, [services]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Existing appointments (dedupe) ──
  // Resource types this patient already has on the SELECTED date (read from the
  // day agenda). Such a unit is shown as an existing appointment and excluded
  // from the write so we never create a duplicate.
  const existingOnSelectedDate = useMemo(() => {
    const m = new Map<string, { time: string; endTime: string }>();
    if (!patient.name) return m;
    for (const a of agenda) {
      if (a.patient !== patient.name) continue;
      if (!m.has(a.resourceType)) m.set(a.resourceType, { time: a.time, endTime: a.endTime });
    }
    return m;
  }, [agenda, patient.name]);

  // A unit is "done" for auto-advance purposes when it is either placed in the
  // plan or already exists for the patient on the selected date.
  function unitIsPlaced(key: string): boolean {
    if (visitPlan[key]) return true;
    const u = unitByKey.get(key);
    return !!u && existingOnSelectedDate.has(u.resourceType);
  }
  function firstUnscheduledKey(): string | null {
    return units.find((u) => !unitIsPlaced(u.key))?.key ?? units[0]?.key ?? null;
  }

  // Reconcile the plan when the selection changes: drop uncommitted blocks whose
  // unit no longer exists (service unchecked), and keep the ultrasound block's
  // study set current. Persisted existing appointments are never touched here.
  useEffect(() => {
    setVisitPlan((prev) => {
      let changed = false;
      const next: Record<string, PlanBlock> = {};
      for (const [k, b] of Object.entries(prev)) {
        const u = unitByKey.get(k);
        if (!u) { changed = true; continue; }
        if (u.studyCount !== b.studyCount || u.label !== b.label) {
          next[k] = { ...b, studyCount: u.studyCount, label: u.label, internalCodes: u.internalCodes, durationMin: b.perStudyMin * u.studyCount };
          changed = true;
        } else {
          next[k] = b;
        }
      }
      return changed ? next : prev;
    });
  }, [unitByKey]);

  // Default / repair the ACTIVE unit: first unscheduled selected service by
  // bucket order; falls back to the first unit. Runs whenever units change.
  useEffect(() => {
    setActiveUnitKey((cur) => {
      if (cur && unitByKey.has(cur)) return cur;
      return firstUnscheduledKey();
    });
  }, [unitByKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const plannedBlocks = useMemo(() => Object.values(visitPlan), [visitPlan]);
  const canConfirm = hasPatient && plannedBlocks.length > 0;

  // Advance to the next unscheduled unit (skipping `justPlaced`). If everything
  // is placed, keep focus on the just-placed unit so the user can still edit it.
  function advanceActive(justPlaced: string) {
    const nextUnit =
      units.find((u) => u.key !== justPlaced && !unitIsPlaced(u.key) && !visitPlan[u.key]) ?? null;
    setActiveUnitKey(nextUnit ? nextUnit.key : justPlaced);
  }

  // Place the ACTIVE unit into the visit plan at the given time on the selected
  // date, then auto-advance. `startMinutes` comes from the chosen slot when
  // available; otherwise it is derived from the time string.
  function placeActiveUnit(
    at: { time: string; startMinutes?: number },
    override?: { constraint: SoftConstraint; reason: string; category: string | null } | null,
  ) {
    if (!activeUnit) return;
    // Dedupe: never place a service on a date where the patient already has one
    // (existingOnSelectedDate is scoped to the selected date's agenda).
    if (existingOnSelectedDate.has(activeUnit.resourceType)) {
      toast({ title: "Already scheduled", description: `${activeUnit.label} already has an appointment on ${prettyDateShort(selectedDate)}.` });
      return;
    }
    const startMinutes = at.startMinutes ?? hmToMin(at.time);
    const perStudyMin =
      activeUnit.resourceType === "ultrasound"
        ? Math.max(5, Math.round((activeDurationMin ?? 15 * activeUnit.studyCount) / activeUnit.studyCount))
        : activeDurationMin ?? 0;
    const durationMin = activeDurationMin ?? (activeUnit.resourceType === "ultrasound" ? perStudyMin * activeUnit.studyCount : 0);
    const block: PlanBlock = {
      unitKey: activeUnit.key,
      resourceType: activeUnit.resourceType,
      label: activeUnit.label,
      internalCodes: activeUnit.internalCodes,
      studyCount: activeUnit.studyCount,
      isoDate: selectedDate,
      time: at.time,
      startMinutes,
      durationMin,
      perStudyMin,
      override: override ?? null,
    };
    setVisitPlan((prev) => ({ ...prev, [activeUnit.key]: block }));
    setTime("");
    advanceActive(activeUnit.key);
  }

  function removePlanBlock(key: string) {
    setVisitPlan((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // ── Write via the multi-service visit endpoint ──
  type WriteGroup = {
    date: string;
    services: Array<{ serviceType: string; time: string }>;
    overrides?: Record<string, { constraint: SoftConstraint; reason: string; category?: string | null; capacityState?: Record<string, unknown> }>;
  };
  // Map the CLIENT visit plan → the existing grouped visit endpoint. Blocks are
  // grouped by date; the ultrasound unit expands into sequential per-study
  // events (T, T+perStudy, …) so the single machine is never double-booked.
  // Per-block overrides ride along keyed by serviceType.
  function buildGroupsFromPlan(): WriteGroup[] {
    const byDate = new Map<string, WriteGroup>();
    const ordered = [...plannedBlocks].sort((a, b) =>
      a.isoDate === b.isoDate ? a.startMinutes - b.startMinutes : a.isoDate.localeCompare(b.isoDate),
    );
    for (const b of ordered) {
      const g = byDate.get(b.isoDate) ?? { date: b.isoDate, services: [] };
      const addOverride = (code: string) => {
        if (!b.override) return;
        (g.overrides ??= {})[code] = {
          constraint: b.override.constraint,
          reason: b.override.reason,
          category: b.override.category,
          capacityState: { operatingDays },
        };
      };
      if (b.resourceType === "ultrasound") {
        let t = b.startMinutes;
        for (const code of b.internalCodes) {
          g.services.push({ serviceType: code, time: minToHm(t) });
          addOverride(code);
          t += b.perStudyMin || 15;
        }
      } else {
        g.services.push({ serviceType: b.internalCodes[0], time: b.time });
        addOverride(b.internalCodes[0]);
      }
      byDate.set(b.isoDate, g);
    }
    return Array.from(byDate.values());
  }

  // ── Write via the multi-service visit endpoint (grouped, multi-date) ──
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
      if (!res.ok && res.status !== 200) {
        throw new Error(body?.error ?? `Visit scheduling failed (${res.status})`);
      }
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
        setVisitPlan({});
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

  // Click a time slot for the ACTIVE unit: a fitting slot places immediately +
  // auto-advances; a conflicted slot (full / off-day / outage) opens the
  // per-service override dialog first.
  function onPickSlot(slot: { time: string; startMinutes: number; fits: boolean; constraint?: SoftConstraint }) {
    if (!activeUnit) return;
    setTime(slot.time);
    if (slot.fits) {
      placeActiveUnit({ time: slot.time, startMinutes: slot.startMinutes });
      return;
    }
    setOverrideCtx({
      unitKey: activeUnit.key,
      constraint: slot.constraint ?? "full",
      time: slot.time,
      message:
        slot.constraint === "off_day"
          ? `${activeUnit.label} is not normally scheduled on ${prettyDateLong(selectedDate)}.`
          : slot.constraint === "outage"
            ? `${activeUnit.label} is unavailable (equipment outage) at ${pretty12h(slot.time)}.`
            : `${activeUnit.label} capacity is full at ${pretty12h(slot.time)}.`,
    });
  }

  // Confirm a per-service override → place the ACTIVE unit WITH the override.
  // The override stays attached to that one service/date/time only.
  function confirmOverride() {
    if (!overrideCtx || !overrideReason.trim()) return;
    if (activeUnit && overrideCtx.unitKey === activeUnit.key) {
      placeActiveUnit(
        { time: overrideCtx.time, startMinutes: hmToMin(overrideCtx.time) },
        { constraint: overrideCtx.constraint, reason: overrideReason.trim(), category: overrideCategory || null },
      );
    }
    setOverrideCtx(null);
    setOverrideReason("");
    setOverrideCategory("");
  }

  // ── Recommendation for the ACTIVE service (client-side smart hint) ──
  // Keeps the visit tight: if other services are already placed on the selected
  // date, recommend the first fitting slot AT/AFTER their latest end (minimize
  // patient idle time). Otherwise the earliest fitting slot.
  const activeRecommendation = useMemo(() => {
    if (!activeUnit) return null;
    const fitting = slots.filter((s) => s.fits);
    if (fitting.length === 0) return null;
    const sameDayEnds = plannedBlocks
      .filter((b) => b.isoDate === selectedDate && b.unitKey !== activeUnit.key)
      .map((b) => b.startMinutes + b.durationMin);
    if (sameDayEnds.length > 0) {
      const after = Math.max(...sameDayEnds);
      const seq = fitting.find((s) => s.startMinutes >= after);
      if (seq) return { time: seq.time, startMinutes: seq.startMinutes, reason: "Right after the previous service — same visit" };
    }
    const first = fitting[0];
    return { time: first.time, startMinutes: first.startMinutes, reason: sameDayEnds.length > 0 ? "Next open time today" : "Earliest available" };
  }, [activeUnit, slots, plannedBlocks, selectedDate]);

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

  // ── Admin-review + Plexus summary tags ──
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
  const plexusCount = qualification?.services.filter((s) => s.resourceType !== "other").length ?? 0;

  // ── Appointment types: compact multi-select DROPDOWN ──
  // Closed = a single control row summarizing the selection. Opening reveals
  // BrainWave / VitalWave checkboxes + a nested Ultrasound sub-list. The
  // closed control keeps Available Times above the fold.
  const serviceSummary = (() => {
    const parts: string[] = [];
    if (brainwave && selected.has(brainwave.internalCode)) parts.push("BrainWave");
    if (vitalwave && selected.has(vitalwave.internalCode)) parts.push("VitalWave");
    if (ultrasoundSelected.length > 0) parts.push(`Ultrasound (${ultrasoundSelected.length})`);
    return parts.length > 0 ? parts.join(", ") : "Select appointment types";
  })();
  const serviceSelector = (
    <div data-testid="scheduler-service-selector">
      {servicesLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading services…</div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setServiceMenuOpen((v) => !v)}
            className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${selectedList.length > 0 ? "border-slate-300 bg-white text-slate-800" : "border-slate-200 bg-white text-slate-400"} hover:bg-slate-50`}
            data-testid="scheduler-service-dropdown"
            aria-expanded={serviceMenuOpen}
          >
            <span className="truncate font-medium">{serviceSummary}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${serviceMenuOpen ? "rotate-180" : ""}`} />
          </button>
          {selectedList.some((s) => s.plexusSourced) ? (
            <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-indigo-500" data-testid="scheduler-plexus-hint"><Sparkles className="h-3 w-3" /> Selected from Plexus IQ</div>
          ) : null}
          {serviceMenuOpen && (
            <div className="mt-1 rounded-lg border border-slate-200 bg-white py-1 shadow-sm" data-testid="scheduler-service-menu">
              {brainwave && (
                <button type="button" onClick={() => toggleService(brainwave, "brainwave")}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-slate-50 ${selected.has(brainwave.internalCode) ? "text-violet-700" : "text-slate-700"}`}
                  data-testid="scheduler-service-brainwave" aria-pressed={selected.has(brainwave.internalCode)}>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected.has(brainwave.internalCode) ? "border-violet-500 bg-violet-500 text-white" : "border-slate-300"}`}>{selected.has(brainwave.internalCode) ? <Check className="h-3 w-3" /> : null}</span>
                  <span className="inline-block h-2 w-2 rounded-full bg-violet-500" /> BrainWave
                </button>
              )}
              {vitalwave && (
                <button type="button" onClick={() => toggleService(vitalwave, "vitalwave")}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-slate-50 ${selected.has(vitalwave.internalCode) ? "text-red-700" : "text-slate-700"}`}
                  data-testid="scheduler-service-vitalwave" aria-pressed={selected.has(vitalwave.internalCode)}>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected.has(vitalwave.internalCode) ? "border-red-500 bg-red-500 text-white" : "border-slate-300"}`}>{selected.has(vitalwave.internalCode) ? <Check className="h-3 w-3" /> : null}</span>
                  <span className="inline-block h-2 w-2 rounded-full bg-red-500" /> VitalWave
                </button>
              )}
              {ultrasound.length > 0 && (
                <div className="border-t border-slate-100">
                  <button type="button" onClick={() => setUltrasoundOpen((v) => !v)}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors hover:bg-slate-50 ${ultrasoundSelected.length > 0 ? "text-emerald-700" : "text-slate-700"}`}
                    data-testid="scheduler-service-ultrasound" aria-expanded={ultrasoundOpen}>
                    <span className="flex items-center gap-2 truncate">
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                      Ultrasound{ultrasoundSelected.length > 0 ? ` (${ultrasoundSelected.length})` : ""}
                    </span>
                    <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${ultrasoundOpen ? "rotate-90" : ""}`} />
                  </button>
                  {ultrasoundOpen && (
                    <div className="max-h-52 overflow-y-auto border-t border-slate-100 bg-slate-50/50 py-1" data-testid="scheduler-ultrasound-menu">
                      {ultrasound.map((u) => {
                        const on = selected.has(u.internalCode);
                        return (
                          <button key={u.internalCode} type="button" onClick={() => toggleService(u, "ultrasound")}
                            className={`flex w-full items-center gap-2 py-1.5 pl-6 pr-3 text-left text-sm transition-colors hover:bg-emerald-50 ${on ? "text-emerald-700" : "text-slate-700"}`}
                            data-testid={`scheduler-ultrasound-option-${u.internalCode}`} aria-pressed={on}>
                            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300"}`}>{on ? <Check className="h-3 w-3" /> : null}</span>
                            <span className="min-w-0"><span className="block truncate">{u.displayName}</span>{u.cptCode ? <span className="block text-[10px] text-slate-400">CPT {u.cptCode}</span> : null}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  // ── Time grid (compact, 15-min). No machine-count clutter — a conflicted
  // slot is marked FULL and, when selected, routes through the override flow
  // where the detailed reason is shown. ──
  const activePlanned = activeUnit ? visitPlan[activeUnit.key] ?? null : null;
  const timeGrid = !primary ? (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs italic text-slate-400">Choose one or more appointment types to see availability.</p>
  ) : slots.length === 0 ? (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs italic text-slate-400">Loading availability…</p>
  ) : (
    <div className="grid grid-cols-4 gap-1.5" data-testid="scheduler-time-slots">
      {slots.map((slot) => {
        // Highlight the slot this active unit is currently placed at (if any),
        // else the transient focus time.
        const isSel = (activePlanned && activePlanned.isoDate === selectedDate ? activePlanned.time : time) === slot.time;
        const offDay = slot.constraint === "off_day";
        const full = slot.constraint === "full" || slot.constraint === "outage";
        // Not disabled — a conflicted slot opens the per-service override flow.
        return (
          <button key={slot.time} type="button" onClick={() => onPickSlot(slot)}
            className={`relative rounded-lg border px-1 py-1.5 text-center text-[12px] font-medium tabular-nums transition-colors ${
              isSel ? "border-transparent bg-slate-900 text-white"
                : full ? "border-red-100 bg-red-50/50 text-red-400 hover:bg-red-100"
                  : offDay ? "border-amber-100 bg-amber-50/50 text-amber-500 hover:bg-amber-100"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
            title={full ? "At capacity — selecting will prompt an override" : offDay ? "Not a normal service day — selecting will prompt an override" : undefined}
            data-testid={`scheduler-slot-${slot.time}`}>
            <span className="leading-none">{pretty12h(slot.time)}</span>
            {full ? <span className="ml-1 text-[8px] font-semibold uppercase text-red-400" data-testid={`scheduler-slot-full-${slot.time}`}>full</span> : null}
          </button>
        );
      })}
    </div>
  );

  // ── Off-day banner (ACTIVE service) + its OWN next eligible day ──
  // Only the active service's day rule applies here — never the whole visit.
  const offDayBanner = activeIsOffDay && activeOpDay && activeUnit ? (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800" data-testid="scheduler-offday-banner">
      <div className="flex items-start gap-1.5">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          {activeUnit.label} is not normally scheduled{facility ? ` at ${facility}` : ""} on {WEEKDAYS[weekdayOf(selectedDate)] ?? "this day"}s.
          {activeOpDay.nextEligibleDay ? (
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="button" onClick={() => { setSelectedDate(activeOpDay.nextEligibleDay!); setTime(""); }} className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-semibold text-amber-700 hover:bg-amber-100" data-testid="scheduler-offday-choose-next">
                Choose {prettyDateLong(activeOpDay.nextEligibleDay)}
              </button>
              <button type="button" onClick={() => setOverrideCtx({ unitKey: activeUnit.key, constraint: "off_day", time: time || slots.find((s) => s.capacityFits)?.time || slots[0]?.time || "09:00", message: `${activeUnit.label} is not normally scheduled on ${prettyDateLong(selectedDate)}.` })} className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-semibold text-amber-700 hover:bg-amber-100" data-testid="scheduler-offday-override">
                Override this day
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  // ── Conflict indicator (ACTIVE service) ──
  const conflictBanner = activeUnit && time && selectedSlot && !selectedSlot.fits && selectedSlot.constraint !== "off_day" ? (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700" data-testid="scheduler-conflict">
      <span className="font-semibold">Conflict.</span>{" "}
      {activeUnit.label} {selectedSlot.constraint === "outage" ? "is unavailable" : "is full"} at {pretty12h(time)}.
      {availability?.conflict?.nextAvailableMinutes != null ? (
        <> {" "}Next available{" "}
          <button type="button" className="font-semibold underline" onClick={() => { const m = availability.conflict!.nextAvailableMinutes!; setTime(minToHm(m)); }} data-testid="scheduler-conflict-next">
            {pretty12h(minToHm(availability.conflict.nextAvailableMinutes))}
          </button>.
        </>
      ) : null}
    </div>
  ) : null;

  // ── Compact equipment access (secondary) ──
  // Machine inventory is NOT shown by default in the scheduler — it lives in
  // Admin Settings → Scheduling Capacity and drives the engine. This is a quiet
  // on-demand disclosure for PCS/ACS who need to sanity-check today's machines.
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

  // ── Recommended (ACTIVE service, concise) ──
  // One best time for the service being placed + a one-line reason. Same-day
  // sequencing is preferred when other services are already on this date.
  const recommendedBlock = !activeUnit ? (
    <p className="text-[11px] italic text-slate-400" data-testid="scheduler-recommended-empty">Select appointment types to see a recommendation.</p>
  ) : activeRecommendation ? (
    <button type="button" onClick={() => placeActiveUnit({ time: activeRecommendation.time, startMinutes: activeRecommendation.startMinutes })}
      className="flex w-full items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-left transition-colors hover:bg-emerald-100"
      data-testid="scheduler-recommended-use">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">{pretty12h(activeRecommendation.time)} · {activeUnit.label}</span>
        <span className="block truncate text-[11px] text-slate-600">{activeRecommendation.reason}</span>
      </span>
      <span className="shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">Use</span>
    </button>
  ) : (
    <p className="text-[11px] italic text-slate-400" data-testid="scheduler-recommended-empty">
      {activeIsOffDay ? `${activeUnit.label} isn't offered on this day — pick its next eligible day below.` : "No open times for this service today — try another day."}
    </p>
  );

  // ── SCHEDULE EACH SERVICE (units) ──
  // One actionable row per selected unit: click to activate (calendar + times
  // switch to that service); status shows Not scheduled / date + time /
  // Existing appointment. Doubles as the running visit-plan summary.
  const ACTIVE_TINT: Record<string, string> = { brainwave: "border-violet-300 bg-violet-50", vitalwave: "border-red-300 bg-red-50", ultrasound: "border-emerald-300 bg-emerald-50" };
  const unitsSection = units.length === 0 ? (
    <p className="text-[11px] italic text-slate-400" data-testid="scheduler-units-empty">Choose appointment types to schedule each service.</p>
  ) : (
    <div className="flex flex-col gap-1" data-testid="scheduler-units">
      {units.map((u) => {
        const isActive = activeUnitKey === u.key;
        const block = visitPlan[u.key];
        const existing = existingOnSelectedDate.get(u.resourceType);
        const scheduled = !!block;
        return (
          <button key={u.key} type="button"
            onClick={() => { setActiveUnitKey(u.key); if (block) setSelectedDate(block.isoDate); setTime(""); }}
            className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left transition-colors ${isActive ? (ACTIVE_TINT[u.resourceType] ?? "border-slate-300 bg-slate-50") : "border-slate-200 bg-white hover:bg-slate-50"}`}
            data-testid={`scheduler-unit-${u.key}`} aria-pressed={isActive}>
            <span className="flex min-w-0 items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${RESOURCE_DOT[u.resourceType] ?? "bg-slate-300"}`} />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-900">
                  {scheduled ? <Check className="h-3 w-3 text-emerald-600" /> : null}
                  {u.label}
                  {isActive ? <span className="rounded bg-slate-900 px-1 py-0 text-[8px] font-bold uppercase tracking-wide text-white" data-testid="scheduler-unit-active">Active</span> : null}
                </span>
                <span className="block truncate text-[11px] text-slate-500" data-testid={`scheduler-unit-status-${u.key}`}>
                  {scheduled
                    ? `${prettyDateShort(block.isoDate)} · ${pretty12h(block.time)}${block.override ? " · override" : ""}`
                    : existing
                      ? `Existing appointment · ${pretty12h(existing.time)}`
                      : "Not scheduled"}
                </span>
              </span>
            </span>
            {scheduled ? (
              <span role="button" tabIndex={0}
                onClick={(e) => { e.stopPropagation(); removePlanBlock(u.key); setActiveUnitKey(u.key); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); removePlanBlock(u.key); setActiveUnitKey(u.key); } }}
                className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600" title="Clear this service's time" data-testid={`scheduler-unit-clear-${u.key}`}>
                <X className="h-3 w-3" />
              </span>
            ) : null}
          </button>
        );
      })}
      <div className="pt-0.5 text-[10px] font-medium text-slate-400" data-testid="scheduler-units-progress">
        {plannedBlocks.length} of {units.length} scheduled
      </div>
    </div>
  );

  // Compact "what the calendar is currently showing" indicator.
  const activeServiceIndicator = activeUnit ? (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500" data-testid="scheduler-active-service">
      <span className={`h-2 w-2 rounded-full ${RESOURCE_DOT[activeUnit.resourceType] ?? "bg-slate-300"}`} />
      {activeUnit.label}{activeDurationMin ? ` · ${activeDurationMin} min` : ""}
    </span>
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
  // Today's Schedule body — constrained internal scroll so a busy day never
  // pushes Available Times off-screen. Collapsed to a preview by default.
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
                      // Operational indicator — an appointment scheduled past a
                      // normal constraint. Hover shows why/who/when.
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

  // ── Patient block (compact — lives inside the PATIENT section) ──
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
          <button type="button" onClick={() => { setPatient({ patientScreeningId: null, executionCaseId: null, name: null, dob: null, facility }); setPatientSearch(""); setSelected(new Map()); preselectedRef.current = null; }} className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Change patient" data-testid="scheduler-change-patient">
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
                    <button key={m.patientScreeningId} type="button" onClick={() => { setPatient({ patientScreeningId: m.patientScreeningId, executionCaseId: null, name: m.name, dob: m.dob, facility: m.facility ?? facility }); preselectedRef.current = null; }} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-slate-50" data-testid={`scheduler-patient-result-${m.patientScreeningId}`}>
                      <span className="min-w-0"><span className="block truncate text-sm text-slate-800">{m.name}</span><span className="block truncate text-[10px] text-slate-400">{m.facility ?? "—"}{m.dob ? ` · DOB ${m.dob}` : ""}</span></span>
                    </button>
                  )))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const scheduleButton = (
    <button type="button" disabled={!canConfirm || scheduleMutation.isPending} onClick={() => setConfirmOpen(true)} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400" data-testid="scheduler-submit">
      {scheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
      Review &amp; Confirm{plannedBlocks.length > 0 ? ` (${plannedBlocks.length})` : ""}
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
            {scheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Schedule Anyway
          </button>
        </div>
      </div>
    </>
  ) : null;

  // ── Confirmation summary (visit plan → one or more dates) ──
  // Built entirely from the CLIENT visit plan; the user sees every date and its
  // service blocks before the single grouped write. Works for one date or many.
  const confirmGroups = useMemo(() => {
    const byDate = new Map<string, PlanBlock[]>();
    for (const b of plannedBlocks) {
      const arr = byDate.get(b.isoDate);
      if (arr) arr.push(b);
      else byDate.set(b.isoDate, [b]);
    }
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, blocks]) => ({ date, blocks: blocks.sort((x, y) => x.startMinutes - y.startMinutes) }));
  }, [plannedBlocks]);
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
                    <div key={b.unitKey} className="flex items-center gap-2 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1 text-[12px] text-slate-700" data-testid={`scheduler-confirm-block-${b.unitKey}`}>
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
        {patient.patientScreeningId != null && qualification && plexusCount > 0 ? (
          <span className="text-[11px] text-slate-500" data-testid="scheduler-plexus-summary">Plexus IQ: {plexusCount} ancillar{plexusCount === 1 ? "y" : "ies"}</span>
        ) : null}
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
                    isSelected ? "border-transparent bg-slate-900 text-white"
                      : isToday ? "border-slate-300 bg-slate-50 text-slate-900"
                        : !normal ? "border-slate-100 bg-slate-50/40 text-slate-300 hover:bg-slate-50"
                          : "border-slate-100 text-slate-700 hover:bg-slate-50"}`}
                  title={normal ? "Click to select · double-click for Quick Schedule" : `Not a normal ${activeUnit ? activeUnit.label : "service"} day · still selectable`}
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
                {/* Quick Schedule shares the SAME appointment-types dropdown,
                    recommendation, and capacity-aware time grid as the full
                    Scheduler — just compact. */}
                <div className="flex flex-col gap-2.5">
                  <div className="text-sm font-semibold text-slate-900">{prettyDateLong(quickDate)}</div>
                  {patientBlock}
                  <div>
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-700">Appointment Types</div>
                    {serviceSelector}
                  </div>
                  {units.length > 0 ? (
                    <div>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-700">Schedule Each Service</div>
                      {unitsSection}
                    </div>
                  ) : null}
                  {activeUnit ? (
                    <div>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-700">Recommended</div>
                      {recommendedBlock}
                    </div>
                  ) : null}
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Available Times</span>
                        {activeServiceIndicator}
                      </span>
                      {equipmentControl}
                    </div>
                    {timeGrid}
                    {(offDayBanner || conflictBanner) ? <div className="mt-2 flex flex-col gap-2">{offDayBanner}{conflictBanner}</div> : null}
                  </div>
                  <button type="button" disabled={!canConfirm || scheduleMutation.isPending} onClick={() => setConfirmOpen(true)} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400" data-testid="scheduler-quick-submit">
                    {scheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />} Review &amp; Confirm{plannedBlocks.length > 0 ? ` (${plannedBlocks.length})` : ""}
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
          {/* Selected date / clinic */}
          <div>
            <div className="text-base font-bold uppercase tracking-tight text-slate-900" data-testid="scheduler-selected-date">{prettyDateLong(selectedDate)}</div>
            {facility ? <div className="text-[11px] text-slate-500">{facility}</div> : null}
          </div>

          {/* PATIENT */}
          <Section title="Patient" first right={reviewTag} testId="scheduler-section-patient">
            {patientBlock}
          </Section>

          {/* APPOINTMENT TYPES — WHAT the patient needs (multi-select). */}
          <Section title="Appointment Types" testId="scheduler-section-types">
            {serviceSelector}
          </Section>

          {/* SCHEDULE EACH SERVICE — WHAT the calendar is scheduling now. */}
          <Section title="Schedule Each Service" testId="scheduler-section-units">
            {unitsSection}
          </Section>

          {/* RECOMMENDED — best time for the ACTIVE service. */}
          <Section title="Recommended" testId="scheduler-section-recommended">
            {recommendedBlock}
          </Section>

          {/* AVAILABLE TIMES — kept high so it's visible without scrolling. */}
          <Section title="Available Times" testId="scheduler-section-times" right={<span className="flex items-center gap-2">{activeServiceIndicator}{equipmentControl}</span>}>
            {timeGrid}
            {(offDayBanner || conflictBanner) ? <div className="mt-2 flex flex-col gap-2">{offDayBanner}{conflictBanner}</div> : null}
          </Section>

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
