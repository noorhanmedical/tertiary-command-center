import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  generateClinicianPDF,
  generatePlexusPDF,
  type ReasoningValue,
} from "@/lib/pdfGeneration";
import PdfPatientSelectDialog from "@/components/PdfPatientSelectDialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Building2, Check, ChevronDown, ChevronRight, Download, Loader2, Printer, Scan, Share2, Users2, X,
} from "lucide-react";
import type { PatientScreening, ScreeningBatch } from "@shared/schema";
import { StepTimeline } from "@/components/StepTimeline";
import { NotesPanelDrawer } from "@/components/NotesPanelDrawer";
import { QualificationReasoningDialog } from "@/features/schedule/QualificationReasoningDialog";
import { categoryIcons, categoryLabels, categoryStyles, getAncillaryCategory, getBadgeColor, isImagingTest, type AncillaryCategory } from "@/features/schedule/ancillaryMeta";

type ScreeningBatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

const APPOINTMENT_STATUSES = ["Completed", "No Show", "Rescheduled", "Scheduled Different Day", "Cancelled", "Pending"] as const;

function buildSharedScheduleUrl(batchId: number): string {
  return `${window.location.origin}/schedule/${batchId}`;
}

function ResultsHeaderActions({
  patients,
  shareButtonText,
  onShare,
  onExport,
  onClinicianPdf,
  onPlexusPdf,
}: {
  patients: PatientScreening[];
  shareButtonText: string;
  onShare: () => void;
  onExport: () => void;
  onClinicianPdf: () => void;
  onPlexusPdf: () => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button variant="outline" size="sm" onClick={onShare} className="gap-1.5 rounded-xl" data-testid="button-share">
        {shareButtonText === "Copied!" ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />} {shareButtonText}
      </Button>
      <Button variant="outline" size="sm" onClick={onExport} className="gap-1.5 rounded-xl" data-testid="button-export">
        <Download className="w-3.5 h-3.5" /> Export CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onClinicianPdf}
        className="gap-1.5 rounded-xl"
        data-testid="button-clinician-pdf"
        disabled={patients.length === 0}
      >
        <Printer className="w-3.5 h-3.5" /> Clinician PDF
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onPlexusPdf}
        className="gap-1.5 rounded-xl"
        data-testid="button-plexus-pdf"
        disabled={patients.length === 0}
      >
        <Users2 className="w-3.5 h-3.5" /> Plexus PDF
      </Button>
    </div>
  );
}

export function ResultsView({
  batch,
  patients,
  loading,
  onExport,
  onNavigate,
  expandedPatient,
  setExpandedPatient,
  expandedClinical,
  setExpandedClinical,
  selectedTestDetail,
  setSelectedTestDetail,
  onUpdatePatient,
}: {
  batch: ScreeningBatchWithPatients | undefined;
  patients: PatientScreening[];
  loading: boolean;
  onExport: () => void;
  onNavigate: (step: "home" | "build" | "results") => void;
  expandedPatient: number | null;
  setExpandedPatient: (id: number | null) => void;
  expandedClinical: number | null;
  setExpandedClinical: (id: number | null) => void;
  selectedTestDetail: { patientId: number; category: string; tests: string[]; reasoning: Record<string, ReasoningValue> } | null;
  setSelectedTestDetail: (v: { patientId: number; category: string; tests: string[]; reasoning: Record<string, ReasoningValue> } | null) => void;
  onUpdatePatient: (id: number, updates: Record<string, unknown>) => void;
}) {
  const { toast } = useToast();
  const [shareButtonText, setShareButtonText] = useState("Share");
  const [pdfMode, setPdfMode] = useState<"clinician" | "plexus" | null>(null);
  const [completeModalPatient, setCompleteModalPatient] = useState<PatientScreening | null>(null);

  const handleStatusChange = useCallback(async (patient: PatientScreening, newStatus: string) => {
    if (newStatus.toLowerCase() === "completed") {
      if ((patient.qualifyingTests || []).length === 0) {
        toast({ title: "No qualifying tests", description: "This patient has no qualifying tests to mark complete.", variant: "destructive" });
        return;
      }
      setCompleteModalPatient(patient);
      return;
    }
    onUpdatePatient(patient.id, { appointmentStatus: newStatus });
  }, [toast, onUpdatePatient, setCompleteModalPatient]);

  const handlePdfGenerate = useCallback((selected: PatientScreening[]) => {
    if (!batch) return;
    setPdfMode(null);
    if (pdfMode === "clinician") generateClinicianPDF(batch.name, selected, batch.scheduleDate, batch.createdAt);
    else if (pdfMode === "plexus") generatePlexusPDF(batch.name, selected, batch.scheduleDate, batch.createdAt);
  }, [batch, pdfMode]);

  const handleOpenClinicianPdf = useCallback(() => {
    setPdfMode("clinician");
  }, []);

  const handleOpenPlexusPdf = useCallback(() => {
    setPdfMode("plexus");
  }, []);

  const handleShare = useCallback(() => {
    if (!batch) return;
    const url = buildSharedScheduleUrl(batch.id);
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
              {batch?.clinicianName && (
                <p className="text-xs font-medium text-primary" data-testid="text-results-clinician">Dr. {batch.clinicianName}</p>
              )}
              {batch?.facility && (
                <p className="text-xs text-slate-600 flex items-center gap-1" data-testid="text-results-facility">
                  <Building2 className="w-3 h-3 inline" />
                  {batch.facility}
                </p>
              )}
              <p className="text-xs text-slate-900">{patients.length} patients screened</p>
            </div>
          </div>
          <ResultsHeaderActions
            patients={patients}
            shareButtonText={shareButtonText}
            onShare={handleShare}
            onExport={onExport}
            onClinicianPdf={handleOpenClinicianPdf}
            onPlexusPdf={handleOpenPlexusPdf}
          />
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
                          <span className="text-sm text-slate-900 font-medium shrink-0 mt-0.5 tabular-nums">{patient.time}</span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <p className="font-semibold text-base text-slate-900 truncate">{patient.name}</p>
                            <span className="text-xs text-slate-900">
                              {[patient.age && `${patient.age}yo`, patient.gender].filter(Boolean).join(" · ")}
                            </span>
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize cursor-pointer select-none ${
                                (patient.patientType || "visit") === "outreach"
                                  ? "bg-orange-100 text-orange-800"
                                  : "bg-teal-100 text-teal-800"
                              }`}
                              title="Click to toggle patient type"
                              onClick={(e) => {
                                e.stopPropagation();
                                const newType = (patient.patientType || "visit") === "visit" ? "outreach" : "visit";
                                onUpdatePatient(patient.id, { patientType: newType });
                              }}
                              data-testid={`badge-patient-type-${patient.id}`}
                            >
                              {patient.patientType || "visit"}
                            </span>
                          </div>
                          {(patient.diagnoses || patient.history || patient.medications || patient.previousTests) && (
                            <div
                              className="flex items-center gap-3 text-xs text-slate-900 cursor-pointer hover:text-slate-700 group mt-0.5 rounded-lg px-1 -ml-1 py-0.5 hover:bg-slate-100/70 transition-colors"
                              onClick={(e) => { e.stopPropagation(); setExpandedClinical(expandedClinical === patient.id ? null : patient.id); }}
                              data-testid={`button-expand-clinical-${patient.id}`}
                            >
                              {patient.diagnoses && (
                                <span className="truncate max-w-[200px]">
                                  <span className="font-semibold">Dx:</span> {patient.diagnoses}
                                </span>
                              )}
                              {patient.history && (
                                <span className="truncate max-w-[160px]">
                                  <span className="font-semibold">Hx:</span> {patient.history}
                                </span>
                              )}
                              {patient.medications && (
                                <span className="truncate max-w-[160px]">
                                  <span className="font-semibold">Rx:</span> {patient.medications}
                                </span>
                              )}
                              {patient.previousTests && (
                                <span className="truncate max-w-[160px]">
                                  <span className="font-semibold">Prev:</span> {patient.previousTests}
                                </span>
                              )}
                              {expandedClinical === patient.id
                                ? <ChevronDown className="w-3 h-3 text-slate-400 shrink-0 ml-auto" />
                                : <ChevronRight className="w-3 h-3 text-slate-400 shrink-0 ml-auto" />
                              }
                            </div>
                          )}
                          {expandedClinical === patient.id && (
                            <div
                              className="mt-2 rounded-xl bg-slate-50/80 border border-slate-200/70 px-4 py-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`panel-clinical-${patient.id}`}
                            >
                              {patient.diagnoses && (
                                <div>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Diagnoses</p>
                                  <p className="text-xs text-slate-900 leading-relaxed">{patient.diagnoses}</p>
                                </div>
                              )}
                              {patient.history && (
                                <div>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">History</p>
                                  <p className="text-xs text-slate-900 leading-relaxed">{patient.history}</p>
                                </div>
                              )}
                              {patient.medications && (
                                <div>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Medications</p>
                                  <p className="text-xs text-slate-900 leading-relaxed">{patient.medications}</p>
                                </div>
                              )}
                              {(patient.previousTests || patient.previousTestsDate) && (
                                <div>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Previous Tests</p>
                                  {patient.previousTests && <p className="text-xs text-slate-900 leading-relaxed">{patient.previousTests}</p>}
                                  {patient.previousTestsDate && <p className="text-xs text-amber-700 font-medium mt-0.5">Date: {patient.previousTestsDate}</p>}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="flex items-center gap-2">
                          <select
                            className="text-[10px] border border-slate-200 rounded-lg px-2 py-0.5 bg-white font-medium cursor-pointer capitalize focus:outline-none focus:ring-1 focus:ring-primary"
                            value={patient.appointmentStatus || "pending"}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleStatusChange(patient, e.target.value);
                            }}
                            data-testid={`select-appointment-status-${patient.id}`}
                          >
                            {APPOINTMENT_STATUSES.map((s) => (
                              <option key={s} value={s.toLowerCase()}>{s}</option>
                            ))}
                          </select>
                          {allTests.length > 0 && (
                            isExpanded
                              ? <ChevronDown className="w-4 h-4 text-slate-400 transition-transform" />
                              : <ChevronRight className="w-4 h-4 text-slate-400 transition-transform" />
                          )}
                        </div>
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
                      </div>
                    </div>
                  </div>

                  {isExpanded && allTests.length > 0 && (
                    <div className="border-t border-slate-100 bg-slate-50/60 p-5" data-testid={`row-expanded-${patient.id}`}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-base text-slate-900">{patient.name} — Ancillary Details</h3>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setExpandedPatient(null); }} data-testid="button-close-detail">
                          <X className="w-4 h-4 text-slate-400" />
                        </Button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {(() => {
                          const grouped: Record<string, string[]> = {};
                          for (const test of allTests) {
                            const cat = getAncillaryCategory(test);
                            if (!grouped[cat]) grouped[cat] = [];
                            grouped[cat].push(test);
                          }
                          return ["brainwave", "vitalwave", "ultrasound", "other"].filter((c) => grouped[c]).map((cat) => {
                            const tests = grouped[cat];
                            const style = categoryStyles[cat as AncillaryCategory];
                            const IconComp = categoryIcons[cat as AncillaryCategory];
                            return (
                              <button
                                key={cat}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTestDetail({ patientId: patient.id, category: cat, tests, reasoning });
                                }}
                                className={`flex items-center gap-2 rounded-xl ${style.bg} border ${style.border} px-4 py-3 hover:shadow-md transition-shadow cursor-pointer text-left`}
                                data-testid={`card-ancillary-${cat}-${patient.id}`}
                              >
                                <IconComp className={`w-4 h-4 ${style.icon} shrink-0`} />
                                <span className={`font-semibold text-sm ${style.accent}`}>{categoryLabels[cat as AncillaryCategory]}</span>
                                {tests.length > 1 && (
                                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${getBadgeColor(cat)}`}>{tests.length}</span>
                                )}
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400 ml-1 shrink-0" />
                              </button>
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

      <QualificationReasoningDialog
        selectedTestDetail={selectedTestDetail}
        setSelectedTestDetail={setSelectedTestDetail}
      />

      <PdfPatientSelectDialog
        open={pdfMode !== null}
        mode={pdfMode}
        patients={patients}
        onClose={() => setPdfMode(null)}
        onGenerate={handlePdfGenerate}
      />

      <NotesPanelDrawer
        batch={batch}
        onUpdatePatient={onUpdatePatient}
        completeModalPatient={completeModalPatient}
        setCompleteModalPatient={setCompleteModalPatient}
      />
    </div>
  );
}
