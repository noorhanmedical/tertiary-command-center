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
} from "lucide-react";
import type { ScreeningBatch, PatientScreening } from "@shared/schema";

type ScreeningBatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };
type ReasoningValue = string | { clinician_understanding: string; patient_talking_points: string };

const ULTRASOUND_TESTS = ["carotid", "echo", "renal", "aaa", "aorta", "thyroid", "venous", "arterial", "dvt", "duplex"];

function getAncillaryCategory(test: string): "brainwave" | "vitalwave" | "ultrasound" | "fibroscan" | "other" {
  const lower = test.toLowerCase();
  if (lower.includes("brain")) return "brainwave";
  if (lower.includes("vital")) return "vitalwave";
  if (lower.includes("fibro")) return "fibroscan";
  if (ULTRASOUND_TESTS.some((u) => lower.includes(u))) return "ultrasound";
  return "other";
}

const categoryStyles: Record<string, { bg: string; border: string; accent: string; icon: string }> = {
  brainwave: { bg: "bg-violet-50 dark:bg-violet-950/30", border: "border-violet-200 dark:border-violet-800", accent: "text-violet-700 dark:text-violet-300", icon: "text-violet-500 dark:text-violet-400" },
  vitalwave: { bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800", accent: "text-red-700 dark:text-red-300", icon: "text-red-500 dark:text-red-400" },
  ultrasound: { bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800", accent: "text-emerald-700 dark:text-emerald-300", icon: "text-emerald-500 dark:text-emerald-400" },
  fibroscan: { bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-800", accent: "text-amber-700 dark:text-amber-300", icon: "text-amber-500 dark:text-amber-400" },
  other: { bg: "bg-slate-50 dark:bg-slate-950/30", border: "border-slate-200 dark:border-slate-800", accent: "text-slate-700 dark:text-slate-300", icon: "text-slate-500 dark:text-slate-400" },
};

const categoryLabels: Record<string, string> = { brainwave: "BrainWave", vitalwave: "VitalWave", ultrasound: "Ultrasound Studies", fibroscan: "FibroScan", other: "Other" };
const categoryIcons: Record<string, typeof Brain> = { brainwave: Brain, vitalwave: Activity, ultrasound: Scan, fibroscan: Scan, other: Scan };

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
    case "fibroscan": return "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300";
    default: return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300";
  }
}

export default function Home() {
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [view, setView] = useState<"home" | "build" | "results">("home");
  const [expandedPatient, setExpandedPatient] = useState<number | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [analyzingPatients, setAnalyzingPatients] = useState<Set<number>>(new Set());

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

  const analyzeAllMutation = useMutation({
    mutationFn: async (batchId: number) => {
      const res = await apiRequest("POST", `/api/batches/${batchId}/analyze`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      setView("results");
      toast({ title: "Analysis complete", description: "All patients have been screened." });
    },
    onError: (err: Error) => {
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
        {view === "results" && selectedBatchId ? (
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
                      <p className="font-semibold">Analyzing all patients...</p>
                      <p className="text-sm text-muted-foreground">Screening with AI for ancillary qualifications</p>
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
            <header className="bg-black/30 backdrop-blur-md sticky top-0 z-50">
              <div className="px-4 py-2 flex items-center gap-3">
                <SidebarTrigger data-testid="button-sidebar-toggle-home" className="text-white" />
              </div>
            </header>

            <main className="relative z-10 flex-1 flex items-center justify-center">
              <div className="max-w-lg w-full px-6">
                <div className="text-center mb-10">
                  <div className="w-20 h-20 rounded-full bg-white/95 dark:bg-card/95 flex items-center justify-center mx-auto mb-6 shadow-sm">
                    <Stethoscope className="w-10 h-10 text-primary" />
                  </div>
                  <h2 className="text-3xl font-bold tracking-tight mb-3 text-slate-900 dark:text-foreground" data-testid="text-home-heading">
                    Plexus Ancillary Screening
                  </h2>
                  <p className="text-slate-600 dark:text-muted-foreground leading-relaxed">
                    Qualify patients for diagnostic ancillaries using AI-powered clinical analysis.
                  </p>
                </div>

                <div className="space-y-4">
                  <Button
                    onClick={handleNewSchedule}
                    disabled={createBatchMutation.isPending}
                    size="lg"
                    className="w-full gap-2"
                    data-testid="button-new-schedule"
                  >
                    {createBatchMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    New Schedule
                  </Button>

                  {batches.length > 0 && (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => setSidebarOpen(true)}
                      className="w-full gap-2 bg-white/95 dark:bg-card/95"
                      data-testid="button-view-history"
                    >
                      <Clock className="w-4 h-4" />
                      Schedule History ({batches.length})
                    </Button>
                  )}
                </div>
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
  const lower = test.toLowerCase();
  const cat = getAncillaryCategory(test);
  return cat === "ultrasound" || cat === "fibroscan" || lower.includes("scan") || lower.includes("ultrasound") || lower.includes("echo");
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
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center relative z-10">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative z-10">
      <header className="bg-white/85 dark:bg-card/85 backdrop-blur-md sticky top-0 z-50">
        <StepTimeline current="results" onNavigate={onNavigate} canGoToResults={true} />
        <div className="px-4 py-3 flex items-center justify-between gap-2 flex-wrap border-b">
          <div className="flex items-center gap-2">
            <SidebarTrigger data-testid="button-sidebar-toggle-results" />
            <div>
              <h1 className="text-base font-bold tracking-tight" data-testid="text-results-title">{batch?.name} - Final Schedule</h1>
              <p className="text-xs text-muted-foreground">{patients.length} patients screened</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={onExport} className="gap-1.5" data-testid="button-export">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="px-2 py-4">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs" data-testid="table-final-schedule">
              <thead>
                <tr className="bg-[#2d4a3e] text-white">
                  <th className="border border-[#1e3a2e] px-3 py-2 text-left font-semibold whitespace-nowrap">TIME</th>
                  <th className="border border-[#1e3a2e] px-3 py-2 text-left font-semibold whitespace-nowrap">NAME</th>
                  <th className="border border-[#1e3a2e] px-3 py-2 text-left font-semibold whitespace-nowrap">AGE</th>
                  <th className="border border-[#1e3a2e] px-3 py-2 text-left font-semibold whitespace-nowrap">GENDER</th>
                  <th className="border border-[#1e3a2e] px-3 py-2 text-left font-semibold whitespace-nowrap">Dx</th>
                  <th className="border border-[#1e3a2e] px-3 py-2 text-left font-semibold whitespace-nowrap">Hx</th>
                  <th className="border border-[#1e3a2e] px-3 py-2 text-left font-semibold whitespace-nowrap">Rx</th>
                  <th className="border border-[#1e3a2e] px-3 py-2 text-left font-semibold whitespace-nowrap">QUALIFYING TESTS</th>
                  <th className="border border-[#1e3a2e] px-3 py-2 text-left font-semibold whitespace-nowrap">QUALIFYING IMAGING</th>
                </tr>
              </thead>
              {patients.map((patient, idx) => {
                  const allTests = patient.qualifyingTests || [];
                  const reasoning = (patient.reasoning || {}) as Record<string, ReasoningValue>;
                  const qualTests = allTests.filter((t) => !isImagingTest(t));
                  const qualImaging = allTests.filter((t) => isImagingTest(t));
                  const isExpanded = expandedPatient === patient.id;
                  const rowBg = idx % 2 === 0 ? "bg-white dark:bg-card" : "bg-slate-50 dark:bg-card/80";

                  return (
                    <tbody key={patient.id}>
                      <tr
                        className={`${rowBg} cursor-pointer hover:bg-slate-100 dark:hover:bg-muted/50 transition-colors`}
                        onClick={() => setExpandedPatient(isExpanded ? null : patient.id)}
                        data-testid={`row-result-${patient.id}`}
                      >
                        <td className="border border-slate-200 dark:border-slate-700 px-3 py-2 whitespace-nowrap align-top">{patient.time || ""}</td>
                        <td className="border border-slate-200 dark:border-slate-700 px-3 py-2 whitespace-nowrap font-medium align-top">{patient.name}</td>
                        <td className="border border-slate-200 dark:border-slate-700 px-3 py-2 whitespace-nowrap align-top">{patient.age || ""}</td>
                        <td className="border border-slate-200 dark:border-slate-700 px-3 py-2 whitespace-nowrap align-top">{patient.gender || ""}</td>
                        <td className="border border-slate-200 dark:border-slate-700 px-3 py-2 align-top max-w-[200px]">
                          <div className="whitespace-pre-wrap break-words">{patient.diagnoses || ""}</div>
                        </td>
                        <td className="border border-slate-200 dark:border-slate-700 px-3 py-2 align-top max-w-[200px]">
                          <div className="whitespace-pre-wrap break-words">{patient.history || ""}</div>
                        </td>
                        <td className="border border-slate-200 dark:border-slate-700 px-3 py-2 align-top max-w-[200px]">
                          <div className="whitespace-pre-wrap break-words">{patient.medications || ""}</div>
                        </td>
                        <td className="border border-slate-200 dark:border-slate-700 px-3 py-2 align-top">
                          <div className="flex flex-col gap-1">
                            {qualTests.length > 0 ? qualTests.map((test) => {
                              const cat = getAncillaryCategory(test);
                              return (
                                <span key={test} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-tight ${getBadgeColor(cat)}`}>
                                  {test}
                                </span>
                              );
                            }) : <span className="text-muted-foreground">-</span>}
                          </div>
                        </td>
                        <td className="border border-slate-200 dark:border-slate-700 px-3 py-2 align-top">
                          <div className="flex flex-col gap-1">
                            {qualImaging.length > 0 ? qualImaging.map((test) => {
                              const cat = getAncillaryCategory(test);
                              return (
                                <span key={test} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-tight ${getBadgeColor(cat)}`}>
                                  {test}
                                </span>
                              );
                            }) : <span className="text-muted-foreground">-</span>}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && allTests.length > 0 && (
                        <tr data-testid={`row-expanded-${patient.id}`}>
                          <td colSpan={9} className="border border-slate-200 dark:border-slate-700 p-0">
                            <div className="bg-slate-50/80 dark:bg-muted/30 p-4">
                              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                                <h3 className="font-semibold text-sm">{patient.name} - Ancillary Details</h3>
                                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setExpandedPatient(null); }} data-testid="button-close-detail">
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {allTests.map((test) => {
                                  const cat = getAncillaryCategory(test);
                                  const style = categoryStyles[cat];
                                  const IconComp = categoryIcons[cat];
                                  const reason = reasoning[test];
                                  const clinician = reason ? (typeof reason === "string" ? reason : reason.clinician_understanding) : null;
                                  const talking = reason ? (typeof reason === "string" ? null : reason.patient_talking_points) : null;

                                  return (
                                    <div key={test} className={`rounded-md border ${style.bg} ${style.border} p-3`} data-testid={`card-ancillary-${test}`}>
                                      <div className="flex items-center gap-2 mb-2">
                                        <IconComp className={`w-4 h-4 ${style.icon}`} />
                                        <span className={`font-semibold text-xs ${style.accent}`}>{test}</span>
                                      </div>

                                      {clinician && (
                                        <div className="rounded-md bg-background/60 dark:bg-background/30 p-2.5 mb-2">
                                          <div className="flex items-center gap-1.5 mb-1">
                                            <GraduationCap className="w-3 h-3 text-muted-foreground" />
                                            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Clinician Understanding</span>
                                          </div>
                                          <p className="text-[11px] leading-relaxed">{clinician}</p>
                                        </div>
                                      )}

                                      {talking && (
                                        <div className="rounded-md bg-background/60 dark:bg-background/30 p-2.5">
                                          <div className="flex items-center gap-1.5 mb-1">
                                            <MessageCircle className="w-3 h-3 text-muted-foreground" />
                                            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Patient Talking Points</span>
                                          </div>
                                          <p className="text-[11px] leading-relaxed">{talking}</p>
                                        </div>
                                      )}

                                      {!clinician && !talking && (
                                        <p className="text-[11px] text-muted-foreground">No detailed reasoning available.</p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  );
                })}
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

function ExpandedAncillaries({ tests, reasoning }: { tests: string[]; reasoning: Record<string, ReasoningValue> }) {
  const grouped: Record<string, { tests: string[]; reasonings: Record<string, ReasoningValue> }> = {};
  for (const test of tests) {
    const cat = getAncillaryCategory(test);
    if (!grouped[cat]) grouped[cat] = { tests: [], reasonings: {} };
    grouped[cat].tests.push(test);
    if (reasoning[test]) grouped[cat].reasonings[test] = reasoning[test];
  }

  const categoryOrder = ["brainwave", "vitalwave", "ultrasound", "fibroscan", "other"];
  const sortedCategories = categoryOrder.filter((c) => grouped[c]);

  return (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Qualifying Ancillaries</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sortedCategories.map((cat) => {
          const group = grouped[cat];
          const style = categoryStyles[cat];
          const IconComp = categoryIcons[cat];
          return (
            <div key={cat} className={`rounded-md border ${style.bg} ${style.border} p-4`} data-testid={`card-ancillary-${cat}`}>
              <div className="flex items-center gap-2 mb-3">
                <IconComp className={`w-5 h-5 ${style.icon}`} />
                <span className={`font-semibold text-sm ${style.accent}`}>{categoryLabels[cat]}</span>
              </div>

              {cat === "ultrasound" && group.tests.length > 1 && (
                <div className="flex items-center gap-1.5 flex-wrap mb-3">
                  {group.tests.map((t) => (
                    <span key={t} className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium ${getBadgeColor(cat)}`}>{t}</span>
                  ))}
                </div>
              )}

              {Object.entries(group.reasonings).map(([test, reason]) => {
                const clinician = typeof reason === "string" ? reason : reason.clinician_understanding;
                const talking = typeof reason === "string" ? null : reason.patient_talking_points;
                return (
                  <div key={test} className="mb-3 last:mb-0">
                    {cat === "ultrasound" && group.tests.length > 1 && (
                      <p className={`text-xs font-semibold mb-1.5 ${style.accent}`}>{test}</p>
                    )}
                    <div className="space-y-2">
                      <div className="rounded-md bg-background/60 dark:bg-background/30 p-3">
                        <div className="flex items-center gap-1.5 mb-1">
                          <GraduationCap className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Clinician Understanding</span>
                        </div>
                        <p className="text-xs leading-relaxed">{clinician}</p>
                      </div>
                      {talking && (
                        <div className="rounded-md bg-background/60 dark:bg-background/30 p-3">
                          <div className="flex items-center gap-1.5 mb-1">
                            <MessageCircle className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Patient Talking Points</span>
                          </div>
                          <p className="text-xs leading-relaxed">{talking}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
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
