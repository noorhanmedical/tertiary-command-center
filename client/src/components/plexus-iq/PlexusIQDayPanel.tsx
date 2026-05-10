import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, Loader2, CalendarDays } from "lucide-react";
import { ResultsView } from "@/components/ResultsView";
import {
  useScreeningBatch,
  useUpdatePatient,
  useInvalidateBatch,
} from "@/hooks/api/screening-batches";
import { useToast } from "@/hooks/use-toast";
import type { PatientScreening, ScreeningBatch } from "@shared/schema";
import type { ReasoningValue } from "@/lib/pdfGeneration";

// Inline middle-column view for the Plexus IQ workspace. Renders the
// canonical <ResultsView/> (chromeless) for whichever batch(es) exist on
// the currently-selected date. When multiple batches exist for the day
// (multi-facility), a tab strip switches between them. No modal, no
// extra layer — the page is just a calendar on the right + this on the
// left, with the stats row above both.

type BatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

function formatLabel(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split("-").map(Number);
  const d = new Date(yyyy, (mm ?? 1) - 1, dd ?? 1);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function ResultsForBatch({
  batchId,
  onExport,
}: {
  batchId: number;
  onExport: () => void;
}) {
  const { data: batch, isLoading } = useScreeningBatch(batchId, { pollWhileProcessing: false });
  const { toast } = useToast();
  const invalidateBatch = useInvalidateBatch();
  const updatePatientMut = useUpdatePatient();

  const [expandedPatient, setExpandedPatient] = useState<number | null>(null);
  const [expandedClinical, setExpandedClinical] = useState<number | null>(null);
  const [selectedTestDetail, setSelectedTestDetail] = useState<
    { patientId: number; category: string; tests: string[]; reasoning: Record<string, ReasoningValue> } | null
  >(null);

  const patients = batch?.patients || [];

  if (isLoading || !batch) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ResultsView
      batch={batch as BatchWithPatients}
      patients={patients as PatientScreening[]}
      loading={false}
      onExport={onExport}
      onNavigate={() => { /* no-op inside Plexus IQ surface */ }}
      expandedPatient={expandedPatient}
      setExpandedPatient={setExpandedPatient}
      expandedClinical={expandedClinical}
      setExpandedClinical={setExpandedClinical}
      selectedTestDetail={selectedTestDetail}
      setSelectedTestDetail={setSelectedTestDetail}
      onUpdatePatient={(id, updates) =>
        updatePatientMut.mutate(
          { id, updates },
          {
            onError: (err: unknown) => {
              toast({
                title: "Update failed",
                description: err instanceof Error ? err.message : "Something went wrong",
                variant: "destructive",
              });
              invalidateBatch(batchId);
            },
          },
        )
      }
      chromeless
    />
  );
}

export function PlexusIQDayPanel({
  isoDate,
  batchesForDate,
}: {
  isoDate: string | null;
  batchesForDate: ScreeningBatch[];
}) {
  const queryClient = useQueryClient();

  const sorted = useMemo(
    () => [...batchesForDate].sort((a, b) => (a.facility ?? "").localeCompare(b.facility ?? "")),
    [batchesForDate],
  );

  const [activeBatchId, setActiveBatchId] = useState<number | null>(null);

  useEffect(() => {
    if (sorted.length > 0) {
      const exists = sorted.some((b) => b.id === activeBatchId);
      if (!exists) setActiveBatchId(sorted[0].id);
    } else {
      setActiveBatchId(null);
    }
  }, [sorted, activeBatchId]);

  async function handleExport() {
    if (!activeBatchId) return;
    const res = await fetch(`/api/screening-batches/${activeBatchId}/export`, { credentials: "include" });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `screening-results-${activeBatchId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
  }

  const showTabs = sorted.length > 1;
  const label = isoDate ? formatLabel(isoDate) : "";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarDays className="w-4 h-4 text-slate-500 shrink-0" />
          <h2 className="text-sm font-semibold tracking-tight text-slate-900 truncate" data-testid="plexus-iq-day-label">
            {isoDate ? label : "Pick a day"}
          </h2>
        </div>
      </div>

      {!isoDate ? (
        <div className="px-6 py-12 text-center text-sm text-slate-500">
          Select a date on the calendar to see its patients.
        </div>
      ) : sorted.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-slate-500">
          No patients scheduled for {label}.
        </div>
      ) : showTabs ? (
        <Tabs
          value={activeBatchId ? String(activeBatchId) : ""}
          onValueChange={(v) => setActiveBatchId(parseInt(v, 10))}
          className="flex flex-col flex-1 min-h-0"
        >
          <div className="px-5 pt-3 border-b border-slate-100">
            <TabsList className="h-9">
              {sorted.map((b) => (
                <TabsTrigger
                  key={b.id}
                  value={String(b.id)}
                  className="text-xs gap-1.5"
                  data-testid={`tab-plexus-iq-facility-${b.id}`}
                >
                  <Building2 className="w-3 h-3" />
                  {b.facility ?? "—"}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="flex-1 min-h-0">
            {sorted.map((b) => (
              <TabsContent
                key={b.id}
                value={String(b.id)}
                className="m-0 data-[state=inactive]:hidden"
                forceMount
              >
                {activeBatchId === b.id && (
                  <ResultsForBatch batchId={b.id} onExport={handleExport} />
                )}
              </TabsContent>
            ))}
          </div>
        </Tabs>
      ) : (
        <div className="flex-1 min-h-0">
          {activeBatchId != null && (
            <ResultsForBatch batchId={activeBatchId} onExport={handleExport} />
          )}
        </div>
      )}
    </div>
  );
}
