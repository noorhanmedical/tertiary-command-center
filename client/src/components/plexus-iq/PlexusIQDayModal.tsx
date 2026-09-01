import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ResultsView } from "@/components/ResultsView";
import {
  useScreeningBatch,
  useUpdatePatient,
  useInvalidateBatch,
} from "@/hooks/api/screening-batches";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Building2 } from "lucide-react";
import type { ScreeningBatch, PatientScreening } from "@shared/schema";
import type { ReasoningValue } from "@/lib/pdfGeneration";

// Day-click modal — renders the canonical <ResultsView/> for the chosen
// date. If multiple batches exist for that date across facilities, a tab
// strip switches between them. ResultsView is rendered with chromeless
// (no StepTimeline / sidebar trigger / page title) so it sits cleanly
// inside the modal; all of its actions (Plexus Atlas, Clinician Atlas, Share,
// Export CSV, Send All to Scheduler, per-row schedule + send + status)
// continue to work via the existing wiring.

type BatchWithPatients = ScreeningBatch & {
  patients?: PatientScreening[];
};

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
      onNavigate={() => { /* no-op inside modal */ }}
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

export function PlexusIQDayModal({
  open,
  isoDate,
  batchesForDate,
  onClose,
}: {
  open: boolean;
  isoDate: string | null;
  batchesForDate: ScreeningBatch[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const sorted = useMemo(() => {
    return [...batchesForDate].sort((a, b) => (a.facility ?? "").localeCompare(b.facility ?? ""));
  }, [batchesForDate]);

  const [activeBatchId, setActiveBatchId] = useState<number | null>(null);

  // Reset/initialize active tab whenever the day or batch list changes.
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
  }

  const showTabs = sorted.length > 1;
  const label = isoDate ? formatLabel(isoDate) : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
        }
      }}
    >
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-6xl max-h-[90vh] p-0 gap-0 rounded-2xl flex flex-col overflow-hidden"
        data-testid="plexus-iq-day-modal"
      >
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold tracking-tight">
            {label || "Schedule"}
          </DialogTitle>
        </DialogHeader>

        {sorted.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            No batches scheduled for this date.
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
            <div className="flex-1 min-h-0 overflow-auto">
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
          <div className="flex-1 min-h-0 overflow-auto">
            {activeBatchId != null && (
              <ResultsForBatch batchId={activeBatchId} onExport={handleExport} />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
