import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import VisitBuildPane from "@/components/qualification/VisitBuildPane";
import { ResultsView } from "@/components/ResultsView";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  CalendarDays,
  Loader2,
  Plus,
  Radio,
  Sparkles,
} from "lucide-react";
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
import { PlexusIQCalendarDrawer } from "@/components/plexus-iq/PlexusIQCalendarDrawer";

// Plexus IQ workspace.
//
// Architecture: Plexus IQ does NOT introduce a new schedule or batch table.
// It auto-creates a single screening_batch (mirroring the outreach-qualification
// pattern) to act as a workspace context, and reuses VisitBuildPane for the
// build/qualification step and ResultsView for the final list step. Patient
// rows persist through the canonical screening batches APIs, so each row
// keeps its own patientType (visit/outreach) — Plexus IQ supports a mixed
// list by leaving sourceMode undefined so the per-patient type label derives
// from appointment data (existing derivePatientType helper).
//
// The right-side calendar drawer is a read-only view over the canonical
// /api/global-schedule-events endpoint; it does not create or own schedule
// state.

const PLEXUS_IQ_BATCH_KEY = "plexusIqWorkspaceBatchId";

function escapeCsv(value: unknown) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export default function PlexusIQPage() {
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
  const [calendarOpen, setCalendarOpen] = useState(false);

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
    const stored = sessionStorage.getItem(PLEXUS_IQ_BATCH_KEY);
    if (stored && !batchId) {
      const parsed = parseInt(stored, 10);
      if (!Number.isNaN(parsed)) setBatchId(parsed);
    }
  }, [batchId]);

  useEffect(() => {
    if (!batchId) return;
    if (batchLoading) return;
    if (selectedBatch) return;
    sessionStorage.removeItem(PLEXUS_IQ_BATCH_KEY);
    setBatchId(null);
    autoCreateRef.current = false;
  }, [batchId, batchLoading, selectedBatch]);

  useEffect(() => {
    if (batchId || autoCreateRef.current) return;
    autoCreateRef.current = true;
    const today = new Date();
    createBatchMut.mutate(
      {
        name: `Plexus IQ - ${today.toLocaleDateString()}`,
        facility: VALID_FACILITIES[0],
      },
      {
        onSuccess: (data) => {
          setBatchId(data.id);
          sessionStorage.setItem(PLEXUS_IQ_BATCH_KEY, String(data.id));
        },
        onError: (e: unknown) => {
          autoCreateRef.current = false;
          toast({
            title: "Failed to initialize Plexus IQ workspace",
            description: e instanceof Error ? e.message : "Could not create workspace batch",
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
    const header = ["Name", "Time", "PatientType", "QualifyingTests", "AppointmentStatus"];
    const rows = patients.map((patient: any) => [
      patient.name ?? "",
      patient.time ?? "",
      patient.patientType ?? "",
      (patient.qualifyingTests ?? []).join("; "),
      patient.appointmentStatus ?? "",
    ]);
    const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedBatch.name || "plexus-iq"}-final-list.csv`;
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

  // Add Visit / Add Outreach: both create a blank patient row through the
  // canonical add-patient endpoint. The patientType is set explicitly so the
  // build card surfaces the correct label and the right downstream behavior
  // (visit rows will land in the schedule when committed; outreach rows stay
  // in outreach context until they are scheduled).
  const handleAddVisit = useCallback(() => {
    if (!batchId) return;
    addPatientMut.mutate({ batchId, name: "", time: undefined, patientType: "visit" });
  }, [batchId, addPatientMut]);

  const handleAddOutreach = useCallback(() => {
    if (!batchId) return;
    addPatientMut.mutate({ batchId, name: "", time: undefined, patientType: "outreach" });
  }, [batchId, addPatientMut]);

  if (!batchId || !selectedBatch) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm text-slate-500">
          {createBatchMut.isPending || batchLoading
            ? "Preparing Plexus IQ workspace..."
            : "Loading Plexus IQ workspace..."}
        </div>
      </div>
    );
  }

  if (viewMode === "results" || selectedBatch.status === "completed") {
    return (
      <div className="relative">
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
        <button
          type="button"
          onClick={() => setCalendarOpen(true)}
          aria-label="Open calendar"
          title="Calendar"
          className="fixed bottom-6 right-6 inline-flex items-center justify-center h-12 w-12 rounded-full bg-plexus-navy-800 text-white shadow-lg hover:bg-plexus-navy-700 transition-colors z-40"
          data-testid="button-plexus-iq-calendar-fab"
        >
          <CalendarDays className="w-5 h-5" />
        </button>
        <PlexusIQCalendarDrawer
          open={calendarOpen}
          onClose={() => setCalendarOpen(false)}
        />
      </div>
    );
  }

  // Plexus IQ build workspace.
  //
  // Renders VisitBuildPane with sourceMode left undefined so each PatientCard
  // derives its Visit/Outreach label from per-patient appointment data rather
  // than forcing all rows to one mode. A small header strip above the pane
  // adds the Plexus IQ-specific actions (Add Visit / Add Outreach / calendar)
  // without reordering the existing build header.
  return (
    <div className="flex flex-col h-full relative">
      <div className="bg-white border-b border-slate-200/60 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <SidebarTrigger data-testid="button-sidebar-toggle-plexus-iq" />
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900" data-testid="text-plexus-iq-title">
                Plexus IQ
              </h1>
              <p className="text-[11px] text-slate-500">
                Mixed Visit + Outreach workspace · {VALID_FACILITIES[0]}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddVisit}
              disabled={addPatientMut.isPending}
              className="gap-1.5 rounded-xl"
              data-testid="button-plexus-iq-add-visit"
            >
              {addPatientMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Visit Patient
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddOutreach}
              disabled={addPatientMut.isPending}
              className="gap-1.5 rounded-xl"
              data-testid="button-plexus-iq-add-outreach"
            >
              {addPatientMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
              Add Outreach Patient
            </Button>
            <Button
              size="sm"
              onClick={analyzeAll}
              disabled={isAnalyzingAll || patients.length === 0}
              className="gap-1.5 rounded-xl"
              data-testid="button-plexus-iq-generate-all"
            >
              {isAnalyzingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Generate All
            </Button>
            <button
              type="button"
              onClick={() => setCalendarOpen(true)}
              aria-label="Open calendar"
              title="Calendar"
              className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-plexus-navy-800 text-white shadow-sm hover:bg-plexus-navy-700 transition-colors"
              data-testid="button-plexus-iq-calendar"
            >
              <CalendarDays className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
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
            if (confirm("Delete all patients from this Plexus IQ workspace?")) {
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
          onAddPatient={handleAddVisit}
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
          intakeTitle="Add Patients"
          cardsTitle="Workspace"
          simpleBuildStepLabel="Build"
          simpleResultsStepLabel="Final"
          // Leave sourceMode undefined so PatientCard derives Visit/Outreach
          // per row from existing appointment data.
        />
      </div>

      <PlexusIQCalendarDrawer
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
      />
    </div>
  );
}
