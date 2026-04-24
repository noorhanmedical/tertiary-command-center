import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import VisitBuildPane from "@/components/qualification/VisitBuildPane";
import { ResultsView } from "@/components/ResultsView";
import {
  useCreateBatch,
  useScreeningBatch,
  useAddPatient,
  useImportPatientsText,
  useImportPatientsFile,
  useUpdatePatient,
  useDeletePatient,
  useStartBatchAnalysis,
  useAnalyzePatient,
  useUpdateBatch,
  useInvalidateBatch,
  fetchAnalysisStatus,
} from "@/hooks/api/screening-batches";
import { useOutreachSchedulers } from "@/hooks/api/outreach";
import { useToast } from "@/hooks/use-toast";
import { VALID_FACILITIES } from "@shared/plexus";
import type { OutreachScheduler } from "@shared/schema";

const OUTREACH_BATCH_KEY = "outreachQualificationBatchId";

function escapeCsv(value: unknown) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export default function OutreachQualificationPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const invalidateBatch = useInvalidateBatch();

  const [batchId, setBatchId] = useState<number | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [importUnlocked, setImportUnlocked] = useState(false);
  const [importCodeInput, setImportCodeInput] = useState("");
  const [importCodeError, setImportCodeError] = useState(false);
  const [analyzingPatients, setAnalyzingPatients] = useState<Set<number>>(new Set());
  const [clinicianInput, setClinicianInput] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState<{ completed: number; total: number } | null>(null);
  const [isAnalyzingAll, setIsAnalyzingAll] = useState(false);
  const [viewMode, setViewMode] = useState<"build" | "results">("build");
  const [expandedPatient, setExpandedPatient] = useState<number | null>(null);
  const [expandedClinical, setExpandedClinical] = useState<number | null>(null);
  const [selectedTestDetail, setSelectedTestDetail] = useState<any | null>(null);

  const autoCreateRef = useRef(false);

  const { data: outreachSchedulers = [] } = useOutreachSchedulers<OutreachScheduler>();
  const createBatchMut = useCreateBatch();
  const addPatientMut = useAddPatient();
  const importTextMut = useImportPatientsText();
  const importFileMut = useImportPatientsFile();
  const updatePatientMut = useUpdatePatient();
  const deletePatientMut = useDeletePatient();
  const analyzePatientMut = useAnalyzePatient();
  const startAnalysisMut = useStartBatchAnalysis();
  const updateBatchMut = useUpdateBatch();

  const { data: selectedBatch, isLoading: batchLoading } = useScreeningBatch(batchId, { pollWhileProcessing: true });
  const patients = selectedBatch?.patients || [];
  const completedCount = patients.filter((p: any) => p.status === "completed").length;

  useEffect(() => {
    if (selectedBatch?.clinicianName != null) {
      setClinicianInput(selectedBatch.clinicianName || "");
    }
  }, [selectedBatch?.id, selectedBatch?.clinicianName]);

  useEffect(() => {
    if (selectedBatch?.status === "completed") {
      setViewMode("results");
    }
  }, [selectedBatch?.status]);

  useEffect(() => {
    const stored = sessionStorage.getItem(OUTREACH_BATCH_KEY);
    if (stored && !batchId) {
      const parsed = parseInt(stored, 10);
      if (!Number.isNaN(parsed)) setBatchId(parsed);
    }
  }, [batchId]);

  useEffect(() => {
    if (!batchId) return;
    if (batchLoading) return;
    if (selectedBatch) return;

    sessionStorage.removeItem(OUTREACH_BATCH_KEY);
    setBatchId(null);
    autoCreateRef.current = false;
  }, [batchId, batchLoading, selectedBatch]);

  useEffect(() => {
    if (batchId || autoCreateRef.current) return;
    autoCreateRef.current = true;
    const today = new Date();
    createBatchMut.mutate(
      {
        name: `Outreach - ${today.toLocaleDateString()}`,
        facility: VALID_FACILITIES[0],
      },
      {
        onSuccess: (data) => {
          setBatchId(data.id);
          sessionStorage.setItem(OUTREACH_BATCH_KEY, String(data.id));
        },
        onError: (e: unknown) => {
          autoCreateRef.current = false;
          toast({
            title: "Failed to initialize outreach workspace",
            description: e instanceof Error ? e.message : "Could not create outreach batch",
            variant: "destructive",
          });
        },
      }
    );
  }, [batchId, createBatchMut, toast]);

  const analyzeOnePatient = useCallback(
    async (patientId: number) => {
      if (!batchId) return;
      setAnalyzingPatients((prev) => new Set(prev).add(patientId));
      try {
        const body = await analyzePatientMut.mutateAsync(patientId);
        invalidateBatch(batchId);
        const handoff = body.autoCommittedSchedulerName
          ? `Sent to ${body.autoCommittedSchedulerName}.`
          : body.commitStatus && body.commitStatus !== "Draft"
            ? "Sent to schedulers."
            : undefined;
        toast({ title: "Patient analyzed", description: handoff });
      } catch (err: unknown) {
        toast({
          title: "Analysis failed",
          description: err instanceof Error ? err.message : "Analysis failed",
          variant: "destructive",
        });
      } finally {
        setAnalyzingPatients((prev) => {
          const next = new Set(prev);
          next.delete(patientId);
          return next;
        });
      }
    },
    [batchId, invalidateBatch, toast, analyzePatientMut]
  );

  const analyzeAll = useCallback(() => {
    if (!batchId || isAnalyzingAll) return;
    setIsAnalyzingAll(true);
    startAnalysisMut.mutate(batchId, {
      onSuccess: async (data) => {
        const total = data.patientCount || 0;
        setAnalysisProgress({ completed: 0, total });
        const MAX_POLLS = 300;
        try {
          for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
            const statusData = await fetchAnalysisStatus(batchId);
            const completed = statusData.completedPatients ?? 0;
            setAnalysisProgress({ completed, total: statusData.totalPatients || total });
            if (statusData.status === "completed") {
              invalidateBatch(batchId);
              setAnalysisProgress(null);
              setViewMode("results");
              toast({ title: "Analysis complete", description: "All patients have been screened." });
              return;
            }
            if (statusData.status === "failed") {
              invalidateBatch(batchId);
              throw new Error(statusData.errorMessage || "Analysis failed. Click Generate All to try again.");
            }
            await new Promise((r) => setTimeout(r, 3000));
          }
          throw new Error("Analysis is taking longer than expected. Click Generate All to resume.");
        } catch (err: unknown) {
          setAnalysisProgress(null);
          toast({
            title: "Analysis failed",
            description: err instanceof Error ? err.message : "Analysis failed",
            variant: "destructive",
          });
        } finally {
          setIsAnalyzingAll(false);
        }
      },
      onError: (err: Error) => {
        setAnalysisProgress(null);
        setIsAnalyzingAll(false);
        toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
      },
    });
  }, [batchId, invalidateBatch, isAnalyzingAll, startAnalysisMut, toast]);

  const handleFileUpload = useCallback(
    (files: FileList | File[]) => {
      if (!batchId) return;
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append("files", file));
      importFileMut.mutate(
        { batchId, formData },
        {
          onSuccess: (data) => toast({ title: `Imported ${data.imported} patients` }),
        }
      );
    },
    [batchId, importFileMut, toast]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files);
    },
    [handleFileUpload]
  );

  const handleExport = useCallback(() => {
    if (!selectedBatch) return;
    const header = ["Name", "Time", "QualifyingTests", "AppointmentStatus", "PatientType"];
    const rows = patients.map((patient: any) => [
      patient.name ?? "",
      patient.time ?? "",
      (patient.qualifyingTests ?? []).join("; "),
      patient.appointmentStatus ?? "",
      patient.patientType ?? "",
    ]);
    const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedBatch.name || "outreach"}-final-list.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [patients, selectedBatch]);

  const handleNavigate = useCallback((step: "home" | "build" | "results") => {
    if (step === "home") {
      setLocation("/home");
      return;
    }
    setViewMode(step === "results" ? "results" : "build");
  }, [setLocation]);

  if (!batchId || !selectedBatch) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm text-slate-500">
          {createBatchMut.isPending || batchLoading ? "Preparing outreach qualification..." : "Loading outreach qualification..."}
        </div>
      </div>
    );
  }

  if (viewMode === "results" || selectedBatch.status === "completed") {
    return (
      <ResultsView
        batch={selectedBatch as any}
        patients={patients as any}
        loading={batchLoading}
        onExport={handleExport}
        onNavigate={handleNavigate}
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
            }
          )
        }
      />
    );
  }

  return (
    <VisitBuildPane
      selectedBatch={selectedBatch as any}
      selectedBatchId={batchId}
      patients={patients}
      batchLoading={batchLoading}
      isProcessing={isAnalyzingAll}
      analysisProgress={analysisProgress}
      completedCount={completedCount}
      clinicianInput={clinicianInput}
      setClinicianInput={setClinicianInput}
      outreachSchedulers={outreachSchedulers}
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
      analyzingPatients={analyzingPatients}
      onNavigate={handleNavigate}
      onDeleteAll={() => {
        if (confirm("Delete all patients from this outreach list?")) {
          patients.forEach((p: any) => deletePatientMut.mutate(p.id));
        }
      }}
      onGenerateAll={analyzeAll}
      onUpdateClinician={(clinicianName) => updateBatchMut.mutate({ id: batchId, updates: { clinicianName } })}
      onAssignScheduler={undefined}
      onHandleDrop={handleDrop}
      onHandleFileUpload={handleFileUpload}
      onImportText={() => {
        if (!pasteText.trim()) return;
        importTextMut.mutate(
          { batchId, text: pasteText.trim() },
          {
            onSuccess: (data) => {
              setPasteText("");
              toast({ title: `Imported ${data.imported} patients` });
            },
          }
        );
      }}
      onAddPatient={() => addPatientMut.mutate({ batchId, name: "", time: undefined })}
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
          }
        )
      }
      onDeletePatient={(id) =>
        deletePatientMut.mutate(id, {
          onSuccess: () => invalidateBatch(batchId),
        })
      }
      onAnalyzeOnePatient={analyzeOnePatient}
      onOpenScheduleModal={() => {}}
      importFilePending={importFileMut.isPending}
      importTextPending={importTextMut.isPending}
      addPatientPending={addPatientMut.isPending}
      simpleHeaderMode={true}
      simpleTitle="Outreach Patients"
      simpleSubtitle="Same parser, patient bars, and generation path as Visit Patients, without requiring a committed visit schedule."
      intakeTitle="Add Outreach Patients"
      cardsTitle="Final Outreach List"
    />
  );
}
