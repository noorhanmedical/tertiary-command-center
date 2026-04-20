import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
import type { ScreeningBatch, PatientScreening, PatientTestHistory, OutreachScheduler } from "@shared/schema";
import type { ReasoningValue } from "@/lib/pdfGeneration";
import { VALID_FACILITIES } from "@shared/plexus";
import { HomeSidebar } from "@/components/HomeSidebar";
import { HomeDashboard, type ScheduleDashboardResponse } from "@/components/HomeDashboard";
import { PatientDirectoryView } from "@/components/PatientDirectoryView";
import { ResultsView } from "@/components/ResultsView";
import { PatientCard } from "@/components/PatientCard";
import { AppointmentModal } from "@/components/AppointmentModal";
import { BatchHeader } from "@/components/BatchHeader";

export type ScreeningBatchWithPatients = ScreeningBatch & { patients?: PatientScreening[]; assignedScheduler?: OutreachScheduler | null };

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

  const activeTab = tabs[activeTabIndex] || tabs[0] || { type: "home" };
  const selectedBatchId = activeTab.type === "schedule" ? activeTab.batchId : null;
  const scheduleViewMode = activeTab.type === "schedule" ? (activeTab.viewMode || "build") : null;
  const view = activeTab.type === "history" ? "history" : activeTab.type === "references" ? "references" : activeTab.type === "schedule" ? "schedule" : "home";

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { setOpen: setSidebarOpen } = useSidebar();

  const { data: batches = [], isLoading: batchesLoading } = useQuery<ScreeningBatchWithPatients[]>({ queryKey: ["/api/screening-batches"] });
  const { data: selectedBatch, isLoading: batchLoading } = useQuery<ScreeningBatchWithPatients>({
    queryKey: ["/api/screening-batches", selectedBatchId],
    enabled: !!selectedBatchId,
    refetchInterval: (query) => query.state.data?.status === "processing" ? 2000 : false,
  });
  const { data: testHistory = [], isLoading: historyLoading } = useQuery<PatientTestHistory[]>({
    queryKey: ["/api/test-history"],
    enabled: view === "history" || view === "references" || tabs.some((t) => t.type === "history" || t.type === "references"),
  });
  const { data: dashboardData, isLoading: dashboardLoading } = useQuery<ScheduleDashboardResponse>({
    queryKey: ["/api/schedule/dashboard", dashboardWeekOverride || "current"],
    queryFn: async () => {
      const url = dashboardWeekOverride ? `/api/schedule/dashboard?weekStart=${encodeURIComponent(dashboardWeekOverride)}` : "/api/schedule/dashboard";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: view === "home",
    refetchInterval: 120000,
  });
  const { data: outreachSchedulers = [] } = useQuery<OutreachScheduler[]>({
    queryKey: ["/api/outreach/schedulers"],
  });

  const importHistoryMutation = useMutation({
    mutationFn: async (text: string) => { const res = await apiRequest("POST", "/api/test-history/import", { text }); return res.json(); },
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ["/api/test-history"] }); toast({ title: `Imported ${data.imported} records` }); setHistoryPasteText(""); },
    onError: (e: unknown) => toast({ title: "Import failed", description: e instanceof Error ? e.message : "Import failed", variant: "destructive" }),
  });
  const importHistoryFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData(); formData.append("file", file);
      const res = await fetch("/api/test-history/import", { method: "POST", credentials: "include", body: formData });
      if (!res.ok) throw new Error((await res.json()).error || "Import failed"); return res.json();
    },
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ["/api/test-history"] }); toast({ title: `Imported ${data.imported} records` }); },
    onError: (e: unknown) => toast({ title: "Import failed", description: e instanceof Error ? e.message : "Import failed", variant: "destructive" }),
  });
  const deleteHistoryMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/test-history/${id}`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/test-history"] }),
  });
  const clearHistoryMutation = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", "/api/test-history"); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/test-history"] }); toast({ title: "All history cleared" }); },
  });

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

  const createBatchMutation = useMutation({
    mutationFn: async ({ name, facility, scheduleDate }: { name: string; facility: string; scheduleDate?: string }) => {
      const res = await apiRequest("POST", "/api/batches", { name, facility, scheduleDate }); return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
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
    },
  });
  const assignSchedulerMutation = useMutation({
    mutationFn: async ({ batchId, schedulerId }: { batchId: number; schedulerId: number | null }) => {
      const res = await apiRequest("POST", `/api/batches/${batchId}/assign-scheduler`, { schedulerId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      sessionStorage.removeItem("pendingSchedulerAssignment");
      setAssignSchedulerModal(null);
      toast({ title: "Scheduler assigned" });
    },
    onError: (e: unknown) => toast({ title: "Assignment failed", description: e instanceof Error ? e.message : "Failed to assign scheduler", variant: "destructive" }),
  });
  const addPatientMutation = useMutation({
    mutationFn: async ({ batchId, name, time, age, gender, dob, phoneNumber, insurance, diagnoses, history, medications, previousTests, previousTestsDate, noPreviousTests, patientType, notes }: { batchId: number; name: string; time?: string; age?: string | number; gender?: string; dob?: string; phoneNumber?: string; insurance?: string; diagnoses?: string; history?: string; medications?: string; previousTests?: string; previousTestsDate?: string; noPreviousTests?: boolean; patientType?: string; notes?: string }) => {
      const res = await apiRequest("POST", `/api/batches/${batchId}/patients`, { name, time, age, gender, dob, phoneNumber, insurance, diagnoses, history, medications, previousTests, previousTestsDate, noPreviousTests, patientType, notes }); return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] }); queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] }); },
  });
  const importTextMutation = useMutation({
    mutationFn: async ({ batchId, text }: { batchId: number; text: string }) => {
      const res = await apiRequest("POST", `/api/batches/${batchId}/import-text`, { text }); return res.json();
    },
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] }); queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] }); setPasteText(""); toast({ title: `Imported ${data.imported} patients` }); },
  });
  const importFileMutation = useMutation({
    mutationFn: async ({ batchId, formData }: { batchId: number; formData: FormData }) => {
      const res = await fetch(`/api/batches/${batchId}/import-file`, { method: "POST", credentials: "include", body: formData });
      if (!res.ok) throw new Error(await res.text()); return res.json();
    },
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] }); queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] }); toast({ title: `Imported ${data.imported} patients` }); },
  });
  const updatePatientMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Record<string, unknown> }) => { const res = await apiRequest("PATCH", `/api/patients/${id}`, updates); return res.json(); },
    onSuccess: (updatedPatient: PatientScreening, { id }) => {
      const batchId = updatedPatient.batchId ?? selectedBatchId;
      queryClient.setQueryData<ScreeningBatchWithPatients>(["/api/screening-batches", batchId], (old) => {
        if (!old) return old;
        return { ...old, patients: (old.patients || []).map((p) => p.id === id ? { ...p, ...updatedPatient } : p) };
      });
    },
    onError: (err: unknown) => {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : "Something went wrong", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
    },
  });
  const deletePatientMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/patients/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] }); queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] }); },
  });
  const deleteBatchMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/screening-batches/${id}`); },
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      const tabIdx = tabs.findIndex((t) => t.type === "schedule" && t.batchId === deletedId);
      if (tabIdx >= 0) closeTab(tabIdx);
    },
  });
  const updateClinicianMutation = useMutation({
    mutationFn: async ({ id, clinicianName }: { id: number; clinicianName: string }) => { await apiRequest("PATCH", `/api/screening-batches/${id}`, { clinicianName }); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] }),
  });
  const analyzeAllMutation = useMutation({
    mutationFn: async (batchId: number) => {
      const res = await apiRequest("POST", `/api/batches/${batchId}/analyze`);
      const data = await res.json();
      const total = data.patientCount || 0;
      setAnalysisProgress({ completed: 0, total });
      const MAX_POLLS = 300;
      const poll = async (attempt = 0): Promise<void> => {
        if (attempt >= MAX_POLLS) throw new Error("Analysis is taking longer than expected. Click Generate All to resume.");
        const statusRes = await fetch(`/api/batches/${batchId}/analysis-status`, { credentials: "include" });
        if (!statusRes.ok) throw new Error("Lost connection during analysis. Click Generate All to resume.");
        const statusData = await statusRes.json();
        const completed = statusData.completedPatients ?? 0;
        setAnalysisProgress({ completed, total: statusData.totalPatients || total });
        if (statusData.status === "completed") {
          queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", batchId] });
          return;
        }
        if (statusData.status === "failed") {
          queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", batchId] });
          throw new Error(statusData.errorMessage || "Analysis failed. Click Generate All to try again.");
        }
        if (statusData.status === "not_started") {
          await new Promise((r) => setTimeout(r, 3000));
          return poll(attempt + 1);
        }
        await new Promise((r) => setTimeout(r, 3000));
        return poll(attempt + 1);
      };
      await poll();
      return data;
    },
    onSuccess: () => {
      setAnalysisProgress(null);
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      toast({ title: "Analysis complete", description: "All patients have been screened." });
      setTabs((prev) => prev.map((tab, i) => i === activeTabIndex && tab.type === "schedule" ? { ...tab, viewMode: "results" as const } : tab));
    },
    onError: (err: Error) => { setAnalysisProgress(null); toast({ title: "Analysis failed", description: err.message, variant: "destructive" }); },
  });
  const analyzeOnePatient = useCallback(async (patientId: number) => {
    setAnalyzingPatients((prev) => new Set(prev).add(patientId));
    try {
      const res = await apiRequest("POST", `/api/patients/${patientId}/analyze`);
      const body = await res.json().catch(() => ({}));
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedule/dashboard"] });
      const handoff = body?.autoCommittedSchedulerName
        ? `Sent to ${body.autoCommittedSchedulerName}.`
        : body?.commitStatus && body.commitStatus !== "Draft"
          ? "Sent to schedulers."
          : undefined;
      toast({ title: "Patient analyzed", description: handoff });
    } catch (err: unknown) {
      toast({ title: "Analysis failed", description: err instanceof Error ? err.message : "Analysis failed", variant: "destructive" });
    } finally {
      setAnalyzingPatients((prev) => { const next = new Set(prev); next.delete(patientId); return next; });
    }
  }, [selectedBatchId, queryClient, toast]);

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
        const res = await fetch(`/api/batches/${selectedBatchId}/analysis-status`, { credentials: "include" });
        if (cancelled) return;
        if (!res.ok) {
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
        consecutiveErrors = 0;
        const data = await res.json();
        if (cancelled) return;
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
    queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
    queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
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
        <div className="bg-[#1e3a5f]/95 backdrop-blur-sm flex items-center gap-0 px-2 shrink-0 overflow-x-auto" data-testid="tab-bar">
          {tabs.map((tab, i) => {
            const isActive = i === activeTabIndex;
            const label = tab.type === "home" ? "Home" : tab.type === "history" ? "Patient History" : tab.type === "references" ? "Patient Directory" : tab.label;
            return (
              <div key={`${tab.type}-${tab.type === "schedule" ? tab.batchId : i}`}
                className={`flex items-center gap-1.5 px-4 py-2 cursor-pointer text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${isActive ? "bg-white/15 text-white border-white" : "text-blue-200/70 border-transparent hover:text-white hover:bg-white/5"}`}
                onClick={() => setActiveTabIndex(i)} data-testid={`tab-${tab.type}${tab.type === "schedule" ? `-${tab.batchId}` : ""}`}>
                <span className="truncate max-w-[180px]">{label}</span>
                {tabs.length > 1 && (
                  <button className="ml-1 p-0.5 rounded hover:bg-white/20 transition-colors" onClick={(e) => { e.stopPropagation(); closeTab(i); }} data-testid={`button-close-tab-${i}`}>
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
          <button className="flex items-center gap-1 px-3 py-2 text-blue-200/60 hover:text-white transition-colors text-sm" onClick={handleNewSchedule} data-testid="button-new-tab">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

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
                    testHistory.length > 0 ? (
                      <Button variant="outline" size="sm" onClick={() => { if (confirm("Clear all test history records?")) clearHistoryMutation.mutate(); }} className="gap-1.5 text-red-600" data-testid="button-clear-history">
                        <Trash2 className="w-3.5 h-3.5" /> Clear All
                      </Button>
                    ) : undefined
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
              onNavigate={handleTimelineNav}
              onDeleteAll={() => { if (confirm("Delete all patients from this schedule?")) patients.forEach((p) => deletePatientMutation.mutate(p.id)); }}
              onGenerateAll={() => analyzeAllMutation.mutate(selectedBatchId!)}
              onUpdateClinician={(clinicianName) => updateClinicianMutation.mutate({ id: selectedBatchId!, clinicianName })}
              schedulers={outreachSchedulers}
              onAssignScheduler={selectedBatch ? () => setAssignSchedulerModal({
                batchId: selectedBatch.id,
                batchName: selectedBatch.name,
                availableSchedulers: outreachSchedulers.filter((s) => s.facility === selectedBatch.facility),
              }) : undefined}
            />
            <main className="flex-1 overflow-auto">
              <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
                {isProcessing && (
                  <Card className="p-6">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-10 h-10 text-primary animate-spin" />
                      <p className="font-semibold">Analyzing patients...</p>
                      {analysisProgress ? (
                        <><p className="text-sm text-muted-foreground" data-testid="text-analysis-progress">{analysisProgress.completed} of {analysisProgress.total} completed</p>
                          <div className="w-full max-w-xs bg-slate-200 dark:bg-muted rounded-full h-2 overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all duration-500 ease-out" style={{ width: `${analysisProgress.total > 0 ? (analysisProgress.completed / analysisProgress.total) * 100 : 0}%` }} /></div></>
                      ) : <p className="text-sm text-muted-foreground">Starting AI screening...</p>}
                    </div>
                  </Card>
                )}
                <section>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Add Patients</h2>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {importUnlocked ? (
                      <>
                        <Card className="p-4">
                          <div className="flex items-center gap-2 mb-3"><Upload className="w-4 h-4 text-muted-foreground" /><span className="text-base font-semibold">Upload File</span></div>
                          <div className={`flex flex-col items-center justify-center border-2 border-dashed rounded-md p-6 cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border"}`}
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop}
                            onClick={() => { const input = document.createElement("input"); input.type = "file"; input.multiple = true; input.accept = ".xlsx,.xls,.csv,.txt,.text,.pdf,.jpg,.jpeg,.png,.gif,.bmp,.webp"; input.onchange = (e) => { const files = (e.target as HTMLInputElement).files; if (files) handleFileUpload(files); }; input.click(); }}
                            data-testid="dropzone-upload">
                            {importFileMutation.isPending ? <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" /> : <><Upload className="w-6 h-6 text-muted-foreground mb-1.5" /><p className="text-xs text-muted-foreground text-center">Drop files or click to browse</p><p className="text-[10px] text-muted-foreground mt-0.5">Excel, CSV, PDF, images, text</p></>}
                          </div>
                        </Card>
                        <Card className="p-4">
                          <div className="flex items-center gap-2 mb-3"><FileText className="w-4 h-4 text-muted-foreground" /><span className="text-base font-semibold">Paste List</span></div>
                          <Textarea placeholder={"Paste patient list here — it will import automatically\n\n9:00 AM - John Smith\n9:30 AM - Jane Doe\nBob Johnson"} className="min-h-[82px] resize-none text-sm mb-2" value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                            onPaste={(e) => { const pasted = e.clipboardData.getData("text"); if (pasted.trim() && selectedBatchId) { e.preventDefault(); setPasteText(pasted); importTextMutation.mutate({ batchId: selectedBatchId, text: pasted.trim() }); } }} data-testid="input-paste-list" />
                          <Button className="w-full gap-1.5" variant="outline" onClick={() => { if (!pasteText.trim() || !selectedBatchId) return; importTextMutation.mutate({ batchId: selectedBatchId, text: pasteText.trim() }); }} disabled={!pasteText.trim() || importTextMutation.isPending} data-testid="button-import-text">
                            {importTextMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Import List
                          </Button>
                        </Card>
                      </>
                    ) : (
                      <Card className="p-4 col-span-1 lg:col-span-2">
                        <div className="flex items-center gap-2 mb-3"><Lock className="w-4 h-4 text-muted-foreground" /><span className="text-base font-semibold">Import Access</span></div>
                        <p className="text-xs text-muted-foreground mb-3">File upload and paste import require an access code. Manual entry is always available.</p>
                        <div className="flex items-center gap-2">
                          <Input type="password" inputMode="numeric" maxLength={4} placeholder="Enter 4-digit code" value={importCodeInput}
                            onChange={(e) => { setImportCodeInput(e.target.value.replace(/\D/g, "").slice(0, 4)); setImportCodeError(false); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { if (importCodeInput === IMPORT_ACCESS_CODE) { setImportUnlocked(true); setImportCodeInput(""); setImportCodeError(false); } else { setImportCodeError(true); setImportCodeInput(""); } } }}
                            className={`max-w-[160px] ${importCodeError ? "border-red-400" : ""}`} data-testid="input-import-code" />
                          <Button size="sm" onClick={() => { if (importCodeInput === IMPORT_ACCESS_CODE) { setImportUnlocked(true); setImportCodeInput(""); setImportCodeError(false); } else { setImportCodeError(true); setImportCodeInput(""); } }} data-testid="button-import-unlock">Unlock</Button>
                        </div>
                        {importCodeError && <p className="text-xs text-red-500 mt-1.5" data-testid="text-import-code-error">Incorrect code. Please try again.</p>}
                      </Card>
                    )}
                    <Card className="p-4">
                      <div className="flex items-center gap-2 mb-3"><Plus className="w-4 h-4 text-muted-foreground" /><span className="text-base font-semibold">Manual Entry</span></div>
                      <Button className="w-full gap-1.5" onClick={() => { if (!selectedBatchId) return; addPatientMutation.mutate({ batchId: selectedBatchId, name: "", time: undefined }); }} disabled={addPatientMutation.isPending} data-testid="button-add-patient">
                        {addPatientMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Patient
                      </Button>
                    </Card>
                  </div>
                </section>
                {patients.length > 0 && (
                  <section>
                    <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                      <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider">Schedule Generator ({patients.length})</h2>
                      {completedCount > 0 && <span className="text-xs text-muted-foreground">{completedCount}/{patients.length} analyzed</span>}
                    </div>
                    <div className="space-y-4">
                      {patients.map((patient) => (
                        <PatientCard
                          key={patient.id}
                          patient={patient}
                          isAnalyzing={analyzingPatients.has(patient.id)}
                          onUpdate={(field, value) => updatePatientMutation.mutate({ id: patient.id, updates: { [field]: value } })}
                          onDelete={() => deletePatientMutation.mutate(patient.id)}
                          onAnalyze={() => analyzeOnePatient(patient.id)}
                          onOpenScheduleModal={(p) => setScheduleModalPatient(p)}
                          schedulerName={selectedBatch?.assignedScheduler?.name ?? null}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </main>
          </div>
        ) : (
          <HomeDashboard
            batches={batches}
            dashboardData={dashboardData}
            dashboardLoading={dashboardLoading}
            dashboardWeekOverride={dashboardWeekOverride}
            setDashboardWeekOverride={setDashboardWeekOverride}
            dashboardClinicKey={dashboardClinicKey}
            setDashboardClinicKey={setDashboardClinicKey}
            onNewSchedule={handleNewSchedule}
            onOpenDir={openReferencesTab}
            onOpenSidebar={() => setSidebarOpen(true)}
            onOpenSchedule={(batchId) => {
              const b = batches.find((x) => x.id === batchId);
              openScheduleTab(batchId, b?.name || "Schedule");
            }}
            isCreatingBatch={createBatchMutation.isPending}
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
