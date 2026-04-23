import { useState, useCallback, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  useScreeningBatches,
  useScreeningBatch,
  useCreateBatch,
  useDeleteBatch,
  useUpdateBatch,
  useAssignScheduler,
  useAddPatient,
  useImportPatientsText,
  useImportPatientsFile,
  useUpdatePatient,
  useDeletePatient,
  useStartBatchAnalysis,
  useAnalyzePatient,
  useInvalidateBatch,
  fetchAnalysisStatus,
  type ScreeningBatchWithPatients as ScreeningBatchWithPatientsHook,
} from "@/hooks/api/screening-batches";
import {
  useTestHistory,
  useImportTestHistoryText,
  useImportTestHistoryFile,
  useDeleteTestHistoryRecord,
  useClearTestHistory,
} from "@/hooks/api/test-history";
import { useScheduleDashboard } from "@/hooks/api/dashboard";
import { useOutreachSchedulers } from "@/hooks/api/outreach";
import { queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSidebar, SidebarTrigger } from "@/components/ui/sidebar";
import { PageHeader } from "@/components/PageHeader";
import { AlertTriangle, Database, FileText, Loader2, Lock, Plus, Search, Trash2, Upload, User, X } from "lucide-react";
import type { PatientScreening, OutreachScheduler } from "@shared/schema";
import type { ReasoningValue } from "@/lib/pdfGeneration";
import { VALID_FACILITIES } from "@shared/plexus";
import { HomeSidebar } from "@/components/HomeSidebar";
import { HomeDashboard, type ScheduleDashboardResponse } from "@/components/HomeDashboard";
import { PatientDirectoryView } from "@/components/PatientDirectoryView";
import { ResultsView } from "@/components/ResultsView";
import { PatientCard } from "@/components/PatientCard";
import { AppointmentModal } from "@/components/AppointmentModal";
import { BatchHeader } from "@/components/BatchHeader";
import VisitBuildPane from "@/components/qualification/VisitBuildPane";

export type ScreeningBatchWithPatients = ScreeningBatchWithPatientsHook;

const FACILITIES = VALID_FACILITIES;
const IMPORT_ACCESS_CODE = "1234";
type TabItem = { type: "home" } | { type: "history" } | { type: "references" } | { type: "schedule"; batchId: number; label: string; viewMode?: "build" | "results" };

export default function Home() {
  const [tabs, setTabs] = useState<TabItem[]>([{ type: "home" }]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [expandedPatient, setExpandedPatient] = useState<number | null>(null);
  const [expandedClinical, setExpandedClinical] = useState<number | null>(null);
  const [selectedTestDetail, setSelectedTestDetail] = useState<{ patientId: number; category: string; tests: string[]; reasoning: Record<string, ReasoningValue> } | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [clinicianInput, setClinicianInput] = useState("");
  const [analyzingPatients, setAnalyzingPatients] = useState<Set<number>>(new Set());
  const [historyPasteText, setHistoryPasteText] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [dirPasteText, setDirPasteText] = useState("");
  const [dirSearch, setDirSearch] = useState("");
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<number>>(new Set());
  const [analysisProgress, setAnalysisProgress] = useState<{ completed: number; total: number } | null>(null);
  const [newScheduleDialogOpen, setNewScheduleDialogOpen] = useState(false);
  const [newScheduleDate, setNewScheduleDate] = useState<Date | undefined>(new Date());
  const [newScheduleFacility, setNewScheduleFacility] = useState<string>("");
  const [importUnlocked, setImportUnlocked] = useState(false);
  const [importCodeInput, setImportCodeInput] = useState("");
  const [importCodeError, setImportCodeError] = useState(false);
  const [scheduleModalPatient, setScheduleModalPatient] = useState<PatientScreening | null>(null);
  const [dashboardWeekOverride, setDashboardWeekOverride] = useState<string | null>(null);
  const [dashboardClinicKey, setDashboardClinicKey] = useState<string | null>(null);
  const [isAutoPolling, setIsAutoPolling] = useState(false);
  const [assignSchedulerModal, setAssignSchedulerModal] = useState<{
    batchId: number;
    batchName: string;
    availableSchedulers: OutreachScheduler[];
  } | null>(null);
  const autoPollingRef = useRef(false);
  const prevBatchStatusRef = useRef<string | undefined>(undefined);
  const wasAutoPollingRef = useRef(false);
  const trackedBatchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (window.location.pathname === "/visit-qualification") {
      setNewScheduleDate(new Date());
      setNewScheduleDialogOpen(true);
    }
  }, []);




  const activeTab = tabs[activeTabIndex] || tabs[0] || { type: "home" };
  const selectedBatchId = activeTab.type === "schedule" ? activeTab.batchId : null;
  const scheduleViewMode = activeTab.type === "schedule" ? (activeTab.viewMode || "build") : null;
  const view = activeTab.type === "history" ? "history" : activeTab.type === "references" ? "references" : activeTab.type === "schedule" ? "schedule" : "home";

  const { toast } = useToast();
  const { setOpen: setSidebarOpen } = useSidebar();
  const invalidateBatch = useInvalidateBatch();

  const { data: batches = [], isLoading: batchesLoading } = useScreeningBatches();
  const { data: selectedBatch, isLoading: batchLoading } = useScreeningBatch(selectedBatchId, { pollWhileProcessing: true });
  const historyEnabled = view === "history" || view === "references" || tabs.some((t) => t.type === "history" || t.type === "references");
  const { data: testHistory = [], isLoading: historyLoading } = useTestHistory(historyEnabled);
  const { data: dashboardData, isLoading: dashboardLoading } = useScheduleDashboard({
    weekOverride: dashboardWeekOverride,
    enabled: view === "home",
  });
  const { data: outreachSchedulers = [] } = useOutreachSchedulers<OutreachScheduler>();

  const importHistoryTextMut = useImportTestHistoryText();
  const importHistoryFileMut = useImportTestHistoryFile();
  const deleteHistoryMut = useDeleteTestHistoryRecord();
  const clearHistoryMut = useClearTestHistory();

  const importHistoryMutation = {
    mutate: (text: string, opts?: { onSuccess?: () => void }) =>
      importHistoryTextMut.mutate(text, {
        onSuccess: (data) => {
          toast({ title: `Imported ${data.imported} records` });
          setHistoryPasteText("");
          opts?.onSuccess?.();
        },
        onError: (e: unknown) =>
          toast({ title: "Import failed", description: e instanceof Error ? e.message : "Import failed", variant: "destructive" }),
      }),
    isPending: importHistoryTextMut.isPending,
  };
  const importHistoryFileMutation = {
    mutate: (file: File) =>
      importHistoryFileMut.mutate(file, {
        onSuccess: (data) => toast({ title: `Imported ${data.imported} records` }),
        onError: (e: unknown) =>
          toast({ title: "Import failed", description: e instanceof Error ? e.message : "Import failed", variant: "destructive" }),
      }),
    isPending: importHistoryFileMut.isPending,
  };
  const deleteHistoryMutation = { mutate: (id: number) => deleteHistoryMut.mutate(id) };
  const clearHistoryMutation = {
    mutate: () =>
      clearHistoryMut.mutate(undefined, {
        onSuccess: () => toast({ title: "All history cleared" }),
      }),
  };

  const openScheduleTab = useCallback((batchId: number, label: string) => {
    const existingIdx = tabs.findIndex((t) => t.type === "schedule" && t.batchId === batchId);
    if (existingIdx >= 0) { setActiveTabIndex(existingIdx); }
    else { setTabs((prev) => [...prev, { type: "schedule", batchId, label }]); setActiveTabIndex(tabs.length); }
  }, [tabs]);

  useEffect(() => {
    const stored = sessionStorage.getItem("pendingSchedulerAssignment");
    if (stored) {
      try {
        const pending = JSON.parse(stored) as { batchId: number; batchName: string; availableSchedulers: OutreachScheduler[] };
        if (pending.batchId && pending.batchName) {
          openScheduleTab(pending.batchId, pending.batchName);
          setAssignSchedulerModal(pending);
        }
      } catch {
        sessionStorage.removeItem("pendingSchedulerAssignment");
      }
    }
  }, []);

  const closeTab = useCallback((index: number) => {
    setTabs((prev) => { const next = prev.filter((_, i) => i !== index); return next.length === 0 ? [{ type: "home" as const }] : next; });
    setActiveTabIndex((prev) => { if (index < prev) return prev - 1; if (index === prev) return Math.max(0, index - 1); return prev; });
  }, []);

  const createBatchMut = useCreateBatch();
  const createBatchMutation = {
    mutate: (
      input: { name: string; facility: string; scheduleDate?: string },
      opts?: { onSuccess?: () => void },
    ) =>
      createBatchMut.mutate(input, {
        onSuccess: (data) => {
          openScheduleTab(data.id, data.name || "New Schedule");
          if (data.requiresManualAssignment) {
            const pendingAssignment = {
              batchId: data.id,
              batchName: data.name || "New Schedule",
              availableSchedulers: data.availableSchedulers ?? [],
            };
            sessionStorage.setItem("pendingSchedulerAssignment", JSON.stringify(pendingAssignment));
            setAssignSchedulerModal(pendingAssignment);
          }
          opts?.onSuccess?.();
        },
      }),
    isPending: createBatchMut.isPending,
  };

  const assignSchedulerMut = useAssignScheduler();
  const assignSchedulerMutation = {
    mutate: (input: { batchId: number; schedulerId: number | null }) =>
      assignSchedulerMut.mutate(input, {
        onSuccess: () => {
          sessionStorage.removeItem("pendingSchedulerAssignment");
          setAssignSchedulerModal(null);
          toast({ title: "Scheduler assigned" });
        },
        onError: (e: unknown) =>
          toast({ title: "Assignment failed", description: e instanceof Error ? e.message : "Failed to assign scheduler", variant: "destructive" }),
      }),
    isPending: assignSchedulerMut.isPending,
  };

  const addPatientMutation = useAddPatient();

  const importTextMut = useImportPatientsText();
  const importTextMutation = {
    mutate: (input: { batchId: number; text: string }) =>
      importTextMut.mutate(input, {
        onSuccess: (data) => { setPasteText(""); toast({ title: `Imported ${data.imported} patients` }); },
      }),
    isPending: importTextMut.isPending,
  };

  const importFileMut = useImportPatientsFile();
  const importFileMutation = {
    mutate: (input: { batchId: number; formData: FormData }) =>
      importFileMut.mutate(input, {
        onSuccess: (data) => toast({ title: `Imported ${data.imported} patients` }),
      }),
    isPending: importFileMut.isPending,
  };

  const updatePatientMut = useUpdatePatient();
  const updatePatientMutation = {
    mutate: (input: { id: number; updates: Record<string, unknown> }) =>
      updatePatientMut.mutate(input, {
        onError: (err: unknown) => {
          toast({ title: "Update failed", description: err instanceof Error ? err.message : "Something went wrong", variant: "destructive" });
          invalidateBatch(selectedBatchId);
        },
      }),
  };

  const deletePatientMut = useDeletePatient();
  const deletePatientMutation = {
    mutate: (id: number) =>
      deletePatientMut.mutate(id, {
        onSuccess: () => invalidateBatch(selectedBatchId),
      }),
  };

  const deleteBatchMut = useDeleteBatch();
  const deleteBatchMutation = {
    mutate: (id: number) =>
      deleteBatchMut.mutate(id, {
        onSuccess: (deletedId) => {
          const tabIdx = tabs.findIndex((t) => t.type === "schedule" && t.batchId === deletedId);
          if (tabIdx >= 0) closeTab(tabIdx);
        },
      }),
    mutateAsync: deleteBatchMut.mutateAsync,
    isPending: deleteBatchMut.isPending,
  };

  const updateBatchMut = useUpdateBatch();
  const updateClinicianMutation = {
    mutate: (input: { id: number; clinicianName: string }) =>
      updateBatchMut.mutate({ id: input.id, updates: { clinicianName: input.clinicianName } }),
  };

  const startAnalysisMut = useStartBatchAnalysis();
  // Tracks the full analyze-all lifecycle (start mutation + foreground poll
  // loop). Pure mutation `isPending` flips back to false the moment the POST
  // resolves, which would let the user re-trigger analysis mid-poll. Keep
  // this true until polling settles.
  const [isAnalyzingAll, setIsAnalyzingAll] = useState(false);
  const analyzeAllMutation = {
    mutate: (batchId: number) => {
      if (isAnalyzingAll) return;
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
                toast({ title: "Analysis complete", description: "All patients have been screened." });
                setTabs((prev) => prev.map((tab, i) => i === activeTabIndex && tab.type === "schedule" ? { ...tab, viewMode: "results" as const } : tab));
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
            toast({ title: "Analysis failed", description: err instanceof Error ? err.message : "Analysis failed", variant: "destructive" });
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
    },
    isPending: startAnalysisMut.isPending || isAnalyzingAll,
  };

  const analyzePatientMut = useAnalyzePatient();
  const analyzeOnePatient = useCallback(async (patientId: number) => {
    setAnalyzingPatients((prev) => new Set(prev).add(patientId));
    try {
      const body = await analyzePatientMut.mutateAsync(patientId);
      invalidateBatch(selectedBatchId);
      queryClient.invalidateQueries({ queryKey: ["/api/schedule/dashboard"] });
      const handoff = body.autoCommittedSchedulerName
        ? `Sent to ${body.autoCommittedSchedulerName}.`
        : body.commitStatus && body.commitStatus !== "Draft"
          ? "Sent to schedulers."
          : undefined;
      toast({ title: "Patient analyzed", description: handoff });
    } catch (err: unknown) {
      toast({ title: "Analysis failed", description: err instanceof Error ? err.message : "Analysis failed", variant: "destructive" });
    } finally {
      setAnalyzingPatients((prev) => { const next = new Set(prev); next.delete(patientId); return next; });
    }
  }, [selectedBatchId, invalidateBatch, toast, analyzePatientMut]);

  const handleFileUpload = useCallback((files: FileList | File[]) => {
    if (!selectedBatchId) return;
    const formData = new FormData(); Array.from(files).forEach((file) => formData.append("files", file));
    importFileMutation.mutate({ batchId: selectedBatchId, formData });
  }, [selectedBatchId, importFileMutation]);
  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files); }, [handleFileUpload]);
  const handleExport = useCallback(async () => {
    if (!selectedBatchId) return;
    const res = await fetch(`/api/screening-batches/${selectedBatchId}/export`, { credentials: "include" });
    const blob = await res.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `screening-results-${selectedBatchId}.csv`; a.click(); URL.revokeObjectURL(url);
  }, [selectedBatchId]);

  const patients = selectedBatch?.patients || [];
  const isProcessing = analyzeAllMutation.isPending || isAutoPolling;
  const completedCount = patients.filter((p) => p.status === "completed").length;

  const setScheduleViewMode = useCallback((mode: "build" | "results") => {
    setTabs((prev) => prev.map((tab, i) => i === activeTabIndex && tab.type === "schedule" ? { ...tab, viewMode: mode } : tab));
  }, [activeTabIndex]);
  const handleTimelineNav = useCallback((step: "home" | "build" | "results") => {
    if (step === "home") { const hi = tabs.findIndex((t) => t.type === "home"); if (hi >= 0) setActiveTabIndex(hi); else { setTabs((prev) => [{ type: "home" }, ...prev]); setActiveTabIndex(0); } }
    else setScheduleViewMode(step);
  }, [tabs, setScheduleViewMode]);
  const handleSelectSchedule = useCallback((batch: ScreeningBatchWithPatients) => { openScheduleTab(batch.id, batch.name); setSidebarOpen(false); }, [openScheduleTab, setSidebarOpen]);
  const handleNewSchedule = useCallback(() => { setNewScheduleDate(new Date()); setNewScheduleDialogOpen(true); }, []);
  const handleNewScheduleConfirm = useCallback(() => {
    const date = newScheduleDate ?? new Date();
    const sd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    createBatchMutation.mutate({ name: `Schedule - ${date.toLocaleDateString()}`, facility: newScheduleFacility, scheduleDate: sd }, { onSuccess: () => { setNewScheduleDialogOpen(false); setNewScheduleFacility(""); } });
  }, [createBatchMutation, newScheduleDate, newScheduleFacility]);
  const openHistoryTab = useCallback(() => {
    const i = tabs.findIndex((t) => t.type === "history"); if (i >= 0) setActiveTabIndex(i); else { setTabs((prev) => [...prev, { type: "history" }]); setActiveTabIndex(tabs.length); }
  }, [tabs]);
  const openReferencesTab = useCallback(() => {
    const i = tabs.findIndex((t) => t.type === "references"); if (i >= 0) setActiveTabIndex(i); else { setTabs((prev) => [...prev, { type: "references" }]); setActiveTabIndex(tabs.length); }
  }, [tabs]);

  useEffect(() => { setClinicianInput(selectedBatch?.clinicianName || ""); }, [selectedBatch?.id, selectedBatch?.clinicianName]);
  useEffect(() => {
    if (selectedBatchIds.size === 0) return;
    const validIds = new Set(batches.map((b) => b.id));
    setSelectedBatchIds((prev) => { const pruned = new Set(Array.from(prev).filter((id) => validIds.has(id))); return pruned.size === prev.size ? prev : pruned; });
  }, [batches]);

  useEffect(() => {
    if (!selectedBatchId || !selectedBatch || selectedBatch.status !== "processing" || analyzeAllMutation.isPending || autoPollingRef.current) {
      return;
    }
    autoPollingRef.current = true;
    wasAutoPollingRef.current = true;
    setIsAutoPolling(true);
    let cancelled = false;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;

    const poll = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const data = await fetchAnalysisStatus(selectedBatchId);
        if (cancelled) return;
        consecutiveErrors = 0;
        setAnalysisProgress({ completed: data.completedPatients ?? 0, total: data.totalPatients ?? 0 });
        if (data.status === "completed" || data.status === "failed") {
          autoPollingRef.current = false;
          setIsAutoPolling(false);
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
        return poll();
      } catch {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          autoPollingRef.current = false;
          setIsAutoPolling(false);
          setAnalysisProgress(null);
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
        return poll();
      }
    };

    poll();

    return () => {
      cancelled = true;
      autoPollingRef.current = false;
      setIsAutoPolling(false);
    };
  }, [selectedBatchId, selectedBatch?.status, analyzeAllMutation.isPending]);

  useEffect(() => {
    if (trackedBatchIdRef.current !== selectedBatchId) {
      trackedBatchIdRef.current = selectedBatchId;
      prevBatchStatusRef.current = selectedBatch?.status;
      wasAutoPollingRef.current = false;
      return;
    }
    const prevStatus = prevBatchStatusRef.current;
    const currentStatus = selectedBatch?.status;
    prevBatchStatusRef.current = currentStatus;
    if (prevStatus !== "processing" || currentStatus === "processing") return;
    if (!wasAutoPollingRef.current) return;
    wasAutoPollingRef.current = false;
    setAnalysisProgress(null);
    autoPollingRef.current = false;
    setIsAutoPolling(false);
    invalidateBatch(selectedBatchId);
    if (currentStatus === "completed") {
      toast({ title: "Analysis complete", description: "All patients have been screened." });
      setTabs((prev) => prev.map((tab) => tab.type === "schedule" && tab.batchId === selectedBatchId ? { ...tab, viewMode: "results" as const } : tab));
    } else if (currentStatus === "failed") {
      toast({ title: "Analysis failed", description: "Analysis failed. Click Generate All to try again.", variant: "destructive" });
    }
  }, [selectedBatch?.status, selectedBatchId]);

  return (
    <>
      <HomeSidebar
        view={view}
        batches={batches}
        batchesLoading={batchesLoading}
        selectedBatchId={selectedBatchId}
        selectedBatchIds={selectedBatchIds}
        setSelectedBatchIds={setSelectedBatchIds}
        onHistoryTab={openHistoryTab}
        onReferencesTab={openReferencesTab}
        onNewSchedule={handleNewSchedule}
        onSelectSchedule={handleSelectSchedule}
        onDeleteBatch={(id) => deleteBatchMutation.mutate(id)}
        onDeleteSelected={async () => {
          if (!confirm(`Delete ${selectedBatchIds.size} schedule(s)?`)) return;
          for (const id of Array.from(selectedBatchIds)) await deleteBatchMutation.mutateAsync(id);
          setSelectedBatchIds(new Set());
        }}
        isDeletingBatch={deleteBatchMutation.isPending}
        setSidebarOpen={setSidebarOpen}
      />

      <div className="flex flex-col flex-1 min-w-0 relative bg-background">
        {view === "history" ? (
          <div className="flex flex-col h-full relative z-10">
            <div className="flex-1 overflow-auto p-4">
              <div className="max-w-5xl mx-auto space-y-4">
                <PageHeader
                  eyebrow="PLEXUS ANCILLARY · PATIENT HISTORY"
                  icon={Database}
                  iconAccent="bg-slate-900/8 text-slate-700"
                  title="Patient Test History"
                  subtitle={`${testHistory.length} record${testHistory.length === 1 ? "" : "s"}`}
                  actions={
                    <>
                      <SidebarTrigger data-testid="button-sidebar-toggle-history" />
                      {testHistory.length > 0 && (
                        <Button variant="outline" size="sm" onClick={() => { if (confirm("Clear all test history records?")) clearHistoryMutation.mutate(); }} className="gap-1.5 text-red-600" data-testid="button-clear-history">
                          <Trash2 className="w-3.5 h-3.5" /> Clear All
                        </Button>
                      )}
                    </>
                  }
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2"><Upload className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-semibold">Upload File</span></div>
                    <p className="text-xs text-muted-foreground mb-2">Import from Excel, CSV, or text files. Columns: PatientName, TestName, DOS, InsuranceType</p>
                    <input type="file" accept=".xlsx,.xls,.csv,.txt" className="text-xs" onChange={(e) => { const file = e.target.files?.[0]; if (file) importHistoryFileMutation.mutate(file); e.target.value = ""; }} data-testid="input-history-file" />
                    {importHistoryFileMutation.isPending && <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Importing...</div>}
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2"><FileText className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-semibold">Paste Data</span></div>
                    <Textarea placeholder="Paste patient test history data here..." value={historyPasteText} onChange={(e) => setHistoryPasteText(e.target.value)} className="text-xs min-h-[80px] mb-2" data-testid="input-history-paste" />
                    <Button size="sm" disabled={!historyPasteText.trim() || importHistoryMutation.isPending} onClick={() => importHistoryMutation.mutate(historyPasteText)} className="gap-1.5" data-testid="button-import-history">
                      {importHistoryMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Import
                    </Button>
                  </Card>
                </div>
                {testHistory.length > 0 && (
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-3"><Search className="w-4 h-4 text-muted-foreground" /><Input placeholder="Search by patient name..." value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} className="text-xs h-8 max-w-xs" data-testid="input-history-search" /></div>
                    <div className="overflow-auto max-h-[60vh]">
                      <table className="w-full border-collapse text-xs">
                        <thead><tr className="bg-slate-100 dark:bg-muted"><th className="border px-3 py-2 text-left font-semibold">Patient Name</th><th className="border px-3 py-2 text-left font-semibold">Test</th><th className="border px-3 py-2 text-left font-semibold">Date of Service</th><th className="border px-3 py-2 text-left font-semibold">Insurance</th><th className="border px-3 py-2 text-left font-semibold">Clinic</th><th className="border px-3 py-2 text-left font-semibold w-10"></th></tr></thead>
                        <tbody>
                          {testHistory.filter((r) => !historySearch || r.patientName.toLowerCase().includes(historySearch.toLowerCase())).map((record) => (
                            <tr key={record.id} className="hover:bg-slate-50 dark:hover:bg-muted/30" data-testid={`row-history-${record.id}`}>
                              <td className="border px-3 py-1.5">{record.patientName}</td>
                              <td className="border px-3 py-1.5">{record.testName}</td>
                              <td className="border px-3 py-1.5">{record.dateOfService}</td>
                              <td className="border px-3 py-1.5"><span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${record.insuranceType === "medicare" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"}`}>{record.insuranceType.toUpperCase()}</span></td>
                              <td className="border px-3 py-1.5"><span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{record.clinic || "NWPG"}</span></td>
                              <td className="border px-3 py-1.5"><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteHistoryMutation.mutate(record.id)} data-testid={`button-delete-history-${record.id}`}><X className="w-3 h-3" /></Button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}
                {historyLoading && <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
              </div>
            </div>
          </div>
        ) : view === "references" ? (
          <PatientDirectoryView
            testHistory={testHistory}
            historyLoading={historyLoading}
            dirPasteText={dirPasteText}
            setDirPasteText={setDirPasteText}
            dirSearch={dirSearch}
            setDirSearch={setDirSearch}
            onImportFile={(file) => importHistoryFileMutation.mutate(file)}
            onImportText={(text) => importHistoryMutation.mutate(text, { onSuccess: () => setDirPasteText("") })}
            onClearAll={() => { if (confirm("Clear all patient history records?")) clearHistoryMutation.mutate(); }}
            importFilePending={importHistoryFileMutation.isPending}
            importTextPending={importHistoryMutation.isPending}
            onOpenHistory={openHistoryTab}
          />
        ) : view === "schedule" && selectedBatchId && (scheduleViewMode === "results" || (selectedBatch?.status === "completed" && scheduleViewMode !== "build")) ? (
          <ResultsView
            batch={selectedBatch}
            patients={patients}
            loading={batchLoading}
            onExport={handleExport}
            onNavigate={handleTimelineNav}
            expandedPatient={expandedPatient}
            setExpandedPatient={setExpandedPatient}
            expandedClinical={expandedClinical}
            setExpandedClinical={setExpandedClinical}
            selectedTestDetail={selectedTestDetail}
            setSelectedTestDetail={setSelectedTestDetail}
            onUpdatePatient={(id, updates) => updatePatientMutation.mutate({ id, updates })}
          />
        ) : view === "schedule" && selectedBatchId ? (
          <VisitBuildPane
            selectedBatch={selectedBatch}
            selectedBatchId={selectedBatchId}
            patients={patients}
            batchLoading={batchLoading}
            isProcessing={isProcessing}
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
            onNavigate={handleTimelineNav}
            onDeleteAll={() => { if (confirm("Delete all patients from this schedule?")) patients.forEach((p) => deletePatientMutation.mutate(p.id)); }}
            onGenerateAll={() => analyzeAllMutation.mutate(selectedBatchId!)}
            onUpdateClinician={(clinicianName) => updateClinicianMutation.mutate({ id: selectedBatchId!, clinicianName })}
            onAssignScheduler={selectedBatch ? () => setAssignSchedulerModal({
              batchId: selectedBatch.id,
              batchName: selectedBatch.name,
              availableSchedulers: outreachSchedulers.filter((s) => s.facility === selectedBatch.facility),
            }) : undefined}
            onHandleDrop={handleDrop}
            onHandleFileUpload={handleFileUpload}
            onImportText={() => { if (!pasteText.trim() || !selectedBatchId) return; importTextMutation.mutate({ batchId: selectedBatchId, text: pasteText.trim() }); }}
            onAddPatient={() => { if (!selectedBatchId) return; addPatientMutation.mutate({ batchId: selectedBatchId, name: "", time: undefined }); }}
            onUpdatePatient={(id, updates) => updatePatientMutation.mutate({ id, updates })}
            onDeletePatient={(id) => deletePatientMutation.mutate(id)}
            onAnalyzeOnePatient={analyzeOnePatient}
            onOpenScheduleModal={(p) => setScheduleModalPatient(p)}
            importFilePending={importFileMutation.isPending}
            importTextPending={importTextMutation.isPending}
            addPatientPending={addPatientMutation.isPending}
          />
        ) : (
          <HomeDashboard
            batches={batches}
            dashboardData={dashboardData}
            dashboardLoading={dashboardLoading}
            dashboardWeekOverride={dashboardWeekOverride}
            setDashboardWeekOverride={setDashboardWeekOverride}
            dashboardClinicKey={dashboardClinicKey}
            setDashboardClinicKey={setDashboardClinicKey}
            onOpenSidebar={() => setSidebarOpen(true)}
            onOpenSchedule={(batchId) => {
              const b = batches.find((x) => x.id === batchId);
              openScheduleTab(batchId, b?.name || "Schedule");
            }}
          />
        )}
      </div>

      <Dialog open={newScheduleDialogOpen} onOpenChange={(v) => { if (!v) setNewScheduleDialogOpen(false); }}>
        <DialogContent className="max-w-sm" data-testid="dialog-new-schedule">
          <DialogHeader><DialogTitle>New Schedule</DialogTitle></DialogHeader>
          <div className="flex justify-center py-2">
            <CalendarPicker mode="single" selected={newScheduleDate} onSelect={setNewScheduleDate} initialFocus data-testid="calendar-new-schedule" />
          </div>
          <div className="px-1 pb-2">
            <label className="text-sm font-medium text-muted-foreground mb-1 block">Facility</label>
            <Select value={newScheduleFacility} onValueChange={setNewScheduleFacility}>
              <SelectTrigger data-testid="select-facility"><SelectValue placeholder="Select a facility..." /></SelectTrigger>
              <SelectContent>{FACILITIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewScheduleDialogOpen(false)} data-testid="button-cancel-new-schedule">Cancel</Button>
            <Button onClick={handleNewScheduleConfirm} disabled={createBatchMutation.isPending || !newScheduleFacility} data-testid="button-create-new-schedule">
              {createBatchMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {scheduleModalPatient && (
        <AppointmentModal
          patient={scheduleModalPatient}
          onClose={() => setScheduleModalPatient(null)}
          defaultDate={selectedBatch?.scheduleDate ?? undefined}
        />
      )}

      <Dialog open={!!assignSchedulerModal} onOpenChange={() => {}}>
        <DialogContent className="max-w-md [&>button.absolute]:hidden" data-testid="dialog-assign-scheduler" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Assign Scheduler</DialogTitle>
            <DialogDescription>
              Same-day schedules require manual scheduler assignment. Please select a scheduler for this batch before continuing.
            </DialogDescription>
          </DialogHeader>
          {assignSchedulerModal && (
            <div className="py-2 space-y-2">
              {assignSchedulerModal.availableSchedulers.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <AlertTriangle className="w-8 h-8 text-amber-500" />
                  <p className="text-sm text-muted-foreground">No schedulers are assigned to <strong>{selectedBatch?.facility || "this clinic"}</strong>.</p>
                  <p className="text-xs text-muted-foreground">The schedule will be saved without a scheduler. An urgent task will be created.</p>
                </div>
              ) : (
                assignSchedulerModal.availableSchedulers.map((scheduler) => (
                  <button
                    key={scheduler.id}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left"
                    onClick={() => assignSchedulerMutation.mutate({ batchId: assignSchedulerModal.batchId, schedulerId: scheduler.id })}
                    disabled={assignSchedulerMutation.isPending}
                    data-testid={`button-select-scheduler-${scheduler.id}`}
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{scheduler.name}</p>
                      <p className="text-xs text-muted-foreground">{scheduler.facility}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
          <DialogFooter>
            {assignSchedulerModal?.availableSchedulers.length === 0 ? (
              <Button
                onClick={() => assignSchedulerMutation.mutate({ batchId: assignSchedulerModal!.batchId, schedulerId: null })}
                disabled={assignSchedulerMutation.isPending}
                data-testid="button-save-unassigned"
              >
                {assignSchedulerMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save Without Scheduler
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
