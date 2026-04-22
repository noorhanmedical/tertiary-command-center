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
  } = props;

  return (
    <div className="flex flex-col h-full relative z-10">
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
