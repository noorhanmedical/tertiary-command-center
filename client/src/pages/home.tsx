import { useState, useCallback, Fragment } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  Heart,
  Zap,
  Check,
  History,
  Trash2,
  Search,
  MessageCircle,
  GraduationCap,
} from "lucide-react";
import type { ScreeningBatch, PatientScreening } from "@shared/schema";

type ScreeningBatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

type ReasoningValue = string | { clinician_understanding: string; patient_talking_points: string };

const ULTRASOUND_TESTS = ["carotid", "echo", "renal", "aaa", "aorta", "thyroid", "venous", "arterial", "dvt", "duplex"];

function isUltrasound(test: string): boolean {
  const lower = test.toLowerCase();
  return ULTRASOUND_TESTS.some((u) => lower.includes(u));
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
  brainwave: {
    bg: "bg-violet-50 dark:bg-violet-950/30",
    border: "border-violet-200 dark:border-violet-800",
    accent: "text-violet-700 dark:text-violet-300",
    icon: "text-violet-500 dark:text-violet-400",
  },
  vitalwave: {
    bg: "bg-red-50 dark:bg-red-950/30",
    border: "border-red-200 dark:border-red-800",
    accent: "text-red-700 dark:text-red-300",
    icon: "text-red-500 dark:text-red-400",
  },
  ultrasound: {
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    border: "border-emerald-200 dark:border-emerald-800",
    accent: "text-emerald-700 dark:text-emerald-300",
    icon: "text-emerald-500 dark:text-emerald-400",
  },
  fibroscan: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-800",
    accent: "text-amber-700 dark:text-amber-300",
    icon: "text-amber-500 dark:text-amber-400",
  },
  other: {
    bg: "bg-slate-50 dark:bg-slate-950/30",
    border: "border-slate-200 dark:border-slate-800",
    accent: "text-slate-700 dark:text-slate-300",
    icon: "text-slate-500 dark:text-slate-400",
  },
};

const categoryLabels: Record<string, string> = {
  brainwave: "BrainWave",
  vitalwave: "VitalWave",
  ultrasound: "Ultrasound Studies",
  fibroscan: "FibroScan",
  other: "Other",
};

const categoryIcons: Record<string, typeof Brain> = {
  brainwave: Brain,
  vitalwave: Activity,
  ultrasound: Scan,
  fibroscan: Scan,
  other: Scan,
};

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
  const [activeTab, setActiveTab] = useState("upload");
  const [freeText, setFreeText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [expandedPatient, setExpandedPatient] = useState<number | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: batches = [], isLoading: batchesLoading } = useQuery<ScreeningBatchWithPatients[]>({
    queryKey: ["/api/screening-batches"],
  });

  const { data: selectedBatch, isLoading: batchLoading } = useQuery<ScreeningBatchWithPatients>({
    queryKey: ["/api/screening-batches", selectedBatchId],
    enabled: !!selectedBatchId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/api/screen-patients", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      setSelectedBatchId(data.batchId);
      setActiveTab("results");
      toast({ title: "Analysis complete", description: `${data.patientCount} patients analyzed.` });
    },
    onError: (err: Error) => {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const textMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", "/api/screen-patients-text", { text });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      setSelectedBatchId(data.batchId);
      setActiveTab("results");
      setFreeText("");
      toast({ title: "Analysis complete", description: `${data.patientCount} patients analyzed.` });
    },
    onError: (err: Error) => {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/screening-batches/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      if (selectedBatchId) setSelectedBatchId(null);
      toast({ title: "Batch deleted" });
    },
  });

  const handleFileUpload = useCallback(
    (files: FileList | File[]) => {
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append("files", file));
      uploadMutation.mutate(formData);
    },
    [uploadMutation]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        handleFileUpload(e.dataTransfer.files);
      }
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

  const isProcessing = uploadMutation.isPending || textMutation.isPending;

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
              <p className="text-xs text-muted-foreground">Analyze Dx, PMH & Rx for Ancillary Qualification</p>
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
            <TabsTrigger value="upload" data-testid="tab-upload" className="gap-1.5 rounded-full">
              <Upload className="w-4 h-4" /> Upload
            </TabsTrigger>
            <TabsTrigger value="results" data-testid="tab-results" className="gap-1.5 rounded-full">
              <FileText className="w-4 h-4" /> Schedule
              {batches.length > 0 && (
                <span className="ml-1 text-xs bg-muted rounded-full px-2 py-0.5">{batches.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history" className="gap-1.5 rounded-full">
              <History className="w-4 h-4" /> History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6 rounded-2xl">
                <div className="flex items-center gap-2.5 mb-4">
                  <FileSpreadsheet className="w-5 h-5 text-muted-foreground" />
                  <h2 className="font-semibold text-base">Upload Schedule / Patient Data</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-5">
                  Upload patient schedules with Dx, PMH, and medications. Supports Excel, CSV, and text files.
                </p>
                <div
                  className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${
                    dragOver ? "border-primary bg-primary/5 scale-[1.01]" : "border-border"
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
                  {isProcessing ? (
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-10 h-10 text-muted-foreground animate-spin" />
                      <p className="text-sm font-medium">Analyzing patients...</p>
                      <p className="text-xs text-muted-foreground">Reviewing Dx, PMH & Rx</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
                        <Upload className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Drop files here or tap to browse</p>
                        <p className="text-xs text-muted-foreground mt-1">.xlsx, .csv, .txt</p>
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              <Card className="p-6 rounded-2xl">
                <div className="flex items-center gap-2.5 mb-4">
                  <ClipboardPaste className="w-5 h-5 text-muted-foreground" />
                  <h2 className="font-semibold text-base">Paste Patient Data</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-5">
                  Paste schedules, clinical notes, or EHR exports with diagnoses, history, and medications.
                </p>
                <Textarea
                  placeholder={"Paste patient schedule here...\nInclude: Dx, PMH, medications, clinical notes"}
                  className="min-h-[180px] resize-none text-sm rounded-xl"
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  data-testid="input-freetext"
                />
                <Button
                  className="w-full mt-4 gap-2 rounded-xl"
                  onClick={() => textMutation.mutate(freeText)}
                  disabled={!freeText.trim() || isProcessing}
                  data-testid="button-analyze-text"
                >
                  {textMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  Analyze for Ancillaries
                </Button>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="results">
            {selectedBatch ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <h2 className="font-bold text-lg tracking-tight" data-testid="text-batch-name">{selectedBatch.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {selectedBatch.patients?.length || 0} patients
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleExport} className="rounded-full gap-1.5" data-testid="button-export">
                      <Download className="w-4 h-4" /> Export CSV
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedBatchId(null)}
                      className="rounded-full"
                      data-testid="button-back"
                    >
                      Back
                    </Button>
                  </div>
                </div>

                {batchLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
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
                            <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Qualifying Tests</th>
                            <th className="px-3 py-3 w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedBatch.patients?.map((patient) => {
                            const isExpanded = expandedPatient === patient.id;
                            const tests = patient.qualifyingTests || [];
                            const reasoning = (patient.reasoning || {}) as Record<string, ReasoningValue>;
                            return (
                              <Fragment key={patient.id}>
                                <tr
                                  className="border-b cursor-pointer hover-elevate transition-colors"
                                  onClick={() => setExpandedPatient(isExpanded ? null : patient.id)}
                                  data-testid={`row-patient-${patient.id}`}
                                >
                                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground" data-testid={`text-time-${patient.id}`}>
                                    {patient.time || "--"}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap font-semibold" data-testid={`text-name-${patient.id}`}>
                                    {patient.name}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap" data-testid={`text-age-${patient.id}`}>
                                    {patient.age || "--"}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap" data-testid={`text-gender-${patient.id}`}>
                                    {patient.gender || "--"}
                                  </td>
                                  <td className="px-4 py-3 max-w-[180px]" data-testid={`text-dx-${patient.id}`}>
                                    <span className="line-clamp-2 text-xs">{truncate(patient.diagnoses, 80)}</span>
                                  </td>
                                  <td className="px-4 py-3 max-w-[180px]" data-testid={`text-hx-${patient.id}`}>
                                    <span className="line-clamp-2 text-xs">{truncate(patient.history, 80)}</span>
                                  </td>
                                  <td className="px-4 py-3 max-w-[160px]" data-testid={`text-rx-${patient.id}`}>
                                    <span className="line-clamp-2 text-xs">{truncate(patient.medications, 60)}</span>
                                  </td>
                                  <td className="px-4 py-3" data-testid={`text-tests-${patient.id}`}>
                                    <div className="flex items-center gap-1 flex-wrap">
                                      {tests.length > 0 ? (
                                        tests.map((test) => {
                                          const cat = getAncillaryCategory(test);
                                          return (
                                            <span key={test} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${getBadgeColor(cat)}`}>
                                              {test}
                                            </span>
                                          );
                                        })
                                      ) : (
                                        <span className="text-xs text-muted-foreground">None</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    {isExpanded ? (
                                      <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                    )}
                                  </td>
                                </tr>
                                {isExpanded && (
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
              </div>
            ) : (
              <div className="text-center py-20">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                  <Scan className="w-7 h-7 text-muted-foreground" />
                </div>
                <h3 className="font-semibold text-lg mb-1">No schedule loaded</h3>
                <p className="text-sm text-muted-foreground mb-5">
                  Upload patient data or select a batch from history.
                </p>
                <Button variant="outline" onClick={() => setActiveTab("upload")} className="rounded-full gap-1.5" data-testid="button-go-upload">
                  <Upload className="w-4 h-4" /> Upload Patients
                </Button>
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
                <h3 className="font-semibold text-lg mb-1">No screening history</h3>
                <p className="text-sm text-muted-foreground">
                  Results will appear here after you analyze patient data.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {batches.map((batch) => (
                  <Card
                    key={batch.id}
                    className="p-4 rounded-2xl hover-elevate cursor-pointer overflow-visible"
                    onClick={() => {
                      setSelectedBatchId(batch.id);
                      setActiveTab("results");
                    }}
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
                        <Badge variant="outline" className="text-xs rounded-full">
                          {batch.status === "completed" ? (
                            <><Check className="w-3 h-3 mr-1" /> Complete</>
                          ) : (
                            <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Processing</>
                          )}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMutation.mutate(batch.id);
                          }}
                          data-testid={`button-delete-batch-${batch.id}`}
                        >
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
                <div
                  key={cat}
                  className={`rounded-2xl border ${style.bg} ${style.border} p-4`}
                  data-testid={`card-ancillary-${cat}`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <IconComp className={`w-5 h-5 ${style.icon}`} />
                    <span className={`font-semibold text-sm ${style.accent}`}>
                      {categoryLabels[cat]}
                    </span>
                  </div>

                  {cat === "ultrasound" && group.tests.length > 1 && (
                    <div className="flex items-center gap-1.5 flex-wrap mb-3">
                      {group.tests.map((t) => (
                        <span key={t} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getBadgeColor(cat)}`}>
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  {Object.entries(group.reasonings).map(([test, reason]) => {
                    const clinician = typeof reason === "string" ? reason : reason.clinician_understanding;
                    const talking = typeof reason === "string" ? null : reason.patient_talking_points;

                    return (
                      <div key={test} className="mb-3 last:mb-0">
                        {(cat === "ultrasound" && group.tests.length > 1) && (
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
