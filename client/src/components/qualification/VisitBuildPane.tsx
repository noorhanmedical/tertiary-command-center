import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Add Patients</h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {importUnlocked ? (
                <>
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Upload className="w-4 h-4 text-muted-foreground" />
                      <span className="text-base font-semibold">Upload File</span>
                    </div>
                    <div
                      className={`flex flex-col items-center justify-center border-2 border-dashed rounded-md p-6 cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border"}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={onHandleDrop}
                      onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.multiple = true;
                        input.accept = ".xlsx,.xls,.csv,.txt,.text,.pdf,.jpg,.jpeg,.png,.gif,.bmp,.webp";
                        input.onchange = (e) => {
                          const files = (e.target as HTMLInputElement).files;
                          if (files) onHandleFileUpload(files);
                        };
                        input.click();
                      }}
                      data-testid="dropzone-upload"
                    >
                      {importFilePending ? (
                        <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
                      ) : (
                        <>
                          <Upload className="w-6 h-6 text-muted-foreground mb-1.5" />
                          <p className="text-xs text-muted-foreground text-center">Drop files or click to browse</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Excel, CSV, PDF, images, text</p>
                        </>
                      )}
                    </div>
                  </Card>

                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span className="text-base font-semibold">Paste List</span>
                    </div>
                    <Textarea
                      placeholder={"Paste patient list here — it will import automatically\n\n9:00 AM - John Smith\n9:30 AM - Jane Doe\nBob Johnson"}
                      className="min-h-[82px] resize-none text-sm mb-2"
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      onPaste={(e) => {
                        const pasted = e.clipboardData.getData("text");
                        if (pasted.trim() && selectedBatchId) {
                          e.preventDefault();
                          setPasteText(pasted);
                          onImportText();
                        }
                      }}
                      data-testid="input-paste-list"
                    />
                    <Button
                      className="w-full gap-1.5"
                      variant="outline"
                      onClick={onImportText}
                      disabled={!pasteText.trim() || importTextPending}
                      data-testid="button-import-text"
                    >
                      {importTextPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      Import List
                    </Button>
                  </Card>
                </>
              ) : (
                <Card className="p-4 col-span-1 lg:col-span-2">
                  <div className="flex items-center gap-2 mb-3">
                    <Lock className="w-4 h-4 text-muted-foreground" />
                    <span className="text-base font-semibold">Import Access</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    File upload and paste import require an access code. Manual entry is always available.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="Enter 4-digit code"
                      value={importCodeInput}
                      onChange={(e) => {
                        setImportCodeInput(e.target.value.replace(/\D/g, "").slice(0, 4));
                        setImportCodeError(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (importCodeInput === IMPORT_ACCESS_CODE) {
                            setImportUnlocked(true);
                            setImportCodeInput("");
                            setImportCodeError(false);
                          } else {
                            setImportCodeError(true);
                            setImportCodeInput("");
                          }
                        }
                      }}
                      className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm max-w-[160px] ${importCodeError ? "border-red-400" : ""}`}
                      data-testid="input-import-code"
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        if (importCodeInput === IMPORT_ACCESS_CODE) {
                          setImportUnlocked(true);
                          setImportCodeInput("");
                          setImportCodeError(false);
                        } else {
                          setImportCodeError(true);
                          setImportCodeInput("");
                        }
                      }}
                      data-testid="button-import-unlock"
                    >
                      Unlock
                    </Button>
                  </div>
                  {importCodeError && (
                    <p className="text-xs text-red-500 mt-1.5" data-testid="text-import-code-error">
                      Incorrect code. Please try again.
                    </p>
                  )}
                </Card>
              )}

              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Plus className="w-4 h-4 text-muted-foreground" />
                  <span className="text-base font-semibold">Manual Entry</span>
                </div>
                <Button
                  className="w-full gap-1.5"
                  onClick={onAddPatient}
                  disabled={addPatientPending}
                  data-testid="button-add-patient"
                >
                  {addPatientPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add Patient
                </Button>
              </Card>
            </div>
          </section>

          {patients.length > 0 && (
            <section>
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider">
                  Schedule Generator ({patients.length})
                </h2>
                {completedCount > 0 && <span className="text-xs text-muted-foreground">{completedCount}/{patients.length} analyzed</span>}
              </div>
              <div className="space-y-4">
                {patients.map((patient) => (
                  <PatientCard
                    key={patient.id}
                    patient={patient}
                    isAnalyzing={analyzingPatients.has(patient.id)}
                    onUpdate={(field, value) => onUpdatePatient(patient.id, { [field]: value })}
                    onDelete={() => onDeletePatient(patient.id)}
                    onAnalyze={() => onAnalyzeOnePatient(patient.id)}
                    onOpenScheduleModal={(p) => onOpenScheduleModal(p)}
                    schedulerName={selectedBatch?.assignedScheduler?.name ?? null}
                    batchScheduleDate={selectedBatch?.scheduleDate ?? null}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
