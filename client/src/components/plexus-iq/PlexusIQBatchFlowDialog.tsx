import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  Clock,
  FilePlus2,
  History,
  Layers,
  PlayCircle,
  Plus,
  Users,
} from "lucide-react";
import type { PatientScreening, ScreeningBatch } from "@shared/schema";
import type { CalendarSummaryRow } from "@/components/plexus-iq/PlexusIQCalendar";
import { formatDateHeader, formatTime12 } from "@/lib/format";
import {
  batchSourceLabel,
  deriveBatchFlowStatus,
  isBatchArchived,
  isBatchResumable,
  resolveBatchSource,
  setBatchArchived,
  useActiveBatchId,
  type BatchFlowStatusMeta,
  type BatchSource,
} from "@/lib/plexusIqBatchSession";

type BatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

// Per-batch view model for the BatchFlow landing + history surfaces.
type BatchVM = {
  batch: ScreeningBatch;
  patientCount: number;
  source: BatchSource;
  status: BatchFlowStatusMeta;
  resumable: boolean;
  archived: boolean;
};

export type PlexusIQBatchFlowDialogProps = {
  open: boolean;
  onClose: () => void;
  batches: ScreeningBatch[];
  summary: CalendarSummaryRow[];
  batchDetails: Record<number, BatchWithPatients>;
  runningBatchIds: Set<number>;
  // Begin a brand-new isolated batch (placement: newRun).
  onStartNew: () => void;
  // Resume / append into an existing batch (placement: append).
  onResume: (batchId: number) => void;
  // Open a batch in the operating list without importing.
  onViewBatch: (batchId: number, facility: string) => void;
};

function StatusPill({ status }: { status: BatchFlowStatusMeta }) {
  return (
    <Badge
      variant="outline"
      className={`text-[10px] font-semibold ${status.pillClass}`}
      data-testid={`batchflow-status-${status.status}`}
    >
      {status.label}
    </Badge>
  );
}

function ActiveBatchCallout({ vm }: { vm: BatchVM }) {
  return (
    <div
      className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3"
      data-testid="batchflow-active-callout"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
            <Layers className="h-3.5 w-3.5" />
            Active batch
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-900">
            {vm.batch.facility ?? "Unassigned clinic"}
            {vm.batch.scheduleDate ? ` • ${formatDateHeader(vm.batch.scheduleDate)}` : ""}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTime12(vm.batch.createdAt)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {vm.patientCount} patient{vm.patientCount === 1 ? "" : "s"}
            </span>
            <span>{batchSourceLabel(vm.source)}</span>
          </div>
        </div>
        <StatusPill status={vm.status} />
      </div>
    </div>
  );
}

export function PlexusIQBatchFlowDialog({
  open,
  onClose,
  batches,
  summary,
  batchDetails,
  runningBatchIds,
  onStartNew,
  onResume,
  onViewBatch,
}: PlexusIQBatchFlowDialogProps) {
  const { activeBatchId } = useActiveBatchId();
  const [view, setView] = useState<"landing" | "history">("landing");
  const [showArchived, setShowArchived] = useState(false);
  // Bump to force a re-read of the localStorage-backed archived set after
  // an archive/unarchive action (those writes don't emit a React update).
  const [archiveVersion, setArchiveVersion] = useState(0);

  // Always return to the landing view each time the dialog is opened so a
  // returning operator never lands back inside a stale list.
  useEffect(() => {
    if (open) {
      setView("landing");
      setShowArchived(false);
    }
  }, [open]);

  const countById = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of summary) m.set(s.id, s.patientCount);
    return m;
  }, [summary]);

  const vmById = useMemo(() => {
    void archiveVersion; // re-derive when archive state changes
    const m = new Map<number, BatchVM>();
    for (const batch of batches) {
      const patients = batchDetails[batch.id]?.patients;
      const patientCount = countById.get(batch.id) ?? batch.patientCount ?? 0;
      const status = deriveBatchFlowStatus(patients, {
        isRunning: runningBatchIds.has(batch.id),
      });
      m.set(batch.id, {
        batch,
        patientCount,
        source: resolveBatchSource(batch.id, patients),
        status,
        resumable: isBatchResumable(batch, status.status),
        archived: isBatchArchived(batch.id),
      });
    }
    return m;
  }, [batches, batchDetails, countById, runningBatchIds, archiveVersion]);

  const activeVm = activeBatchId != null ? vmById.get(activeBatchId) ?? null : null;

  // Most-recent resumable batch (excludes the active one + archived) for
  // the "Continue Recent Batch" landing shortcut.
  const recentResumable = useMemo(() => {
    const candidates = Array.from(vmById.values())
      .filter(
        (vm) =>
          vm.resumable &&
          vm.patientCount > 0 &&
          vm.batch.id !== activeBatchId &&
          !vm.archived,
      )
      .sort(
        (a, b) =>
          new Date(b.batch.createdAt).getTime() - new Date(a.batch.createdAt).getTime(),
      );
    return candidates[0] ?? null;
  }, [vmById, activeBatchId]);

  // History grouped by scheduleDate (falls back to "Unscheduled"), each
  // group sorted newest batch first.
  const historyGroups = useMemo(() => {
    const visible = Array.from(vmById.values()).filter(
      (vm) => showArchived || !vm.archived,
    );
    const groups = new Map<string, BatchVM[]>();
    for (const vm of visible) {
      const key = vm.batch.scheduleDate ?? "__unscheduled__";
      const arr = groups.get(key);
      if (arr) arr.push(vm);
      else groups.set(key, [vm]);
    }
    const ordered = Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === "__unscheduled__") return 1;
      if (b[0] === "__unscheduled__") return -1;
      return b[0].localeCompare(a[0]);
    });
    for (const [, arr] of ordered) {
      arr.sort(
        (x, y) =>
          new Date(y.batch.createdAt).getTime() - new Date(x.batch.createdAt).getTime(),
      );
    }
    return ordered;
  }, [vmById, showArchived]);

  const archivedCount = useMemo(
    () => Array.from(vmById.values()).filter((vm) => vm.archived).length,
    [vmById],
  );

  function handleArchiveToggle(vm: BatchVM) {
    setBatchArchived(vm.batch.id, !vm.archived);
    setArchiveVersion((v) => v + 1);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl"
        data-testid="plexus-iq-batchflow-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold tracking-tight">
            {view === "history" ? (
              <>
                <History className="h-4 w-4 text-slate-500" />
                Batch History
              </>
            ) : (
              <>
                <Layers className="h-4 w-4 text-indigo-600" />
                Plexus BatchFlow
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {view === "landing" ? (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Every BatchFlow intake is its own isolated, timestamped batch. Start a
              new one for a fresh paste, or resume a recent batch to keep adding to it.
            </p>

            {activeVm ? (
              <div className="space-y-3">
                <ActiveBatchCallout vm={activeVm} />
                {activeVm.patientCount > 0 ? (
                  <div
                    className="rounded-xl border border-slate-200 bg-white p-3"
                    data-testid="batchflow-append-choice"
                  >
                    <div className="mb-2 text-xs font-medium text-slate-600">
                      This batch already has patients. What would you like to do?
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        className="flex-1 justify-start gap-2"
                        onClick={onStartNew}
                        data-testid="button-batchflow-start-separate"
                      >
                        <FilePlus2 className="h-4 w-4" />
                        Start separate batch
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1 justify-start gap-2"
                        onClick={() => onResume(activeVm.batch.id)}
                        data-testid="button-batchflow-append-current"
                      >
                        <Plus className="h-4 w-4" />
                        Append to current batch
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    className="w-full justify-start gap-2"
                    onClick={() => onResume(activeVm.batch.id)}
                    data-testid="button-batchflow-continue-active"
                  >
                    <Plus className="h-4 w-4" />
                    Add patients to this batch
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Button
                  className="w-full justify-start gap-2"
                  onClick={onStartNew}
                  data-testid="button-batchflow-start-new"
                >
                  <FilePlus2 className="h-4 w-4" />
                  Start New Batch
                </Button>
                {recentResumable ? (
                  <Button
                    variant="outline"
                    className="h-auto w-full justify-start gap-2 py-2.5 text-left"
                    onClick={() => onResume(recentResumable.batch.id)}
                    data-testid="button-batchflow-continue-recent"
                  >
                    <PlayCircle className="h-4 w-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        Continue Recent Batch
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {recentResumable.batch.facility ?? "Unassigned"} •{" "}
                        {formatTime12(recentResumable.batch.createdAt)} •{" "}
                        {recentResumable.patientCount} patient
                        {recentResumable.patientCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </Button>
                ) : null}
              </div>
            )}

            <Button
              variant="ghost"
              className="w-full justify-start gap-2 text-slate-600"
              onClick={() => setView("history")}
              data-testid="button-batchflow-view-history"
            >
              <History className="h-4 w-4" />
              View Batch History
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-slate-600"
                onClick={() => setView("landing")}
                data-testid="button-batchflow-history-back"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              {archivedCount > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-slate-500"
                  onClick={() => setShowArchived((s) => !s)}
                  data-testid="button-batchflow-toggle-archived"
                >
                  {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
                </Button>
              ) : null}
            </div>

            {historyGroups.length === 0 ? (
              <div
                className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500"
                data-testid="batchflow-history-empty"
              >
                No batches yet. Start a new batch to begin.
              </div>
            ) : (
              <div className="space-y-5">
                {historyGroups.map(([dateKey, rows]) => (
                  <div key={dateKey}>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {dateKey === "__unscheduled__"
                        ? "Unscheduled"
                        : formatDateHeader(dateKey)}
                    </div>
                    <div className="space-y-2">
                      {rows.map((vm) => (
                        <div
                          key={vm.batch.id}
                          className={`rounded-xl border bg-white p-3 ${
                            vm.archived ? "border-slate-200 opacity-70" : "border-slate-200"
                          }`}
                          data-testid={`batchflow-history-row-${vm.batch.id}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-slate-900">
                                {vm.batch.facility ?? "Unassigned clinic"}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {formatTime12(vm.batch.createdAt)}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <Users className="h-3 w-3" />
                                  {vm.patientCount}
                                </span>
                                <span>{batchSourceLabel(vm.source)}</span>
                              </div>
                            </div>
                            <StatusPill status={vm.status} />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() =>
                                onViewBatch(vm.batch.id, vm.batch.facility ?? "")
                              }
                              data-testid={`button-batchflow-view-${vm.batch.id}`}
                            >
                              View
                            </Button>
                            {vm.resumable ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1 text-xs"
                                onClick={() => onResume(vm.batch.id)}
                                data-testid={`button-batchflow-resume-${vm.batch.id}`}
                              >
                                <Plus className="h-3 w-3" />
                                Resume
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs text-slate-500"
                              onClick={() => handleArchiveToggle(vm)}
                              data-testid={`button-batchflow-archive-${vm.batch.id}`}
                            >
                              {vm.archived ? (
                                <>
                                  <ArchiveRestore className="h-3 w-3" />
                                  Unarchive
                                </>
                              ) : (
                                <>
                                  <Archive className="h-3 w-3" />
                                  Archive
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
