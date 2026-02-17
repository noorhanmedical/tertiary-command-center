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
      toast({ title: "Analysis complete", description: `${data.patientCount} patients analyzed for ancillary qualifications.` });
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
      toast({ title: "Analysis complete", description: `${data.patientCount} patients analyzed for ancillary qualifications.` });
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
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-primary flex items-center justify-center">
              <Stethoscope className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight" data-testid="text-app-title">
                Ancillary Screening
              </h1>
              <p className="text-xs text-muted-foreground">Analyze Dx, PMH & Rx for Ancillary Qualification</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs gap-1">
              <Zap className="w-3 h-3" /> GPT-5.2
            </Badge>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="upload" data-testid="tab-upload" className="gap-1.5">
              <Upload className="w-4 h-4" /> Upload
            </TabsTrigger>
            <TabsTrigger value="results" data-testid="tab-results" className="gap-1.5">
              <FileText className="w-4 h-4" /> Schedule
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
                  <h2 className="font-semibold">Upload Schedule / Patient Data</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Upload patient schedules with Dx, PMH, and medications. Supports Excel, CSV, and text files.
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
                      <Loader2 className="w-10 h-10 text-muted-foreground animate-spin" />
                      <p className="text-sm font-medium">Analyzing patients for ancillary qualifications...</p>
                      <p className="text-xs text-muted-foreground">Reviewing Dx, PMH & Rx for each patient</p>
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
                  <h2 className="font-semibold">Paste Patient Data</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Paste schedules, clinical notes, EHR exports with diagnoses, history, and medications.
                </p>
                <Textarea
                  placeholder={"Paste patient schedule here...\nInclude: Dx, PMH, medications, clinical notes"}
                  className="min-h-[180px] resize-none text-sm"
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  data-testid="input-freetext"
                />
                <Button
                  className="w-full mt-3 gap-2"
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
                    <h2 className="font-semibold text-lg" data-testid="text-batch-name">{selectedBatch.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {selectedBatch.patients?.length || 0} patients
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
                      Back
                    </Button>
                  </div>
                </div>

                {batchLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <Card className="overflow-visible">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" data-testid="table-schedule">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Time</th>
                            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Name</th>
                            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Age</th>
                            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Gender</th>
                            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Dx</th>
                            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Hx</th>
                            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Rx</th>
                            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Qualifying Tests</th>
                            <th className="px-3 py-2.5 w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedBatch.patients?.map((patient) => {
                            const isExpanded = expandedPatient === patient.id;
                            const tests = patient.qualifyingTests || [];
                            const reasoning = (patient.reasoning || {}) as Record<string, string>;
                            return (
                              <Fragment key={patient.id}>
                                <tr
                                  className="border-b cursor-pointer hover-elevate transition-colors"
                                  onClick={() => setExpandedPatient(isExpanded ? null : patient.id)}
                                  data-testid={`row-patient-${patient.id}`}
                                >
                                  <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground" data-testid={`text-time-${patient.id}`}>
                                    {patient.time || "--"}
                                  </td>
                                  <td className="px-3 py-2.5 whitespace-nowrap font-medium" data-testid={`text-name-${patient.id}`}>
                                    {patient.name}
                                  </td>
                                  <td className="px-3 py-2.5 whitespace-nowrap" data-testid={`text-age-${patient.id}`}>
                                    {patient.age || "--"}
                                  </td>
                                  <td className="px-3 py-2.5 whitespace-nowrap" data-testid={`text-gender-${patient.id}`}>
                                    {patient.gender || "--"}
                                  </td>
                                  <td className="px-3 py-2.5 max-w-[180px]" data-testid={`text-dx-${patient.id}`}>
                                    <span className="line-clamp-2 text-xs">{truncate(patient.diagnoses, 80)}</span>
                                  </td>
                                  <td className="px-3 py-2.5 max-w-[180px]" data-testid={`text-hx-${patient.id}`}>
                                    <span className="line-clamp-2 text-xs">{truncate(patient.history, 80)}</span>
                                  </td>
                                  <td className="px-3 py-2.5 max-w-[160px]" data-testid={`text-rx-${patient.id}`}>
                                    <span className="line-clamp-2 text-xs">{truncate(patient.medications, 60)}</span>
                                  </td>
                                  <td className="px-3 py-2.5" data-testid={`text-tests-${patient.id}`}>
                                    <div className="flex items-center gap-1 flex-wrap">
                                      {tests.length > 0 ? (
                                        tests.map((test) => (
                                          <Badge key={test} variant="secondary" className="text-[10px] leading-tight px-1.5 py-0.5 whitespace-nowrap">
                                            {test}
                                          </Badge>
                                        ))
                                      ) : (
                                        <span className="text-xs text-muted-foreground">None</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5 text-center">
                                    {isExpanded ? (
                                      <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                    )}
                                  </td>
                                </tr>
                                {isExpanded && (
                                  <tr data-testid={`row-detail-${patient.id}`}>
                                    <td colSpan={9} className="bg-muted/30 px-4 py-4 border-b">
                                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                        <div>
                                          <div className="flex items-center gap-1.5 mb-1">
                                            <Stethoscope className="w-3.5 h-3.5 text-muted-foreground" />
                                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dx (Diagnoses)</span>
                                          </div>
                                          <p className="text-sm whitespace-pre-wrap">{patient.diagnoses || "N/A"}</p>
                                        </div>
                                        <div>
                                          <div className="flex items-center gap-1.5 mb-1">
                                            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hx (History / PMH)</span>
                                          </div>
                                          <p className="text-sm whitespace-pre-wrap">{patient.history || "N/A"}</p>
                                        </div>
                                        <div>
                                          <div className="flex items-center gap-1.5 mb-1">
                                            <Pill className="w-3.5 h-3.5 text-muted-foreground" />
                                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Rx (Medications)</span>
                                          </div>
                                          <p className="text-sm whitespace-pre-wrap">{patient.medications || "N/A"}</p>
                                        </div>
                                      </div>
                                      {patient.notes && (
                                        <div className="mb-4">
                                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes</span>
                                          <p className="text-sm whitespace-pre-wrap mt-1">{patient.notes}</p>
                                        </div>
                                      )}
                                      {Object.keys(reasoning).length > 0 && (
                                        <div>
                                          <div className="flex items-center gap-1.5 mb-2">
                                            <Brain className="w-3.5 h-3.5 text-muted-foreground" />
                                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI Qualification Reasoning</span>
                                          </div>
                                          <div className="space-y-1.5">
                                            {Object.entries(reasoning).map(([test, reason]) => (
                                              <div key={test} className="flex items-start gap-2 text-sm">
                                                <Badge variant="secondary" className="text-[10px] leading-tight px-1.5 py-0.5 whitespace-nowrap shrink-0 mt-0.5">
                                                  {test}
                                                </Badge>
                                                <span className="text-muted-foreground text-xs">{reason}</span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
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
              <div className="text-center py-16">
                <Scan className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="font-semibold text-lg mb-1">No schedule loaded</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Upload patient data or select a batch from history to view the schedule.
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
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : batches.length === 0 ? (
              <div className="text-center py-16">
                <History className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
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
                    className="p-4 hover-elevate cursor-pointer overflow-visible"
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
                            {batch.createdAt && ` · ${new Date(batch.createdAt).toLocaleDateString()}`}
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
