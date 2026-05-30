import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import QualificationIntakePane from "./QualificationIntakePane";
import QualificationPatientCardsPane from "./QualificationPatientCardsPane";
import { Loader2, Trash2, Sparkles } from "lucide-react";
import { StepTimeline } from "@/components/StepTimeline";
import type { OutreachScheduler } from "@shared/schema";
import type { ScreeningBatchWithPatients } from "@/pages/home";

type BuildSourceMode = "visit" | "outreach";

interface VisitBuildPaneProps {
  selectedBatch: ScreeningBatchWithPatients | undefined;
  selectedBatchId: number | null;
  patients: any[];
  batchLoading: boolean;
  isProcessing: boolean;
  analysisProgress: { completed: number; total: number } | null;
  completedCount: number;
  clinicianInput: string;
  setClinicianInput: (value: string) => void;
  outreachSchedulers: OutreachScheduler[];
  pasteText: string;
  setPasteText: (value: string) => void;
  dragOver: boolean;
  setDragOver: (value: boolean) => void;
  importUnlocked: boolean;
  setImportUnlocked: (value: boolean) => void;
  importCodeInput: string;
  setImportCodeInput: (value: string) => void;
  importCodeError: boolean;
  setImportCodeError: (value: boolean) => void;
  analyzingPatients: Set<number>;
  onNavigate: (step: "home" | "build" | "results") => void;
  onDeleteAll: () => void;
  onGenerateAll: () => void;
  onUpdateClinician: (clinicianName: string) => void;
  onAssignScheduler?: () => void;
  onHandleDrop: (e: React.DragEvent) => void;
  onHandleFileUpload: (files: FileList | File[]) => void;
  onImportText: () => void;
  onAddPatient: () => void;
  onUpdatePatient: (id: number, updates: Record<string, unknown>) => void;
  onDeletePatient: (id: number) => void;
  onAnalyzeOnePatient: (id: number) => void;
  onOpenScheduleModal: (patient: any) => void;
  importFilePending: boolean;
  importTextPending: boolean;
  addPatientPending: boolean;
  // Legacy props kept for callsite compatibility — no longer rendered as
  // separate copy. The compact header derives its title from sourceMode +
  // facility, and explanatory subtitle text has been removed.
  simpleHeaderMode?: boolean;
  simpleTitle?: string;
  simpleSubtitle?: string;
  intakeTitle?: string;
  cardsTitle?: string;
  simpleBuildStepLabel?: string;
  simpleResultsStepLabel?: string;
  sourceMode?: BuildSourceMode;
  sourceFacility?: string | null;
}

export default function VisitBuildPane(props: VisitBuildPaneProps) {
  const {
    selectedBatch,
    patients,
    isProcessing,
    analysisProgress,
    completedCount,
    clinicianInput,
    setClinicianInput,
    pasteText,
    setPasteText,
    dragOver,
    setDragOver,
    importUnlocked,
    setImportUnlocked,
    importCodeInput,
    setImportCodeInput,
    importCodeError,
    setImportCodeError,
    analyzingPatients,
    onNavigate,
    onDeleteAll,
    onGenerateAll,
    onUpdateClinician,
    onHandleDrop,
    onHandleFileUpload,
    onImportText,
    onAddPatient,
    onUpdatePatient,
    onDeletePatient,
    onAnalyzeOnePatient,
    onOpenScheduleModal,
    importFilePending,
    importTextPending,
    addPatientPending,
    intakeTitle = "Add Patients",
    cardsTitle = "Schedule Generator",
    simpleBuildStepLabel = "Build Schedule",
    simpleResultsStepLabel = "Final Schedule",
    sourceMode = "visit",
    sourceFacility,
  } = props;

  const facility = sourceFacility ?? selectedBatch?.facility ?? null;
  const headerLabel = sourceMode === "outreach" ? "Outreach" : "Visit";
  const headerTitle = facility ? `${headerLabel} · ${facility}` : headerLabel;

  return (
    <div className="flex flex-col h-full relative z-10">
      <header className="bg-white/85 dark:bg-card/85 backdrop-blur-md sticky top-0 z-50 border-b border-slate-200/60">
        <StepTimeline
          current="build"
          onNavigate={onNavigate}
          canGoToResults={completedCount > 0}
          buildLabel={simpleBuildStepLabel}
          resultsLabel={simpleResultsStepLabel}
        />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <SidebarTrigger data-testid="button-sidebar-toggle-build" />
            <div className="min-w-0">
              <h1
                className="text-xl font-semibold tracking-tight text-slate-900 truncate"
                data-testid="text-build-header-title"
              >
                {headerTitle}
              </h1>
              <input
                type="text"
                placeholder="Clinician / Provider"
                value={clinicianInput}
                onChange={(e) => setClinicianInput(e.target.value)}
                onBlur={() => onUpdateClinician(clinicianInput)}
                className="mt-0.5 text-xs text-slate-500 bg-transparent border-0 focus:outline-none px-0 py-0 w-44 placeholder:text-slate-400"
                data-testid="input-build-clinician"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {patients.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={onDeleteAll}
                disabled={isProcessing}
                className="gap-1.5 rounded-xl"
                data-testid="button-build-delete-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete All
              </Button>
            )}
            <Button
              onClick={onGenerateAll}
              disabled={isProcessing || patients.length === 0}
              className="gap-1.5 rounded-xl"
              data-testid="button-build-generate-all"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Generate All
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-auto bg-finance-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {isProcessing && (
            <Card className="p-6">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
                <p className="font-semibold">Analyzing patients...</p>
                {analysisProgress ? (
                  <>
                    <p className="text-sm text-muted-foreground" data-testid="text-analysis-progress">
                      {analysisProgress.completed} of {analysisProgress.total} completed
                    </p>
                    <div className="w-full max-w-xs bg-slate-200 dark:bg-muted rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                        style={{
                          width: `${analysisProgress.total > 0 ? (analysisProgress.completed / analysisProgress.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Starting AI screening...</p>
                )}
              </div>
            </Card>
          )}

          <QualificationIntakePane
            pasteText={pasteText}
            setPasteText={setPasteText}
            dragOver={dragOver}
            setDragOver={setDragOver}
            importUnlocked={importUnlocked}
            setImportUnlocked={setImportUnlocked}
            importCodeInput={importCodeInput}
            setImportCodeInput={setImportCodeInput}
            importCodeError={importCodeError}
            setImportCodeError={setImportCodeError}
            importFilePending={importFilePending}
            importTextPending={importTextPending}
            addPatientPending={addPatientPending}
            onHandleDrop={onHandleDrop}
            onHandleFileUpload={onHandleFileUpload}
            onImportText={onImportText}
            onAddPatient={onAddPatient}
            title={intakeTitle}
            pastePlaceholder={"Paste patient list here — it will import automatically\n\n9:00 AM - John Smith\n9:30 AM - Jane Doe\nBob Johnson"}
            uploadTestId="dropzone-upload"
            pasteTestId="input-paste-list"
            importTextTestId="button-import-text"
            addPatientTestId="button-add-patient"
          />
          <QualificationPatientCardsPane
            title={cardsTitle}
            patients={patients}
            analyzingPatients={analyzingPatients}
            completedCount={completedCount}
            onUpdatePatient={onUpdatePatient}
            onDeletePatient={onDeletePatient}
            onAnalyzeOnePatient={onAnalyzeOnePatient}
            onOpenScheduleModal={onOpenScheduleModal}
            schedulerName={selectedBatch?.assignedScheduler?.name ?? null}
            batchScheduleDate={selectedBatch?.scheduleDate ?? null}
            sourceMode={sourceMode}
          />
        </div>
      </main>
    </div>
  );
}
