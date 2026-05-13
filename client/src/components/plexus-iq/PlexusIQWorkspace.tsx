import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import QualificationPatientCardsPane from "@/components/qualification/QualificationPatientCardsPane";
import type { ScreeningBatch, PatientScreening } from "@shared/schema";
import type { CalendarSummaryRow } from "@/components/plexus-iq/PlexusIQCalendar";

// Plexus IQ interior workspace.
//
// Default view is status-first (Needs Completion) so the operator sees
// the work that needs completion, not every finalized card.
//
// Tabs:
//   - Needs Completion (default) — only groups with incomplete/error patients
//   - Finalized                  — groups with completed/finalized patients
//   - Scheduled                  — groups for dated batches (facility/date schedule access snapshot)
//   - All Patients               — preserves the legacy facility/date accordion
//
// Right-side calendar drawer (UniversalCalendarDrawer, opened from the
// header calendar icon in plexus-iq.tsx) is OUT OF SCOPE for this view
// and is intentionally untouched.

type BatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

type PlexusIQWorklistGroup = {
  key: string;
  facility: string;
  row: CalendarSummaryRow;
  batchId: number;
  scheduleDate: string | null;
  dateLabel: string;
  patients: PatientScreening[];
  incompletePatients: PatientScreening[];
  finalizedPatients: PatientScreening[];
  scheduledPatients: PatientScreening[];
  totalCount: number;
  incompleteCount: number;
  finalizedCount: number;
  scheduledCount: number;
  errorCount: number;
  detailReady: boolean;
};

function formatDateLabel(scheduleDate: string | null | undefined): string {
  if (!scheduleDate) return "Outreach (no date)";
  const [yyyy, mm, dd] = scheduleDate.split("-").map(Number);
  if (!yyyy || !mm || !dd) return scheduleDate;
  const d = new Date(yyyy, mm - 1, dd);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function pendingFinal(detail: BatchWithPatients | undefined) {
  if (!detail?.patients) return { pending: null as number | null, final: null as number | null };
  let pending = 0;
  let final = 0;
  for (const p of detail.patients) {
    if (p.status === "completed") final += 1;
    else pending += 1;
  }
  return { pending, final };
}

// Per-patient classification helpers.
//
// Light/incomplete work should stay in Needs Completion so the default
// view answers "what needs my attention right now?".
//
// Final/completed work stays accessible in Finalized and in All Patients
// but does not clog the default queue.
//
// Scheduled is a facility/date schedule-access layer — not a replacement
// for the right-panel calendar drawer.
function isFinalized(p: PatientScreening): boolean {
  return p.status === "completed";
}
function isErrored(p: PatientScreening): boolean {
  return p.status === "error";
}
function isIncomplete(p: PatientScreening): boolean {
  if (isFinalized(p)) return false;
  return true;
}
function isScheduled(p: PatientScreening, batchScheduleDate: string | null): boolean {
  // For now, "scheduled" is conservative: any patient inside a dated
  // batch, or any patient flagged as a clinic visit (vs outreach).
  if (batchScheduleDate) return true;
  if (p.patientType === "visit") return true;
  return false;
}

function classifyGroup(
  row: CalendarSummaryRow,
  detail: BatchWithPatients | undefined,
  facility: string,
): PlexusIQWorklistGroup {
  const patients = detail?.patients ?? [];
  const incompletePatients = patients.filter(isIncomplete);
  const finalizedPatients = patients.filter(isFinalized);
  const scheduledPatients = patients.filter((p) => isScheduled(p, row.scheduleDate ?? null));
  const errorCount = patients.filter(isErrored).length;
  return {
    key: `${facility}::${row.id}`,
    facility,
    row,
    batchId: row.id,
    scheduleDate: row.scheduleDate ?? null,
    dateLabel: formatDateLabel(row.scheduleDate),
    patients,
    incompletePatients,
    finalizedPatients,
    scheduledPatients,
    totalCount: row.patientCount,
    incompleteCount: incompletePatients.length,
    finalizedCount: finalizedPatients.length,
    scheduledCount: scheduledPatients.length,
    errorCount,
    detailReady: !!detail?.patients,
  };
}

function IconButton({
  label,
  testId,
  onClick,
  disabled,
  variant = "default",
  children,
}: {
  label: string;
  testId: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  variant?: "default" | "danger";
  children: React.ReactNode;
}) {
  const base =
    "inline-flex items-center justify-center h-8 w-8 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const tone =
    variant === "danger"
      ? "text-red-500 hover:text-red-600 hover:bg-red-50"
      : "text-slate-500 hover:text-slate-900 hover:bg-slate-100";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`${base} ${tone}`}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

type WorklistGroupCardProps = {
  group: PlexusIQWorklistGroup;
  mode: "needs" | "finalized" | "scheduled";
  isOpen: boolean;
  onToggle: () => void;
  analyzingBatchId: number | null;
  analyzingPatients: Set<number>;
  onGenerateBatch: (batchId: number) => void;
  onOpenFinalSchedule: (scheduleDate: string) => void;
  onUpdatePatient: (id: number, updates: Record<string, unknown>) => void;
  onDeletePatient: (id: number) => void;
  onAnalyzeOnePatient: (id: number) => void;
};

function WorklistGroupCard({
  group,
  mode,
  isOpen,
  onToggle,
  analyzingBatchId,
  analyzingPatients,
  onGenerateBatch,
  onOpenFinalSchedule,
  onUpdatePatient,
  onDeletePatient,
  onAnalyzeOnePatient,
}: WorklistGroupCardProps) {
  const isAnalyzing = analyzingBatchId === group.batchId;
  // The pane data depends on which tab this card lives in: Needs
  // Completion shows incomplete patients, Finalized shows only completed
  // ones, Scheduled shows the scheduled subset (currently equivalent to
  // all patients on a dated batch).
  const patientsToRender =
    mode === "needs"
      ? group.incompletePatients
      : mode === "finalized"
      ? group.finalizedPatients
      : group.scheduledPatients.length > 0
      ? group.scheduledPatients
      : group.patients;

  const ariaLabel =
    mode === "needs"
      ? "Work incomplete"
      : mode === "finalized"
      ? "View finalized"
      : "View patients";

  return (
    <div
      className="rounded-xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden"
      data-testid={`plexus-iq-worklist-group-${group.batchId}`}
    >
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${isOpen ? "Collapse" : "Expand"} ${group.facility} ${group.dateLabel}`}
          className="inline-flex items-center justify-center h-7 w-7 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 shrink-0"
          data-testid={`button-plexus-iq-worklist-toggle-${group.batchId}`}
        >
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <CalendarDays className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-sm font-medium text-slate-900 truncate">{group.dateLabel}</span>
            <span className="text-[10px] text-slate-400">·</span>
            <span className="text-[11px] text-slate-600 truncate">{group.facility}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 flex-wrap text-[10px] text-slate-500">
            <span>
              {group.totalCount} {group.totalCount === 1 ? "patient" : "patients"}
            </span>
            {group.incompleteCount > 0 && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-amber-700">
                  {group.incompleteCount} needs completion
                </span>
              </>
            )}
            {group.finalizedCount > 0 && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-emerald-700">{group.finalizedCount} finalized</span>
              </>
            )}
            {group.scheduleDate && group.scheduledCount > 0 && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-sky-700">{group.scheduledCount} scheduled</span>
              </>
            )}
            {group.errorCount > 0 && (
              <>
                <span className="text-slate-300">·</span>
                <span className="inline-flex items-center gap-0.5 text-rose-700">
                  <AlertTriangle className="h-3 w-3" />
                  {group.errorCount} error
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {mode === "needs" && group.incompleteCount > 0 && (
            <IconButton
              label={isAnalyzing ? "Generating…" : "Generate all"}
              testId={`button-plexus-iq-worklist-generate-${group.batchId}`}
              onClick={() => onGenerateBatch(group.batchId)}
              disabled={isAnalyzing || analyzingBatchId !== null || group.totalCount === 0}
            >
              {isAnalyzing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
            </IconButton>
          )}
          {group.scheduleDate && (
            <IconButton
              label="Open final schedule"
              testId={`button-plexus-iq-worklist-final-${group.batchId}`}
              onClick={() => onOpenFinalSchedule(group.scheduleDate as string)}
            >
              <CalendarCheck className="w-4 h-4" />
            </IconButton>
          )}
          <button
            type="button"
            onClick={onToggle}
            className="ml-1 inline-flex items-center gap-1 rounded-full bg-slate-100 hover:bg-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-800 transition-colors"
            data-testid={`button-plexus-iq-worklist-action-${group.batchId}`}
          >
            {ariaLabel}
            <span className="text-slate-500">({patientsToRender.length})</span>
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="px-4 pb-4 pt-0">
          {!group.detailReady ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 italic py-3">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading patients…
            </div>
          ) : patientsToRender.length === 0 ? (
            <div className="text-xs text-slate-500 italic py-3">
              {mode === "needs"
                ? "Nothing left to complete in this group."
                : mode === "finalized"
                ? "No finalized patients yet in this group."
                : "No scheduled patients in this group."}
            </div>
          ) : (
            <QualificationPatientCardsPane
              title="Patients"
              patients={patientsToRender}
              analyzingPatients={analyzingPatients}
              completedCount={group.finalizedCount}
              onUpdatePatient={onUpdatePatient}
              onDeletePatient={onDeletePatient}
              onAnalyzeOnePatient={onAnalyzeOnePatient}
              onOpenScheduleModal={() => { /* Plexus IQ has no per-patient appointment modal */ }}
              schedulerName={null}
              batchScheduleDate={group.scheduleDate}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function PlexusIQWorkspace({
  summary,
  batchDetails,
  analyzingBatchId,
  analyzingPatients,
  onGenerateBatch,
  onOpenFinalSchedule,
  onDeleteAllForBatch,
  onDeleteAllForFacility,
  onUpdatePatient,
  onDeletePatient,
  onAnalyzeOnePatient,
}: {
  summary: CalendarSummaryRow[];
  batchDetails: Record<number, BatchWithPatients>;
  analyzingBatchId: number | null;
  analyzingPatients: Set<number>;
  onGenerateBatch: (batchId: number) => void;
  onOpenFinalSchedule: (scheduleDate: string) => void;
  onDeleteAllForBatch: (batchId: number) => void;
  onDeleteAllForFacility: (facility: string) => void;
  onUpdatePatient: (id: number, updates: Record<string, unknown>) => void;
  onDeletePatient: (id: number) => void;
  onAnalyzeOnePatient: (id: number) => void;
}) {
  // Active facilities (any patient count). Used both by the All Patients
  // accordion and as the base set for the status-derived worklists.
  const grouped = useMemo(() => {
    const active = summary.filter((s) => s.patientCount > 0);
    const byFacility = new Map<string, CalendarSummaryRow[]>();
    for (const row of active) {
      const key = row.facility ?? "Unassigned";
      const arr = byFacility.get(key);
      if (arr) arr.push(row);
      else byFacility.set(key, [row]);
    }
    const facilities: { facility: string; rows: CalendarSummaryRow[] }[] = [];
    byFacility.forEach((rows, facility) => {
      rows.sort((a, b) => {
        const ad = a.scheduleDate ?? "";
        const bd = b.scheduleDate ?? "";
        if (ad === bd) return 0;
        if (!ad) return 1;
        if (!bd) return -1;
        return bd.localeCompare(ad);
      });
      facilities.push({ facility, rows });
    });
    facilities.sort((a, b) => {
      const aMax = a.rows[0]?.scheduleDate ?? "";
      const bMax = b.rows[0]?.scheduleDate ?? "";
      if (aMax === bMax) return a.facility.localeCompare(b.facility);
      if (!aMax) return 1;
      if (!bMax) return -1;
      return bMax.localeCompare(aMax);
    });
    return facilities;
  }, [summary]);

  const allGroups = useMemo<PlexusIQWorklistGroup[]>(() => {
    const out: PlexusIQWorklistGroup[] = [];
    for (const fac of grouped) {
      for (const row of fac.rows) {
        out.push(classifyGroup(row, batchDetails[row.id], fac.facility));
      }
    }
    return out;
  }, [grouped, batchDetails]);

  // Sorting per tab. Newest/nearest first within each priority bucket.
  const needsGroups = useMemo(() => {
    return allGroups
      .filter((g) => g.errorCount > 0 || g.incompleteCount > 0 || !g.detailReady)
      .sort((a, b) => {
        if ((b.errorCount > 0 ? 1 : 0) !== (a.errorCount > 0 ? 1 : 0)) {
          return (b.errorCount > 0 ? 1 : 0) - (a.errorCount > 0 ? 1 : 0);
        }
        if (b.incompleteCount !== a.incompleteCount) {
          return b.incompleteCount - a.incompleteCount;
        }
        const ad = a.scheduleDate ?? "";
        const bd = b.scheduleDate ?? "";
        if (ad !== bd) {
          if (!ad) return 1;
          if (!bd) return -1;
          return bd.localeCompare(ad);
        }
        return a.facility.localeCompare(b.facility);
      });
  }, [allGroups]);

  const finalizedGroups = useMemo(() => {
    return allGroups
      .filter((g) => g.finalizedCount > 0)
      .sort((a, b) => {
        const ad = a.scheduleDate ?? "";
        const bd = b.scheduleDate ?? "";
        if (ad !== bd) {
          if (!ad) return 1;
          if (!bd) return -1;
          return bd.localeCompare(ad);
        }
        return a.facility.localeCompare(b.facility);
      });
  }, [allGroups]);

  const scheduledGroups = useMemo(() => {
    return allGroups
      .filter((g) => g.scheduleDate || g.scheduledCount > 0)
      .sort((a, b) => {
        const ad = a.scheduleDate ?? "";
        const bd = b.scheduleDate ?? "";
        if (ad !== bd) {
          if (!ad) return 1;
          if (!bd) return -1;
          return bd.localeCompare(ad);
        }
        return a.facility.localeCompare(b.facility);
      });
  }, [allGroups]);

  const totals = useMemo(() => {
    let totalPatients = 0;
    let totalIncomplete = 0;
    let totalFinalized = 0;
    let totalScheduled = 0;
    let totalErrors = 0;
    const datedSet = new Set<string>();
    for (const g of allGroups) {
      totalPatients += g.totalCount;
      totalIncomplete += g.incompleteCount;
      totalFinalized += g.finalizedCount;
      totalScheduled += g.scheduledCount;
      totalErrors += g.errorCount;
      if (g.scheduleDate) datedSet.add(g.scheduleDate);
    }
    return {
      totalPatients,
      totalIncomplete,
      totalFinalized,
      totalScheduled,
      totalErrors,
      scheduledDates: datedSet.size,
    };
  }, [allGroups]);

  // Per-group expansion state, shared by all status tabs. Resetting on
  // tab change would make returning to a tab "forget" what the user
  // expanded; we keep it shared.
  const [openGroupKeys, setOpenGroupKeys] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setOpenGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (grouped.length === 0) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-12">
        <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="text-sm font-semibold text-slate-900">No patients yet</div>
          <p className="mt-2 text-xs text-slate-500">
            Use <span className="font-medium">Add Patient</span> or{" "}
            <span className="font-medium">Import</span> to start. Patients route
            to the matching <span className="whitespace-nowrap">facility · date</span>{" "}
            batch automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-10 xl:px-14 py-6 space-y-3">
      <Tabs defaultValue="needs" className="w-full">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="bg-slate-100" data-testid="plexus-iq-worklist-tabs">
            <TabsTrigger value="needs" data-testid="tab-plexus-iq-needs">
              Needs Completion
              {totals.totalIncomplete > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">
                  {totals.totalIncomplete}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="finalized" data-testid="tab-plexus-iq-finalized">
              Finalized
              {totals.totalFinalized > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-800">
                  {totals.totalFinalized}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="scheduled" data-testid="tab-plexus-iq-scheduled">
              Scheduled
              {totals.scheduledDates > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-sky-100 px-1.5 text-[10px] font-semibold text-sky-800">
                  {totals.scheduledDates}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="all" data-testid="tab-plexus-iq-all">
              All Patients
              {totals.totalPatients > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-700">
                  {totals.totalPatients}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-3 text-[10px] text-slate-500" data-testid="plexus-iq-worklist-snapshot">
            <span>
              <strong className="text-slate-800">{totals.totalIncomplete}</strong> needs completion
            </span>
            <span className="text-slate-300">·</span>
            <span>
              <strong className="text-slate-800">{totals.totalFinalized}</strong> finalized
            </span>
            <span className="text-slate-300">·</span>
            <span>
              <strong className="text-slate-800">{totals.scheduledDates}</strong> dates scheduled
            </span>
            <span className="text-slate-300">·</span>
            <span>
              <strong className="text-slate-800">{totals.totalPatients}</strong> total
            </span>
          </div>
        </div>

        <TabsContent value="needs" className="mt-3" data-testid="plexus-iq-tab-content-needs">
          {needsGroups.length === 0 ? (
            <div className="rounded-2xl bg-white p-6 text-center text-xs text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <CheckCircle2 className="mx-auto mb-2 h-5 w-5 text-emerald-600" />
              All visible patients are finalized. Use Finalized, Scheduled,
              or All Patients to review completed work.
            </div>
          ) : (
            <div className="space-y-2">
              {needsGroups.map((g) => (
                <WorklistGroupCard
                  key={g.key}
                  group={g}
                  mode="needs"
                  isOpen={openGroupKeys.has(g.key)}
                  onToggle={() => toggleGroup(g.key)}
                  analyzingBatchId={analyzingBatchId}
                  analyzingPatients={analyzingPatients}
                  onGenerateBatch={onGenerateBatch}
                  onOpenFinalSchedule={onOpenFinalSchedule}
                  onUpdatePatient={onUpdatePatient}
                  onDeletePatient={onDeletePatient}
                  onAnalyzeOnePatient={onAnalyzeOnePatient}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="finalized" className="mt-3" data-testid="plexus-iq-tab-content-finalized">
          {finalizedGroups.length === 0 ? (
            <div className="rounded-2xl bg-white p-6 text-center text-xs text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              No finalized patients yet. Run Generate on a batch to populate.
            </div>
          ) : (
            <div className="space-y-2">
              {finalizedGroups.map((g) => (
                <WorklistGroupCard
                  key={g.key}
                  group={g}
                  mode="finalized"
                  isOpen={openGroupKeys.has(g.key)}
                  onToggle={() => toggleGroup(g.key)}
                  analyzingBatchId={analyzingBatchId}
                  analyzingPatients={analyzingPatients}
                  onGenerateBatch={onGenerateBatch}
                  onOpenFinalSchedule={onOpenFinalSchedule}
                  onUpdatePatient={onUpdatePatient}
                  onDeletePatient={onDeletePatient}
                  onAnalyzeOnePatient={onAnalyzeOnePatient}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="scheduled" className="mt-3" data-testid="plexus-iq-tab-content-scheduled">
          {scheduledGroups.length === 0 ? (
            <div className="rounded-2xl bg-white p-6 text-center text-xs text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              No scheduled facility/date groups yet. The right-panel calendar
              still shows available dates.
            </div>
          ) : (
            <div className="space-y-2">
              {scheduledGroups.map((g) => (
                <WorklistGroupCard
                  key={g.key}
                  group={g}
                  mode="scheduled"
                  isOpen={openGroupKeys.has(g.key)}
                  onToggle={() => toggleGroup(g.key)}
                  analyzingBatchId={analyzingBatchId}
                  analyzingPatients={analyzingPatients}
                  onGenerateBatch={onGenerateBatch}
                  onOpenFinalSchedule={onOpenFinalSchedule}
                  onUpdatePatient={onUpdatePatient}
                  onDeletePatient={onDeletePatient}
                  onAnalyzeOnePatient={onAnalyzeOnePatient}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="all" className="mt-3" data-testid="plexus-iq-tab-content-all">
          {/* Legacy facility → date → patient cards accordion preserved
              verbatim so power users can still browse the full archive.
              Default-collapsed; same icons + callbacks as before. */}
          <div className="flex items-center gap-2 px-1 pb-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              All Facilities
            </span>
            <span className="text-[10px] text-slate-400">
              ({grouped.length} {grouped.length === 1 ? "facility" : "facilities"})
            </span>
          </div>

          <Accordion type="multiple" defaultValue={[]} className="space-y-3">
            {grouped.map(({ facility, rows }) => (
              <AccordionItem
                key={facility}
                value={facility}
                className="rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden border-0"
                data-testid={`plexus-iq-facility-${facility}`}
              >
                <div className="relative bg-slate-900 hover:bg-slate-800 transition-colors">
                  <AccordionTrigger className="w-full hover:no-underline px-5 py-3 pr-24 text-white text-left [&>svg]:text-white/70 [&>svg]:hover:text-white">
                    <span className="text-sm font-semibold tracking-tight text-white truncate">
                      {facility}
                    </span>
                  </AccordionTrigger>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteAllForFacility(facility);
                    }}
                    aria-label={`Delete all patients in ${facility}`}
                    title={`Delete all patients in ${facility}`}
                    className="absolute right-12 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-8 w-8 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors z-10"
                    data-testid={`button-plexus-iq-delete-facility-${facility}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <AccordionContent className="pb-3 pt-0 bg-slate-50/40">
                  <Accordion type="multiple" defaultValue={[]} className="px-3 pt-3 space-y-2">
                    {rows.map((row) => {
                      const detail = batchDetails[row.id];
                      const patients = detail?.patients ?? [];
                      const pf = pendingFinal(detail);
                      const isAnalyzing = analyzingBatchId === row.id;
                      const dateLabel = formatDateLabel(row.scheduleDate);
                      const detailReady = !!detail?.patients;
                      const completedCount = pf.final ?? 0;
                      return (
                        <AccordionItem
                          key={row.id}
                          value={`${row.id}`}
                          className="rounded-xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden border-0"
                          data-testid={`plexus-iq-date-${row.id}`}
                        >
                          <div className="relative hover:bg-slate-50 transition-colors">
                            <AccordionTrigger
                              className={`w-full hover:no-underline px-4 py-2.5 text-left ${
                                row.scheduleDate ? "pr-36" : "pr-24"
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <CalendarDays className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-slate-900 truncate">
                                    {dateLabel}
                                  </div>
                                  <div className="text-[10px] text-slate-500 flex items-center gap-1 flex-wrap">
                                    <span>
                                      {row.patientCount}{" "}
                                      {row.patientCount === 1 ? "patient" : "patients"}
                                    </span>
                                    {pf.pending != null && pf.final != null && (
                                      <>
                                        <span className="text-slate-300">·</span>
                                        <span>{pf.pending} pending</span>
                                        <span className="text-slate-300">·</span>
                                        <span>{pf.final} final</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </AccordionTrigger>
                            <div className="absolute right-12 top-1/2 -translate-y-1/2 flex items-center gap-0.5 z-10">
                              <IconButton
                                label={isAnalyzing ? "Generating…" : "Generate all"}
                                testId={`button-plexus-iq-generate-batch-${row.id}`}
                                onClick={() => onGenerateBatch(row.id)}
                                disabled={
                                  isAnalyzing ||
                                  analyzingBatchId !== null ||
                                  row.patientCount === 0
                                }
                              >
                                {isAnalyzing ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Sparkles className="w-4 h-4" />
                                )}
                              </IconButton>
                              {row.scheduleDate && (
                                <IconButton
                                  label="Open final schedule"
                                  testId={`button-plexus-iq-open-final-${row.id}`}
                                  onClick={() =>
                                    onOpenFinalSchedule(row.scheduleDate as string)
                                  }
                                >
                                  <CalendarCheck className="w-4 h-4" />
                                </IconButton>
                              )}
                              <IconButton
                                label="Delete all on this date"
                                testId={`button-plexus-iq-delete-batch-${row.id}`}
                                onClick={() => onDeleteAllForBatch(row.id)}
                                variant="danger"
                              >
                                <Trash2 className="w-4 h-4" />
                              </IconButton>
                            </div>
                          </div>

                          <AccordionContent className="px-4 pb-4 pt-0">
                            {!detailReady ? (
                              <div className="flex items-center gap-2 text-xs text-slate-500 italic py-3">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Loading patients…
                              </div>
                            ) : (
                              <QualificationPatientCardsPane
                                title="Patients"
                                patients={patients}
                                analyzingPatients={analyzingPatients}
                                completedCount={completedCount}
                                onUpdatePatient={onUpdatePatient}
                                onDeletePatient={onDeletePatient}
                                onAnalyzeOnePatient={onAnalyzeOnePatient}
                                onOpenScheduleModal={() => { /* Plexus IQ has no per-patient appointment modal */ }}
                                schedulerName={null}
                                batchScheduleDate={row.scheduleDate ?? null}
                              />
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </TabsContent>
      </Tabs>
    </div>
  );
}
