import { useState, useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import heroBg from "@/assets/images/hero-bg.png";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Upload,
  FileText,
  Brain,
  Activity,
  Scan,
  Loader2,
  ChevronDown,
  ChevronRight,
  Download,
  Stethoscope,
  Pill,
  Zap,
  Check,
  Trash2,
  MessageCircle,
  GraduationCap,
  Plus,
  Sparkles,
  Calendar,
  X,
  Clock,
  PanelLeft,
  Database,
  AlertTriangle,
  ShieldAlert,
  Search,
  Users,
  DollarSign,
  Building2,
  Share2,
  Copy,
} from "lucide-react";
import type { ScreeningBatch, PatientScreening, PatientTestHistory } from "@shared/schema";

type ScreeningBatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };
type ReasoningValue = string | { clinician_understanding: string; patient_talking_points: string; confidence?: "high" | "medium" | "low"; qualifying_factors?: string[]; icd10_codes?: string[] };

const ULTRASOUND_TESTS = ["carotid", "echo", "stress", "venous", "duplex", "renal", "arterial", "aortic", "aneurysm", "aaa", "93880", "93306", "93975", "93925", "93930", "93978", "93350", "93971", "93970"];

function getAncillaryCategory(test: string): "brainwave" | "vitalwave" | "ultrasound" | "other" {
  const lower = test.toLowerCase();
  if (lower.includes("brain")) return "brainwave";
  if (lower.includes("vital")) return "vitalwave";
  if (ULTRASOUND_TESTS.some((u) => lower.includes(u))) return "ultrasound";
  return "other";
}

const categoryStyles: Record<string, { bg: string; border: string; accent: string; icon: string }> = {
  brainwave: { bg: "bg-violet-50 dark:bg-violet-950/30", border: "border-violet-200 dark:border-violet-800", accent: "text-violet-700 dark:text-violet-300", icon: "text-violet-500 dark:text-violet-400" },
  vitalwave: { bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800", accent: "text-red-700 dark:text-red-300", icon: "text-red-500 dark:text-red-400" },
  ultrasound: { bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800", accent: "text-emerald-700 dark:text-emerald-300", icon: "text-emerald-500 dark:text-emerald-400" },
  other: { bg: "bg-slate-50 dark:bg-slate-950/30", border: "border-slate-200 dark:border-slate-800", accent: "text-slate-700 dark:text-slate-300", icon: "text-slate-500 dark:text-slate-400" },
};

const categoryLabels: Record<string, string> = { brainwave: "BrainWave", vitalwave: "VitalWave", ultrasound: "Ultrasound Studies", other: "Other" };
const categoryIcons: Record<string, typeof Brain> = { brainwave: Brain, vitalwave: Activity, ultrasound: Scan, other: Scan };

function StepTimeline({ current, onNavigate, canGoToResults }: { current: "home" | "build" | "results"; onNavigate: (step: "home" | "build" | "results") => void; canGoToResults: boolean }) {
  const steps = [
    { id: "home" as const, label: "Home", num: 1 },
    { id: "build" as const, label: "Build Schedule", num: 2 },
    { id: "results" as const, label: "Final Schedule", num: 3 },
  ];
  const currentIdx = steps.findIndex((s) => s.id === current);

  return (
    <div className="flex items-center justify-center gap-0 py-2 px-4 border-b bg-white/50 dark:bg-card/50" data-testid="step-timeline">
      {steps.map((step, i) => {
        const isActive = step.id === current;
        const isPast = i < currentIdx;
        const isClickable = true;

        return (
          <div key={step.id} className="flex items-center">
            {i > 0 && (
              <div className={`w-8 sm:w-12 h-px mx-1 ${isPast || isActive ? "bg-primary" : "bg-border"}`} />
            )}
            <Button
              variant={isActive ? "default" : "ghost"}
              size="sm"
              onClick={() => isClickable && onNavigate(step.id)}
              disabled={!isClickable}
              className={`gap-1.5 text-xs ${
                isActive
                  ? ""
                  : isPast
                  ? "text-primary"
                  : ""
              }`}
              data-testid={`step-${step.id}`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                isActive
                  ? "bg-primary-foreground text-primary"
                  : isPast
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}>
                {isPast ? <Check className="w-3 h-3" /> : step.num}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function getBadgeColor(cat: string): string {
  switch (cat) {
    case "brainwave": return "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300";
    case "vitalwave": return "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300";
    case "ultrasound": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300";
    default: return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300";
  }
}

export default function Home() {
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [view, setView] = useState<"home" | "build" | "results" | "history">("home");
  const [expandedPatient, setExpandedPatient] = useState<number | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [analyzingPatients, setAnalyzingPatients] = useState<Set<number>>(new Set());
  const [historyPasteText, setHistoryPasteText] = useState("");
  const [historySearch, setHistorySearch] = useState("");

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { setOpen: setSidebarOpen } = useSidebar();

  const { data: batches = [], isLoading: batchesLoading } = useQuery<ScreeningBatchWithPatients[]>({
    queryKey: ["/api/screening-batches"],
  });

  const { data: selectedBatch, isLoading: batchLoading } = useQuery<ScreeningBatchWithPatients>({
    queryKey: ["/api/screening-batches", selectedBatchId],
    enabled: !!selectedBatchId,
  });

  const { data: testHistory = [], isLoading: historyLoading } = useQuery<PatientTestHistory[]>({
    queryKey: ["/api/test-history"],
    enabled: view === "history",
  });

  const importHistoryMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", "/api/test-history/import", { text });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/test-history"] });
      toast({ title: `Imported ${data.imported} records` });
      setHistoryPasteText("");
    },
    onError: (e: any) => {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    },
  });

  const importHistoryFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/test-history/import", { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json()).error || "Import failed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/test-history"] });
      toast({ title: `Imported ${data.imported} records` });
    },
    onError: (e: any) => {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteHistoryMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/test-history/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/test-history"] });
    },
  });

  const clearHistoryMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/test-history");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/test-history"] });
      toast({ title: "All history cleared" });
    },
  });

  const createBatchMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/batches", { name });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      setSelectedBatchId(data.id);
      setView("build");
    },
  });

  const addPatientMutation = useMutation({
    mutationFn: async ({ batchId, name, time }: { batchId: number; name: string; time?: string }) => {
      const res = await apiRequest("POST", `/api/batches/${batchId}/patients`, { name, time });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
    },
  });

  const importTextMutation = useMutation({
    mutationFn: async ({ batchId, text }: { batchId: number; text: string }) => {
      const res = await apiRequest("POST", `/api/batches/${batchId}/import-text`, { text });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      setPasteText("");
      toast({ title: `Imported ${data.imported} patients` });
    },
  });

  const importFileMutation = useMutation({
    mutationFn: async ({ batchId, formData }: { batchId: number; formData: FormData }) => {
      const res = await fetch(`/api/batches/${batchId}/import-file`, { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      toast({ title: `Imported ${data.imported} patients` });
    },
  });

  const updatePatientMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      const res = await apiRequest("PATCH", `/api/patients/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
    },
  });

  const deletePatientMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/patients/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
    },
  });

  const deleteBatchMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/screening-batches/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      setSelectedBatchId(null);
      setView("home");
    },
  });

  const [analysisProgress, setAnalysisProgress] = useState<{ completed: number; total: number } | null>(null);

  const analyzeAllMutation = useMutation({
    mutationFn: async (batchId: number) => {
      const res = await apiRequest("POST", `/api/batches/${batchId}/analyze`);
      const data = await res.json();
      const total = data.patientCount || 0;
      setAnalysisProgress({ completed: 0, total });

      const pollProgress = async (): Promise<void> => {
        const batchRes = await fetch(`/api/screening-batches/${batchId}`);
        const batchData = await batchRes.json();
        const completedCount = (batchData.patients || []).filter((p: any) => p.status === "completed").length;
        setAnalysisProgress({ completed: completedCount, total });

        if (batchData.status === "completed") {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return pollProgress();
      };

      await pollProgress();
      return data;
    },
    onSuccess: () => {
      setAnalysisProgress(null);
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      setView("results");
      toast({ title: "Analysis complete", description: "All patients have been screened." });
    },
    onError: (err: Error) => {
      setAnalysisProgress(null);
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const analyzeOnePatient = useCallback(async (patientId: number) => {
    setAnalyzingPatients((prev) => new Set(prev).add(patientId));
    try {
      const res = await apiRequest("POST", `/api/patients/${patientId}/analyze`);
      await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      toast({ title: "Patient analyzed" });
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally {
      setAnalyzingPatients((prev) => {
        const next = new Set(prev);
        next.delete(patientId);
        return next;
      });
    }
  }, [selectedBatchId, queryClient, toast]);

  const handleFileUpload = useCallback(
    (files: FileList | File[]) => {
      if (!selectedBatchId) return;
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append("files", file));
      importFileMutation.mutate({ batchId: selectedBatchId, formData });
    },
    [selectedBatchId, importFileMutation]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files);
    },
    [handleFileUpload]
  );

  const handleExport = useCallback(async () => {
    if (!selectedBatchId) return;
    const res = await fetch(`/api/screening-batches/${selectedBatchId}/export`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `screening-results-${selectedBatchId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedBatchId]);

  const patients = selectedBatch?.patients || [];
  const isProcessing = analyzeAllMutation.isPending;
  const completedCount = patients.filter((p) => p.status === "completed").length;

  const handleTimelineNav = useCallback((step: "home" | "build" | "results") => {
    if (step === "home") { setView("home"); setSelectedBatchId(null); }
    else if (step === "build") setView("build");
    else if (step === "results") setView("results");
  }, []);

  const handleSelectSchedule = useCallback((batch: ScreeningBatchWithPatients) => {
    setSelectedBatchId(batch.id);
    setView(batch.status === "completed" ? "results" : "build");
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  const handleNewSchedule = useCallback(() => {
    createBatchMutation.mutate(`Schedule - ${new Date().toLocaleDateString()}`);
  }, [createBatchMutation]);

  return (
    <>
      <Sidebar collapsible="offcanvas" data-testid="sidebar-history">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Tools</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => {
                      setView("history");
                      setSidebarOpen(false);
                    }}
                    isActive={view === "history"}
                    data-testid="sidebar-patient-history"
                  >
                    <Database className="w-4 h-4 shrink-0" />
                    <span className="text-sm font-medium">Patient History</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Schedule History</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => {
                      handleNewSchedule();
                      setSidebarOpen(false);
                    }}
                    data-testid="sidebar-new-schedule"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span className="text-sm font-medium">New Schedule</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {batchesLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                ) : batches.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                    No schedules yet
                  </div>
                ) : (
                  batches.map((batch) => (
                    <SidebarMenuItem key={batch.id}>
                      <SidebarMenuButton
                        onClick={() => handleSelectSchedule(batch)}
                        isActive={selectedBatchId === batch.id}
                        tooltip={batch.name}
                        data-testid={`sidebar-schedule-${batch.id}`}
                      >
                        <Calendar className="w-4 h-4 shrink-0" />
                        <div className="flex flex-col min-w-0">
                          <span className="truncate text-sm">{batch.name}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {batch.patientCount} patients
                            {batch.status === "completed" && " · Complete"}
                          </span>
                        </div>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <div className="flex flex-col flex-1 min-w-0 relative">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${heroBg})` }}
        />
        <div className="absolute inset-0 bg-background/30 dark:bg-background/60" />
        {view === "history" ? (
          <div className="flex flex-col h-full relative z-10">
            <header className="bg-white/85 dark:bg-card/85 backdrop-blur-md sticky top-0 z-50">
              <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-2 flex-wrap border-b">
                <div className="flex items-center gap-2">
                  <SidebarTrigger data-testid="button-sidebar-toggle-history" />
                  <div>
                    <h1 className="text-base font-bold tracking-tight flex items-center gap-2">
                      <Database className="w-4 h-4" />
                      Patient Test History
                    </h1>
                    <p className="text-xs text-muted-foreground">{testHistory.length} records</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {testHistory.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (confirm("Clear all test history records?")) clearHistoryMutation.mutate();
                      }}
                      className="gap-1.5 text-red-600"
                      data-testid="button-clear-history"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear All
                    </Button>
                  )}
                </div>
              </div>
            </header>
            <div className="flex-1 overflow-auto p-4">
              <div className="max-w-5xl mx-auto space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Upload className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-semibold">Upload File</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">Import from Excel, CSV, or text files</p>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv,.txt"
                      className="text-xs"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) importHistoryFileMutation.mutate(file);
                        e.target.value = "";
                      }}
                      data-testid="input-history-file"
                    />
                    {importHistoryFileMutation.isPending && (
                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin" /> Importing...
                      </div>
                    )}
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-semibold">Paste Data</span>
                    </div>
                    <Textarea
                      placeholder="Paste patient test history data here..."
                      value={historyPasteText}
                      onChange={(e) => setHistoryPasteText(e.target.value)}
                      className="text-xs min-h-[80px] mb-2"
                      data-testid="input-history-paste"
                    />
                    <Button
                      size="sm"
                      disabled={!historyPasteText.trim() || importHistoryMutation.isPending}
                      onClick={() => importHistoryMutation.mutate(historyPasteText)}
                      className="gap-1.5"
                      data-testid="button-import-history"
                    >
                      {importHistoryMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      Import
                    </Button>
                  </Card>
                </div>

                {testHistory.length > 0 && (
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Search className="w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by patient name..."
                        value={historySearch}
                        onChange={(e) => setHistorySearch(e.target.value)}
                        className="text-xs h-8 max-w-xs"
                        data-testid="input-history-search"
                      />
                    </div>
                    <div className="overflow-auto max-h-[60vh]">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 dark:bg-muted">
                            <th className="border px-3 py-2 text-left font-semibold">Patient Name</th>
                            <th className="border px-3 py-2 text-left font-semibold">Test</th>
                            <th className="border px-3 py-2 text-left font-semibold">Date of Service</th>
                            <th className="border px-3 py-2 text-left font-semibold">Insurance</th>
                            <th className="border px-3 py-2 text-left font-semibold">Clinic</th>
                            <th className="border px-3 py-2 text-left font-semibold w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {testHistory
                            .filter((r) => !historySearch || r.patientName.toLowerCase().includes(historySearch.toLowerCase()))
                            .map((record) => (
                              <tr key={record.id} className="hover:bg-slate-50 dark:hover:bg-muted/30" data-testid={`row-history-${record.id}`}>
                                <td className="border px-3 py-1.5">{record.patientName}</td>
                                <td className="border px-3 py-1.5">{record.testName}</td>
                                <td className="border px-3 py-1.5">{record.dateOfService}</td>
                                <td className="border px-3 py-1.5">
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    record.insuranceType === "medicare"
                                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                      : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                  }`}>
                                    {record.insuranceType.toUpperCase()}
                                  </span>
                                </td>
                                <td className="border px-3 py-1.5">
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                    {record.clinic || "NWPG"}
                                  </span>
                                </td>
                                <td className="border px-3 py-1.5">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={() => deleteHistoryMutation.mutate(record.id)}
                                    data-testid={`button-delete-history-${record.id}`}
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}

                {historyLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : view === "results" && selectedBatchId ? (
          <ResultsView
            batch={selectedBatch}
            patients={patients}
            loading={batchLoading}
            onExport={handleExport}
            onNavigate={handleTimelineNav}
            expandedPatient={expandedPatient}
            setExpandedPatient={setExpandedPatient}
          />
        ) : view === "build" && selectedBatchId ? (
          <div className="flex flex-col h-full relative z-10">
            <header className="bg-white/85 dark:bg-card/85 backdrop-blur-md sticky top-0 z-50">
              <StepTimeline current="build" onNavigate={handleTimelineNav} canGoToResults={completedCount > 0} />
              <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-2 flex-wrap border-b">
                <div className="flex items-center gap-2">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <div>
                    <h1 className="text-base font-bold tracking-tight" data-testid="text-schedule-name">{selectedBatch?.name || "Loading..."}</h1>
                    <p className="text-xs text-muted-foreground">{patients.length} patients</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {patients.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (confirm("Delete all patients from this schedule?")) {
                          patients.forEach((p) => deletePatientMutation.mutate(p.id));
                        }
                      }}
                      disabled={isProcessing}
                      className="gap-1.5"
                      data-testid="button-delete-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete All
                    </Button>
                  )}
                  <Button
                    onClick={() => analyzeAllMutation.mutate(selectedBatchId!)}
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

            <main className="flex-1 overflow-auto">
              <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
                {isProcessing && (
                  <Card className="p-6">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-10 h-10 text-primary animate-spin" />
                      <p className="font-semibold">Analyzing patients...</p>
                      {analysisProgress && (
                        <>
                          <p className="text-sm text-muted-foreground" data-testid="text-analysis-progress">
                            {analysisProgress.completed} of {analysisProgress.total} completed
                          </p>
                          <div className="w-full max-w-xs bg-slate-200 dark:bg-muted rounded-full h-2 overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                              style={{ width: `${analysisProgress.total > 0 ? (analysisProgress.completed / analysisProgress.total) * 100 : 0}%` }}
                            />
                          </div>
                        </>
                      )}
                      {!analysisProgress && (
                        <p className="text-sm text-muted-foreground">Starting AI screening...</p>
                      )}
                    </div>
                  </Card>
                )}

                <section>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Add Patients</h2>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <Card className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Upload className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-semibold">Upload File</span>
                      </div>
                      <div
                        className={`flex flex-col items-center justify-center border-2 border-dashed rounded-md p-6 cursor-pointer transition-colors ${
                          dragOver ? "border-primary bg-primary/5" : "border-border"
                        }`}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        onClick={() => {
                          const input = document.createElement("input");
                          input.type = "file";
                          input.multiple = true;
                          input.accept = ".xlsx,.xls,.csv,.txt,.text,.pdf,.jpg,.jpeg,.png,.gif,.bmp,.webp";
                          input.onchange = (e) => {
                            const files = (e.target as HTMLInputElement).files;
                            if (files) handleFileUpload(files);
                          };
                          input.click();
                        }}
                        data-testid="dropzone-upload"
                      >
                        {importFileMutation.isPending ? (
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
                        <span className="text-sm font-semibold">Paste List</span>
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
                            importTextMutation.mutate({ batchId: selectedBatchId, text: pasted.trim() });
                          }
                        }}
                        data-testid="input-paste-list"
                      />
                      <Button
                        className="w-full gap-1.5"
                        variant="outline"
                        onClick={() => {
                          if (!pasteText.trim() || !selectedBatchId) return;
                          importTextMutation.mutate({ batchId: selectedBatchId, text: pasteText.trim() });
                        }}
                        disabled={!pasteText.trim() || importTextMutation.isPending}
                        data-testid="button-import-text"
                      >
                        {importTextMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Import List
                      </Button>
                    </Card>

                    <Card className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Plus className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-semibold">Manual Entry</span>
                      </div>
                      <Button
                        className="w-full gap-1.5"
                        onClick={() => {
                          if (!selectedBatchId) return;
                          addPatientMutation.mutate({ batchId: selectedBatchId, name: "", time: undefined });
                        }}
                        disabled={addPatientMutation.isPending}
                        data-testid="button-add-patient"
                      >
                        {addPatientMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Add Patient
                      </Button>
                    </Card>
                  </div>
                </section>

                {patients.length > 0 && (
                  <section>
                    <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                        Schedule Generator ({patients.length})
                      </h2>
                      {completedCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {completedCount}/{patients.length} analyzed
                        </span>
                      )}
                    </div>
                    <div className="space-y-3">
                      {patients.map((patient) => (
                        <PatientCard
                          key={patient.id}
                          patient={patient}
                          isAnalyzing={analyzingPatients.has(patient.id)}
                          onUpdate={(field, value) => {
                            updatePatientMutation.mutate({ id: patient.id, updates: { [field]: value } });
                          }}
                          onDelete={() => deletePatientMutation.mutate(patient.id)}
                          onAnalyze={() => analyzeOnePatient(patient.id)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {patients.length === 0 && !isProcessing && (
                  <div className="text-center py-16 text-muted-foreground">
                    <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">No patients yet. Use the options above to add patients.</p>
                  </div>
                )}
              </div>
            </main>
          </div>
        ) : (
          <div className="flex flex-col h-full relative z-10">
            <header className="sticky top-0 z-50">
              <div className="px-6 py-3 flex items-center">
                <SidebarTrigger data-testid="button-sidebar-toggle-home" className="text-white/70 hover:text-white" />
              </div>
            </header>

            <main className="relative z-10 flex-1 overflow-auto">
              <div className="max-w-5xl mx-auto px-8 pt-8 pb-16">
                <div className="mb-10">
                  <h2 className="text-2xl font-semibold tracking-tight text-white drop-shadow-md" data-testid="text-home-heading">
                    Plexus Ancillary Screening
                  </h2>
                  <p className="text-sm text-white/60 mt-1 font-light">
                    AI-powered clinical analysis for diagnostic ancillaries
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <Card
                    className={`group cursor-pointer rounded-2xl bg-white/85 dark:bg-card/85 backdrop-blur-xl border-0 shadow-sm hover:shadow-md transition-shadow duration-200 ${createBatchMutation.isPending ? "pointer-events-none opacity-60" : ""}`}
                    onClick={handleNewSchedule}
                    data-testid="tile-new-schedule"
                  >
                    <div className="flex items-start gap-4 p-5">
                      <div className="shrink-0 mt-0.5">
                        {createBatchMutation.isPending ? (
                          <Loader2 className="w-6 h-6 text-primary animate-spin" />
                        ) : (
                          <Plus className="w-6 h-6 text-primary" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-medium text-sm text-slate-900 dark:text-foreground" data-testid="text-tile-new-schedule">New Schedule</h3>
                        <p className="text-xs text-slate-500 dark:text-muted-foreground mt-0.5 leading-relaxed">Create a new patient screening schedule</p>
                      </div>
                    </div>
                  </Card>

                  <Card
                    className="group cursor-pointer rounded-2xl bg-white/85 dark:bg-card/85 backdrop-blur-xl border-0 shadow-sm hover:shadow-md transition-shadow duration-200"
                    onClick={() => setView("history")}
                    data-testid="tile-patient-database"
                  >
                    <div className="flex items-start gap-4 p-5">
                      <div className="shrink-0 mt-0.5">
                        <Users className="w-6 h-6 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-medium text-sm text-slate-900 dark:text-foreground" data-testid="text-tile-patient-database">Patient Database</h3>
                        <p className="text-xs text-slate-500 dark:text-muted-foreground mt-0.5 leading-relaxed">View and manage patient test history</p>
                      </div>
                    </div>
                  </Card>

                  <Card
                    className="rounded-2xl bg-white/85 dark:bg-card/85 backdrop-blur-xl border-0 shadow-sm"
                    data-testid="tile-billing"
                  >
                    <div className="p-5">
                      <div className="flex items-start gap-4 mb-4">
                        <div className="shrink-0 mt-0.5">
                          <DollarSign className="w-6 h-6 text-emerald-600" />
                        </div>
                        <div>
                          <h3 className="font-medium text-sm text-slate-900 dark:text-foreground" data-testid="text-tile-billing">Billing</h3>
                          <p className="text-xs text-slate-500 dark:text-muted-foreground mt-0.5">Select a practice</p>
                        </div>
                      </div>
                      <div className="space-y-1.5 pl-10">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start gap-2 h-8 text-xs font-normal text-slate-700 dark:text-foreground hover:bg-slate-100 dark:hover:bg-muted rounded-lg"
                          data-testid="button-billing-nwpg"
                        >
                          <Building2 className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          NWPG
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start gap-2 h-8 text-xs font-normal text-slate-700 dark:text-foreground hover:bg-slate-100 dark:hover:bg-muted rounded-lg"
                          data-testid="button-billing-taylor"
                        >
                          <Building2 className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          Taylor Family Practice
                        </Button>
                      </div>
                    </div>
                  </Card>
                </div>

                {batches.length > 0 && (
                  <div className="mt-8">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSidebarOpen(true)}
                      className="gap-2 text-white/60 hover:text-white hover:bg-white/10 text-xs font-normal"
                      data-testid="button-view-history"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      Schedule History ({batches.length})
                    </Button>
                  </div>
                )}
              </div>
            </main>
          </div>
        )}
      </div>
    </>
  );
}

function PatientCard({
  patient,
  isAnalyzing,
  onUpdate,
  onDelete,
  onAnalyze,
}: {
  patient: PatientScreening;
  isAnalyzing: boolean;
  onUpdate: (field: string, value: string) => void;
  onDelete: () => void;
  onAnalyze: () => void;
}) {
  const isCompleted = patient.status === "completed";
  const tests = patient.qualifyingTests || [];

  const [localName, setLocalName] = useState(patient.name || "");
  const [localTime, setLocalTime] = useState(patient.time || "");
  const [localDx, setLocalDx] = useState(patient.diagnoses || "");
  const [localHx, setLocalHx] = useState(patient.history || "");
  const [localRx, setLocalRx] = useState(patient.medications || "");

  useEffect(() => { setLocalName(patient.name || ""); }, [patient.name]);
  useEffect(() => { setLocalTime(patient.time || ""); }, [patient.time]);
  useEffect(() => { setLocalDx(patient.diagnoses || ""); }, [patient.diagnoses]);
  useEffect(() => { setLocalHx(patient.history || ""); }, [patient.history]);
  useEffect(() => { setLocalRx(patient.medications || ""); }, [patient.medications]);

  return (
    <Card className={`overflow-visible ${isCompleted ? "ring-1 ring-emerald-200 dark:ring-emerald-800" : ""}`} data-testid={`card-patient-${patient.id}`}>
      <div className="px-4 py-3 flex items-center justify-between gap-2 border-b flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-1">
            <Input
              placeholder="Patient name"
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              onBlur={() => { if (localName !== (patient.name || "")) onUpdate("name", localName); }}
              className="h-7 text-sm font-semibold px-2"
              data-testid={`input-patient-name-${patient.id}`}
            />
            <Input
              placeholder="Time (optional)"
              value={localTime}
              onChange={(e) => setLocalTime(e.target.value)}
              onBlur={() => { if (localTime !== (patient.time || "")) onUpdate("time", localTime); }}
              className="h-6 text-xs px-2"
              data-testid={`input-patient-time-${patient.id}`}
            />
          </div>
          {isCompleted && (
            <Badge variant="outline" className="text-xs gap-1 no-default-hover-elevate no-default-active-elevate">
              <Check className="w-3 h-3 text-emerald-500" /> Analyzed
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onAnalyze}
            disabled={isAnalyzing}
            className="gap-1.5"
            data-testid={`button-generate-${patient.id}`}
          >
            {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {isCompleted ? "Re-Generate" : "Generate"}
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} data-testid={`button-delete-patient-${patient.id}`}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1 mb-1.5">
            <Stethoscope className="w-3 h-3" /> Dx (Diagnoses)
          </label>
          <Textarea
            placeholder="HTN, DM2, HLD..."
            className="min-h-[70px] resize-none text-sm"
            value={localDx}
            onChange={(e) => setLocalDx(e.target.value)}
            onBlur={() => { if (localDx !== (patient.diagnoses || "")) onUpdate("diagnoses", localDx); }}
            data-testid={`input-dx-${patient.id}`}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1 mb-1.5">
            <FileText className="w-3 h-3" /> Hx (History / PMH)
          </label>
          <Textarea
            placeholder="MI 2019, CABG, TIA..."
            className="min-h-[70px] resize-none text-sm"
            value={localHx}
            onChange={(e) => setLocalHx(e.target.value)}
            onBlur={() => { if (localHx !== (patient.history || "")) onUpdate("history", localHx); }}
            data-testid={`input-hx-${patient.id}`}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1 mb-1.5">
            <Pill className="w-3 h-3" /> Rx (Medications)
          </label>
          <Textarea
            placeholder="Metformin, Lisinopril..."
            className="min-h-[70px] resize-none text-sm"
            value={localRx}
            onChange={(e) => setLocalRx(e.target.value)}
            onBlur={() => { if (localRx !== (patient.medications || "")) onUpdate("medications", localRx); }}
            data-testid={`input-rx-${patient.id}`}
          />
        </div>
      </div>

      {isCompleted && tests.length > 0 && (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1">Qualifying:</span>
            {tests.map((test) => {
              const cat = getAncillaryCategory(test);
              return (
                <span key={test} className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium ${getBadgeColor(cat)}`}>
                  {test}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

function isImagingTest(test: string): boolean {
  const cat = getAncillaryCategory(test);
  return cat === "ultrasound";
}

function ResultsView({
  batch,
  patients,
  loading,
  onExport,
  onNavigate,
  expandedPatient,
  setExpandedPatient,
}: {
  batch: ScreeningBatchWithPatients | undefined;
  patients: PatientScreening[];
  loading: boolean;
  onExport: () => void;
  onNavigate: (step: "home" | "build" | "results") => void;
  expandedPatient: number | null;
  setExpandedPatient: (id: number | null) => void;
}) {
  const { toast } = useToast();
  const [shareButtonText, setShareButtonText] = useState("Share");

  const handleShare = useCallback(() => {
    if (!batch) return;
    const url = `${window.location.origin}/schedule/${batch.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setShareButtonText("Copied!");
      toast({ title: "Link copied", description: "Share link copied to clipboard" });
      setTimeout(() => setShareButtonText("Share"), 2000);
    }).catch(() => {
      toast({ title: "Copy failed", description: url, variant: "destructive" });
    });
  }, [batch, toast]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center relative z-10">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative z-10">
      <header className="bg-white/80 backdrop-blur-xl sticky top-0 z-50 border-b border-slate-200/60">
        <StepTimeline current="results" onNavigate={onNavigate} canGoToResults={true} />
        <div className="px-8 lg:px-[10%] py-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <SidebarTrigger data-testid="button-sidebar-toggle-results" />
            <div>
              <h1 className="text-base font-semibold tracking-tight" data-testid="text-results-title">{batch?.name} — Final Schedule</h1>
              <p className="text-xs text-slate-900">{patients.length} patients screened</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleShare} className="gap-1.5 rounded-xl" data-testid="button-share">
              {shareButtonText === "Copied!" ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />} {shareButtonText}
            </Button>
            <Button variant="outline" size="sm" onClick={onExport} className="gap-1.5 rounded-xl" data-testid="button-export">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto bg-slate-50/50">
        <div className="px-8 lg:px-[10%] py-6">
          <div className="space-y-3" data-testid="table-final-schedule">
            {patients.map((patient) => {
              const allTests = patient.qualifyingTests || [];
              const reasoning = (patient.reasoning || {}) as Record<string, ReasoningValue>;
              const qualTests = allTests.filter((t) => !isImagingTest(t));
              const qualImaging = allTests.filter((t) => isImagingTest(t));
              const isExpanded = expandedPatient === patient.id;

              return (
                <Card
                  key={patient.id}
                  className="rounded-2xl border-0 shadow-sm bg-white/85 backdrop-blur-sm overflow-hidden transition-shadow hover:shadow-md"
                  data-testid={`row-result-${patient.id}`}
                >
                  <div
                    className="p-4 cursor-pointer hover:bg-slate-50/60 transition-colors"
                    onClick={() => setExpandedPatient(isExpanded ? null : patient.id)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4 min-w-0 flex-1">
                        {patient.time && (
                          <span className="text-xs text-slate-900 font-medium shrink-0 mt-0.5 tabular-nums">{patient.time}</span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-sm text-slate-900 truncate">{patient.name}</p>
                            <span className="text-[11px] text-slate-900">
                              {[patient.age && `${patient.age}yo`, patient.gender].filter(Boolean).join(" · ")}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-slate-900">
                            {patient.diagnoses && (
                              <span className="truncate max-w-[200px]" title={patient.diagnoses}>
                                <span className="font-semibold">Dx:</span> {patient.diagnoses}
                              </span>
                            )}
                            {patient.history && (
                              <span className="truncate max-w-[160px]" title={patient.history}>
                                <span className="font-semibold">Hx:</span> {patient.history}
                              </span>
                            )}
                            {patient.medications && (
                              <span className="truncate max-w-[160px]" title={patient.medications}>
                                <span className="font-semibold">Rx:</span> {patient.medications}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1.5 flex-wrap justify-end max-w-[340px]">
                          {qualTests.map((test) => (
                            <span key={test} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getBadgeColor(getAncillaryCategory(test))}`}>
                              {test}
                            </span>
                          ))}
                          {qualImaging.length > 0 && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getBadgeColor("ultrasound")}`}>
                              <Scan className="w-3 h-3 mr-1" />
                              Ultrasound Studies ({qualImaging.length})
                            </span>
                          )}
                          {allTests.length === 0 && (
                            <span className="text-xs text-slate-900 italic">No qualifying tests</span>
                          )}
                        </div>
                        {allTests.length > 0 && (
                          isExpanded
                            ? <ChevronDown className="w-4 h-4 text-slate-400 transition-transform" />
                            : <ChevronRight className="w-4 h-4 text-slate-400 transition-transform" />
                        )}
                      </div>
                    </div>
                  </div>

                  {isExpanded && allTests.length > 0 && (
                    <div className="border-t border-slate-100 bg-slate-50/60 p-5" data-testid={`row-expanded-${patient.id}`}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-sm text-slate-900">{patient.name} — Ancillary Details</h3>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setExpandedPatient(null); }} data-testid="button-close-detail">
                          <X className="w-4 h-4 text-slate-400" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {(() => {
                          const grouped: Record<string, string[]> = {};
                          for (const test of allTests) {
                            const cat = getAncillaryCategory(test);
                            if (!grouped[cat]) grouped[cat] = [];
                            grouped[cat].push(test);
                          }
                          return ["brainwave", "vitalwave", "ultrasound", "other"].filter((c) => grouped[c]).map((cat) => {
                            const tests = grouped[cat];
                            const style = categoryStyles[cat];
                            const IconComp = categoryIcons[cat];
                            return (
                              <div key={cat} className={`rounded-xl ${style.bg} border ${style.border} p-4 backdrop-blur-sm`} data-testid={`card-ancillary-${cat}`}>
                                <div className="flex items-center gap-2 mb-3">
                                  <IconComp className={`w-4 h-4 ${style.icon}`} />
                                  <span className={`font-semibold text-xs ${style.accent}`}>{categoryLabels[cat]}</span>
                                </div>

                                {cat === "ultrasound" && tests.length > 1 && (
                                  <div className="flex items-center gap-1.5 flex-wrap mb-3">
                                    {tests.map((t) => (
                                      <span key={t} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getBadgeColor(cat)}`}>{t}</span>
                                    ))}
                                  </div>
                                )}

                                {tests.map((test) => {
                                  const reason = reasoning[test];
                                  const clinician = reason ? (typeof reason === "string" ? reason : reason.clinician_understanding) : null;
                                  const talking = reason ? (typeof reason === "string" ? null : reason.patient_talking_points) : null;
                                  const confidence = reason && typeof reason !== "string" ? reason.confidence : null;
                                  const qualifyingFactors = reason && typeof reason !== "string" ? reason.qualifying_factors : null;
                                  const icd10Codes = reason && typeof reason !== "string" ? reason.icd10_codes : null;

                                  const confidenceStyles: Record<string, string> = {
                                    high: "bg-emerald-100 text-emerald-700",
                                    medium: "bg-amber-100 text-amber-700",
                                    low: "bg-orange-100 text-orange-700",
                                  };

                                  return (
                                    <div key={test} className="mb-3 last:mb-0">
                                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                        {(cat === "ultrasound" || tests.length > 1) && (
                                          <p className={`text-xs font-semibold ${style.accent}`}>{test}</p>
                                        )}
                                        {confidence && (
                                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${confidenceStyles[confidence]}`} data-testid={`badge-confidence-${test}`}>
                                            {confidence.toUpperCase()}
                                          </span>
                                        )}
                                      </div>

                                      {qualifyingFactors && qualifyingFactors.length > 0 && (
                                        <div className="flex items-center gap-1 flex-wrap mb-2" data-testid={`factors-${test}`}>
                                          {qualifyingFactors.map((factor, idx) => (
                                            <span key={idx} className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200/60">
                                              {factor}
                                            </span>
                                          ))}
                                        </div>
                                      )}

                                      {clinician && (
                                        <div className="rounded-xl bg-white/80 backdrop-blur-sm p-3 mb-2 shadow-sm">
                                          <div className="flex items-center gap-1.5 mb-1.5">
                                            <GraduationCap className="w-3.5 h-3.5 text-slate-400" />
                                            <span className="text-[10px] font-semibold text-slate-900 uppercase tracking-wider">Clinician Understanding</span>
                                          </div>
                                          <p className="text-[11px] leading-relaxed text-slate-900">{clinician}</p>
                                        </div>
                                      )}

                                      {talking && (
                                        <div className="rounded-xl bg-white/80 backdrop-blur-sm p-3 mb-2 shadow-sm">
                                          <div className="flex items-center gap-1.5 mb-1.5">
                                            <MessageCircle className="w-3.5 h-3.5 text-slate-400" />
                                            <span className="text-[10px] font-semibold text-slate-900 uppercase tracking-wider">Patient Talking Points</span>
                                          </div>
                                          <p className="text-[11px] leading-relaxed text-slate-900">{talking}</p>
                                        </div>
                                      )}

                                      {icd10Codes && icd10Codes.length > 0 && (
                                        <div className="flex items-center gap-1 flex-wrap mt-1.5" data-testid={`icd10-${test}`}>
                                          <span className="text-[10px] text-slate-900 font-medium mr-0.5">ICD-10:</span>
                                          {icd10Codes.map((code, idx) => (
                                            <span key={idx} className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-slate-100 text-slate-900">
                                              {code}
                                            </span>
                                          ))}
                                        </div>
                                      )}

                                      {!clinician && !talking && (
                                        <p className="text-[11px] text-slate-900 italic">No detailed reasoning available.</p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "draft":
      return <Badge variant="outline" className="text-xs gap-1 no-default-hover-elevate no-default-active-elevate"><FileText className="w-3 h-3" /> Draft</Badge>;
    case "processing":
      return <Badge variant="outline" className="text-xs gap-1 no-default-hover-elevate no-default-active-elevate"><Loader2 className="w-3 h-3 animate-spin" /> Processing</Badge>;
    case "completed":
      return <Badge variant="outline" className="text-xs gap-1 no-default-hover-elevate no-default-active-elevate"><Check className="w-3 h-3 text-emerald-500" /> Complete</Badge>;
    default:
      return <Badge variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate">{status}</Badge>;
  }
}
