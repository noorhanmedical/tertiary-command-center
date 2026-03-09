import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Brain,
  Activity,
  Scan,
  ChevronDown,
  ChevronRight,
  GraduationCap,
  MessageCircle,
  Stethoscope,
  X,
  Download,
} from "lucide-react";
import type { PatientScreening } from "@shared/schema";

type ReasoningValue = string | { clinician_understanding: string; patient_talking_points: string; confidence?: "high" | "medium" | "low"; qualifying_factors?: string[] };

const ULTRASOUND_TESTS = ["carotid", "echo", "stress", "venous", "duplex", "renal", "arterial", "aortic", "aneurysm", "aaa", "93880", "93306", "93975", "93925", "93930", "93978", "93350", "93971", "93970"];

function getAncillaryCategory(test: string): "brainwave" | "vitalwave" | "ultrasound" | "other" {
  const lower = test.toLowerCase();
  if (lower.includes("brain")) return "brainwave";
  if (lower.includes("vital")) return "vitalwave";
  if (ULTRASOUND_TESTS.some((u) => lower.includes(u))) return "ultrasound";
  return "other";
}

function isImagingTest(test: string): boolean {
  return getAncillaryCategory(test) === "ultrasound";
}

const categoryStyles: Record<string, { bg: string; border: string; accent: string; icon: string }> = {
  brainwave: { bg: "bg-violet-50/80", border: "border-violet-200/60", accent: "text-violet-700", icon: "text-violet-500" },
  vitalwave: { bg: "bg-red-50/80", border: "border-red-200/60", accent: "text-red-700", icon: "text-red-500" },
  ultrasound: { bg: "bg-emerald-50/80", border: "border-emerald-200/60", accent: "text-emerald-700", icon: "text-emerald-500" },
  other: { bg: "bg-slate-50/80", border: "border-slate-200/60", accent: "text-slate-700", icon: "text-slate-500" },
};

const categoryLabels: Record<string, string> = { brainwave: "BrainWave", vitalwave: "VitalWave", ultrasound: "Ultrasound Studies", other: "Other" };
const categoryIcons: Record<string, typeof Brain> = { brainwave: Brain, vitalwave: Activity, ultrasound: Scan, other: Scan };

function getBadgeColor(cat: string): string {
  switch (cat) {
    case "brainwave": return "bg-violet-100 text-violet-800";
    case "vitalwave": return "bg-red-100 text-red-800";
    case "ultrasound": return "bg-emerald-100 text-emerald-800";
    default: return "bg-slate-100 text-slate-800";
  }
}

export default function SharedSchedule() {
  const [, params] = useRoute("/schedule/:id");
  const batchId = params?.id ? parseInt(params.id) : null;
  const [expandedPatient, setExpandedPatient] = useState<number | null>(null);

  const { data: batchData, isLoading } = useQuery<any>({
    queryKey: ["/api/screening-batches", batchId],
    enabled: !!batchId,
  });

  const batch = batchData;
  const patients: PatientScreening[] = batchData?.patients || [];

  const handleExport = async () => {
    if (!batchId) return;
    const res = await fetch(`/api/screening-batches/${batchId}/export`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `screening-results-${batchId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <Stethoscope className="w-14 h-14 text-slate-300 mx-auto mb-5" />
          <h2 className="text-xl font-bold text-slate-900" data-testid="text-not-found">Schedule not found</h2>
          <p className="text-sm text-slate-600 mt-2">This schedule may have been deleted or the link is invalid.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-[#1a365d] sticky top-0 z-50">
        <div className="w-full px-[5%] md:px-[10%] lg:px-[15%] py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-2.5 bg-white/10 rounded-xl">
                <Stethoscope className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-xs text-blue-200/70 font-medium tracking-wider uppercase mb-0.5">Plexus Ancillary Screening</p>
                <h1 className="text-lg font-bold text-white tracking-tight" data-testid="text-shared-schedule-title">{batch.name}</h1>
                <p className="text-sm text-blue-200/80 mt-0.5" data-testid="text-shared-patient-count">{patients.length} patients screened</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              className="gap-2 bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white rounded-xl"
              data-testid="button-export-shared"
            >
              <Download className="w-4 h-4" /> Export CSV
            </Button>
          </div>
        </div>
      </header>

      <main className="w-full px-[5%] md:px-[10%] lg:px-[15%] py-8">
        <div className="space-y-3" data-testid="shared-schedule-list">
          {patients.map((patient) => {
            const allTests = patient.qualifyingTests || [];
            const reasoning = (patient.reasoning || {}) as Record<string, ReasoningValue>;
            const qualTests = allTests.filter((t) => !isImagingTest(t));
            const qualImaging = allTests.filter((t) => isImagingTest(t));
            const isExpanded = expandedPatient === patient.id;

            return (
              <Card
                key={patient.id}
                className={`rounded-2xl border shadow-sm bg-white overflow-hidden transition-all duration-200 ${isExpanded ? "border-slate-300 shadow-md" : "border-slate-200/60 hover:shadow-md hover:border-slate-200"}`}
                data-testid={`shared-row-${patient.id}`}
              >
                <div
                  className={`px-5 py-3.5 cursor-pointer transition-colors ${isExpanded ? "bg-slate-50/80" : "hover:bg-slate-50/40"}`}
                  onClick={() => setExpandedPatient(isExpanded ? null : patient.id)}
                  data-testid={`button-expand-${patient.id}`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                      {patient.time && (
                        <span className="text-sm text-slate-500 font-medium shrink-0 tabular-nums w-[72px]" data-testid={`text-time-${patient.id}`}>{patient.time}</span>
                      )}
                      <p className="font-semibold text-base text-slate-900 truncate shrink-0 max-w-[240px]" data-testid={`text-name-${patient.id}`}>{patient.name}</p>
                      <span className="text-xs text-slate-500 shrink-0">
                        {[patient.age && `${patient.age}yo`, patient.gender].filter(Boolean).join(" · ")}
                      </span>
                      <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 min-w-0 flex-1 overflow-hidden">
                        {patient.diagnoses && (
                          <span className="truncate" title={patient.diagnoses}>
                            <span className="font-semibold text-slate-700">Dx:</span> {patient.diagnoses}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {qualTests.map((test) => (
                          <span key={test} className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${getBadgeColor(getAncillaryCategory(test))}`}>
                            {test}
                          </span>
                        ))}
                        {qualImaging.length > 0 && (
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${getBadgeColor("ultrasound")}`}>
                            <Scan className="w-3 h-3 mr-1" />
                            Ultrasound ({qualImaging.length})
                          </span>
                        )}
                        {allTests.length === 0 && (
                          <span className="text-xs text-slate-400 italic">None</span>
                        )}
                      </div>
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-200/80 bg-white" data-testid={`row-expanded-${patient.id}`}>
                    <div className="px-6 py-5">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="font-bold text-lg text-slate-900">{patient.name}</h3>
                          <div className="flex items-center gap-4 mt-1 text-sm text-slate-600">
                            {patient.age && <span>{patient.age}yo</span>}
                            {patient.gender && <span>{patient.gender}</span>}
                          </div>
                        </div>
                        <button
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                          onClick={(e) => { e.stopPropagation(); setExpandedPatient(null); }}
                          data-testid="button-close-detail"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                        {patient.diagnoses && (
                          <div className="bg-slate-50 rounded-xl px-4 py-3">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Diagnoses</p>
                            <p className="text-sm text-slate-900">{patient.diagnoses}</p>
                          </div>
                        )}
                        {patient.history && (
                          <div className="bg-slate-50 rounded-xl px-4 py-3">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">History</p>
                            <p className="text-sm text-slate-900">{patient.history}</p>
                          </div>
                        )}
                        {patient.medications && (
                          <div className="bg-slate-50 rounded-xl px-4 py-3">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Medications</p>
                            <p className="text-sm text-slate-900">{patient.medications}</p>
                          </div>
                        )}
                      </div>

                      {allTests.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
                                <div key={cat} className={`rounded-xl ${style.bg} border ${style.border} p-5`} data-testid={`card-ancillary-${cat}`}>
                                  <div className="flex items-center gap-2.5 mb-4">
                                    <IconComp className={`w-5 h-5 ${style.icon}`} />
                                    <span className={`font-bold text-sm ${style.accent}`}>{categoryLabels[cat]}</span>
                                  </div>
                                  {cat === "ultrasound" && tests.length > 1 && (
                                    <div className="flex items-center gap-1.5 flex-wrap mb-4">
                                      {tests.map((t) => (
                                        <span key={t} className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getBadgeColor(cat)}`}>{t}</span>
                                      ))}
                                    </div>
                                  )}
                                  {tests.map((test) => {
                                    const reason = reasoning[test];
                                    const clinician = reason ? (typeof reason === "string" ? reason : reason.clinician_understanding) : null;
                                    const talking = reason ? (typeof reason === "string" ? null : reason.patient_talking_points) : null;
                                    const confidence = reason && typeof reason !== "string" ? reason.confidence : null;
                                    const confidenceStyles: Record<string, string> = {
                                      high: "bg-emerald-100 text-emerald-700",
                                      medium: "bg-amber-100 text-amber-700",
                                      low: "bg-orange-100 text-orange-700",
                                    };
                                    return (
                                      <div key={test} className="mb-4 last:mb-0">
                                        <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                                          {(cat === "ultrasound" || tests.length > 1) && (
                                            <p className={`text-sm font-semibold ${style.accent}`}>{test}</p>
                                          )}
                                          {confidence && (
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${confidenceStyles[confidence]}`}>
                                              {confidence.toUpperCase()}
                                            </span>
                                          )}
                                        </div>
                                        {clinician && (
                                          <div className="rounded-xl bg-white/90 backdrop-blur-sm p-4 mb-3 shadow-sm">
                                            <div className="flex items-center gap-2 mb-2">
                                              <GraduationCap className="w-4 h-4 text-slate-500" />
                                              <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">Clinician Understanding</span>
                                            </div>
                                            <p className="text-sm leading-relaxed text-slate-800">{clinician}</p>
                                          </div>
                                        )}
                                        {talking && (
                                          <div className="rounded-xl bg-white/90 backdrop-blur-sm p-4 mb-3 shadow-sm">
                                            <div className="flex items-center gap-2 mb-2">
                                              <MessageCircle className="w-4 h-4 text-slate-500" />
                                              <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">Patient Talking Points</span>
                                            </div>
                                            <p className="text-sm leading-relaxed text-slate-800">{talking}</p>
                                          </div>
                                        )}
                                        {!clinician && !talking && (
                                          <p className="text-sm text-slate-500 italic">No detailed reasoning available.</p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            });
                          })()}
                        </div>
                      )}

                      {allTests.length === 0 && (
                        <p className="text-sm text-slate-500 italic">No qualifying tests for this patient.</p>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {patients.length === 0 && (
          <div className="text-center py-20">
            <Stethoscope className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-base text-slate-600">No patients in this schedule.</p>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200/60 bg-white/60 backdrop-blur-sm">
        <div className="w-full px-[5%] md:px-[10%] lg:px-[15%] py-4">
          <p className="text-xs text-slate-400 text-center">Plexus Ancillary Screening · AI-powered patient qualification</p>
        </div>
      </footer>
    </div>
  );
}
