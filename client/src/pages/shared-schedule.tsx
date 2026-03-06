import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
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
} from "lucide-react";
import type { PatientScreening } from "@shared/schema";

type ReasoningValue = string | { clinician_understanding: string; patient_talking_points: string; confidence?: "high" | "medium" | "low"; qualifying_factors?: string[]; icd10_codes?: string[] };

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
  brainwave: { bg: "bg-violet-50/80", border: "border-violet-100", accent: "text-violet-700", icon: "text-violet-500" },
  vitalwave: { bg: "bg-red-50/80", border: "border-red-100", accent: "text-red-700", icon: "text-red-500" },
  ultrasound: { bg: "bg-emerald-50/80", border: "border-emerald-100", accent: "text-emerald-700", icon: "text-emerald-500" },
  other: { bg: "bg-slate-50/80", border: "border-slate-100", accent: "text-slate-700", icon: "text-slate-500" },
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <Stethoscope className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-600">Schedule not found</h2>
          <p className="text-sm text-slate-400 mt-1">This schedule may have been deleted or the link is invalid.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/50">
      <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200/60 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-8 lg:px-[10%] py-4">
          <div className="flex items-center gap-3">
            <Stethoscope className="w-5 h-5 text-slate-600" />
            <div>
              <h1 className="text-base font-semibold tracking-tight" data-testid="text-shared-schedule-title">{batch.name}</h1>
              <p className="text-xs text-slate-500" data-testid="text-shared-patient-count">{patients.length} patients screened</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 lg:px-[10%] py-6">
        <div className="space-y-3">
          {patients.map((patient) => {
            const allTests = patient.qualifyingTests || [];
            const reasoning = (patient.reasoning || {}) as Record<string, ReasoningValue>;
            const qualTests = allTests.filter((t) => !isImagingTest(t));
            const qualImaging = allTests.filter((t) => isImagingTest(t));
            const isExpanded = expandedPatient === patient.id;

            return (
              <Card
                key={patient.id}
                className="rounded-2xl border-0 shadow-sm overflow-hidden"
                data-testid={`shared-row-${patient.id}`}
              >
                <div
                  className="p-4 cursor-pointer hover:bg-slate-50/80 transition-colors"
                  onClick={() => setExpandedPatient(isExpanded ? null : patient.id)}
                  data-testid={`button-expand-${patient.id}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-4 min-w-0">
                      {patient.time && (
                        <span className="text-xs text-slate-400 font-medium shrink-0" data-testid={`text-time-${patient.id}`}>{patient.time}</span>
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate" data-testid={`text-name-${patient.id}`}>{patient.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {[patient.age && `${patient.age}yo`, patient.gender].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1 flex-wrap justify-end">
                        {qualTests.map((test) => (
                          <span key={test} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getBadgeColor(getAncillaryCategory(test))}`}>
                            {test}
                          </span>
                        ))}
                        {qualImaging.length > 0 && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getBadgeColor("ultrasound")}`}>
                            Ultrasound Studies ({qualImaging.length})
                          </span>
                        )}
                        {allTests.length === 0 && (
                          <span className="text-xs text-slate-300">No qualifying tests</span>
                        )}
                      </div>
                      {allTests.length > 0 && (
                        isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                  </div>
                </div>

                {isExpanded && allTests.length > 0 && (
                  <div className="border-t border-slate-100 bg-slate-50/50 p-4" data-testid={`row-expanded-${patient.id}`}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-sm text-slate-700">{patient.name} — Ancillary Details</h3>
                      <button
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
                        onClick={(e) => { e.stopPropagation(); setExpandedPatient(null); }}
                        data-testid="button-close-detail"
                      >
                        <X className="w-4 h-4" />
                      </button>
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
                            <div key={cat} className={`rounded-xl ${style.bg} border ${style.border} p-4`} data-testid={`card-ancillary-${cat}`}>
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
                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${confidenceStyles[confidence]}`}>
                                          {confidence.toUpperCase()}
                                        </span>
                                      )}
                                    </div>
                                    {clinician && (
                                      <div className="rounded-lg bg-white/80 p-3 mb-2">
                                        <div className="flex items-center gap-1.5 mb-1">
                                          <GraduationCap className="w-3.5 h-3.5 text-slate-400" />
                                          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Clinician Understanding</span>
                                        </div>
                                        <p className="text-[11px] leading-relaxed text-slate-700">{clinician}</p>
                                      </div>
                                    )}
                                    {talking && (
                                      <div className="rounded-lg bg-white/80 p-3 mb-2">
                                        <div className="flex items-center gap-1.5 mb-1">
                                          <MessageCircle className="w-3.5 h-3.5 text-slate-400" />
                                          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Patient Talking Points</span>
                                        </div>
                                        <p className="text-[11px] leading-relaxed text-slate-700">{talking}</p>
                                      </div>
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
      </main>
    </div>
  );
}
