import { useState, useCallback, Fragment } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  FileText,
  Brain,
  Activity,
  Scan,
  Loader2,
  ChevronDown,
  ChevronUp,
  Download,
  ClipboardPaste,
  FileSpreadsheet,
  Stethoscope,
  Pill,
  Zap,
  Check,
  History,
  Trash2,
  Search,
  MessageCircle,
  GraduationCap,
  Plus,
  UserPlus,
  X,
  Save,
  Pencil,
  Play,
} from "lucide-react";
import type { ScreeningBatch, PatientScreening } from "@shared/schema";

type ScreeningBatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };
type ReasoningValue = string | { clinician_understanding: string; patient_talking_points: string };

const ULTRASOUND_TESTS = ["carotid", "echo", "renal", "aaa", "aorta", "thyroid", "venous", "arterial", "dvt", "duplex"];
function isUltrasound(test: string): boolean {
  return ULTRASOUND_TESTS.some((u) => test.toLowerCase().includes(u));
}

function getAncillaryCategory(test: string): "brainwave" | "vitalwave" | "ultrasound" | "fibroscan" | "other" {
  const lower = test.toLowerCase();
  if (lower.includes("brain")) return "brainwave";
  if (lower.includes("vital")) return "vitalwave";
  if (lower.includes("fibro")) return "fibroscan";
  if (isUltrasound(lower)) return "ultrasound";
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
  const [activeTab, setActiveTab] = useState("schedule");
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [expandedPatient, setExpandedPatient] = useState<number | null>(null);
  const [editingPatient, setEditingPatient] = useState<number | null>(null);
  const [showAddPanel, setShowAddPanel] = useState<"manual" | "text" | "file" | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualTime, setManualTime] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [editForm, setEditForm] = useState<{
    diagnoses: string; history: string; medications: string; notes: string;
    age: string; gender: string;
  }>({ diagnoses: "", history: "", medications: "", notes: "", age: "", gender: "" });

  const { toast } = useToast();
  const queryClient = useQueryClient();

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
      setManualName("");
      setManualTime("");
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
      setShowAddPanel(null);
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
      setShowAddPanel(null);
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
      setEditingPatient(null);
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
      if (selectedBatchId) setSelectedBatchId(null);
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async (batchId: number) => {
      const res = await apiRequest("POST", `/api/batches/${batchId}/analyze`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      toast({ title: "Analysis complete", description: "Ancillary qualifications generated." });
    },
    onError: (err: Error) => {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    },
  });

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

  const startEditing = (patient: PatientScreening) => {
    setEditingPatient(patient.id);
    setEditForm({
      diagnoses: patient.diagnoses || "",
      history: patient.history || "",
      medications: patient.medications || "",
      notes: patient.notes || "",
      age: patient.age?.toString() || "",
      gender: patient.gender || "",
    });
  };

  const savePatientEdit = () => {
    if (!editingPatient) return;
    updatePatientMutation.mutate({ id: editingPatient, updates: editForm });
  };

  const isDraft = selectedBatch?.status === "draft";
  const isProcessing = selectedBatch?.status === "processing" || analyzeMutation.isPending;
  const isCompleted = selectedBatch?.status === "completed";
  const patients = selectedBatch?.patients || [];

  const truncate = (text: string | null | undefined, max: number) => {
    if (!text) return "";
    return text.length > max ? text.substring(0, max) + "..." : text;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-5 py-4 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary flex items-center justify-center">
              <Stethoscope className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-tight" data-testid="text-app-title">
                Ancillary Screening
              </h1>
              <p className="text-xs text-muted-foreground">Build Schedule, Add Clinical Data, Generate Qualifications</p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs gap-1.5 rounded-full">
            <Zap className="w-3 h-3" /> GPT-5.2
          </Badge>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-5 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 rounded-full">
            <TabsTrigger value="schedule" data-testid="tab-schedule" className="gap-1.5 rounded-full">
              <FileText className="w-4 h-4" /> Schedule
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history" className="gap-1.5 rounded-full">
              <History className="w-4 h-4" /> History
              {batches.length > 0 && (
                <span className="ml-1 text-xs bg-muted rounded-full px-2 py-0.5">{batches.length}</span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="schedule">
            {!selectedBatchId ? (
              <div className="space-y-6">
                <div className="text-center py-16">
                  <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                    <Plus className="w-7 h-7 text-muted-foreground" />
                  </div>
                  <h3 className="font-semibold text-lg mb-1">Start a New Batch</h3>
                  <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                    Create a batch, add patients to the schedule, fill in their clinical data, then generate ancillary qualifications.
                  </p>
                  <Button
                    onClick={() => createBatchMutation.mutate(`Batch - ${new Date().toLocaleDateString()}`)}
                    disabled={createBatchMutation.isPending}
                    className="rounded-full gap-2"
                    data-testid="button-new-batch"
                  >
                    {createBatchMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    New Batch
                  </Button>
                </div>

                {batches.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-3">Or continue a recent batch:</h3>
                    <div className="grid gap-2">
                      {batches.slice(0, 5).map((batch) => (
                        <Card
                          key={batch.id}
                          className="p-3 rounded-2xl hover-elevate cursor-pointer overflow-visible"
                          onClick={() => { setSelectedBatchId(batch.id); }}
                          data-testid={`card-recent-batch-${batch.id}`}
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                                <FileText className="w-4 h-4 text-muted-foreground" />
                              </div>
                              <div>
                                <p className="font-semibold text-sm">{batch.name}</p>
                                <p className="text-xs text-muted-foreground">{batch.patientCount} patients</p>
                              </div>
                            </div>
                            <StatusBadge status={batch.status} />
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : batchLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => { setSelectedBatchId(null); setShowAddPanel(null); setEditingPatient(null); }} data-testid="button-back">
                      <ChevronUp className="w-4 h-4 -rotate-90" />
                    </Button>
                    <div>
                      <h2 className="font-bold text-lg tracking-tight" data-testid="text-batch-name">{selectedBatch?.name}</h2>
                      <p className="text-sm text-muted-foreground">
                        {patients.length} patients
                        <span className="mx-1.5">·</span>
                        <StatusBadge status={selectedBatch?.status || "draft"} inline />
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {isDraft && patients.length > 0 && (
                      <Button
                        onClick={() => analyzeMutation.mutate(selectedBatchId!)}
                        disabled={isProcessing}
                        className="rounded-full gap-2"
                        data-testid="button-analyze"
                      >
                        {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        Analyze for Ancillaries
                      </Button>
                    )}
                    {isCompleted && (
                      <>
                        <Button variant="outline" size="sm" onClick={handleExport} className="rounded-full gap-1.5" data-testid="button-export">
                          <Download className="w-4 h-4" /> Export CSV
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (!selectedBatchId) return;
                            // Re-run by resetting to draft-like state
                            analyzeMutation.mutate(selectedBatchId);
                          }}
                          disabled={isProcessing}
                          className="rounded-full gap-1.5"
                          data-testid="button-reanalyze"
                        >
                          {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                          Re-Analyze
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {isDraft && (
                  <Card className="p-4 rounded-2xl">
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <span className="text-sm font-semibold">Add Patients</span>
                      <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                        <Button
                          variant={showAddPanel === "manual" ? "default" : "outline"}
                          size="sm"
                          onClick={() => setShowAddPanel(showAddPanel === "manual" ? null : "manual")}
                          className="rounded-full gap-1.5"
                          data-testid="button-add-manual"
                        >
                          <UserPlus className="w-3.5 h-3.5" /> Manual
                        </Button>
                        <Button
                          variant={showAddPanel === "text" ? "default" : "outline"}
                          size="sm"
                          onClick={() => setShowAddPanel(showAddPanel === "text" ? null : "text")}
                          className="rounded-full gap-1.5"
                          data-testid="button-add-text"
                        >
                          <ClipboardPaste className="w-3.5 h-3.5" /> Paste List
                        </Button>
                        <Button
                          variant={showAddPanel === "file" ? "default" : "outline"}
                          size="sm"
                          onClick={() => setShowAddPanel(showAddPanel === "file" ? null : "file")}
                          className="rounded-full gap-1.5"
                          data-testid="button-add-file"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" /> File
                        </Button>
                      </div>
                    </div>

                    {showAddPanel === "manual" && (
                      <div className="flex items-end gap-2 pt-2 flex-wrap">
                        <div className="flex-1 min-w-[160px]">
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">Patient Name</label>
                          <Input
                            placeholder="John Smith"
                            value={manualName}
                            onChange={(e) => setManualName(e.target.value)}
                            className="rounded-xl"
                            data-testid="input-manual-name"
                          />
                        </div>
                        <div className="w-32">
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">Time (optional)</label>
                          <Input
                            placeholder="9:00 AM"
                            value={manualTime}
                            onChange={(e) => setManualTime(e.target.value)}
                            className="rounded-xl"
                            data-testid="input-manual-time"
                          />
                        </div>
                        <Button
                          onClick={() => {
                            if (!manualName.trim() || !selectedBatchId) return;
                            addPatientMutation.mutate({ batchId: selectedBatchId, name: manualName.trim(), time: manualTime.trim() || undefined });
                          }}
                          disabled={!manualName.trim() || addPatientMutation.isPending}
                          className="rounded-xl gap-1.5"
                          data-testid="button-add-patient"
                        >
                          {addPatientMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                          Add
                        </Button>
                      </div>
                    )}

                    {showAddPanel === "text" && (
                      <div className="pt-2 space-y-2">
                        <label className="text-xs font-medium text-muted-foreground block">
                          Paste patient names (one per line). Optionally include time before the name.
                        </label>
                        <Textarea
                          placeholder={"9:00 AM - John Smith\n9:30 AM - Jane Doe\nBob Johnson"}
                          className="min-h-[120px] resize-none text-sm rounded-xl"
                          value={pasteText}
                          onChange={(e) => setPasteText(e.target.value)}
                          data-testid="input-paste-list"
                        />
                        <Button
                          onClick={() => {
                            if (!pasteText.trim() || !selectedBatchId) return;
                            importTextMutation.mutate({ batchId: selectedBatchId, text: pasteText.trim() });
                          }}
                          disabled={!pasteText.trim() || importTextMutation.isPending}
                          className="rounded-xl gap-1.5"
                          data-testid="button-import-text"
                        >
                          {importTextMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                          Import Patients
                        </Button>
                      </div>
                    )}

                    {showAddPanel === "file" && (
                      <div
                        className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer mt-2 ${
                          dragOver ? "border-primary bg-primary/5" : "border-border"
                        }`}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        onClick={() => {
                          const input = document.createElement("input");
                          input.type = "file";
                          input.multiple = true;
                          input.accept = ".xlsx,.xls,.csv,.txt,.text";
                          input.onchange = (e) => {
                            const files = (e.target as HTMLInputElement).files;
                            if (files) handleFileUpload(files);
                          };
                          input.click();
                        }}
                        data-testid="dropzone-upload"
                      >
                        {importFileMutation.isPending ? (
                          <div className="flex flex-col items-center gap-2">
                            <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
                            <p className="text-sm font-medium">Importing...</p>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2">
                            <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
                              <Upload className="w-5 h-5 text-muted-foreground" />
                            </div>
                            <p className="text-sm font-medium">Drop files or tap to browse</p>
                            <p className="text-xs text-muted-foreground">.xlsx, .csv, .txt</p>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                )}

                {isProcessing && (
                  <Card className="p-6 rounded-2xl">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-10 h-10 text-primary animate-spin" />
                      <p className="font-semibold">Analyzing patients for ancillary qualifications...</p>
                      <p className="text-sm text-muted-foreground">Reviewing Dx, PMH & Rx with GPT-5.2</p>
                    </div>
                  </Card>
                )}

                {patients.length > 0 && (
                  <Card className="overflow-visible rounded-2xl">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" data-testid="table-schedule">
                        <thead>
                          <tr className="border-b bg-muted/40">
                            <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Time</th>
                            <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Name</th>
                            <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Age</th>
                            <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Gender</th>
                            <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Dx</th>
                            <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Hx</th>
                            <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Rx</th>
                            {isCompleted && (
                              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Qualifying Tests</th>
                            )}
                            <th className="px-3 py-3 w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {patients.map((patient) => {
                            const isExpanded = expandedPatient === patient.id;
                            const isEditing = editingPatient === patient.id;
                            const tests = patient.qualifyingTests || [];
                            const reasoning = (patient.reasoning || {}) as Record<string, ReasoningValue>;

                            return (
                              <Fragment key={patient.id}>
                                <tr
                                  className="border-b cursor-pointer hover-elevate transition-colors"
                                  onClick={() => {
                                    if (isEditing) return;
                                    if (isDraft) {
                                      startEditing(patient);
                                    } else {
                                      setExpandedPatient(isExpanded ? null : patient.id);
                                    }
                                  }}
                                  data-testid={`row-patient-${patient.id}`}
                                >
                                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{patient.time || "--"}</td>
                                  <td className="px-4 py-3 whitespace-nowrap font-semibold">{patient.name}</td>
                                  <td className="px-4 py-3 whitespace-nowrap">{patient.age || "--"}</td>
                                  <td className="px-4 py-3 whitespace-nowrap">{patient.gender || "--"}</td>
                                  <td className="px-4 py-3 max-w-[180px]">
                                    <span className="line-clamp-2 text-xs">{patient.diagnoses ? truncate(patient.diagnoses, 80) : <span className="text-muted-foreground italic">--</span>}</span>
                                  </td>
                                  <td className="px-4 py-3 max-w-[180px]">
                                    <span className="line-clamp-2 text-xs">{patient.history ? truncate(patient.history, 80) : <span className="text-muted-foreground italic">--</span>}</span>
                                  </td>
                                  <td className="px-4 py-3 max-w-[160px]">
                                    <span className="line-clamp-2 text-xs">{patient.medications ? truncate(patient.medications, 60) : <span className="text-muted-foreground italic">--</span>}</span>
                                  </td>
                                  {isCompleted && (
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-1 flex-wrap">
                                        {tests.length > 0 ? tests.map((test) => {
                                          const cat = getAncillaryCategory(test);
                                          return (
                                            <span key={test} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${getBadgeColor(cat)}`}>
                                              {test}
                                            </span>
                                          );
                                        }) : <span className="text-xs text-muted-foreground">None</span>}
                                      </div>
                                    </td>
                                  )}
                                  <td className="px-3 py-3">
                                    <div className="flex items-center gap-1">
                                      {isDraft && (
                                        <>
                                          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); startEditing(patient); }} data-testid={`button-edit-patient-${patient.id}`}>
                                            <Pencil className="w-3.5 h-3.5" />
                                          </Button>
                                          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); deletePatientMutation.mutate(patient.id); }} data-testid={`button-delete-patient-${patient.id}`}>
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </Button>
                                        </>
                                      )}
                                      {isCompleted && (
                                        isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                      )}
                                    </div>
                                  </td>
                                </tr>
                                {isEditing && isDraft && (
                                  <tr data-testid={`row-edit-${patient.id}`}>
                                    <td colSpan={isCompleted ? 9 : 8} className="px-4 py-4 border-b bg-muted/20">
                                      <PatientEditForm
                                        editForm={editForm}
                                        setEditForm={setEditForm}
                                        onSave={savePatientEdit}
                                        onCancel={() => setEditingPatient(null)}
                                        saving={updatePatientMutation.isPending}
                                      />
                                    </td>
                                  </tr>
                                )}
                                {isExpanded && isCompleted && (
                                  <tr data-testid={`row-detail-${patient.id}`}>
                                    <td colSpan={9} className="px-4 py-5 border-b bg-muted/20">
                                      <ExpandedPatientDetail patient={patient} reasoning={reasoning} tests={tests} />
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}

                {patients.length === 0 && !isProcessing && (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-sm">No patients added yet. Use the options above to add patients to this batch.</p>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history">
            {batchesLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : batches.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                  <History className="w-7 h-7 text-muted-foreground" />
                </div>
                <h3 className="font-semibold text-lg mb-1">No batches yet</h3>
                <p className="text-sm text-muted-foreground">Create your first batch from the Schedule tab.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {batches.map((batch) => (
                  <Card
                    key={batch.id}
                    className="p-4 rounded-2xl hover-elevate cursor-pointer overflow-visible"
                    onClick={() => { setSelectedBatchId(batch.id); setActiveTab("schedule"); }}
                    data-testid={`card-batch-${batch.id}`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-muted flex items-center justify-center">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">{batch.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {batch.patientCount} patients
                            {batch.createdAt && ` · ${new Date(batch.createdAt).toLocaleDateString()}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={batch.status} />
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); deleteBatchMutation.mutate(batch.id); }} data-testid={`button-delete-batch-${batch.id}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function StatusBadge({ status, inline }: { status: string; inline?: boolean }) {
  if (inline) {
    switch (status) {
      case "draft": return <span className="text-blue-600 dark:text-blue-400 font-medium">Draft</span>;
      case "processing": return <span className="text-amber-600 dark:text-amber-400 font-medium">Processing</span>;
      case "completed": return <span className="text-emerald-600 dark:text-emerald-400 font-medium">Complete</span>;
      default: return <span className="font-medium">{status}</span>;
    }
  }
  switch (status) {
    case "draft": return <Badge variant="outline" className="text-xs rounded-full gap-1"><Pencil className="w-3 h-3" /> Draft</Badge>;
    case "processing": return <Badge variant="outline" className="text-xs rounded-full gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Processing</Badge>;
    case "completed": return <Badge variant="outline" className="text-xs rounded-full gap-1"><Check className="w-3 h-3" /> Complete</Badge>;
    default: return <Badge variant="outline" className="text-xs rounded-full">{status}</Badge>;
  }
}

function PatientEditForm({
  editForm,
  setEditForm,
  onSave,
  onCancel,
  saving,
}: {
  editForm: { diagnoses: string; history: string; medications: string; notes: string; age: string; gender: string };
  setEditForm: (form: typeof editForm) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Age</label>
          <Input value={editForm.age} onChange={(e) => setEditForm({ ...editForm, age: e.target.value })} placeholder="65" className="rounded-xl" data-testid="input-edit-age" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Gender</label>
          <Input value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })} placeholder="M / F" className="rounded-xl" data-testid="input-edit-gender" />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Dx (Diagnoses)</label>
        <Textarea value={editForm.diagnoses} onChange={(e) => setEditForm({ ...editForm, diagnoses: e.target.value })} placeholder="HTN, DM2, HLD, Hypothyroidism..." className="min-h-[60px] resize-none text-sm rounded-xl" data-testid="input-edit-dx" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Hx (History / PMH)</label>
        <Textarea value={editForm.history} onChange={(e) => setEditForm({ ...editForm, history: e.target.value })} placeholder="MI 2019, CABG 2020, TIA 2021..." className="min-h-[60px] resize-none text-sm rounded-xl" data-testid="input-edit-hx" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Rx (Medications)</label>
        <Textarea value={editForm.medications} onChange={(e) => setEditForm({ ...editForm, medications: e.target.value })} placeholder="Metformin 1000mg, Lisinopril 20mg..." className="min-h-[60px] resize-none text-sm rounded-xl" data-testid="input-edit-rx" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes (optional)</label>
        <Textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Additional clinical notes..." className="min-h-[40px] resize-none text-sm rounded-xl" data-testid="input-edit-notes" />
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onSave} disabled={saving} className="rounded-xl gap-1.5" data-testid="button-save-patient">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save
        </Button>
        <Button variant="outline" onClick={onCancel} className="rounded-xl gap-1.5" data-testid="button-cancel-edit">
          <X className="w-4 h-4" /> Cancel
        </Button>
      </div>
    </div>
  );
}

function ExpandedPatientDetail({
  patient,
  reasoning,
  tests,
}: {
  patient: PatientScreening;
  reasoning: Record<string, ReasoningValue>;
  tests: string[];
}) {
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
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Stethoscope className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dx (Diagnoses)</span>
          </div>
          <p className="text-sm whitespace-pre-wrap">{patient.diagnoses || "N/A"}</p>
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hx (History / PMH)</span>
          </div>
          <p className="text-sm whitespace-pre-wrap">{patient.history || "N/A"}</p>
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Pill className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Rx (Medications)</span>
          </div>
          <p className="text-sm whitespace-pre-wrap">{patient.medications || "N/A"}</p>
        </div>
      </div>

      {sortedCategories.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Qualifying Ancillaries</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sortedCategories.map((cat) => {
              const group = grouped[cat];
              const style = categoryStyles[cat];
              const IconComp = categoryIcons[cat];
              return (
                <div key={cat} className={`rounded-2xl border ${style.bg} ${style.border} p-4`} data-testid={`card-ancillary-${cat}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <IconComp className={`w-5 h-5 ${style.icon}`} />
                    <span className={`font-semibold text-sm ${style.accent}`}>{categoryLabels[cat]}</span>
                  </div>

                  {cat === "ultrasound" && group.tests.length > 1 && (
                    <div className="flex items-center gap-1.5 flex-wrap mb-3">
                      {group.tests.map((t) => (
                        <span key={t} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getBadgeColor(cat)}`}>{t}</span>
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
                          <div className="rounded-xl bg-background/60 dark:bg-background/30 p-3">
                            <div className="flex items-center gap-1.5 mb-1">
                              <GraduationCap className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Clinician Understanding</span>
                            </div>
                            <p className="text-xs leading-relaxed">{clinician}</p>
                          </div>
                          {talking && (
                            <div className="rounded-xl bg-background/60 dark:bg-background/30 p-3">
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
      )}
    </div>
  );
}
