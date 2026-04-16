import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  categoryIcons,
  categoryLabels,
  categoryStyles,
  type AncillaryCategory,
} from "@/features/schedule/ancillaryMeta";

type ReasoningValue =
  | string
  | {
      clinician_understanding: string;
      patient_talking_points: string;
      confidence?: "high" | "medium" | "low";
      qualifying_factors?: string[];
      icd10_codes?: string[];
      pearls?: string[];
      approvalRequired?: boolean;
    };

export function QualificationReasoningDialog({
  selectedTestDetail,
  setSelectedTestDetail,
}: {
  selectedTestDetail: {
    patientId: number;
    category: string;
    tests: string[];
    reasoning: Record<string, ReasoningValue>;
  } | null;
  setSelectedTestDetail: (
    v: {
      patientId: number;
      category: string;
      tests: string[];
      reasoning: Record<string, ReasoningValue>;
    } | null
  ) => void;
}) {
  return (
    <Dialog
      open={!!selectedTestDetail}
      onOpenChange={(open) => {
        if (!open) setSelectedTestDetail(null);
      }}
    >
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-2xl max-h-[85vh] sm:max-h-[80vh] flex flex-col p-0 gap-0 rounded-2xl"
        data-testid="dialog-qualification-detail"
      >
        {selectedTestDetail &&
          (() => {
            const { category, tests, reasoning } = selectedTestDetail;
            const typedCategory = category as AncillaryCategory;
            const style = categoryStyles[typedCategory];
            const IconComp = categoryIcons[typedCategory];

            return (
              <>
                <DialogHeader className={`px-5 sm:px-6 py-4 border-b border-slate-100 ${style.bg} rounded-t-2xl shrink-0`}>
                  <DialogTitle className="flex items-center gap-2">
                    <IconComp className={`w-5 h-5 ${style.icon}`} />
                    <span className={`font-semibold text-base ${style.accent}`}>{categoryLabels[typedCategory]}</span>
                  </DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-5">
                  {tests.map((test) => {
                    const reason = reasoning[test];
                    const clinician = reason ? (typeof reason === "string" ? reason : reason.clinician_understanding) : null;
                    const talking = reason ? (typeof reason === "string" ? null : reason.patient_talking_points) : null;
                    const confidence = reason && typeof reason !== "string" ? reason.confidence : null;
                    const qualifyingFactors = reason && typeof reason !== "string" ? reason.qualifying_factors : null;
                    const icd10 = reason && typeof reason !== "string" ? reason.icd10_codes : null;
                    const pearls = reason && typeof reason !== "string" ? reason.pearls : null;

                    const confidenceClass =
                      confidence === "high"
                        ? "bg-emerald-100 text-emerald-800"
                        : confidence === "medium"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-100 text-slate-700";

                    return (
                      <div key={test} className={`rounded-xl border ${style.border} ${style.bg} p-3 sm:p-4`} data-testid={`dialog-test-${test}`}>
                        <div className="flex items-center gap-2 mb-2 sm:mb-3 flex-wrap">
                          <p className={`text-sm font-semibold ${style.accent}`}>{test}</p>
                          {confidence && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${confidenceClass}`}>
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
                            <div className="text-[10px] font-semibold text-slate-900 uppercase tracking-wider mb-1.5">Clinician Understanding</div>
                            <p className="text-[11px] leading-relaxed text-slate-900">{clinician}</p>
                          </div>
                        )}

                        {talking && (
                          <div className="rounded-xl bg-white/80 backdrop-blur-sm p-3 shadow-sm mb-2">
                            <div className="text-[10px] font-semibold text-slate-900 uppercase tracking-wider mb-1.5">Patient Talking Points</div>
                            <p className="text-[11px] leading-relaxed text-slate-900">{talking}</p>
                          </div>
                        )}

                        {icd10 && icd10.length > 0 && (
                          <div className="rounded-xl bg-white/80 backdrop-blur-sm p-3 shadow-sm mb-2">
                            <div className="text-[10px] font-semibold text-slate-900 uppercase tracking-wider mb-1.5">ICD-10 Codes</div>
                            <div className="flex flex-wrap gap-1.5">
                              {icd10.map((code, idx) => (
                                <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                                  {code}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {pearls && pearls.length > 0 && (
                          <div className="rounded-xl bg-white/80 backdrop-blur-sm p-3 shadow-sm">
                            <div className="text-[10px] font-semibold text-slate-900 uppercase tracking-wider mb-1.5">Clinical Pearls</div>
                            <div className="space-y-1">
                              {pearls.map((pear, idx) => (
                                <p key={idx} className="text-[11px] leading-relaxed text-slate-900">• {pear}</p>
                              ))}
                            </div>
                          </div>
                        )}

                        {!clinician && !talking && !(icd10 && icd10.length) && !(pearls && pearls.length) && (
                          <p className="text-[11px] text-slate-900 italic">No detailed reasoning available.</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                <DialogFooter className="px-5 sm:px-6 py-4 border-t border-slate-100 shrink-0">
                  <Button variant="outline" onClick={() => setSelectedTestDetail(null)}>
                    Close
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
      </DialogContent>
    </Dialog>
  );
}
