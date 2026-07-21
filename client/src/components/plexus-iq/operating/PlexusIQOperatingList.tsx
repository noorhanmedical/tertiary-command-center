import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, Plus } from "lucide-react";
import type { AuthUser } from "@/App";
import type { PatientScreening, ScreeningBatch } from "@shared/schema";
import type { CalendarSummaryRow } from "@/components/plexus-iq/PlexusIQCalendar";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  openPatientPacketPrintPreview,
  PACKET_PREVIEW_MESSAGE_SOURCE,
} from "@/lib/pdfGeneration";
import PdfPatientSelectDialog from "@/components/PdfPatientSelectDialog";
import { isPatientPdfEligible } from "@/lib/pdfPacketGrouping";
import { computePlexusIqStatus } from "@/lib/plexusIqStatus";
import { parseAppointmentTimeMinutes } from "@/lib/qualificationRunOrdering";
import { AdminReviewDialog } from "@/components/qualification/AdminReviewDialog";
import { PlexusIQAssignDateDialog } from "@/components/plexus-iq/PlexusIQAssignDateDialog";
import {
  PlexusIQDatePanel,
  type PlexusIQDateGroup,
  type PlexusIQBatchNode,
} from "./PlexusIQDatePanel";
import { PlexusIQListBar } from "./PlexusIQListBar";
import {
  PlexusIQOperatingRow,
  OPERATING_GRID_COLS,
} from "./PlexusIQOperatingRow";

type BatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

export type PlexusIQOperatingListProps = {
  summary: CalendarSummaryRow[];
  batches: ScreeningBatch[];
  batchDetails: Record<number, BatchWithPatients>;
  /** Batch IDs whose qualification job is actively running. */
  runningBatchIds: Set<number>;
  analyzingPatients: Set<number>;
  /** Patient IDs whose most recent edit failed to persist. */
  saveFailedPatientIds?: Set<number>;
  onGenerateBatch: (batchId: number) => void;
  onDeleteAllForBatch: (batchId: number) => void;
  onUpdatePatient: (id: number, updates: Record<string, unknown>) => void;
  onDeletePatient: (id: number) => void;
  onAnalyzeOnePatient: (id: number) => void;
  /**
   * Fires whenever the operating list's active selection changes so the
   * page can default Add-Patient / Bulk-Import to the facility + date the
   * user is currently viewing.
   */
  onSelectionChange?: (sel: {
    facility: string | null;
    scheduleDate: string | null;
    batchId: number | null;
  }) => void;
  /**
   * Imperative request to focus a specific batch (e.g. the one freshly
   * imported patients landed in). When set, the list switches its facility
   * + batch selection to it, then calls `onFocusConsumed`.
   */
  focusBatch?: { id: number; facility: string } | null;
  onFocusConsumed?: () => void;
  /** Opens the Add Patient(s) hub. Relocated from the old page header. */
  onAddPatient?: () => void;
  /** Opens the calendar drawer. Relocated from the old page header. */
  onOpenCalendar?: () => void;
  /**
   * Returns to the clinic-tile board. When provided, an inline back
   * control is rendered at the start of the toolbar (instead of a separate
   * "Back to clinics" pill-header above the list).
   */
  onBack?: () => void;
};

const UNSCHEDULED_KEY = "unscheduled";

function timeLabelFor(createdAt: string | Date | null | undefined): string {
  if (!createdAt) return "Import";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "Import";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function dateLabelFor(iso: string | null | undefined): string {
  if (!iso) return "Unscheduled";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

type BatchSummaryCounts = {
  total: number;
  completed: number;
  failed: number;
  pending: number;
};

function countPatients(
  patients: PatientScreening[],
  runningPatients: Set<number>,
): BatchSummaryCounts {
  let completed = 0;
  let failed = 0;
  let pending = 0;
  for (const p of patients) {
    const meta = computePlexusIqStatus(p, { isRunning: runningPatients.has(p.id) });
    if (meta.status === "failed") failed += 1;
    else if (meta.status === "pending_qualification") pending += 1;
    else completed += 1;
  }
  return { total: patients.length, completed, failed, pending };
}

function nodeStatus(
  counts: BatchSummaryCounts,
  running: boolean,
): Pick<PlexusIQBatchNode, "statusLabel" | "statusTone"> {
  if (running) return { statusLabel: "Running", statusTone: "running" };
  if (counts.failed > 0) return { statusLabel: "Errors", statusTone: "errors" };
  if (counts.total > 0 && counts.pending === 0)
    return { statusLabel: "Ready", statusTone: "ready" };
  return { statusLabel: "Pending", statusTone: "pending" };
}

export function PlexusIQOperatingList({
  summary,
  batches,
  batchDetails,
  runningBatchIds,
  analyzingPatients,
  saveFailedPatientIds,
  onGenerateBatch,
  onDeleteAllForBatch: _onDeleteAllForBatch,
  onUpdatePatient,
  onDeletePatient,
  onAnalyzeOnePatient,
  onSelectionChange,
  focusBatch,
  onFocusConsumed,
  onAddPatient,
  onOpenCalendar,
  onBack,
}: PlexusIQOperatingListProps) {
  const { toast } = useToast();
  const { data: currentUser } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    staleTime: 5 * 60 * 1000,
  });
  const isAdmin = currentUser?.role === "admin";

  // ── Patient-count lookup from the calendar summary ──────────────────
  const countById = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of summary) m.set(s.id, s.patientCount);
    return m;
  }, [summary]);

  // ── Facility list (only facilities that have at least one batch) ─────
  const facilities = useMemo(() => {
    const set = new Set<string>();
    for (const b of batches) {
      if (b.facility && (countById.get(b.id) ?? 0) > 0) set.add(b.facility);
    }
    return Array.from(set).sort();
  }, [batches, countById]);

  // Newest batch overall → default facility.
  const defaultFacility = useMemo(() => {
    let best: ScreeningBatch | null = null;
    for (const b of batches) {
      if ((countById.get(b.id) ?? 0) === 0) continue;
      if (!best || new Date(b.createdAt).getTime() > new Date(best.createdAt).getTime()) {
        best = b;
      }
    }
    return best?.facility ?? facilities[0] ?? null;
  }, [batches, countById, facilities]);

  const [facilityOverride, setFacilityOverride] = useState<string | null>(null);
  const selectedFacility =
    facilityOverride && facilities.includes(facilityOverride)
      ? facilityOverride
      : defaultFacility;

  // ── Batches for the selected facility, grouped by date ──────────────
  const facilityBatches = useMemo(
    () =>
      batches
        .filter(
          (b) =>
            b.facility === selectedFacility && (countById.get(b.id) ?? 0) > 0,
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
    [batches, selectedFacility, countById],
  );

  const dateGroups = useMemo<PlexusIQDateGroup[]>(() => {
    const byDate = new Map<string, ScreeningBatch[]>();
    for (const b of facilityBatches) {
      const key = b.scheduleDate ?? UNSCHEDULED_KEY;
      const arr = byDate.get(key);
      if (arr) arr.push(b);
      else byDate.set(key, [b]);
    }
    const keys = Array.from(byDate.keys()).sort((a, b) => {
      if (a === UNSCHEDULED_KEY) return 1;
      if (b === UNSCHEDULED_KEY) return -1;
      return b.localeCompare(a);
    });
    return keys.map((key) => ({
      key,
      label: key === UNSCHEDULED_KEY ? "Unscheduled" : dateLabelFor(key),
      batches: byDate
        .get(key)!
        .map((b) => {
          const patients = batchDetails[b.id]?.patients ?? [];
          const running = runningBatchIds.has(b.id);
          const counts = countPatients(patients, analyzingPatients);
          return {
            batchId: b.id,
            timeLabel: timeLabelFor(b.createdAt),
            patientCount: countById.get(b.id) ?? patients.length,
            createdAtMs: new Date(b.createdAt).getTime(),
            ...nodeStatus(counts, running),
          } satisfies PlexusIQBatchNode;
        })
        .sort((a, b) => b.createdAtMs - a.createdAtMs),
    }));
  }, [facilityBatches, batchDetails, runningBatchIds, analyzingPatients, countById]);

  // ── Selection: which batch / which date group is expanded ───────────
  const newestBatchId = facilityBatches[0]?.id ?? null;
  const [batchOverride, setBatchOverride] = useState<number | null>(null);
  const selectedBatchId =
    batchOverride != null && facilityBatches.some((b) => b.id === batchOverride)
      ? batchOverride
      : newestBatchId;

  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) ?? null,
    [batches, selectedBatchId],
  );
  const selectedScheduleDate = selectedBatch?.scheduleDate ?? null;

  // Report the active selection up so the page can default Add-Patient /
  // Bulk-Import to the facility + date currently in view.
  useEffect(() => {
    onSelectionChange?.({
      facility: selectedFacility,
      scheduleDate: selectedScheduleDate,
      batchId: selectedBatchId,
    });
  }, [onSelectionChange, selectedFacility, selectedScheduleDate, selectedBatchId]);

  // Expanded date groups are real, user-controlled state — toggling a date
  // header only opens/closes that group and never moves the selected batch.
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  const toggleDate = useCallback((key: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Keep selection and expansion sensibly synced. We open the selected batch's
  // date group only on meaningful transitions — initial load, facility switch,
  // or a focus-after-import request — and never on a plain batch-row click. This
  // is keyed on the *transition*, not the date string, so focusing/switching to
  // a batch that shares the previously-selected date still re-opens its group
  // even if the user had collapsed it. Plain selection within a facility leaves
  // the user's collapse state alone, so a collapsed group never springs back.
  const prevFacilityRef = useRef<string | null>(null);
  const didInitialExpandRef = useRef(false);
  const forceExpandRef = useRef(false);
  useEffect(() => {
    if (!selectedBatch) return;
    const facilityChanged = prevFacilityRef.current !== selectedFacility;
    const firstTime = !didInitialExpandRef.current;
    const focusForced = forceExpandRef.current;
    prevFacilityRef.current = selectedFacility;
    didInitialExpandRef.current = true;
    forceExpandRef.current = false;
    if (!facilityChanged && !firstTime && !focusForced) return;
    const key = selectedBatch.scheduleDate ?? UNSCHEDULED_KEY;
    setExpandedDates((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, [selectedBatch, selectedFacility]);

  // ── Patients of the selected batch ──────────────────────────────────
  const patients = useMemo(
    () => (selectedBatchId != null ? batchDetails[selectedBatchId]?.patients ?? [] : []),
    [batchDetails, selectedBatchId],
  );

  // ── Sort: appointment time (default for visit lists with times) or name ──
  // "time" puts timed patients first in chronological order; untimed
  // patients follow, alphabetical among themselves. The default is per-batch:
  // time when the list has visit patients with parseable appointment times,
  // name otherwise. A manual toggle in the list bar overrides it.
  const hasApptTimes = useMemo(
    () =>
      patients.some(
        (p) =>
          (p.patientType ?? "visit") !== "outreach" &&
          parseAppointmentTimeMinutes(p.time) != null,
      ),
    [patients],
  );
  const [sortOverride, setSortOverride] = useState<"time" | "name" | null>(null);
  useEffect(() => {
    setSortOverride(null);
  }, [selectedBatchId]);
  const sortMode: "time" | "name" = sortOverride ?? (hasApptTimes ? "time" : "name");

  const sortedPatients = useMemo(() => {
    const byName = (a: PatientScreening, b: PatientScreening) =>
      (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
    const arr = [...patients];
    if (sortMode === "time") {
      arr.sort((a, b) => {
        const am = parseAppointmentTimeMinutes(a.time);
        const bm = parseAppointmentTimeMinutes(b.time);
        if (am != null && bm != null) return am - bm || byName(a, b);
        if (am != null) return -1;
        if (bm != null) return 1;
        return byName(a, b);
      });
    } else {
      arr.sort(byName);
    }
    return arr;
  }, [patients, sortMode]);

  const isBatchRunning =
    selectedBatchId != null && runningBatchIds.has(selectedBatchId);
  const counts = useMemo(
    () => countPatients(patients, analyzingPatients),
    [patients, analyzingPatients],
  );

  // ── Selection state for bulk actions ────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const visibleIds = useMemo(
    () => new Set(sortedPatients.map((p) => p.id)),
    [sortedPatients],
  );
  const selectedHere = useMemo(
    () => sortedPatients.filter((p) => selectedIds.has(p.id)),
    [sortedPatients, selectedIds],
  );
  const allSelected =
    sortedPatients.length > 0 && selectedHere.length === sortedPatients.length;

  const toggleSelect = useCallback((id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const selectAll = useCallback(
    () => setSelectedIds((prev) => new Set([...prev, ...visibleIds])),
    [visibleIds],
  );
  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) next.delete(id);
      return next;
    });
  }, [visibleIds]);

  // ── Review panel ────────────────────────────────────────────────────
  const [reviewPatientId, setReviewPatientId] = useState<number | null>(null);

  // ── Change schedule date (left date panel pencil) ───────────────────
  // Reuses the same PATCH /api/screening-batches/:id contract as the
  // unscheduled-batches assign flow on the Plexus IQ page.
  const queryClient = useQueryClient();
  const [changeDateTarget, setChangeDateTarget] = useState<{
    id: number;
    label: string;
    currentDate: string | null;
  } | null>(null);
  const [changeDatePending, setChangeDatePending] = useState(false);

  const openChangeDate = useCallback(
    (batchId: number) => {
      const b = batches.find((x) => x.id === batchId);
      setChangeDateTarget({
        id: batchId,
        label: b
          ? `${b.name} — currently ${b.scheduleDate ? dateLabelFor(b.scheduleDate) : "unscheduled"}`
          : `List #${batchId}`,
        currentDate: b?.scheduleDate ?? null,
      });
    },
    [batches],
  );

  const handleChangeDate = useCallback(
    async (batchId: number, isoDate: string) => {
      setChangeDatePending(true);
      try {
        const res = await apiRequest("PATCH", `/api/screening-batches/${batchId}`, {
          scheduleDate: isoDate,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Failed (${res.status})`);
        }
        toast({
          title: "Date updated",
          description: `Schedule moved to ${dateLabelFor(isoDate)}`,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
        queryClient.invalidateQueries({
          queryKey: ["/api/screening-batches/calendar-summary"],
        });
        setChangeDateTarget(null);
      } catch (err) {
        toast({
          title: "Could not change date",
          description: err instanceof Error ? err.message : "Update failed",
          variant: "destructive",
        });
      } finally {
        setChangeDatePending(false);
      }
    },
    [queryClient, toast],
  );

  // Apply an imperative focus request (e.g. after an import) by switching
  // the facility + batch selection to the requested batch, then clearing
  // the request via onFocusConsumed.
  useEffect(() => {
    if (!focusBatch) return;
    setFacilityOverride(focusBatch.facility);
    setBatchOverride(focusBatch.id);
    setReviewPatientId(null);
    // Ensure the focused batch's date group is opened once the new selection
    // settles, even if it shares the previously-selected date and was collapsed.
    forceExpandRef.current = true;
    onFocusConsumed?.();
  }, [focusBatch, onFocusConsumed]);

  // ── PDF actions ─────────────────────────────────────────────────────
  // Preview-first workflow (matches the Schedule results view):
  //   1. Clicking a packet button opens a print-preview popup of the
  //      eligible patients in "select" mode.
  //   2. The popup's Print button posts back to this window, which opens
  //      PdfPatientSelectDialog so the operator can narrow the roster.
  //   3. "Print Selected" re-opens the preview in "print" mode rendering
  //      only the chosen patients, each on its own page.
  const [pdfMode, setPdfMode] = useState<"clinician" | "plexus" | null>(null);
  const [pdfPatients, setPdfPatients] = useState<PatientScreening[]>([]);

  const pdfTargets = useCallback(() => {
    const base = selectedHere.length > 0 ? selectedHere : sortedPatients;
    return base.filter(isPatientPdfEligible);
  }, [selectedHere, sortedPatients]);

  const openPreview = useCallback(
    (
      mode: "clinician" | "plexus",
      selected: PatientScreening[],
      printMode: "print" | "select" = "print",
    ) => {
      if (!selectedBatch) return;
      try {
        const result = openPatientPacketPrintPreview({
          mode,
          batchName: selectedBatch.name,
          patients: selected,
          scheduleDate: selectedBatch.scheduleDate,
          createdAt: selectedBatch.createdAt,
          printMode,
        });
        if (!result.ok && result.reason === "popup-blocked") {
          toast({
            title: "Popup blocked. Allow popups to print this packet.",
            description:
              "Your browser blocked the print preview window. Re-enable popups for this site and try again.",
            variant: "destructive",
          });
        }
      } catch (err) {
        toast({
          title: "Could not open print preview",
          description: err instanceof Error ? err.message : "Could not generate PDF",
          variant: "destructive",
        });
      }
    },
    [selectedBatch, toast],
  );

  const runPdf = useCallback(
    (mode: "clinician" | "plexus") => {
      if (!selectedBatch) return;
      const targets = pdfTargets();
      if (targets.length === 0) {
        toast({
          title: "Nothing to print",
          description: "No qualified, packet-eligible patients in the selection.",
          variant: "destructive",
        });
        return;
      }
      setPdfPatients(targets);
      openPreview(mode, targets, "select");
    },
    [selectedBatch, pdfTargets, toast, openPreview],
  );

  // Listen for the preview popup's Print click (origin- and source-
  // validated) and open the patient-selection dialog for that packet mode.
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as
        | { source?: string; action?: string; mode?: "clinician" | "plexus" }
        | null;
      if (!data || data.source !== PACKET_PREVIEW_MESSAGE_SOURCE) return;
      if (data.action !== "open-select") return;
      if (data.mode !== "clinician" && data.mode !== "plexus") return;
      setPdfMode(data.mode);
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const deleteSelected = useCallback(() => {
    if (selectedHere.length === 0) return;
    if (
      !confirm(
        `Remove ${selectedHere.length} patient${selectedHere.length === 1 ? "" : "s"} from this list?`,
      )
    )
      return;
    for (const p of selectedHere) onDeletePatient(p.id);
    clearSelection();
  }, [selectedHere, onDeletePatient, clearSelection]);

  const reviewPatient = useMemo(
    () => sortedPatients.find((p) => p.id === reviewPatientId) ?? null,
    [sortedPatients, reviewPatientId],
  );

  // ── Empty state ─────────────────────────────────────────────────────
  if (facilities.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-10 xl:px-14 py-16 text-center">
        <p className="text-sm text-slate-500">
          No patients yet. Use <span className="font-medium">Add Patient(s)</span> to import a list.
        </p>
      </div>
    );
  }


  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-10 xl:px-14 py-4">
      {/* Facility context selector + relocated workspace actions */}
      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <SidebarTrigger data-testid="button-sidebar-toggle-plexus-iq" />
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to clinics"
              title="Back to clinics"
              className="inline-flex items-center justify-center h-9 w-9 rounded-full text-slate-600 hover:bg-slate-100 transition-colors"
              data-testid="button-plexus-iq-clinic-back"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Facility
          </span>
          <Select
            value={selectedFacility ?? undefined}
            onValueChange={(v) => {
              setFacilityOverride(v);
              setBatchOverride(null);
              setReviewPatientId(null);
            }}
          >
            <SelectTrigger className="h-9 w-[260px] text-sm" data-testid="select-operating-facility">
              <SelectValue placeholder="Select facility" />
            </SelectTrigger>
            <SelectContent>
              {facilities.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {onAddPatient && (
            <Button
              size="sm"
              onClick={onAddPatient}
              className="h-9 gap-1.5 rounded-md"
              data-testid="button-plexus-iq-add-patient"
            >
              <Plus className="w-4 h-4" />
              Add Patient(s)
            </Button>
          )}
          {onOpenCalendar && (
            <button
              type="button"
              onClick={onOpenCalendar}
              aria-label="Open calendar"
              title="Calendar"
              className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-plexus-navy-800 text-white shadow-sm hover:bg-plexus-navy-700 transition-colors"
              data-testid="button-plexus-iq-calendar"
            >
              <CalendarDays className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[240px_minmax(0,1fr)] rounded-md border border-slate-200 overflow-hidden bg-white h-[calc(100vh-220px)] min-h-[480px]">
        {/* Left: Date panel */}
        <PlexusIQDatePanel
          groups={dateGroups}
          selectedBatchId={selectedBatchId}
          expandedDates={expandedDates}
          onToggleDate={toggleDate}
          onSelectBatch={(id) => {
            setBatchOverride(id);
            setReviewPatientId(null);
          }}
          onChangeDate={openChangeDate}
        />

        {/* Right: the patient list (stays mounted; Admin Review opens as an
            overlay popup on top of it via PlexusIQReviewHost below). */}
        <div className="flex flex-col min-h-0">
          <PlexusIQListBar
            patientCount={patients.length}
            selectedCount={selectedHere.length}
            allSelected={allSelected}
            hasFailed={counts.failed > 0}
            pendingCount={counts.pending}
            isGenerating={isBatchRunning}
            canAct={selectedBatchId != null}
            onSelectAll={selectAll}
            onClear={clearSelection}
            onDeleteSelected={deleteSelected}
            onRetryFailed={() => selectedBatchId != null && onGenerateBatch(selectedBatchId)}
            onGenerate={() => selectedBatchId != null && onGenerateBatch(selectedBatchId)}
            onClinicianPdf={() => runPdf("clinician")}
            onPlexusPdf={() => runPdf("plexus")}
            sortMode={sortMode}
            onSortModeChange={setSortOverride}
          />
          <div className="flex-1 min-h-0 overflow-auto bg-slate-50/30">
            <div className="w-full p-3 space-y-1.5">
            {sortedPatients.length === 0 ? (
              <div className="py-16 text-center text-xs text-slate-400">
                {selectedBatchId == null
                  ? "Select an import on the left."
                  : "No patients in this import."}
              </div>
            ) : (
              <>
                <div
                  className={`sticky top-0 z-10 grid ${OPERATING_GRID_COLS} gap-3 items-center px-3 py-2 border border-slate-200 rounded-md bg-slate-50/95 backdrop-blur-md text-[10px] font-semibold uppercase tracking-wider text-slate-500`}
                  data-testid="plexus-iq-operating-header"
                >
                  {/* Checkbox column (no label) */}
                  <div aria-hidden />
                  <div className="truncate text-center">Name</div>
                  <div className="truncate text-center">DOB</div>
                  <div className="truncate text-center">Insurance</div>
                  <div className="text-center">Status</div>
                  <div className="text-center">Flags</div>
                  <div className="text-center">Ancillary</div>
                  <div className="text-center">Review</div>
                </div>
                {sortedPatients.map((p) => (
                <PlexusIQOperatingRow
                  key={p.id}
                  patient={p}
                  isRunning={analyzingPatients.has(p.id) || isBatchRunning}
                  saveFailed={saveFailedPatientIds?.has(p.id)}
                  selected={selectedIds.has(p.id)}
                  isAdmin={!!isAdmin}
                  onToggleSelect={(checked) => toggleSelect(p.id, checked)}
                  onOpenReview={() => setReviewPatientId(p.id)}
                />
                ))}
              </>
            )}
            </div>
          </div>
        </div>
      </div>

      {/* Admin Review overlay popup — floats on top of the list (which stays
          rendered underneath). Keyed by patient id so each gets a fresh
          review context; siblings power in-overlay patient navigation. */}
      {reviewPatient && (
        <PlexusIQReviewHost
          key={reviewPatient.id}
          patient={reviewPatient}
          siblings={sortedPatients}
          scheduleDate={selectedBatch?.scheduleDate ?? null}
          dateLabel={selectedBatch ? dateLabelFor(selectedBatch.scheduleDate) : null}
          onUpdatePatient={onUpdatePatient}
          onClose={() => setReviewPatientId(null)}
        />
      )}

      <PdfPatientSelectDialog
        open={pdfMode !== null}
        mode={pdfMode}
        patients={pdfPatients}
        preserveOrder
        onClose={() => setPdfMode(null)}
        onGenerate={(selected) => {
          const mode = pdfMode;
          setPdfMode(null);
          if (mode) openPreview(mode, selected, "print");
        }}
      />

      <PlexusIQAssignDateDialog
        open={changeDateTarget !== null}
        batchId={changeDateTarget?.id ?? null}
        batchLabel={changeDateTarget?.label ?? ""}
        initialDate={changeDateTarget?.currentDate ?? null}
        title="Change date"
        onClose={() => setChangeDateTarget(null)}
        onAssign={handleChangeDate}
        pending={changeDatePending}
      />
    </div>
  );
}

// ── Review host ───────────────────────────────────────────────────────
// Reuses the proven add/remove-test flow from PatientListRow and renders
// AdminReviewDialog as an overlay popup. Keyed by patient id so each
// patient gets a fresh review context.
function PlexusIQReviewHost({
  patient,
  siblings,
  scheduleDate,
  dateLabel,
  onUpdatePatient,
  onClose,
}: {
  patient: PatientScreening;
  siblings: PatientScreening[];
  scheduleDate: string | null;
  dateLabel: string | null;
  onUpdatePatient: (id: number, updates: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [localTests, setLocalTests] = useState<string[]>(patient.qualifyingTests || []);

  const onUpdate = useCallback(
    (field: string, value: string | string[] | boolean | Record<string, unknown>) => {
      onUpdatePatient(patient.id, { [field]: value });
    },
    [onUpdatePatient, patient.id],
  );

  const handleAddTest = useCallback(
    (test: string) => {
      if (localTests.includes(test)) return;
      const updated = [...localTests, test];
      setLocalTests(updated);
      onUpdate("qualifyingTests", updated);
      apiRequest("POST", `/api/patients/${patient.id}/analyze-test`, { testName: test })
        .then((r) => r.json())
        .then((data: PatientScreening) => {
          if (data) {
            queryClient.setQueryData<ScreeningBatch & { patients?: PatientScreening[] }>(
              ["/api/screening-batches", patient.batchId],
              (old) => {
                if (!old) return old;
                return {
                  ...old,
                  patients: (old.patients || []).map((p) =>
                    p.id === patient.id ? { ...p, ...data } : p,
                  ),
                };
              },
            );
          }
        })
        .catch(() => {
          toast({
            title: "Could not generate reasoning",
            description: `Qualification notes for ${test} were not generated.`,
            variant: "destructive",
          });
        });
    },
    [localTests, onUpdate, patient.id, patient.batchId, queryClient, toast],
  );

  const handleRemoveTest = useCallback(
    (test: string) => {
      const updated = localTests.filter((t) => t !== test);
      setLocalTests(updated);
      onUpdate("qualifyingTests", updated);
    },
    [localTests, onUpdate],
  );

  return (
    <AdminReviewDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      patient={patient}
      facility={patient.facility ?? null}
      scheduleDate={scheduleDate}
      onUpdate={onUpdate}
      onAddTest={handleAddTest}
      onRemoveTest={handleRemoveTest}
      siblings={siblings}
      dateLabel={dateLabel}
    />
  );
}

export default PlexusIQOperatingList;
