import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import QualificationIntakePane from "./QualificationIntakePane";
import QualificationPatientCardsPane from "./QualificationPatientCardsPane";
import { Loader2, Upload, FileText, Plus, Lock, AlertTriangle, User, Trash2, Calendar, Building2, Users, Phone } from "lucide-react";
import { BatchHeader } from "@/components/BatchHeader";
import { PatientCard } from "@/components/PatientCard";
import type { OutreachScheduler } from "@shared/schema";
import type { ScreeningBatchWithPatients } from "@/pages/home";

type BuildSourceMode = "visit" | "outreach";

function formatSourceDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dateStr;
  const [yyyy, mm, dd] = parts;
  return new Date(yyyy, mm - 1, dd).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function SourceSummary({
  mode,
  facility,
  scheduleDate,
  patientCount,
}: {
  mode: BuildSourceMode;
  facility: string | null | undefined;
  scheduleDate: string | null | undefined;
  patientCount: number;
}) {
  const isVisit = mode === "visit";
  const sourceLabel = isVisit ? "Clinic appointment schedule" : "Outreach patient pool";
  const criteriaLabel = isVisit
    ? "Appointment date"
    : "Criteria";
  const criteriaValue = isVisit ? formatSourceDate(scheduleDate) : "Outreach patient pool";

  return (
    <section className="finance-card p-4" data-testid={`build-source-summary-${mode}`}>
      <div className="flex items-center gap-2 mb-3">
        {isVisit ? (
          <Calendar className="h-4 w-4 text-finance-cta-blue" />
        ) : (
          <Phone className="h-4 w-4 text-finance-cta-lavender" />
        )}
        <span className="finance-section-title text-base">Build source</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SourceField
          icon={<Building2 className="h-3.5 w-3.5 text-finance-text-muted" />}
          label="Facility"
          value={facility ?? "—"}
        />
        <SourceField
          icon={isVisit
            ? <Calendar className="h-3.5 w-3.5 text-finance-text-muted" />
            : <FileText className="h-3.5 w-3.5 text-finance-text-muted" />}
          label={criteriaLabel}
          value={criteriaValue}
        />
        <SourceField
          icon={<FileText className="h-3.5 w-3.5 text-finance-text-muted" />}
          label="Source"
          value={sourceLabel}
        />
        <SourceField
          icon={<Users className="h-3.5 w-3.5 text-finance-text-muted" />}
          label="Patients"
          value={String(patientCount)}
        />
      </div>
    </section>
  );
}

function SourceField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-finance-text-muted">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-medium text-finance-text">{value}</div>
    </div>
  );
}

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
    simpleTitle = "Visit Patients",
    simpleSubtitle = "Build patients and generate visit workflow outputs.",
    intakeTitle = "Add Patients",
    cardsTitle = "Schedule Generator",
    simpleBuildStepLabel = "Build Schedule",
    simpleResultsStepLabel = "Final Schedule",
    sourceMode = "visit",
    sourceFacility,
  } = props;

  const summaryFacility = sourceFacility ?? selectedBatch?.facility ?? null;
  const summaryScheduleDate = selectedBatch?.scheduleDate ?? null;

  return (
    <div className="flex flex-col h-full relative z-10">
      {simpleHeaderMode ? (
        <div className="border-b border-finance-border bg-finance-card">
          <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs font-semibold tracking-[0.16em] uppercase text-finance-text-muted mb-1">
                  PLEXUS ANCILLARY
                </div>
                <div className="finance-section-title">{simpleTitle}</div>
                <div className="finance-section-subtitle mt-1">{simpleSubtitle}</div>
                <div className="text-xs text-finance-text-muted mt-1">{simpleBuildStepLabel} · {simpleResultsStepLabel}</div>
              </div>
              <div className="text-xs text-finance-text-secondary">
                {completedCount}/{patients.length} qualified
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-[240px] flex-1 max-w-md">
                <div className="text-xs font-medium text-finance-text-muted mb-1">Clinician</div>
                <input
                  value={clinicianInput}
                  onChange={(e) => setClinicianInput(e.target.value)}
                  onBlur={() => onUpdateClinician(clinicianInput)}
                  placeholder="Enter clinician name"
                  className="finance-input h-10 w-full text-sm"
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
      <main className="flex-1 overflow-auto bg-finance-bg">
        <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
          <SourceSummary
            mode={sourceMode}
            facility={summaryFacility}
            scheduleDate={summaryScheduleDate}
            patientCount={patients.length}
          />
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
          />
        </div>
      </main>
    </div>
  );
}
