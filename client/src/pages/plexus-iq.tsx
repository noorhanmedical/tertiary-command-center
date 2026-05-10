import { useCallback, useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Loader2, Plus, Upload } from "lucide-react";
import {
  useScreeningBatches,
  useCreateBatch,
  useAddPatient,
} from "@/hooks/api/screening-batches";
import { useToast } from "@/hooks/use-toast";
import type { ScreeningBatch, PatientScreening } from "@shared/schema";
import { qk } from "@/hooks/api/keys";
import { PlexusIQCalendar } from "@/components/plexus-iq/PlexusIQCalendar";
import { PlexusIQAddPatientModal } from "@/components/plexus-iq/PlexusIQAddPatientModal";
import {
  PlexusIQBulkImportModal,
  type ParsedRow,
} from "@/components/plexus-iq/PlexusIQBulkImportModal";
import { PlexusIQDayModal } from "@/components/plexus-iq/PlexusIQDayModal";
import { findOrCreateBatchByFacilityDate } from "@/components/plexus-iq/findOrCreateBatch";

// Plexus IQ page — calendar-first multi-day, multi-facility workspace.
//
// Architecture:
//   - Plexus IQ owns NO batch of its own.
//   - The single source of truth is screening_batches keyed by
//     (facility, scheduleDate). Add Patient and Bulk Import resolve to or
//     create the matching batch on demand via findOrCreateBatchByFacilityDate.
//   - The day-click popup is the canonical <ResultsView/> rendered inside
//     a Dialog (with chromeless=true), so PDFs / Share / Export / Send to
//     Scheduler all come for free from the existing wiring.
//   - The inline calendar reads patient counts and ancillary categories from
//     each batch's detail (lazy-fetched via useQueries) and reads
//     "completed" indicators from /api/global-schedule-events.

type BatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

export default function PlexusIQPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createBatchMut = useCreateBatch();
  const addPatientMut = useAddPatient();

  const { data: batches = [] } = useScreeningBatches();

  // Lazy-fetch each batch's detail (just for the patient count + ancillaries
  // shown in the calendar dots). Batches without a scheduleDate never land
  // on the calendar, so we skip them. React Query dedupes with the per-batch
  // detail fetches done elsewhere (e.g. inside the day modal), so opening a
  // day doesn't refetch.
  const datedBatches = useMemo(() => batches.filter((b) => !!b.scheduleDate), [batches]);

  const detailQueries = useQueries({
    queries: datedBatches.map((b) => ({
      queryKey: qk.screeningBatches.detail(b.id),
      queryFn: async () => {
        const res = await fetch(`/api/screening-batches/${b.id}`, { credentials: "include" });
        if (!res.ok) throw new Error(`Batch detail fetch failed (${res.status})`);
        return (await res.json()) as BatchWithPatients;
      },
      staleTime: 30_000,
    })),
  });

  const batchDetails = useMemo<Record<number, BatchWithPatients>>(() => {
    const map: Record<number, BatchWithPatients> = {};
    detailQueries.forEach((q, i) => {
      const id = datedBatches[i]?.id;
      if (id != null && q.data) map[id] = q.data;
    });
    return map;
  }, [detailQueries, datedBatches]);

  // Day-click modal state.
  const [openDate, setOpenDate] = useState<string | null>(null);
  const batchesForOpenDate = useMemo(
    () => (openDate ? batches.filter((b) => b.scheduleDate === openDate) : []),
    [batches, openDate],
  );

  // Add Patient + Bulk Import modal state.
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    current: number;
    total: number;
    uniqueBatches: number;
    uniqueFacilities: number;
  } | null>(null);
  const [bulkPending, setBulkPending] = useState(false);

  const refreshBatches = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
  }, [queryClient]);

  const handleAddPatient = useCallback(
    async (input: {
      facility: string;
      scheduleDate: string;
      patientType: "visit" | "outreach";
      name: string;
      time?: string;
    }) => {
      try {
        const targetBatchId = await findOrCreateBatchByFacilityDate({
          facility: input.facility,
          scheduleDate: input.scheduleDate,
          allBatches: batches,
          createBatch: (i) => createBatchMut.mutateAsync(i) as Promise<{ id: number }>,
        });
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
        refreshBatches();
      } catch (err) {
        toast({
          title: "Add failed",
          description: err instanceof Error ? err.message : "Could not add patient",
          variant: "destructive",
        });
      }
    },
    [batches, createBatchMut, addPatientMut, toast, refreshBatches],
  );

  const handleBulkImport = useCallback(
    async (rows: ParsedRow[]) => {
      if (rows.length === 0) return;
      setBulkPending(true);

      // Group rows by (facility, scheduleDate) so we resolve each batch only
      // once, then post all of that group's patients in sequence.
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
        // Snapshot the current batches list once and grow it in memory as we
        // create new batches inside this import; this avoids round-tripping
        // through React Query for each new batch.
        let workingBatches: ScreeningBatch[] = [...batches];

        for (const [, groupRows] of groups) {
          const first = groupRows[0];
          const targetBatchId = await findOrCreateBatchByFacilityDate({
            facility: first.facility,
            scheduleDate: first.scheduleDate,
            allBatches: workingBatches,
            createBatch: async (i) => {
              const created = (await createBatchMut.mutateAsync(i)) as ScreeningBatch & { id: number };
              workingBatches = [...workingBatches, created as ScreeningBatch];
              return created;
            },
          });

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
        refreshBatches();
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
    [batches, createBatchMut, addPatientMut, toast, refreshBatches],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-slate-200/60 sticky top-0 z-30">
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
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-slate-50/40">
        <PlexusIQCalendar
          batches={batches}
          batchDetails={batchDetails}
          onSelectDate={(d) => setOpenDate(d)}
        />
      </div>

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
        batchesForDate={batchesForOpenDate}
        onClose={() => setOpenDate(null)}
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
