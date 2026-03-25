import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
  AlertTriangle,
  ShieldAlert,
  Calendar,
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

const confidenceStyles: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-orange-100 text-orange-700",
};

const CORRECT_PIN = "1111";

export default function SharedSchedule() {
  const [, params] = useRoute("/schedule/:id");
  const batchId = params?.id ? parseInt(params.id) : null;
  const [expandedPatient, setExpandedPatient] = useState<number | null>(null);

  const [selectedTestDetail, setSelectedTestDetail] = useState<{ category: string; tests: string[]; reasoning: Record<string, ReasoningValue> } | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

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
      <div className="flex items-center justify-center h-screen bg-background px-4">
        <div className="text-center">
          <Stethoscope className="w-14 h-14 text-slate-300 mx-auto mb-5" />
          <h2 className="text-xl font-bold text-slate-900" data-testid="text-not-found">Schedule not found</h2>
          <p className="text-sm text-slate-600 mt-2">This schedule may have been deleted or the link is invalid.</p>
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
        <Card className="w-full max-w-sm rounded-3xl shadow-xl border-slate-200/60 overflow-hidden">
          <div className="bg-[#1a365d] px-6 py-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white/10 mb-3">
              <Stethoscope className="w-6 h-6 text-white" />
            </div>
            <p className="text-xs text-blue-200/70 font-medium tracking-wider uppercase mb-1">Plexus Ancillary Screening</p>
            <h1 className="text-base font-bold text-white leading-snug">{batch.name}</h1>
          </div>
          <div className="px-6 py-6 space-y-5">
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-800">Enter access code</p>
              <p className="text-xs text-slate-500 mt-1">This schedule is protected</p>
            </div>
            <div className="space-y-3">
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                value={pin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "").slice(0, 4);
                  setPin(val);
                  setPinError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (pin === CORRECT_PIN) { setUnlocked(true); } else { setPinError(true); setPin(""); }
                  }
                }}
                className={`w-full text-center text-2xl tracking-[0.5em] font-bold border rounded-2xl px-4 py-3 focus:outline-none transition-colors ${pinError ? "border-red-400 bg-red-50 text-red-600" : "border-slate-200 bg-slate-50 text-slate-800 focus:border-primary"}`}
                data-testid="input-pin"
                autoFocus
              />
              {pinError && (
                <p className="text-xs text-red-500 text-center" data-testid="text-pin-error">Incorrect code. Please try again.</p>
              )}
              <Button
                className="w-full rounded-2xl py-3 text-base"
                onClick={() => {
                  if (pin === CORRECT_PIN) { setUnlocked(true); } else { setPinError(true); setPin(""); }
                }}
                data-testid="button-unlock"
              >
                View Schedule
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-50">
        <div className="bg-[#1a365d] px-4 md:px-8 py-2">
          <div className="max-w-5xl mx-auto flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-blue-200/80 shrink-0" />
            <p className="text-xs text-blue-200/80 font-semibold tracking-wider uppercase truncate">Plexus Ancillary Screening</p>
          </div>
        </div>
        <div className="bg-blue-100/90 border-b border-blue-200/60 px-4 md:px-8 py-3 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-bold text-slate-800 tracking-tight leading-tight truncate" data-testid="text-shared-schedule-title">{batch.name}</h1>
              {batch.clinicianName && (
                <p className="text-xs text-slate-700 font-medium mt-0.5 truncate" data-testid="text-shared-clinician">Dr. {batch.clinicianName}</p>
              )}
              <p className="text-xs text-slate-600 mt-0.5" data-testid="text-shared-patient-count">{patients.length} patients screened</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              className="gap-1.5 border-blue-300 text-blue-800 hover:bg-blue-200/60 rounded-xl shrink-0 text-xs px-3"
              data-testid="button-export-shared"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export CSV</span>
              <span className="sm:hidden">CSV</span>
            </Button>
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-3 sm:px-4 md:px-8 py-4 sm:py-8">
        <div className="space-y-2 sm:space-y-3" data-testid="shared-schedule-list">
          {patients.map((patient) => {
            const allTests = patient.qualifyingTests || [];
            const reasoning = (patient.reasoning || {}) as Record<string, ReasoningValue>;
            const cooldowns = (patient.cooldownTests || []) as { test: string; lastDate: string; insuranceType: string; cooldownMonths: number }[];
            const qualTests = allTests.filter((t) => !isImagingTest(t));
            const qualImaging = allTests.filter((t) => isImagingTest(t));
            const isExpanded = expandedPatient === patient.id;
            const hasCooldowns = cooldowns.length > 0;

            return (
              <Card
                key={patient.id}
                className={`rounded-2xl border-0 shadow-sm bg-white/85 backdrop-blur-sm overflow-hidden transition-shadow hover:shadow-md ${hasCooldowns ? "ring-1 ring-amber-300" : ""}`}
                data-testid={`shared-row-${patient.id}`}
              >
                <div
                  className="p-3 sm:p-4 cursor-pointer hover:bg-slate-50/60 transition-colors active:bg-slate-100/60"
                  onClick={() => setExpandedPatient(isExpanded ? null : patient.id)}
                  data-testid={`button-expand-${patient.id}`}
                >
                  <div className="flex items-start gap-2 sm:gap-4">
                    {patient.time && (
                      <span className="text-xs sm:text-sm text-slate-900 font-medium shrink-0 mt-0.5 tabular-nums pt-0.5" data-testid={`text-time-${patient.id}`}>{patient.time}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-semibold text-sm sm:text-base text-slate-900 truncate" data-testid={`text-name-${patient.id}`}>{patient.name}</p>
                            <span className="text-xs text-slate-600 shrink-0">
                              {[patient.age && `${patient.age}yo`, patient.gender].filter(Boolean).join(" · ")}
                            </span>
                            {hasCooldowns && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 shrink-0" data-testid={`badge-cooldown-${patient.id}`}>
                                <AlertTriangle className="w-3 h-3" />
                                Cooldown ({cooldowns.length})
                              </span>
                            )}
                          </div>
                        </div>
                        {allTests.length > 0 && (
                          <div className="shrink-0 mt-0.5">
                            {isExpanded
                              ? <ChevronDown className="w-4 h-4 text-slate-400" />
                              : <ChevronRight className="w-4 h-4 text-slate-400" />}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {qualTests.map((test) => (
                          <span key={test} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getBadgeColor(getAncillaryCategory(test))}`}>
                            {test}
                          </span>
                        ))}
                        {qualImaging.length > 0 && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getBadgeColor("ultrasound")}`}>
                            <Scan className="w-3 h-3 mr-1" />
                            Ultrasound ({qualImaging.length})
                          </span>
                        )}
                        {allTests.length === 0 && (
                          <span className="text-xs text-slate-500 italic">No qualifying tests</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {isExpanded && (allTests.length > 0 || hasCooldowns || patient.diagnoses || patient.history || patient.medications) && (
                  <div className="border-t border-slate-100 bg-slate-50/60 p-3 sm:p-5" data-testid={`row-expanded-${patient.id}`}>
                    <div className="flex items-center justify-between mb-3 sm:mb-4">
                      <h3 className="font-semibold text-sm sm:text-base text-slate-900 truncate pr-2">{patient.name} — Ancillary Details</h3>
                      <button
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
                        onClick={(e) => { e.stopPropagation(); setExpandedPatient(null); }}
                        data-testid="button-close-detail"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {(patient.diagnoses || patient.history || patient.medications) && (
                      <div className="rounded-xl bg-white border border-slate-200/70 px-3 sm:px-4 py-3 mb-3 sm:mb-4" data-testid={`card-patient-history-${patient.id}`}>
                        <div className="flex items-center gap-2 mb-2 sm:mb-3">
                          <Stethoscope className="w-4 h-4 text-slate-500 shrink-0" />
                          <span className="font-semibold text-sm text-slate-800">Patient History</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
                          {patient.diagnoses && (
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Diagnoses (Dx)</p>
                              <p className="text-xs text-slate-900 leading-relaxed" data-testid={`text-diagnoses-${patient.id}`}>{patient.diagnoses}</p>
                            </div>
                          )}
                          {patient.history && (
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">History (Hx)</p>
                              <p className="text-xs text-slate-900 leading-relaxed" data-testid={`text-history-${patient.id}`}>{patient.history}</p>
                            </div>
                          )}
                          {patient.medications && (
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Medications (Rx)</p>
                              <p className="text-xs text-slate-900 leading-relaxed" data-testid={`text-medications-${patient.id}`}>{patient.medications}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {hasCooldowns && (
                      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 sm:p-4 mb-3 sm:mb-4" data-testid={`card-cooldown-${patient.id}`}>
                        <div className="flex items-center gap-2 mb-2 sm:mb-3">
                          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                          <span className="font-semibold text-sm text-amber-800">Cooldown Violations</span>
                        </div>
                        <div className="space-y-2">
                          {cooldowns.map((cd, idx) => (
                            <div key={idx} className="rounded-lg bg-white/80 px-3 py-2" data-testid={`cooldown-item-${idx}`}>
                              <div className="flex items-center gap-2 min-w-0 mb-1">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                <span className="text-sm font-medium text-amber-900">{cd.test}</span>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap text-xs text-amber-700 pl-5">
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  Last: {cd.lastDate}
                                </span>
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-200/60 text-[10px] font-semibold uppercase">
                                  {cd.insuranceType}
                                </span>
                                <span className="text-[10px]">{cd.cooldownMonths}mo cooldown</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row flex-wrap gap-2">
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
                            <button
                              key={cat}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTestDetail({ category: cat, tests, reasoning });
                              }}
                              className={`flex items-center gap-2 rounded-xl ${style.bg} border ${style.border} px-4 py-3 hover:shadow-md active:shadow-sm transition-shadow cursor-pointer text-left w-full sm:w-auto`}
                              data-testid={`card-ancillary-${cat}-${patient.id}`}
                            >
                              <IconComp className={`w-4 h-4 ${style.icon} shrink-0`} />
                              <span className={`font-semibold text-sm ${style.accent}`}>{categoryLabels[cat]}</span>
                              {tests.length > 1 && (
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${getBadgeColor(cat)}`}>{tests.length}</span>
                              )}
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400 ml-auto sm:ml-1 shrink-0" />
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

        {patients.length === 0 && (
          <div className="text-center py-20">
            <Stethoscope className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-base text-slate-600">No patients in this schedule.</p>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200/60 bg-white/60 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-4">
          <p className="text-xs text-slate-400 text-center">Plexus Ancillary Screening · AI-powered patient qualification</p>
        </div>
      </footer>

      <Dialog open={!!selectedTestDetail} onOpenChange={(open) => { if (!open) setSelectedTestDetail(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl max-h-[85vh] sm:max-h-[80vh] flex flex-col p-0 gap-0 rounded-2xl" data-testid="dialog-test-detail">
          {selectedTestDetail && (() => {
            const { category, tests, reasoning } = selectedTestDetail;
            const style = categoryStyles[category];
            const IconComp = categoryIcons[category];
            return (
              <>
                <DialogHeader className={`px-5 sm:px-6 py-4 border-b border-slate-100 ${style.bg} rounded-t-2xl shrink-0`}>
                  <DialogTitle className="flex items-center gap-2">
                    <IconComp className={`w-5 h-5 ${style.icon}`} />
                    <span className={`font-semibold text-base ${style.accent}`}>{categoryLabels[category]}</span>
                  </DialogTitle>
                  <DialogDescription className="sr-only">Detailed reasoning for {categoryLabels[category]} qualification</DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-5">
                  {tests.map((test) => {
                    const reason = reasoning[test];
                    const clinician = reason ? (typeof reason === "string" ? reason : reason.clinician_understanding) : null;
                    const talking = reason ? (typeof reason === "string" ? null : reason.patient_talking_points) : null;
                    const confidence = reason && typeof reason !== "string" ? reason.confidence : null;
                    const qualifyingFactors = reason && typeof reason !== "string" ? reason.qualifying_factors : null;

                    return (
                      <div key={test} className={`rounded-xl border ${style.border} ${style.bg} p-3 sm:p-4`} data-testid={`dialog-test-${test}`}>
                        <div className="flex items-center gap-2 mb-2 sm:mb-3 flex-wrap">
                          <p className={`text-sm font-semibold ${style.accent}`}>{test}</p>
                          {confidence && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${confidenceStyles[confidence]}`}>
                              {confidence.toUpperCase()}
                            </span>
                          )}
                        </div>

                        {qualifyingFactors && qualifyingFactors.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap mb-2 sm:mb-3">
                            {qualifyingFactors.map((factor, idx) => (
                              <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200/60">
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
                          <div className="rounded-xl bg-white/80 backdrop-blur-sm p-3 shadow-sm">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <MessageCircle className="w-3.5 h-3.5 text-slate-400" />
                              <span className="text-[10px] font-semibold text-slate-900 uppercase tracking-wider">Patient Talking Points</span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-slate-900">{talking}</p>
                          </div>
                        )}

                        {!clinician && !talking && (
                          <p className="text-[11px] text-slate-900 italic">No detailed reasoning available.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
