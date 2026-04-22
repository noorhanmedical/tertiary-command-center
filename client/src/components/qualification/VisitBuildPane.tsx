import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import QualificationIntakePane from "./QualificationIntakePane";
import QualificationPatientCardsPane from "./QualificationPatientCardsPane";
import { Loader2, Upload, FileText, Plus, Lock, AlertTriangle, User, Trash2 } from "lucide-react";
import { BatchHeader } from "@/components/BatchHeader";
import { PatientCard } from "@/components/PatientCard";
import type { OutreachScheduler } from "@shared/schema";
import type { ScreeningBatchWithPatients } from "@/pages/home";

const IMPORT_ACCESS_CODE = "1234";

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
  simpleHeaderMode?: boolean;
  simpleTitle?: string;
  simpleSubtitle?: string;
}

export default function VisitBuildPane(props: VisitBuildPaneProps) {
  const {
    selectedBatch,
    selectedBatchId,
    patients,
    isProcessing,
    analysisProgress,
    completedCount,
    clinicianInput,
    setClinicianInput,
    outreachSchedulers,
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
    onAssignScheduler,
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
    simpleHeaderMode = false,
    simpleTitle = "Visit Qualification",
    simpleSubtitle = "Build patients and generate qualifications.",
  } = props;

  return (
    <div className="flex flex-col h-full relative z-10">
      {simpleHeaderMode ? (
        <div className="border-b bg-white/80 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs font-semibold tracking-[0.16em] uppercase text-slate-500 mb-1">
                  PLEXUS ANCILLARY
                </div>
                <div className="text-xl font-semibold text-slate-900">{simpleTitle}</div>
                <div className="text-sm text-slate-500 mt-1">{simpleSubtitle}</div>
              </div>
              <div className="text-xs text-slate-500">
                {completedCount}/{patients.length} qualified
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-[240px] flex-1 max-w-md">
                <div className="text-xs font-medium text-slate-500 mb-1">Clinician</div>
                <input
                  value={clinicianInput}
                  onChange={(e) => setClinicianInput(e.target.value)}
                  onBlur={() => onUpdateClinician(clinicianInput)}
                  placeholder="Enter clinician name"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  data-testid="input-simple-clinician"
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  onClick={onDeleteAll}
                  disabled={patients.length === 0}
                  data-testid="button-simple-delete-all"
                >
                  Delete All
                </Button>
                <Button
                  onClick={onGenerateAll}
                  disabled={patients.length === 0 || isProcessing}
                  data-testid="button-simple-generate-all"
                >
                  {isProcessing ? "Generating..." : "Generate All"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <BatchHeader
          selectedBatch={selectedBatch}
          selectedBatchId={selectedBatchId}
          clinicianInput={clinicianInput}
          setClinicianInput={setClinicianInput}
          patients={patients}
          isProcessing={isProcessing}
          analysisProgress={analysisProgress}
          completedCount={completedCount}
          onNavigate={onNavigate}
          onDeleteAll={onDeleteAll}
          onGenerateAll={onGenerateAll}
          onUpdateClinician={onUpdateClinician}
          schedulers={outreachSchedulers}
          onAssignScheduler={onAssignScheduler}
        />
      )}
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
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
            title="Add Patients"
            pastePlaceholder={"Paste patient list here — it will import automatically\n\n9:00 AM - John Smith\n9:30 AM - Jane Doe\nBob Johnson"}
            uploadTestId="dropzone-upload"
            pasteTestId="input-paste-list"
            importTextTestId="button-import-text"
            addPatientTestId="button-add-patient"
          />
          <QualificationPatientCardsPane
            title="Schedule Generator"
            patients={patients}
            analyzingPatients={analyzingPatients}
            completedCount={completedCount}
            onUpdatePatient={onUpdatePatient}
            onDeletePatient={onDeletePatient}
            onAnalyzeOnePatient={onAnalyzeOnePatient}
            onOpenScheduleModal={onOpenScheduleModal}
            schedulerName={selectedBatch?.assignedScheduler?.name ?? null}
            batchScheduleDate={selectedBatch?.scheduleDate ?? null}
          />
        </div>
      </main>
    </div>
  );
}
