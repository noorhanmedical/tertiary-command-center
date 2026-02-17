import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  Clock,
  User,
  Stethoscope,
  Pill,
  Heart,
  Zap,
  AlertCircle,
  Check,
  History,
  Trash2,
} from "lucide-react";
import type { ScreeningBatch, PatientScreening } from "@shared/schema";

type ScreeningBatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

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
      toast({ title: "Screening complete", description: `${data.patientCount} patients screened successfully.` });
    },
    onError: (err: Error) => {
      toast({ title: "Screening failed", description: err.message, variant: "destructive" });
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
      toast({ title: "Screening complete", description: `${data.patientCount} patients screened successfully.` });
    },
    onError: (err: Error) => {
      toast({ title: "Screening failed", description: err.message, variant: "destructive" });
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

  const getTestIcon = (test: string) => {
    const lower = test.toLowerCase();
    if (lower.includes("brain")) return <Brain className="w-3 h-3" />;
    if (lower.includes("vital")) return <Activity className="w-3 h-3" />;
    if (lower.includes("echo")) return <Heart className="w-3 h-3" />;
    return <Scan className="w-3 h-3" />;
  };

  const getTestColor = (test: string): string => {
    const lower = test.toLowerCase();
    if (lower.includes("brain")) return "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300";
    if (lower.includes("vital")) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
    if (lower.includes("carotid")) return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
    if (lower.includes("echo")) return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300";
    if (lower.includes("renal")) return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
    if (lower.includes("aorta") || lower.includes("aaa")) return "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300";
    if (lower.includes("thyroid")) return "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300";
    if (lower.includes("venous") || lower.includes("dvt") || lower.includes("arterial")) return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300";
    return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-primary flex items-center justify-center">
              <Stethoscope className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight" data-testid="text-app-title">
                Ancillary Screening
              </h1>
              <p className="text-xs text-muted-foreground">AI-Powered Patient Qualification</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs gap-1">
              <Zap className="w-3 h-3" /> GPT-5.2 Powered
            </Badge>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="upload" data-testid="tab-upload" className="gap-1.5">
              <Upload className="w-4 h-4" /> Upload Patients
            </TabsTrigger>
            <TabsTrigger value="results" data-testid="tab-results" className="gap-1.5">
              <FileText className="w-4 h-4" /> Results
              {batches.length > 0 && (
                <span className="ml-1 text-xs bg-muted rounded-full px-1.5">{batches.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history" className="gap-1.5">
              <History className="w-4 h-4" /> History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <FileSpreadsheet className="w-5 h-5 text-muted-foreground" />
                  <h2 className="font-semibold">Upload Files</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Upload patient schedules, medical histories, medications, and notes. Supports Excel, CSV, and text files.
                </p>
                <div
                  className={`border-2 border-dashed rounded-md p-8 text-center transition-colors cursor-pointer ${
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
                  {isProcessing ? (
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-10 h-10 text-primary animate-spin" />
                      <p className="text-sm font-medium">Screening patients with AI...</p>
                      <p className="text-xs text-muted-foreground">This may take a moment for thorough analysis</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <Upload className="w-10 h-10 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">Drop files here or click to browse</p>
                        <p className="text-xs text-muted-foreground mt-1">.xlsx, .csv, .txt supported</p>
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <ClipboardPaste className="w-5 h-5 text-muted-foreground" />
                  <h2 className="font-semibold">Paste Free Text</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Paste patient schedules, clinical notes, EHR exports, or any medical text directly.
                </p>
                <Textarea
                  placeholder="Paste patient information here... Schedules, PMH, medications, clinical notes - any format works."
                  className="min-h-[180px] resize-none text-sm"
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  data-testid="input-freetext"
                />
                <Button
                  className="w-full mt-3 gap-2"
                  onClick={() => textMutation.mutate(freeText)}
                  disabled={!freeText.trim() || isProcessing}
                  data-testid="button-screen-text"
                >
                  {textMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Brain className="w-4 h-4" />
                  )}
                  Screen Patients
                </Button>
              </Card>
            </div>

            <Card className="p-6">
              <h3 className="font-semibold mb-3">What We Screen For</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {[
                  { name: "BrainWave (EEG)", icon: Brain, desc: "Neurological evaluation" },
                  { name: "VitalWave (ABI)", icon: Activity, desc: "Peripheral artery screening" },
                  { name: "Carotid Ultrasound", icon: Scan, desc: "Stroke risk assessment" },
                  { name: "Echocardiogram", icon: Heart, desc: "Cardiac function" },
                  { name: "Renal Artery US", icon: Scan, desc: "Renovascular disease" },
                  { name: "AAA Ultrasound", icon: Scan, desc: "Aortic aneurysm screening" },
                  { name: "Thyroid Ultrasound", icon: Scan, desc: "Thyroid evaluation" },
                  { name: "Venous/Arterial US", icon: Scan, desc: "DVT & PAD assessment" },
                ].map((test) => (
                  <div key={test.name} className="flex items-start gap-2 p-3 rounded-md bg-muted/50">
                    <test.icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium leading-tight">{test.name}</p>
                      <p className="text-xs text-muted-foreground">{test.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="results">
            {selectedBatch ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <h2 className="font-semibold text-lg" data-testid="text-batch-name">{selectedBatch.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {selectedBatch.patients?.length || 0} patients screened
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleExport} data-testid="button-export">
                      <Download className="w-4 h-4 mr-1.5" /> Export CSV
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedBatchId(null)}
                      data-testid="button-back"
                    >
                      Back to list
                    </Button>
                  </div>
                </div>

                {batchLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedBatch.patients?.map((patient) => (
                      <PatientCard
                        key={patient.id}
                        patient={patient}
                        expanded={expandedPatient === patient.id}
                        onToggle={() => setExpandedPatient(expandedPatient === patient.id ? null : patient.id)}
                        getTestIcon={getTestIcon}
                        getTestColor={getTestColor}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-16">
                <Scan className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="font-semibold text-lg mb-1">No batch selected</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Upload patient data or select a batch from history to view results.
                </p>
                <Button variant="outline" onClick={() => setActiveTab("upload")} data-testid="button-go-upload">
                  <Upload className="w-4 h-4 mr-1.5" /> Upload Patients
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history">
            {batchesLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
            ) : batches.length === 0 ? (
              <div className="text-center py-16">
                <History className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="font-semibold text-lg mb-1">No screening history</h3>
                <p className="text-sm text-muted-foreground">
                  Your screening results will appear here after you upload patient data.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {batches.map((batch) => (
                  <Card
                    key={batch.id}
                    className="p-4 hover-elevate cursor-pointer"
                    onClick={() => {
                      setSelectedBatchId(batch.id);
                      setActiveTab("results");
                    }}
                    data-testid={`card-batch-${batch.id}`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{batch.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {batch.patientCount} patients
                            {batch.createdAt && ` \u00B7 ${new Date(batch.createdAt).toLocaleDateString()}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
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

function PatientCard({
  patient,
  expanded,
  onToggle,
  getTestIcon,
  getTestColor,
}: {
  patient: PatientScreening;
  expanded: boolean;
  onToggle: () => void;
  getTestIcon: (test: string) => JSX.Element;
  getTestColor: (test: string) => string;
}) {
  const tests = patient.qualifyingTests || [];
  const reasoning = (patient.reasoning || {}) as Record<string, string>;

  return (
    <Card className="overflow-visible" data-testid={`card-patient-${patient.id}`}>
      <div
        className="p-4 cursor-pointer hover-elevate"
        onClick={onToggle}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-sm" data-testid={`text-patient-name-${patient.id}`}>
                  {patient.name}
                </h3>
                {patient.time && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {patient.time}
                  </span>
                )}
                {patient.age && (
                  <span className="text-xs text-muted-foreground">
                    {patient.age}yo
                  </span>
                )}
                {patient.gender && (
                  <span className="text-xs text-muted-foreground">{patient.gender}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {tests.length > 0 ? (
                  tests.map((test) => (
                    <Tooltip key={test}>
                      <TooltipTrigger asChild>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${getTestColor(test)}`}>
                          {getTestIcon(test)}
                          {test}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs">
                        <p className="text-xs">{reasoning[test] || "Qualified based on clinical findings"}</p>
                      </TooltipContent>
                    </Tooltip>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> No qualifying tests identified
                  </span>
                )}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="shrink-0">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4">
          <Separator className="mb-4" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {patient.diagnoses && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Stethoscope className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Diagnoses</span>
                </div>
                <p className="text-sm leading-relaxed">{patient.diagnoses}</p>
              </div>
            )}
            {patient.history && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">History</span>
                </div>
                <ScrollArea className="max-h-40">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{patient.history}</p>
                </ScrollArea>
              </div>
            )}
            {patient.medications && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Pill className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Medications</span>
                </div>
                <p className="text-sm leading-relaxed">{patient.medications}</p>
              </div>
            )}
            {patient.notes && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <ClipboardPaste className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes</span>
                </div>
                <ScrollArea className="max-h-40">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{patient.notes}</p>
                </ScrollArea>
              </div>
            )}
          </div>

          {Object.keys(reasoning).length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Brain className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">AI Reasoning</span>
              </div>
              <div className="space-y-2">
                {Object.entries(reasoning).map(([test, reason]) => (
                  <div key={test} className="flex items-start gap-2 text-sm">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium shrink-0 ${getTestColor(test)}`}>
                      {getTestIcon(test)} {test}
                    </span>
                    <span className="text-muted-foreground">{reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
