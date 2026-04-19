import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Building2, Loader2, Sparkles, Trash2 } from "lucide-react";
import { StepTimeline } from "@/components/StepTimeline";
import type { PatientScreening, ScreeningBatch } from "@shared/schema";

type ScreeningBatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

interface BatchHeaderProps {
  selectedBatch: ScreeningBatchWithPatients | undefined;
  selectedBatchId: number | null;
  clinicianInput: string;
  setClinicianInput: (v: string) => void;
  patients: PatientScreening[];
  isProcessing: boolean;
  analysisProgress: { completed: number; total: number } | null;
  completedCount: number;
  onNavigate: (step: "home" | "build" | "results") => void;
  onDeleteAll: () => void;
  onGenerateAll: () => void;
  onUpdateClinician: (clinicianName: string) => void;
}

export function BatchHeader({
  selectedBatch,
  selectedBatchId,
  clinicianInput,
  setClinicianInput,
  patients,
  isProcessing,
  analysisProgress,
  completedCount,
  onNavigate,
  onDeleteAll,
  onGenerateAll,
  onUpdateClinician,
}: BatchHeaderProps) {
  return (
    <header className="bg-white/85 dark:bg-card/85 backdrop-blur-md sticky top-0 z-50">
      <StepTimeline current="build" onNavigate={onNavigate} canGoToResults={completedCount > 0} />
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-2 flex-wrap border-b">
        <div className="flex items-center gap-2">
          <SidebarTrigger data-testid="button-sidebar-toggle" />
          <div>
            <h1 className="text-base font-bold tracking-tight" data-testid="text-schedule-name">{selectedBatch?.name || "Loading..."}</h1>
            <div className="flex items-center gap-1 mt-0.5">
              <input
                type="text"
                placeholder="Clinician / Provider"
                value={clinicianInput}
                onChange={(e) => setClinicianInput(e.target.value)}
                onBlur={() => {
                  if (selectedBatchId) {
                    onUpdateClinician(clinicianInput);
                  }
                }}
                className="text-xs text-muted-foreground bg-transparent border-0 border-b border-dashed border-muted-foreground/40 focus:border-primary focus:outline-none px-0 py-0.5 w-44 placeholder:text-muted-foreground/50"
                data-testid="input-clinician-name"
              />
            </div>
            {selectedBatch?.facility && (
              <div className="flex items-center gap-1 mt-0.5">
                <Building2 className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground" data-testid="text-facility-build">{selectedBatch.facility}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {patients.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDeleteAll}
              disabled={isProcessing}
              className="gap-1.5"
              data-testid="button-delete-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete All
            </Button>
          )}
          <Button
            onClick={onGenerateAll}
            disabled={isProcessing || patients.length === 0}
            className="gap-1.5"
            data-testid="button-generate-all"
          >
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Generate All
          </Button>
        </div>
      </div>
    </header>
  );
}
