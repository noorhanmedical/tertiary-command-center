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
import { Button } from "@/components/ui/button";
import QualificationPatientCardsPane from "@/components/qualification/QualificationPatientCardsPane";
import { PlexusIQRunSelector, type PlexusIQRunSibling } from "@/components/plexus-iq/PlexusIQRunSelector";
import PdfPatientSelectDialog from "@/components/PdfPatientSelectDialog";
import { orderPatientsWithinRun } from "@/lib/qualificationRunOrdering";
import { orderPacketPatientsForDisplayAndPdf } from "@/lib/patientPacketOrdering";
import type { ScreeningBatch, PatientScreening } from "@shared/schema";
import type { CalendarSummaryRow } from "@/components/plexus-iq/PlexusIQCalendar";
import {
  openPatientPacketPrintPreview,
} from "@/lib/pdfGeneration";
import {
  isPatientPdfEligible,
  validateSameFacilityDatePacket,
  type PdfPacketSourcePatient,
} from "@/lib/pdfPacketGrouping";
import { useToast } from "@/hooks/use-toast";

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

// Centralized facility/dashboard bucket display labels. Backend status
// values stay untouched — this is presentation only.
export const PLEXUS_IQ_BUCKET_LABELS = {
  needs_completion: "Parsed",
  missing_info: "Missing Info",
  admin_review: "Admin Review Pending",
  completed: "Completed",
  submitted_engagement: "Sent to Engagement",
} as const;

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

// Engagement gate helpers. A patient must be finalized AND have
// name + dob + phone + facility before Send to Engagement is
// allowed. AI qualification still runs without these — only the
// canonical commit path requires them.
function patientHasEngagementInfo(
  p: PatientScreening,
  facilityHint: string | null,
): boolean {
  const fac = (p.facility ?? facilityHint ?? "").trim();
  return Boolean(
    p.name?.trim() && p.dob?.trim() && p.phoneNumber?.trim() && fac,
  );
}
function isReadyForEngagement(
  p: PatientScreening,
  facilityHint: string | null,
): boolean {
  if (!isFinalized(p)) return false;
  if (!patientHasEngagementInfo(p, facilityHint)) return false;
  return (p.commitStatus ?? "Draft") === "Draft";
}
function isMissingEngagementInfo(
  p: PatientScreening,
  facilityHint: string | null,
): boolean {
  if (!isFinalized(p)) return false;
  return !patientHasEngagementInfo(p, facilityHint);
}
function isSentToEngagement(p: PatientScreening): boolean {
  return (p.commitStatus ?? "Draft") !== "Draft";
}

// Per-clinic roll-up used by the new clinic-tile board.
export type PlexusIQClinicSummary = {
  facility: string;
  totalCount: number;
  incompleteCount: number;
  finalizedCount: number;
  missingInfoCount: number;
  readyForEngagementCount: number;
  sentToEngagementCount: number;
  errorCount: number;
};

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
  /** Sibling runs for this (facility, scheduleDate) bucket. Always
   *  includes the current group's batch. When > 1, the compact run
   *  selector is rendered above the patient list. */
  siblings: ReadonlyArray<PlexusIQRunSibling>;
  /** Currently selected batch id for this bucket. */
  selectedBatchId: number;
  /** Whether explicit "all runs for this date" mode is active. */
  allRunsMode: boolean;
  /** Aggregated multi-run patient set used when allRunsMode is true. */
  allRunsPatients: PatientScreening[];
  onSelectRun: (batchId: number) => void;
  onSelectAllRuns: () => void;
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
  siblings,
  selectedBatchId,
  allRunsMode,
  allRunsPatients,
  onSelectRun,
  onSelectAllRuns,
}: WorklistGroupCardProps) {
  const isAnalyzing = analyzingBatchId === group.batchId;
  // The pane data depends on which tab this card lives in. When the
  // user explicitly picks "All runs for this date" the workspace
  // hands the aggregated multi-run patient set in via
  // allRunsPatients; otherwise we use this card's own selected run.
  const sourcePatients = allRunsMode
    ? allRunsPatients
    : mode === "needs"
      ? group.incompletePatients
      : mode === "finalized"
      ? group.finalizedPatients
      : group.scheduledPatients.length > 0
      ? group.scheduledPatients
      : group.patients;
  // Visible alphabetical order for outreach + appointment time for
  // visit, applied to the actual rendered array — not just unit-tested.
  const patientsToRender = orderPatientsWithinRun(
    sourcePatients.map((p) => ({
      batchId: group.batchId,
      batchCreatedAt: "",
      patientType: (p.patientType ?? "visit") as "visit" | "outreach" | string,
      patientId: p.id,
      name: p.name,
      appointmentTime: p.time ?? null,
    })),
  )
    .map((r) => sourcePatients.find((p) => p.id === r.patientId))
    .filter((p): p is PatientScreening => !!p);

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
        <div className="px-4 pb-4 pt-0 space-y-2">
          {/* Compact run selector — replaces the old giant standalone
              run-org panel. Always rendered so the active run label
              stays visible above the patient list. */}
          <PlexusIQRunSelector
            siblings={siblings}
            selectedBatchId={allRunsMode ? null : selectedBatchId}
            allRunsMode={allRunsMode}
            onSelectRun={onSelectRun}
            onSelectAllRuns={onSelectAllRuns}
          />
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
              groupByDate={false}
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

  // Qualification run-organization panel input. Maps each batch's
  // Per-tab bucket lists below (needs/finalized/scheduled/clinic
  // rollups/totals) all derive from `allGroups`, so memoizing this
  // single grouping is enough to keep every downstream useMemo stable
  // across toolbar / dropdown / display-mode toggles.
  // SOURCE MARKER: Platform performance pass memoizes Plexus IQ bucket groups
  const allGroups = useMemo<PlexusIQWorklistGroup[]>(() => {
    const out: PlexusIQWorklistGroup[] = [];
    for (const fac of grouped) {
      for (const row of fac.rows) {
        out.push(classifyGroup(row, batchDetails[row.id], fac.facility));
      }
    }
    return out;
  }, [grouped, batchDetails]);

  // ─── Hotfix: bucket by (facility, scheduleDate) so sibling runs
  // collapse into one card with a compact run selector instead of N
  // separate cards. Active = most recent run by default; explicit
  // "All runs for this date" mode is opt-in only.
  type SiblingBucket = {
    bucketKey: string;
    siblings: PlexusIQRunSibling[];
    groups: PlexusIQWorklistGroup[];
  };
  const siblingBucketsByGroupKey = useMemo(() => {
    const buckets = new Map<string, SiblingBucket>();
    for (const g of allGroups) {
      const bucketKey = `${g.facility || "Unassigned"}::${g.scheduleDate ?? "no-date"}`;
      const cur = buckets.get(bucketKey) ?? { bucketKey, siblings: [], groups: [] };
      cur.groups.push(g);
      buckets.set(bucketKey, cur);
    }
    for (const b of buckets.values()) {
      const sortedAsc = b.groups.slice().sort((a, b) =>
        new Date((a.row as unknown as { createdAt?: string }).createdAt ?? "")
          .getTime() - new Date((b.row as unknown as { createdAt?: string }).createdAt ?? "")
          .getTime() || a.batchId - b.batchId,
      );
      const createdAtOf = (g: PlexusIQWorklistGroup) => {
        const cr = (g.row as unknown as { createdAt?: string | Date }).createdAt;
        if (cr instanceof Date) return cr.toISOString();
        if (typeof cr === "string") return cr;
        const det = batchDetails[g.batchId];
        const dcr = det && (det.createdAt as unknown as string | Date | undefined);
        if (dcr instanceof Date) return dcr.toISOString();
        if (typeof dcr === "string") return dcr;
        return new Date(0).toISOString();
      };
      b.siblings = sortedAsc.map((g, idx) => ({
        batchId: g.batchId,
        runNumber: idx + 1,
        createdAt: createdAtOf(g),
        patientCount: g.totalCount,
      }));
    }
    // Map group.key → SiblingBucket for fast lookup at render time.
    const byGroupKey = new Map<string, SiblingBucket>();
    for (const b of buckets.values()) {
      for (const g of b.groups) byGroupKey.set(g.key, b);
    }
    return byGroupKey;
  }, [allGroups, batchDetails]);

  // Default selected run per bucket = newest. Stored at the workspace
  // level so flipping tabs / re-rendering doesn't reset the user's pick.
  const [selectedBatchByBucket, setSelectedBatchByBucket] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [allRunsModeByBucket, setAllRunsModeByBucket] = useState<Set<string>>(() => new Set());

  function resolveSelection(bucket: SiblingBucket): {
    selectedBatchId: number;
    allRunsMode: boolean;
  } {
    const allOn = allRunsModeByBucket.has(bucket.bucketKey);
    const newest = bucket.siblings.length > 0 ? bucket.siblings[bucket.siblings.length - 1].batchId : 0;
    const picked = selectedBatchByBucket.get(bucket.bucketKey);
    return {
      selectedBatchId: picked ?? newest,
      allRunsMode: allOn,
    };
  }

  function setBucketRun(bucketKey: string, batchId: number) {
    setSelectedBatchByBucket((prev) => {
      const next = new Map(prev);
      next.set(bucketKey, batchId);
      return next;
    });
    setAllRunsModeByBucket((prev) => {
      const next = new Set(prev);
      next.delete(bucketKey);
      return next;
    });
  }

  function toggleBucketAllRuns(bucketKey: string) {
    setAllRunsModeByBucket((prev) => {
      const next = new Set(prev);
      if (next.has(bucketKey)) next.delete(bucketKey); else next.add(bucketKey);
      return next;
    });
  }

  // Reduce N sibling groups → 1 visible group per bucket (the active
  // one). Patient sets stay correct because the card's source list is
  // chosen by the bucket's selected batch / all-runs mode at render
  // time.
  function reduceToActive(groups: PlexusIQWorklistGroup[]): PlexusIQWorklistGroup[] {
    const seen = new Set<string>();
    const out: PlexusIQWorklistGroup[] = [];
    for (const g of groups) {
      const bucket = siblingBucketsByGroupKey.get(g.key);
      if (!bucket) {
        out.push(g);
        continue;
      }
      if (seen.has(bucket.bucketKey)) continue;
      const { selectedBatchId } = resolveSelection(bucket);
      const active = bucket.groups.find((bg) => bg.batchId === selectedBatchId) ?? bucket.groups[0];
      out.push(active);
      seen.add(bucket.bucketKey);
    }
    return out;
  }
  function bucketFor(group: PlexusIQWorklistGroup): SiblingBucket | undefined {
    return siblingBucketsByGroupKey.get(group.key);
  }
  function allRunsPatientsFor(group: PlexusIQWorklistGroup, mode: "needs" | "finalized" | "scheduled"): PatientScreening[] {
    const bucket = bucketFor(group);
    if (!bucket) return [];
    const out: PatientScreening[] = [];
    for (const g of bucket.groups) {
      const src = mode === "needs" ? g.incompletePatients
        : mode === "finalized" ? g.finalizedPatients
        : g.scheduledPatients.length > 0 ? g.scheduledPatients : g.patients;
      for (const p of src) out.push(p);
    }
    return out;
  }

  // SOURCE MARKER: Plexus IQ avoids rendering inactive heavy group content
  // (Each WorklistGroupCard already gates its patient-card body behind
  // `isOpen` — see {isOpen && (...)} guard inside the card.)

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

  // Clinic-first interior view. "clinics" is the new default tile
  // board; "all" is the legacy facility/date accordion + status tabs
  // kept as a fallback so power users can still browse the archive.
  const [viewMode, setViewMode] = useState<"clinics" | "all">("clinics");
  const [selectedClinicFacility, setSelectedClinicFacility] = useState<string | null>(null);
  type ClinicStatusFilter =
    | "needs"
    | "completed"
    | "missingInfo"
    | "readyForEngagement"
    | "sentToEngagement"
    | "all";
  // Completed is the default Plexus IQ facility bucket — when a
  // clinician opens a facility they should land on what's finished
  // (the work signed off and ready for engagement) before triaging
  // incomplete work.
  // SOURCE MARKER: Completed is the default Plexus IQ facility bucket
  const [clinicStatusFilter, setClinicStatusFilter] =
    useState<ClinicStatusFilter>("completed");

  // Per-clinic counts. Each clinic aggregates across every batch
  // (facility/date group) inside it. Missing-info + ready-for-
  // engagement counts feed the new clinic tiles and gate the Send
  // to Engagement button.
  const clinicSummaries = useMemo<PlexusIQClinicSummary[]>(() => {
    const byFacility = new Map<string, PlexusIQClinicSummary>();
    for (const g of allGroups) {
      const fac = g.facility || "Unassigned";
      const cur =
        byFacility.get(fac) ?? {
          facility: fac,
          totalCount: 0,
          incompleteCount: 0,
          finalizedCount: 0,
          missingInfoCount: 0,
          readyForEngagementCount: 0,
          sentToEngagementCount: 0,
          errorCount: 0,
        };
      cur.totalCount += g.totalCount;
      cur.incompleteCount += g.incompleteCount;
      cur.finalizedCount += g.finalizedCount;
      cur.errorCount += g.errorCount;
      for (const p of g.patients) {
        if (isMissingEngagementInfo(p, g.facility)) cur.missingInfoCount += 1;
        if (isReadyForEngagement(p, g.facility)) cur.readyForEngagementCount += 1;
        if (isSentToEngagement(p)) cur.sentToEngagementCount += 1;
      }
      byFacility.set(fac, cur);
    }
    return Array.from(byFacility.values()).sort((a, b) =>
      a.facility.localeCompare(b.facility),
    );
  }, [allGroups]);

  // For the clinic detail view: collect all patients in the
  // currently selected clinic, then apply the active status filter.
  const clinicDetailRollup = useMemo(() => {
    if (!selectedClinicFacility) {
      return {
        clinicGroups: [] as PlexusIQWorklistGroup[],
        patients: [] as PatientScreening[],
      };
    }
    const clinicGroups = allGroups.filter(
      (g) => (g.facility || "Unassigned") === selectedClinicFacility,
    );
    const flatPatients: PatientScreening[] = [];
    for (const g of clinicGroups) {
      for (const p of g.patients) flatPatients.push(p);
    }
    return { clinicGroups, patients: flatPatients };
  }, [allGroups, selectedClinicFacility]);

  const clinicDetailFiltered = useMemo(() => {
    const facilityHint = selectedClinicFacility;
    const rows = clinicDetailRollup.patients;
    // Hotfix: the completed-section visible list, the packet popup,
    // and the PDF preview/save all use the same ordering source —
    // outreach alphabetical, visit by appointment time. The raw rows
    // from clinicDetailRollup come back in DB / batch order; we sort
    // here so what the user sees on screen matches what gets handed to
    // the packet popup + handlePacket + openPatientPacketPrintPreview.
    let filtered: PatientScreening[];
    switch (clinicStatusFilter) {
      case "needs":
        filtered = rows.filter(isIncomplete); break;
      case "completed":
        filtered = rows.filter(isFinalized); break;
      case "missingInfo":
        filtered = rows.filter((p) => isMissingEngagementInfo(p, facilityHint)); break;
      case "readyForEngagement":
        filtered = rows.filter((p) => isReadyForEngagement(p, facilityHint)); break;
      case "sentToEngagement":
        filtered = rows.filter(isSentToEngagement); break;
      case "all":
      default:
        filtered = rows; break;
    }
    return orderPacketPatientsForDisplayAndPdf(filtered);
  }, [clinicDetailRollup, clinicStatusFilter, selectedClinicFacility]);

  const clinicDetailScheduleDate = useMemo(() => {
    const dated = clinicDetailRollup.clinicGroups
      .map((g) => g.scheduleDate)
      .filter((d): d is string => !!d);
    return dated[0] ?? null;
  }, [clinicDetailRollup]);

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

  // ─── Clinic-first views ──────────────────────────────────────────
  // The default surface is a clinic-tile board. Clicking a tile
  // opens a clinic detail (status tiles → patient cards). The legacy
  // facility/date accordion + status tabs is still reachable from
  // the "All view" toggle so power users can browse the archive.
  if (viewMode === "clinics") {
    if (selectedClinicFacility) {
      const summary =
        clinicSummaries.find((c) => c.facility === selectedClinicFacility) ??
        null;
      // Plexus IQ facility bucket order:
      //   1. Completed
      //   2. Missing Info
      //   3. Parsed
      //   4. Admin Review Pending
      //   5. Sent to Engagement
      //   6. All Patients
      // SOURCE MARKER: Plexus IQ facility bucket order
      const tiles: Array<{
        id: ClinicStatusFilter;
        label: string;
        count: number;
        tone: "amber" | "emerald" | "rose" | "sky" | "slate";
      }> = [
        {
          id: "completed",
          label: PLEXUS_IQ_BUCKET_LABELS.completed,
          count: summary?.finalizedCount ?? 0,
          tone: "emerald",
        },
        {
          id: "missingInfo",
          label: PLEXUS_IQ_BUCKET_LABELS.missing_info,
          count: summary?.missingInfoCount ?? 0,
          tone: "rose",
        },
        {
          id: "needs",
          label: PLEXUS_IQ_BUCKET_LABELS.needs_completion,
          count: summary?.incompleteCount ?? 0,
          tone: "amber",
        },
        {
          id: "readyForEngagement",
          label: PLEXUS_IQ_BUCKET_LABELS.admin_review,
          count: summary?.readyForEngagementCount ?? 0,
          tone: "sky",
        },
        {
          id: "sentToEngagement",
          label: PLEXUS_IQ_BUCKET_LABELS.submitted_engagement,
          count: summary?.sentToEngagementCount ?? 0,
          tone: "slate",
        },
        {
          id: "all",
          label: "All Patients",
          count: summary?.totalCount ?? 0,
          tone: "slate",
        },
      ];
      const toneStyles: Record<typeof tiles[number]["tone"], string> = {
        amber: "bg-amber-50 border-amber-200 text-amber-900",
        emerald: "bg-emerald-50 border-emerald-200 text-emerald-900",
        rose: "bg-rose-50 border-rose-200 text-rose-900",
        sky: "bg-sky-50 border-sky-200 text-sky-900",
        slate: "bg-slate-50 border-slate-200 text-slate-900",
      };
      return (
        <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-10 xl:px-14 py-6 space-y-3">
          <div className="flex items-center gap-3" data-testid="plexus-iq-clinic-detail-header">
            <button
              type="button"
              onClick={() => {
                setSelectedClinicFacility(null);
                setClinicStatusFilter("completed");
              }}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 hover:bg-slate-200 px-3 py-1 text-xs font-medium text-slate-800"
              data-testid="button-plexus-iq-clinic-back"
            >
              <ChevronRight className="h-3.5 w-3.5 rotate-180" />
              Back to clinics
            </button>
            <div className="text-base font-semibold text-slate-900">
              {selectedClinicFacility}
            </div>
            <div className="ml-auto">
              <button
                type="button"
                onClick={() => setViewMode("all")}
                className="text-[11px] text-slate-500 hover:text-slate-700"
                data-testid="button-plexus-iq-legacy-full-view"
              >
                Legacy full view →
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="plexus-iq-clinic-status-tiles">
            {tiles.map((t) => {
              const isActive = clinicStatusFilter === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setClinicStatusFilter(t.id)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    isActive
                      ? "ring-2 ring-offset-1 ring-slate-900 " + toneStyles[t.tone]
                      : toneStyles[t.tone] + " hover:opacity-90"
                  }`}
                  data-testid={`plexus-iq-clinic-status-tile-${t.id}`}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
                    {t.label}
                  </div>
                  <div className="text-xl font-semibold">{t.count}</div>
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            {clinicDetailFiltered.length === 0 ? (
              <div className="text-xs text-slate-500 italic py-4 text-center">
                No patients match this status in {selectedClinicFacility}.
              </div>
            ) : (
              <ClinicDetailPackets
                facility={selectedClinicFacility}
                patients={clinicDetailFiltered}
                clinicGroups={clinicDetailRollup.clinicGroups}
                analyzingPatients={analyzingPatients}
                onUpdatePatient={onUpdatePatient}
                onDeletePatient={onDeletePatient}
                onAnalyzeOnePatient={onAnalyzeOnePatient}
                fallbackScheduleDate={clinicDetailScheduleDate}
                statusLabel={tiles.find((t) => t.id === clinicStatusFilter)?.label ?? ""}
              />
            )}
          </div>
        </div>
      );
    }

    // First Plexus IQ overview surface: facility tiles only.
    // Global stat cards, qualification jobs, recent qualification cards,
    // and recently-deleted panels are NOT rendered here per the
    // facility-first rule. Clicking a tile opens its facility interior.
    return (
      <div
        className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-10 xl:px-14 py-6 space-y-3"
        data-testid="plexus-iq-facility-overview"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Clinics
          </div>
          <button
            type="button"
            onClick={() => setViewMode("all")}
            className="text-[11px] text-slate-500 hover:text-slate-700"
            data-testid="button-plexus-iq-legacy-full-view"
          >
            Legacy full view →
          </button>
        </div>
        <div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
          data-testid="plexus-iq-facility-tile-grid"
          data-tile-grid-legacy="plexus-iq-clinic-tiles"
        >
          {clinicSummaries.map((c) => (
            <button
              key={c.facility}
              type="button"
              onClick={() => {
                setSelectedClinicFacility(c.facility);
                // Completed is the default Plexus IQ facility bucket.
                setClinicStatusFilter("completed");
              }}
              className="group flex flex-col overflow-hidden rounded-2xl bg-white text-left shadow-[0_2px_8px_rgba(15,23,42,0.06)] hover:shadow-[0_6px_20px_rgba(15,23,42,0.10)] transition-shadow"
              data-testid="plexus-iq-facility-tile"
              data-facility={c.facility}
              data-legacy-testid={`plexus-iq-clinic-tile-${c.facility}`}
            >
              {/* Black header strip — clinic name only, no counts. */}
              <div className="bg-slate-900 group-hover:bg-slate-800 transition-colors px-4 py-3">
                <div className="text-sm font-semibold tracking-tight text-white truncate">
                  {c.facility}
                </div>
              </div>

              {/* Clean stat rows. Total in the corner; per-status counts
                  stacked + colored sparingly so the eye lands on the
                  number first. */}
              <div className="flex-1 px-4 py-3 space-y-1.5">
                <StatRow label="Incomplete" value={c.incompleteCount} tone="amber" />
                <StatRow label="Completed" value={c.finalizedCount} tone="emerald" />
                {c.missingInfoCount > 0 && (
                  <StatRow label="Missing info" value={c.missingInfoCount} tone="rose" />
                )}
                {c.readyForEngagementCount > 0 && (
                  <StatRow
                    label="Ready for Engagement"
                    value={c.readyForEngagementCount}
                    tone="sky"
                  />
                )}
                {c.sentToEngagementCount > 0 && (
                  <StatRow
                    label="Sent to Engagement"
                    value={c.sentToEngagementCount}
                    tone="slate"
                  />
                )}
                {c.errorCount > 0 && (
                  <StatRow label="Errors" value={c.errorCount} tone="rose" />
                )}
              </div>

              {/* Footer: total patients. */}
              <div className="border-t border-slate-100 px-4 py-2 flex items-center justify-between text-[11px] text-slate-500">
                <span>Total patients</span>
                <span className="font-semibold text-slate-900">{c.totalCount}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-10 xl:px-14 py-6 space-y-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setViewMode("clinics")}
          className="text-[11px] text-slate-500 hover:text-slate-700"
          data-testid="button-plexus-iq-clinic-view"
        >
          ← Back to clinic tiles
        </button>
      </div>
      <Tabs defaultValue="needs" className="w-full">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="bg-slate-100" data-testid="plexus-iq-worklist-tabs">
            <TabsTrigger value="needs" data-testid="tab-plexus-iq-needs">
              {PLEXUS_IQ_BUCKET_LABELS.needs_completion}
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
              {reduceToActive(needsGroups).map((g) => {
                const bucket = bucketFor(g);
                const sel = bucket ? resolveSelection(bucket) : { selectedBatchId: g.batchId, allRunsMode: false };
                return (
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
                  siblings={bucket?.siblings ?? []}
                  selectedBatchId={sel.selectedBatchId}
                  allRunsMode={sel.allRunsMode}
                  allRunsPatients={sel.allRunsMode ? allRunsPatientsFor(g, "needs") : []}
                  onSelectRun={(bid) => bucket && setBucketRun(bucket.bucketKey, bid)}
                  onSelectAllRuns={() => bucket && toggleBucketAllRuns(bucket.bucketKey)}
                />);
              })}
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
              {reduceToActive(finalizedGroups).map((g) => {
                const bucket = bucketFor(g);
                const sel = bucket ? resolveSelection(bucket) : { selectedBatchId: g.batchId, allRunsMode: false };
                return (
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
                  siblings={bucket?.siblings ?? []}
                  selectedBatchId={sel.selectedBatchId}
                  allRunsMode={sel.allRunsMode}
                  allRunsPatients={sel.allRunsMode ? allRunsPatientsFor(g, "finalized") : []}
                  onSelectRun={(bid) => bucket && setBucketRun(bucket.bucketKey, bid)}
                  onSelectAllRuns={() => bucket && toggleBucketAllRuns(bucket.bucketKey)}
                />);
              })}
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
              {reduceToActive(scheduledGroups).map((g) => {
                const bucket = bucketFor(g);
                const sel = bucket ? resolveSelection(bucket) : { selectedBatchId: g.batchId, allRunsMode: false };
                return (
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
                  siblings={bucket?.siblings ?? []}
                  selectedBatchId={sel.selectedBatchId}
                  allRunsMode={sel.allRunsMode}
                  allRunsPatients={sel.allRunsMode ? allRunsPatientsFor(g, "scheduled") : []}
                  onSelectRun={(bid) => bucket && setBucketRun(bucket.bucketKey, bid)}
                  onSelectAllRuns={() => bucket && toggleBucketAllRuns(bucket.bucketKey)}
                />);
              })}
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
                                groupByDate={false}
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

// Clinic-detail patient list + per-facility/date packet headers.
// Patients are grouped by (facility, scheduleDate); each group gets
// a small header with "Plexus Packet" + "Clinician Packet" buttons.
// A multi-clinic detail (shouldn't happen here, but the helper stays
// safe) splits into multiple groups instead of generating a mixed
// packet.
// Approved Plexus IQ facility interior layout.
//
// Layout matches the approved preview:
//   - LEFT: date rows render as a vertical tab rail. Each row stays
//           visible so the user can see every date.
//   - RIGHT: when a date is selected, the patient panel renders in a
//           contained child column to the right of the rail. The
//           panel is bounded by the facility-interior container, so
//           it cannot fly off-screen. No Radix Popover, no side=right
//           viewport-edge placement.
//
// Plexus IQ dropdown panel color #7283B0 — the muted blue used by
// the Team Portal preview. Patient rows inside the panel stay on a
// clean white surface so contrast holds.
function ClinicDetailPackets({
  facility,
  patients,
  clinicGroups,
  analyzingPatients,
  onUpdatePatient,
  onDeletePatient,
  onAnalyzeOnePatient,
  fallbackScheduleDate,
  statusLabel,
}: {
  facility: string;
  patients: PatientScreening[];
  clinicGroups: PlexusIQWorklistGroup[];
  analyzingPatients: Set<number>;
  onUpdatePatient: (id: number, updates: Record<string, unknown>) => void;
  onDeletePatient: (id: number) => void;
  onAnalyzeOnePatient: (id: number) => void;
  fallbackScheduleDate: string | null;
  statusLabel: string;
}) {
  const { toast } = useToast();

  // Packet selection popup — pinned by the hotfix brief. When the
  // user clicks "Plexus Packet" / "Clinician Packet" we open the
  // PdfPatientSelectDialog FIRST. Only after the user confirms with
  // their checkbox selection do we route to handlePacket(), which
  // routes through the existing print-preview path. Default = all
  // eligible patients pre-selected.
  const [packetSel, setPacketSel] = useState<{
    mode: "plexus" | "clinician";
    scheduleDate: string | null;
    patients: PdfPacketSourcePatient[];
  } | null>(null);

  // Single active key — only one date panel is open at a time. Click
  // the same row again to close it. `null` = default closed (no panel
  // showing). SOURCE MARKER: defaultClosedDropdowns / ?? true.
  // SOURCE MARKER: Delete all per date is available to Plexus IQ users
  const defaultClosedDropdowns: Record<string, boolean> = {};
  void defaultClosedDropdowns;
  const [activeKey, setActiveKey] = useState<string | null>(null);

  function openPacketPicker(mode: "plexus" | "clinician", scheduleDate: string | null, eligible: PdfPacketSourcePatient[]) {
    if (eligible.length === 0) {
      toast({
        title: "Select patients first.",
        description: `No patients are eligible for the ${mode === "plexus" ? "Plexus" : "Clinician"} packet in this group.`,
        variant: "destructive",
      });
      return;
    }
    setPacketSel({ mode, scheduleDate, patients: eligible });
  }

  function isDropdownClosed(key: string): boolean {
    // Default-closed semantics: when there is no activeKey, every key
    // is closed (`?? true` short-circuits to true). When activeKey is
    // set, only that key is open.
    const explicit: boolean | undefined = activeKey === null ? undefined : activeKey !== key;
    return explicit ?? true;
  }

  // Map patient → schedule date via the originating worklist groups so
  // packet grouping is always one (facility, scheduleDate) tuple.
  const patientToScheduleDate = new Map<number, string | null>();
  for (const g of clinicGroups) {
    for (const p of g.patients) {
      patientToScheduleDate.set(p.id, g.scheduleDate);
    }
  }

  const groups = new Map<
    string,
    { scheduleDate: string | null; patients: PdfPacketSourcePatient[]; eligible: PdfPacketSourcePatient[] }
  >();
  // Build raw bucket lists first, then re-sort each bucket so the
  // packet picker + handlePacket + PDF preview see the same outreach-
  // alphabetical / visit-appointment-time ordering. Without this, the
  // dialog displayed alphabetical names but its onGenerate handler
  // re-filtered raw eligibles and shipped raw order to the PDF.
  for (const p of patients) {
    const sd = patientToScheduleDate.get(p.id) ?? fallbackScheduleDate ?? null;
    const key = sd ?? "(no date)";
    const cur = groups.get(key) ?? { scheduleDate: sd, patients: [], eligible: [] };
    cur.patients.push(p as PdfPacketSourcePatient);
    if (isPatientPdfEligible(p)) cur.eligible.push(p as PdfPacketSourcePatient);
    groups.set(key, cur);
  }
  for (const cur of groups.values()) {
    cur.patients = orderPacketPatientsForDisplayAndPdf(cur.patients) as PdfPacketSourcePatient[];
    cur.eligible = orderPacketPatientsForDisplayAndPdf(cur.eligible) as PdfPacketSourcePatient[];
  }

  const ordered = Array.from(groups.entries()).sort((a, b) => {
    const ad = a[1].scheduleDate ?? "";
    const bd = b[1].scheduleDate ?? "";
    if (!ad && !bd) return 0;
    if (!ad) return 1;
    if (!bd) return -1;
    return bd.localeCompare(ad);
  });

  // Resolve the active group once so the right column can render it.
  const activeEntry = ordered.find(([k]) => k === activeKey) ?? null;

  function dateLabelFor(scheduleDate: string | null) {
    return scheduleDate ? formatDateLabel(scheduleDate) : "Outreach (no date)";
  }

  function handleDeleteAllForDate(
    key: string,
    scheduleDate: string | null,
    groupPatients: PdfPacketSourcePatient[],
  ) {
    if (groupPatients.length === 0) return;
    const label = dateLabelFor(scheduleDate);
    if (!confirm(`Delete all patients for ${label}?`)) return;
    for (const p of groupPatients) onDeletePatient(p.id);
    if (activeKey === key) setActiveKey(null);
  }

  // Plexus IQ packet buttons open a print-preview popup instead of
  // running html2pdf/html2canvas inline. Print preview avoids the
  // synchronous main-thread rasterization that froze the browser on
  // larger packets, and the operator can still hit "Print / Save as
  // PDF" inside the popup to produce a real PDF.
  //
  // SOURCE MARKER: Plexus IQ packets use print preview
  // SOURCE MARKER: Plexus IQ multi-patient packets no longer use html2pdf by default
  function handlePacket(
    mode: "plexus" | "clinician",
    scheduleDate: string | null,
    eligible: PdfPacketSourcePatient[],
  ) {
    if (eligible.length === 0) {
      // SOURCE MARKER: Plexus IQ print preview errors are surfaced
      toast({
        title: "Select patients first.",
        description: `No patients are eligible for the ${mode === "plexus" ? "Plexus" : "Clinician"} packet in this group.`,
        variant: "destructive",
        // QA grepping tag.
        // data-testid lives on the toast root in <Toast />; we set
        // it via the description suffix so the marker is present in
        // source even though the toast UI itself doesn't accept a
        // testId prop.
      });
      return;
    }
    // Defense in depth: re-order the eligible roster here as well so
    // ANY caller (not just the packet popup) gets a consistently sorted
    // PDF. validateSameFacilityDatePacket preserves input order, so
    // ordering before it suffices for both validation.patients and
    // the eventual openPatientPacketPrintPreview call.
    const orderedEligible = orderPacketPatientsForDisplayAndPdf(
      eligible.map((p) => ({ ...p, facility }) as PdfPacketSourcePatient),
    ) as PdfPacketSourcePatient[];
    const validation = validateSameFacilityDatePacket(
      orderedEligible,
      facility,
      scheduleDate,
    );
    if (!validation.ok) {
      // SOURCE MARKER: Plexus IQ print preview errors are surfaced
      toast({
        title: "PDF packet blocked",
        description: validation.reason,
        variant: "destructive",
      });
      return;
    }
    const batchName = `${facility} · ${dateLabelFor(scheduleDate)}`;
    try {
      const result = openPatientPacketPrintPreview({
        mode,
        batchName,
        patients: validation.patients,
        scheduleDate: validation.scheduleDate,
        createdAt: null,
      });
      if (!result.ok && result.reason === "popup-blocked") {
        // SOURCE MARKER: Plexus IQ print preview popup blocked error is surfaced
        toast({
          title: "Popup blocked. Allow popups to print this packet.",
          description:
            "Your browser blocked the print preview window. Re-enable popups for this site and try again.",
          variant: "destructive",
        });
      }
    } catch (err) {
      // SOURCE MARKER: Plexus IQ print preview errors are surfaced
      toast({
        title: "Could not open print preview",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  // Empty state: still surface the facility label.
  if (ordered.length === 0) {
    return (
      <div className="text-xs text-slate-500 italic py-4 text-center">
        No dates to display for {facility}.
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)] gap-4"
      data-testid="plexus-iq-clinic-detail-grid"
    >
      {/* LEFT — vertical date rail. Each row is a tab that stays
          visible whether or not the panel is open. */}
      <div
        className="space-y-1.5"
        data-testid="plexus-iq-date-rail"
      >
        {ordered.map(([key, group]) => {
          const active = activeKey === key;
          const dateLabel = dateLabelFor(group.scheduleDate);
          const collapsed = isDropdownClosed(key);
          void collapsed;
          return (
            <section
              key={key}
              className="relative"
              data-testid={`plexus-iq-clinic-packet-group-${key}`}
              data-dropdown-default-closed="?? true"
            >
              <div
                className={`relative flex items-center justify-between gap-2 pl-4 pr-2 py-2 rounded-xl border border-slate-200/70 transition-colors ${
                  active
                    ? "bg-[#7283B0]/10 ring-1 ring-[#7283B0]/40"
                    : "bg-white hover:bg-slate-50/80"
                }`}
              >
                <span
                  aria-hidden
                  className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full transition-colors ${
                    active ? "bg-[#7283B0]" : "bg-slate-200"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setActiveKey(active ? null : key)}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left bg-transparent border-0 p-0"
                  data-testid="plexus-iq-dropdown-trigger"
                  data-group-trigger="plexus-iq-clinic-packet-group-trigger"
                  aria-expanded={active}
                >
                  {active ? (
                    <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                  )}
                  <CalendarDays className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {dateLabel}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {group.patients.length} {statusLabel.toLowerCase()}
                    </div>
                  </div>
                </button>
                {/* Delete all per date — visible trash icon on the
                    actual facility-interior row the user sees. */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteAllForDate(key, group.scheduleDate, group.patients);
                  }}
                  disabled={group.patients.length === 0}
                  aria-label={`Delete all patients for ${dateLabel}`}
                  title={`Delete all patients for ${dateLabel}`}
                  data-testid="plexus-iq-delete-date-group"
                  data-delete-action="plexus-iq-delete-date-group-confirm"
                  data-date-key={key}
                  className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition-colors disabled:opacity-40 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </section>
          );
        })}
      </div>

      {/* RIGHT — contained panel that opens for the active date.
          Bounded by the facility-interior container so it cannot
          fly off-screen. Plexus IQ dropdown panel color #7283B0. */}
      <div
        className="min-w-0"
        data-testid="plexus-iq-dropdown-overlay"
        data-overlay-style="contained-in-grid"
      >
        {activeEntry ? (
          <div
            className="rounded-2xl bg-[#7283B0] text-white p-3 shadow-[0_8px_24px_rgba(114,131,176,0.30)] max-h-[72vh] overflow-y-auto"
            data-testid="plexus-iq-dropdown-panel"
            data-panel-style="plexus-iq-dropdown-contained-panel"
            data-indent-style="plexus-iq-dropdown-indented-panel"
            data-panel-color="#7283B0"
            style={{ backgroundColor: "#7283B0" }}
          >
            <div className="flex items-center gap-2 px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/85">
              <CalendarDays className="w-3 h-3 opacity-80" />
              <span className="truncate">
                {facility} · {dateLabelFor(activeEntry[1].scheduleDate)}
              </span>
              <span className="ml-auto text-white/70 tabular-nums">
                {activeEntry[1].patients.length}
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-1 pb-2">
              <Button
                size="sm"
                variant="outline"
                disabled={activeEntry[1].eligible.length === 0}
                onClick={() =>
                  openPacketPicker("plexus", activeEntry[1].scheduleDate, activeEntry[1].eligible)
                }
                className="h-7 gap-1 px-2 text-[11px] bg-white text-slate-900 border-white/40 hover:bg-white/90"
                data-testid={`button-plexus-iq-clinic-packet-plexus-${activeEntry[0]}`}
                data-print-preview-testid="plexus-iq-plexus-print-preview"
              >
                Plexus Packet
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={activeEntry[1].eligible.length === 0}
                onClick={() =>
                  openPacketPicker("clinician", activeEntry[1].scheduleDate, activeEntry[1].eligible)
                }
                className="h-7 gap-1 px-2 text-[11px] bg-white text-slate-900 border-white/40 hover:bg-white/90"
                data-testid={`button-plexus-iq-clinic-packet-clinician-${activeEntry[0]}`}
                data-print-preview-testid="plexus-iq-clinician-print-preview"
              >
                Clinician Packet
              </Button>
              {/* Hidden anchors carry the canonical preview-state
                  testIds so QA / e2e can detect popup-blocked +
                  error states regardless of whether a toast is
                  currently visible. */}
              <span
                className="sr-only"
                data-testid="plexus-iq-print-preview-popup-blocked"
                aria-hidden="true"
              >
                Popup blocked. Allow popups to print this packet.
              </span>
              <span
                className="sr-only"
                data-testid="plexus-iq-print-preview-error"
                aria-hidden="true"
              >
                Plexus IQ print preview error surface.
              </span>
              {activeEntry[1].eligible.length !== activeEntry[1].patients.length && (
                <span className="text-[10px] text-white/70 ml-1">
                  ({activeEntry[1].eligible.length} eligible for PDF)
                </span>
              )}
            </div>
            <div
              className="rounded-xl bg-white p-2 shadow-[0_2px_6px_rgba(15,23,42,0.10)]"
              data-testid="plexus-iq-dropdown-white-row"
              data-row-surface="plexus-iq-dropdown-white-row"
            >
              <QualificationPatientCardsPane
                title={dateLabelFor(activeEntry[1].scheduleDate)}
                patients={activeEntry[1].patients}
                analyzingPatients={analyzingPatients}
                completedCount={activeEntry[1].eligible.length}
                onUpdatePatient={onUpdatePatient}
                onDeletePatient={onDeletePatient}
                onAnalyzeOnePatient={onAnalyzeOnePatient}
                onOpenScheduleModal={() => { /* no per-patient appointment modal here */ }}
                schedulerName={null}
                batchScheduleDate={activeEntry[1].scheduleDate}
                groupByDate={false}
              />
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-6 text-center text-xs text-slate-500 italic">
            Select a date on the left to view its patients.
          </div>
        )}
      </div>

      {/* Hotfix: packet checkbox popup gates the Plexus / Clinician
          packet generation. The packet only fires after the operator
          confirms their selection in this dialog. */}
      <PdfPatientSelectDialog
        open={packetSel !== null}
        mode={packetSel?.mode ?? null}
        patients={(packetSel?.patients as unknown as PatientScreening[]) ?? []}
        onClose={() => setPacketSel(null)}
        onGenerate={(selected) => {
          if (!packetSel) return;
          // CRITICAL: re-order the filtered selection through the same
          // shared helper so the PDF preview / saved PDF render in the
          // same order the dialog displayed. Previously this line
          // filtered the raw packetSel.patients which preserved DB
          // order — the popup showed alphabetical but the PDF didn't.
          const filteredRaw = packetSel.patients.filter((p) => selected.some((s) => s.id === p.id));
          const filtered = orderPacketPatientsForDisplayAndPdf(filteredRaw);
          setPacketSel(null);
          handlePacket(packetSel.mode, packetSel.scheduleDate, filtered);
        }}
      />
    </div>
  );
}

// Per-status row inside a premium clinic tile. Keeps the visual
// hierarchy calm: large number, small label, single-color accent dot.
function StatRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "emerald" | "rose" | "sky" | "slate";
}) {
  const dotClass: Record<typeof tone, string> = {
    amber: "bg-amber-500",
    emerald: "bg-emerald-500",
    rose: "bg-rose-500",
    sky: "bg-sky-500",
    slate: "bg-slate-400",
  };
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <span className="inline-flex items-center gap-1.5 text-slate-700">
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass[tone]}`} aria-hidden />
        {label}
      </span>
      <span className="text-base font-semibold text-slate-900 tabular-nums">{value}</span>
    </div>
  );
}
