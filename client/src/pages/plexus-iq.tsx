import { useCallback, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CalendarDays, Loader2, Plus, Upload } from "lucide-react";
import {
  useScreeningBatches,
  useCreateBatch,
  useAddPatient,
  useUpdatePatient,
  useDeletePatient,
  useAnalyzePatient,
  useStartBatchAnalysis,
  useInvalidateBatch,
  fetchAnalysisStatus,
} from "@/hooks/api/screening-batches";
import { useToast } from "@/hooks/use-toast";
import type { ScreeningBatch, PatientScreening } from "@shared/schema";
import { qk } from "@/hooks/api/keys";
import { apiRequest } from "@/lib/queryClient";
import { PlexusIQCalendar, type CalendarSummaryRow } from "@/components/plexus-iq/PlexusIQCalendar";
import { PlexusIQAddPatientModal } from "@/components/plexus-iq/PlexusIQAddPatientModal";
import {
  PlexusIQBulkImportModal,
  type ParsedRow,
} from "@/components/plexus-iq/PlexusIQBulkImportModal";
import { PlexusIQDayModal } from "@/components/plexus-iq/PlexusIQDayModal";
import { PlexusIQAssignDateDialog } from "@/components/plexus-iq/PlexusIQAssignDateDialog";
import { PlexusIQWorkspace } from "@/components/plexus-iq/PlexusIQWorkspace";
import { PlexusIQDashboardRow } from "@/components/plexus-iq/PlexusIQDashboardRow";

// Plexus IQ page — patient workspace center + calendar drawer.
//
// Layout:
//   Left   — existing app sidebar (provided by App.tsx route shell).
//   Center — PlexusIQWorkspace: real screening_batches grouped by
//            facility/date, each section listing the existing PatientCard.
//   Right  — Sheet drawer (toggled by the calendar icon in the header)
//            containing PlexusIQCalendar. Date click opens the canonical
//            <ResultsView/> via PlexusIQDayModal.
//
// Architecture rules (preserved from prior hardening pass):
//   - Plexus IQ owns NO batch of its own.
//   - Single source of truth: screening_batches keyed by
//     (facility, scheduleDate). Add Patient and Bulk Import resolve to or
//     create the matching batch on demand via resolveBatchId.
//   - The day-click popup is the canonical <ResultsView/> rendered inside
//     a Dialog (with chromeless=true), so PDFs / Share / Export / Send to
//     Scheduler all come for free from the existing wiring.
//   - The calendar reads from a single aggregated endpoint
//     (/api/screening-batches/calendar-summary) that returns one row per
//     batch with patientCount + categories. No per-batch fan-out for the
//     calendar.
//   - The center workspace fetches per-batch detail ONLY for batches with
//     patientCount > 0 (lazy `useQueries` over the active subset). Empty
//     historical batches don't trigger detail fetches.
//   - Concurrent "Add Patient" clicks for the same (facility, date) are
//     deduplicated via pendingCreatesRef so we don't double-create batches
//     during the gap between create resolution and React Query refetch.

const CALENDAR_SUMMARY_KEY = ["/api/screening-batches/calendar-summary"] as const;

type BatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

export default function PlexusIQPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidateBatch = useInvalidateBatch();
  const createBatchMut = useCreateBatch();
  const addPatientMut = useAddPatient();
  const updatePatientMut = useUpdatePatient();
  const deletePatientMut = useDeletePatient();
  const analyzePatientMut = useAnalyzePatient();
  const startAnalysisMut = useStartBatchAnalysis();

  const { data: batches = [] } = useScreeningBatches();

  // Aggregated payload for the calendar (counts + ancillary categories).
  // Single round-trip; replaces the old per-batch detail fan-out.
  const { data: summary = [] } = useQuery<CalendarSummaryRow[]>({
    queryKey: CALENDAR_SUMMARY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/screening-batches/calendar-summary", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Calendar summary fetch failed (${res.status})`);
      return res.json();
    },
    staleTime: 15_000,
  });

  // Active batches = those with at least one patient. Only these need
  // per-batch detail hydration for the workspace render.
  const activeBatchIds = useMemo(
    () => summary.filter((s) => s.patientCount > 0).map((s) => s.id),
    [summary],
  );

  const detailQueries = useQueries({
    queries: activeBatchIds.map((id) => ({
      queryKey: qk.screeningBatches.detail(id),
      queryFn: async () => {
        const res = await fetch(`/api/screening-batches/${id}`, { credentials: "include" });
        if (!res.ok) throw new Error(`Batch detail fetch failed (${res.status})`);
        return (await res.json()) as BatchWithPatients;
      },
      staleTime: 30_000,
    })),
  });

  const batchDetails = useMemo<Record<number, BatchWithPatients>>(() => {
    const map: Record<number, BatchWithPatients> = {};
    detailQueries.forEach((q, i) => {
      const id = activeBatchIds[i];
      if (id != null && q.data) map[id] = q.data;
    });
    return map;
  }, [detailQueries, activeBatchIds]);

  // ───── Modals + drawer state ─────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [openDate, setOpenDate] = useState<string | null>(null);

  const batchesForOpenDate = useMemo(
    () => (openDate ? batches.filter((b) => b.scheduleDate === openDate) : []),
    [batches, openDate],
  );

  // ───── Bulk import progress ──────────────────────────────────────────
  const [bulkProgress, setBulkProgress] = useState<{
    current: number;
    total: number;
    uniqueBatches: number;
    uniqueFacilities: number;
  } | null>(null);
  const [bulkPending, setBulkPending] = useState(false);

  // Assign-date dialog state for the unscheduled-batches panel inside the
  // calendar drawer.
  const [assignTarget, setAssignTarget] = useState<{ id: number; label: string } | null>(null);
  const [assignPending, setAssignPending] = useState(false);

  // Dedup concurrent "Add Patient" clicks targeting the same (facility, date).
  const pendingCreatesRef = useRef<Map<string, Promise<number>>>(new Map());

  // ───── Per-batch + per-patient analysis tracking ─────────────────────
  const [analyzingBatchId, setAnalyzingBatchId] = useState<number | null>(null);
  const [analyzingPatients, setAnalyzingPatients] = useState<Set<number>>(new Set());

  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
    queryClient.invalidateQueries({ queryKey: CALENDAR_SUMMARY_KEY });
  }, [queryClient]);

  const resolveBatchId = useCallback(
    async (facility: string, scheduleDate: string): Promise<number> => {
      const existing = batches.find(
        (b) => b.facility === facility && b.scheduleDate === scheduleDate,
      );
      if (existing) return existing.id;

      const key = `${facility}::${scheduleDate}`;
      const inFlight = pendingCreatesRef.current.get(key);
      if (inFlight) return inFlight;

      const promise = createBatchMut
        .mutateAsync({
          name: `${facility} - ${scheduleDate}`,
          facility,
          scheduleDate,
        })
        .then((b) => (b as { id: number }).id);
      pendingCreatesRef.current.set(key, promise);
      try {
        return await promise;
      } finally {
        pendingCreatesRef.current.delete(key);
      }
    },
    [batches, createBatchMut],
  );

  // Returns true on success, false on failure. The Add Patient modal uses
  // the boolean to decide whether to clear and close itself; on failure we
  // leave the modal open so the user can correct and retry.
  const handleAddPatient = useCallback(
    async (input: {
      facility: string;
      scheduleDate: string;
      patientType: "visit" | "outreach";
      name: string;
      time?: string;
    }): Promise<boolean> => {
      try {
        const targetBatchId = await resolveBatchId(input.facility, input.scheduleDate);
        await addPatientMut.mutateAsync({
          batchId: targetBatchId,
          name: input.name,
          time: input.time,
          patientType: input.patientType,
        });
        toast({
          title: "Patient added",
          description: `${input.facility} on ${input.scheduleDate}`,
        });
        refreshAll();
        return true;
      } catch (err) {
        toast({
          title: "Add failed",
          description: err instanceof Error ? err.message : "Could not add patient",
          variant: "destructive",
        });
        return false;
      }
    },
    [resolveBatchId, addPatientMut, toast, refreshAll],
  );

  const handleBulkImport = useCallback(
    async (rows: ParsedRow[]) => {
      if (rows.length === 0) return;
      setBulkPending(true);

      const groups = new Map<string, ParsedRow[]>();
      for (const r of rows) {
        const key = `${r.facility}::${r.scheduleDate}`;
        const arr = groups.get(key);
        if (arr) arr.push(r);
        else groups.set(key, [r]);
      }

      const uniqueFacilities = new Set(rows.map((r) => r.facility)).size;
      let processed = 0;
      const total = rows.length;

      try {
        for (const [, groupRows] of groups) {
          const first = groupRows[0];
          const targetBatchId = await resolveBatchId(first.facility, first.scheduleDate);

          for (const r of groupRows) {
            await addPatientMut.mutateAsync({
              batchId: targetBatchId,
              name: r.name,
              time: r.time,
              patientType: r.patientType,
            });
            processed += 1;
            setBulkProgress({
              current: processed,
              total,
              uniqueBatches: groups.size,
              uniqueFacilities,
            });
          }
        }

        toast({
          title: "Import complete",
          description: `Imported ${total} patient${total === 1 ? "" : "s"} into ${groups.size} batch${groups.size === 1 ? "" : "es"} across ${uniqueFacilities} facilit${uniqueFacilities === 1 ? "y" : "ies"}.`,
        });
        refreshAll();
        setBulkOpen(false);
      } catch (err) {
        toast({
          title: "Import failed",
          description: err instanceof Error ? err.message : "Bulk import failed",
          variant: "destructive",
        });
      } finally {
        setBulkPending(false);
        setBulkProgress(null);
      }
    },
    [resolveBatchId, addPatientMut, toast, refreshAll],
  );

  const handleAssignDate = useCallback(
    async (batchId: number, isoDate: string) => {
      setAssignPending(true);
      try {
        const res = await apiRequest("PATCH", `/api/screening-batches/${batchId}`, {
          scheduleDate: isoDate,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Failed (${res.status})`);
        }
        toast({ title: "Date assigned", description: `Batch scheduled for ${isoDate}` });
        refreshAll();
        setAssignTarget(null);
      } catch (err) {
        toast({
          title: "Could not assign date",
          description: err instanceof Error ? err.message : "Update failed",
          variant: "destructive",
        });
      } finally {
        setAssignPending(false);
      }
    },
    [toast, refreshAll],
  );

  // ───── Per-patient mutations (used by PatientCard inside workspace) ──
  const handleUpdatePatient = useCallback(
    (id: number, updates: Record<string, unknown>) => {
      updatePatientMut.mutate(
        { id, updates },
        {
          onError: (err: unknown) => {
            toast({
              title: "Update failed",
              description: err instanceof Error ? err.message : "Something went wrong",
              variant: "destructive",
            });
          },
        },
      );
    },
    [updatePatientMut, toast],
  );

  const handleDeletePatient = useCallback(
    (id: number) => {
      deletePatientMut.mutate(id, {
        onSuccess: () => refreshAll(),
      });
    },
    [deletePatientMut, refreshAll],
  );

  const handleAnalyzePatient = useCallback(
    async (patientId: number) => {
      setAnalyzingPatients((prev) => new Set(prev).add(patientId));
      try {
        await analyzePatientMut.mutateAsync(patientId);
        const owning = batches.find((b) =>
          (batchDetails[b.id]?.patients ?? []).some((p) => p.id === patientId),
        );
        if (owning) invalidateBatch(owning.id);
        refreshAll();
        toast({ title: "Patient analyzed" });
      } catch (err) {
        toast({
          title: "Analysis failed",
          description: err instanceof Error ? err.message : "Analysis failed",
          variant: "destructive",
        });
      } finally {
        setAnalyzingPatients((prev) => {
          const next = new Set(prev);
          next.delete(patientId);
          return next;
        });
      }
    },
    [analyzePatientMut, batches, batchDetails, invalidateBatch, refreshAll, toast],
  );

  // Generate All for a single batch — runs the canonical batch analysis
  // pipeline and polls the existing /api/batches/:id/analysis-status route.
  const handleGenerateBatch = useCallback(
    (batchId: number) => {
      if (analyzingBatchId !== null) return;
      setAnalyzingBatchId(batchId);
      startAnalysisMut.mutate(batchId, {
        onSuccess: async () => {
          const MAX_POLLS = 300;
          try {
            for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
              const status = await fetchAnalysisStatus(batchId);
              if (status.status === "completed") {
                invalidateBatch(batchId);
                refreshAll();
                toast({
                  title: "Analysis complete",
                  description: "Patients in this batch have been screened.",
                });
                return;
              }
              if (status.status === "failed") {
                throw new Error(status.errorMessage || "Analysis failed.");
              }
              await new Promise((r) => setTimeout(r, 3000));
            }
            throw new Error("Analysis taking longer than expected.");
          } catch (err) {
            toast({
              title: "Analysis failed",
              description: err instanceof Error ? err.message : "Analysis failed",
              variant: "destructive",
            });
          } finally {
            setAnalyzingBatchId(null);
          }
        },
        onError: (err: Error) => {
          setAnalyzingBatchId(null);
          toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
        },
      });
    },
    [analyzingBatchId, startAnalysisMut, invalidateBatch, refreshAll, toast],
  );

  const handleOpenFinalSchedule = useCallback((scheduleDate: string) => {
    setOpenDate(scheduleDate);
  }, []);

  // Delete every patient in a single batch (does NOT delete the batch row).
  // Sequential to keep React Query / server invalidation predictable.
  const handleDeleteAllForBatch = useCallback(
    async (batchId: number) => {
      const detail = batchDetails[batchId];
      const patients = detail?.patients ?? [];
      if (patients.length === 0) return;
      const confirmed = window.confirm(
        `Delete all ${patients.length} patient${patients.length === 1 ? "" : "s"} on this date? The batch itself will remain.`,
      );
      if (!confirmed) return;
      try {
        for (const p of patients) {
          await deletePatientMut.mutateAsync(p.id);
        }
        invalidateBatch(batchId);
        refreshAll();
        toast({
          title: "Patients deleted",
          description: `Cleared ${patients.length} patient${patients.length === 1 ? "" : "s"}.`,
        });
      } catch (err) {
        toast({
          title: "Delete failed",
          description: err instanceof Error ? err.message : "Could not delete patients",
          variant: "destructive",
        });
      }
    },
    [batchDetails, deletePatientMut, invalidateBatch, refreshAll, toast],
  );

  // Delete every patient under a facility, across every active dated/undated
  // batch. Batch rows themselves are preserved.
  const handleDeleteAllForFacility = useCallback(
    async (facility: string) => {
      const facilityBatches = batches.filter((b) => b.facility === facility);
      const allPatients: number[] = [];
      for (const b of facilityBatches) {
        const detail = batchDetails[b.id];
        if (detail?.patients) {
          for (const p of detail.patients) allPatients.push(p.id);
        }
      }
      if (allPatients.length === 0) return;
      const confirmed = window.confirm(
        `Delete all ${allPatients.length} patient${allPatients.length === 1 ? "" : "s"} for ${facility}? Batch records will remain.`,
      );
      if (!confirmed) return;
      try {
        for (const id of allPatients) {
          await deletePatientMut.mutateAsync(id);
        }
        for (const b of facilityBatches) invalidateBatch(b.id);
        refreshAll();
        toast({
          title: "Facility cleared",
          description: `Cleared ${allPatients.length} patient${allPatients.length === 1 ? "" : "s"} for ${facility}.`,
        });
      } catch (err) {
        toast({
          title: "Delete failed",
          description: err instanceof Error ? err.message : "Could not delete patients",
          variant: "destructive",
        });
      }
    },
    [batches, batchDetails, deletePatientMut, invalidateBatch, refreshAll, toast],
  );

  return (
    <div className="flex flex-col h-full w-full min-w-0">
      <header className="bg-white border-b border-slate-200/60 sticky top-0 z-30">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <SidebarTrigger data-testid="button-sidebar-toggle-plexus-iq" />
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900" data-testid="text-plexus-iq-title">
                Plexus IQ
              </h1>
              <p className="text-[11px] text-slate-500">
                Multi-day, multi-facility workspace
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkOpen(true)}
              className="gap-1.5 rounded-xl"
              data-testid="button-plexus-iq-bulk-import"
            >
              <Upload className="w-4 h-4" />
              Import
            </Button>
            <Button
              size="sm"
              onClick={() => setAddOpen(true)}
              className="gap-1.5 rounded-xl"
              data-testid="button-plexus-iq-add-patient"
            >
              <Plus className="w-4 h-4" />
              Add Patient
            </Button>
            <button
              type="button"
              onClick={() => setCalendarOpen(true)}
              aria-label="Open calendar"
              title="Calendar"
              className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-plexus-navy-800 text-white shadow-sm hover:bg-plexus-navy-700 transition-colors"
              data-testid="button-plexus-iq-calendar"
            >
              <CalendarDays className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-auto bg-slate-50/40">
        <div className="w-full px-4 sm:px-6 lg:px-8 pt-6">
          <PlexusIQDashboardRow summary={summary} batchDetails={batchDetails} />
        </div>
        <PlexusIQWorkspace
          summary={summary}
          batchDetails={batchDetails}
          analyzingBatchId={analyzingBatchId}
          analyzingPatients={analyzingPatients}
          onGenerateBatch={handleGenerateBatch}
          onOpenFinalSchedule={handleOpenFinalSchedule}
          onDeleteAllForBatch={handleDeleteAllForBatch}
          onDeleteAllForFacility={handleDeleteAllForFacility}
          onUpdatePatient={handleUpdatePatient}
          onDeletePatient={handleDeletePatient}
          onAnalyzeOnePatient={handleAnalyzePatient}
        />
      </main>

      <Sheet open={calendarOpen} onOpenChange={(v) => { if (!v) setCalendarOpen(false); }}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl p-0 gap-0 flex flex-col"
          data-testid="plexus-iq-calendar-sheet"
        >
          <SheetHeader className="px-5 pt-5 pb-3 border-b">
            <SheetTitle className="text-base font-semibold tracking-tight">
              Calendar
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-auto">
            <PlexusIQCalendar
              summary={summary}
              onSelectDate={(d) => {
                setOpenDate(d);
                setCalendarOpen(false);
              }}
              onAssignDate={(id, label) => setAssignTarget({ id, label })}
            />
          </div>
        </SheetContent>
      </Sheet>

      <PlexusIQAddPatientModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={handleAddPatient}
        pending={addPatientMut.isPending || createBatchMut.isPending}
      />

      <PlexusIQBulkImportModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onImport={handleBulkImport}
        pending={bulkPending}
        progress={bulkProgress}
      />

      <PlexusIQDayModal
        open={openDate !== null}
        isoDate={openDate}
        batchesForDate={batchesForOpenDate as ScreeningBatch[]}
        onClose={() => setOpenDate(null)}
      />

      <PlexusIQAssignDateDialog
        open={assignTarget !== null}
        batchId={assignTarget?.id ?? null}
        batchLabel={assignTarget?.label ?? ""}
        onClose={() => setAssignTarget(null)}
        onAssign={handleAssignDate}
        pending={assignPending}
      />

      {(addPatientMut.isPending || createBatchMut.isPending) && (
        <div className="fixed bottom-6 right-6 inline-flex items-center gap-2 rounded-full bg-plexus-navy-800 text-white shadow-lg px-4 py-2 z-40">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Saving…</span>
        </div>
      )}
    </div>
  );
}
