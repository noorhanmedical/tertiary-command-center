import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Loader2, Plus, Upload } from "lucide-react";
import {
  useScreeningBatches,
  useCreateBatch,
  useAddPatient,
} from "@/hooks/api/screening-batches";
import { useToast } from "@/hooks/use-toast";
import type { ScreeningBatch } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { PlexusIQCalendar, type CalendarSummaryRow } from "@/components/plexus-iq/PlexusIQCalendar";
import { PlexusIQAddPatientModal } from "@/components/plexus-iq/PlexusIQAddPatientModal";
import {
  PlexusIQBulkImportModal,
  type ParsedRow,
} from "@/components/plexus-iq/PlexusIQBulkImportModal";
import { PlexusIQAssignDateDialog } from "@/components/plexus-iq/PlexusIQAssignDateDialog";
import { PlexusIQStatsRow } from "@/components/plexus-iq/PlexusIQStatsRow";
import { PlexusIQDayPanel } from "@/components/plexus-iq/PlexusIQDayPanel";

// Plexus IQ — calendar-first multi-day, multi-facility workspace.
//
// Layout:
//   ┌─────────────────────────────────────────────────────────────┐
//   │  Header (Plexus IQ + Import + Add Patient)                  │
//   ├─────────────────────────────────────────────────────────────┤
//   │  Stats row (BrainWave / VitalWave / Ultrasound / Total)     │
//   ├─────────────────────────────────────┬───────────────────────┤
//   │                                     │                       │
//   │  Selected day's patient cards       │  Calendar (right)     │
//   │  (canonical ResultsView, chromeless)│  Click a day → middle │
//   │                                     │  updates inline       │
//   │                                     │                       │
//   └─────────────────────────────────────┴───────────────────────┘
//
// No batch is owned by Plexus IQ. Adding a patient resolves to or creates
// the matching screening_batch keyed by (facility, scheduleDate).
// Concurrent Add Patient clicks for the same key share a single in-flight
// POST via pendingCreatesRef.

const CALENDAR_SUMMARY_KEY = ["/api/screening-batches/calendar-summary"] as const;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function PlexusIQPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createBatchMut = useCreateBatch();
  const addPatientMut = useAddPatient();

  const { data: batches = [] } = useScreeningBatches();
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

  // Selected day defaults to today. Clicking a calendar cell updates this.
  const [selectedDate, setSelectedDate] = useState<string>(todayIso());
  const batchesForSelectedDate = useMemo(
    () => batches.filter((b) => b.scheduleDate === selectedDate),
    [batches, selectedDate],
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

  // Assign-date dialog state.
  const [assignTarget, setAssignTarget] = useState<{ id: number; label: string } | null>(null);
  const [assignPending, setAssignPending] = useState(false);

  // Dedup concurrent batch creates for the same (facility, date) key.
  const pendingCreatesRef = useRef<Map<string, Promise<number>>>(new Map());

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
        // Auto-jump the calendar selection to the day we just added so the
        // user immediately sees the new patient.
        setSelectedDate(input.scheduleDate);
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
        setSelectedDate(isoDate);
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

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0 h-full w-full bg-slate-50/40">
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

      <div className="flex-1 min-h-0 overflow-auto">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-5 space-y-5">
          <PlexusIQStatsRow summary={summary} />

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
            <PlexusIQDayPanel
              isoDate={selectedDate}
              batchesForDate={batchesForSelectedDate as ScreeningBatch[]}
            />

            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <PlexusIQCalendar
                summary={summary}
                onSelectDate={(d) => setSelectedDate(d)}
                onAssignDate={(id, label) => setAssignTarget({ id, label })}
                selectedDate={selectedDate}
                compact
              />
            </div>
          </div>
        </div>
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
