import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronRight, Sparkles } from "lucide-react";
import type { PatientScreening } from "@shared/schema";
import {
  categoryIcons,
  categoryLabels,
  getAncillaryCategory,
  type AncillaryCategory,
} from "@/features/schedule/ancillaryMeta";
import type { ReasoningValue } from "@/lib/pdfGeneration";
import { PatientSilhouette } from "@/components/PatientSilhouette";

const ANCILLARY_ORDER: AncillaryCategory[] = ["brainwave", "vitalwave", "ultrasound"];

const ANCILLARY_CARD_STYLES: Record<AncillaryCategory, string> = {
  brainwave: "bg-violet-700 hover:bg-violet-600",
  vitalwave: "bg-rose-800 hover:bg-rose-700",
  ultrasound: "bg-emerald-700 hover:bg-emerald-600",
  other: "bg-slate-700 hover:bg-slate-600",
};

function deriveAge(dob: string | null | undefined, fallback: number | null | undefined): string {
  if (fallback != null) return String(fallback);
  if (!dob) return "";
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dob);
  let y: number | null = null;
  let m: number | null = null;
  let d: number | null = null;
  if (ymd) { y = +ymd[1]; m = +ymd[2]; d = +ymd[3]; }
  else if (mdy) { y = +mdy[3]; m = +mdy[1]; d = +mdy[2]; }
  if (y === null || m === null || d === null) return "";
  const dobDate = new Date(y, m - 1, d);
  if (Number.isNaN(dobDate.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - dobDate.getFullYear();
  const md = now.getMonth() - dobDate.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < dobDate.getDate())) age -= 1;
  if (age < 0 || age > 130) return "";
  return String(age);
}

interface PatientDetailDialogProps {
  patient: PatientScreening | null;
  open: boolean;
  onClose: () => void;
  onOpenAncillary: (
    detail: {
      patientId: number;
      category: string;
      tests: string[];
      reasoning: Record<string, ReasoningValue>;
    },
  ) => void;
  patientType?: "Visit" | "Outreach";
  tasksSlot?: React.ReactNode;
}

const AI_LOGIC_DRAFTS_STORAGE_KEY = "plexusIq.aiLogicDrafts.v1";

type AiLogicDraft = {
  id: string;
  patientId: number;
  patientName: string;
  scope: "patient" | "clinic" | "global";
  instruction: string;
  context: {
    hx?: string | null;
    dx?: string | null;
    rx?: string | null;
    qualifyingTests: string[];
  };
  createdAt: string;
  status: "draft";
};

function appendAiLogicDraft(draft: AiLogicDraft) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(AI_LOGIC_DRAFTS_STORAGE_KEY);
    const existing = raw ? JSON.parse(raw) : [];
    const drafts = Array.isArray(existing) ? existing : [];
    drafts.unshift(draft);
    window.localStorage.setItem(AI_LOGIC_DRAFTS_STORAGE_KEY, JSON.stringify(drafts.slice(0, 100)));
  } catch {
    // Local draft persistence is best-effort until server-backed rule storage is wired.
  }
}

export function PatientDetailDialog({
  patient,
  open,
  onClose,
  onOpenAncillary,
  patientType = "Visit",
  tasksSlot,
}: PatientDetailDialogProps) {
  const [aiLogicOpen, setAiLogicOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [ruleScope, setRuleScope] = useState<"patient" | "clinic" | "global">("patient");
  const [savedDraftMessage, setSavedDraftMessage] = useState<string | null>(null);

  if (!patient) {
    return (
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-2xl rounded-2xl" />
      </Dialog>
    );
  }

  const displayName = (patient.name || "").trim() || "Unnamed patient";
  const ageText = deriveAge(patient.dob, patient.age);
  const tests = patient.qualifyingTests || [];
  const reasoning = (patient.reasoning || {}) as Record<string, ReasoningValue>;

  const testsByCategory = ANCILLARY_ORDER.reduce<Record<AncillaryCategory, string[]>>(
    (acc, cat) => {
      acc[cat] = tests.filter((t) => getAncillaryCategory(t) === cat);
      return acc;
    },
    { brainwave: [], vitalwave: [], ultrasound: [], other: [] },
  );

  const visibleCategories = ANCILLARY_ORDER.filter((c) => testsByCategory[c].length > 0);

  const handleSaveAiLogicDraft = () => {
    const instruction = aiInstruction.trim();
    if (!instruction) {
      setSavedDraftMessage("Add a short instruction before saving.");
      return;
    }

    appendAiLogicDraft({
      id: `${patient.id}-${Date.now()}`,
      patientId: patient.id,
      patientName: displayName,
      scope: ruleScope,
      instruction,
      context: {
        hx: patient.history,
        dx: patient.diagnoses,
        rx: patient.medications,
        qualifyingTests: tests,
      },
      createdAt: new Date().toISOString(),
      status: "draft",
    });

    setSavedDraftMessage("Saved as draft AI logic. Review it later in the Clinical Intelligence & Governance tile.");
    setAiInstruction("");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent
          className="w-[calc(100vw-2rem)] max-w-2xl max-h-[88vh] overflow-y-auto p-0 gap-0 rounded-2xl bg-white"
          data-testid={`dialog-patient-detail-${patient.id}`}
        >
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <div
                aria-hidden="true"
                className="shrink-0 inline-flex items-center justify-center h-14 w-14 rounded-full bg-plexus-navy-800 text-white"
              >
                <PatientSilhouette gender={patient.gender} className="w-7 h-7" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle
                  className="text-xl font-light tracking-tight text-slate-900 truncate"
                  data-testid={`dialog-detail-name-${patient.id}`}
                >
                  {displayName}
                </DialogTitle>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-slate-500 font-medium">
                  <span>
                    {patientType === "Visit" ? "Visit Appointment" : "Outreach"}
                  </span>
                  {patientType === "Visit" && patient.time && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="tabular-nums normal-case tracking-normal text-slate-700 font-semibold">
                        {patient.time}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSavedDraftMessage(null);
                  setAiLogicOpen(true);
                }}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 transition-colors"
                data-testid={`button-ai-logic-${patient.id}`}
                title="Teach AI or draft reusable logic from this patient"
              >
                <Sparkles className="w-3.5 h-3.5" />
                AI Logic
              </button>
            </div>
          </DialogHeader>

          <div className="px-6 py-5 space-y-5">
            <section>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">
                Patient
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                {patient.dob && (
                  <div>
                    <dt className="text-[10px] font-medium uppercase tracking-wider text-slate-400">DOB</dt>
                    <dd className="text-slate-900">{patient.dob}</dd>
                  </div>
                )}
                {ageText && (
                  <div>
                    <dt className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Age</dt>
                    <dd className="text-slate-900">{ageText}</dd>
                  </div>
                )}
                {patient.insurance && (
                  <div>
                    <dt className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Insurance</dt>
                    <dd className="text-slate-900 truncate" title={patient.insurance}>{patient.insurance}</dd>
                  </div>
                )}
                {patient.phoneNumber && (
                  <div>
                    <dt className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Phone</dt>
                    <dd className="text-slate-900 truncate" title={patient.phoneNumber}>{patient.phoneNumber}</dd>
                  </div>
                )}
              </dl>
            </section>

            {(patient.history || patient.diagnoses || patient.medications) && (
              <section>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Clinical
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSavedDraftMessage(null);
                      setAiLogicOpen(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-500 hover:bg-violet-50 hover:text-violet-700 transition-colors"
                    data-testid={`button-clinical-ai-logic-${patient.id}`}
                  >
                    <Sparkles className="w-3 h-3" />
                    Teach AI
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {patient.history && (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Hx</div>
                      <p className="text-xs leading-relaxed text-slate-900 line-clamp-4">{patient.history}</p>
                    </div>
                  )}
                  {patient.diagnoses && (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Dx</div>
                      <p className="text-xs leading-relaxed text-slate-900 line-clamp-4">{patient.diagnoses}</p>
                    </div>
                  )}
                  {patient.medications && (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Rx</div>
                      <p className="text-xs leading-relaxed text-slate-900 line-clamp-4">{patient.medications}</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {visibleCategories.length > 0 && (
              <section>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">
                  Ancillary
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {visibleCategories.map((cat) => {
                    const Icon = categoryIcons[cat];
                    const count = testsByCategory[cat].length;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() =>
                          onOpenAncillary({
                            patientId: patient.id,
                            category: cat,
                            tests: testsByCategory[cat],
                            reasoning,
                          })
                        }
                        className={`relative flex items-center gap-3 rounded-xl px-4 py-3.5 text-white text-left transition-colors shadow-sm ${ANCILLARY_CARD_STYLES[cat]}`}
                        data-testid={`dialog-detail-ancillary-${cat}-${patient.id}`}
                      >
                        <Icon className="w-7 h-7 text-white shrink-0" strokeWidth={1.75} fill="none" />
                        <span className="flex-1 font-medium tracking-tight">
                          {categoryLabels[cat]}
                          {count > 1 && (
                            <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-white/20 text-white text-[10px] font-semibold">
                              {count}
                            </span>
                          )}
                        </span>
                        <ChevronRight className="w-4 h-4 text-white/80 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {tasksSlot}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={aiLogicOpen} onOpenChange={setAiLogicOpen}>
        <DialogContent
          className="w-[calc(100vw-2rem)] max-w-xl rounded-2xl bg-white p-0 gap-0"
          data-testid={`dialog-ai-logic-${patient.id}`}
        >
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100">
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-violet-50 text-violet-700">
                <Sparkles className="h-4 w-4" />
              </span>
              AI Logic for this patient
            </DialogTitle>
            <p className="text-xs leading-relaxed text-slate-500">
              Draft patient-specific learning or a reusable rule from this review. Future server wiring should send these drafts into Clinical Intelligence & Governance for approval, versioning, audit trail, and CMS-aware rule testing.
            </p>
          </DialogHeader>

          <div className="px-6 py-5 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">
                Source context
              </div>
              <div className="space-y-1.5 text-xs text-slate-700">
                {patient.history && <p><span className="font-semibold text-slate-900">HX:</span> {patient.history}</p>}
                {patient.diagnoses && <p><span className="font-semibold text-slate-900">DX:</span> {patient.diagnoses}</p>}
                {patient.medications && <p><span className="font-semibold text-slate-900">RX:</span> {patient.medications}</p>}
                {tests.length > 0 && <p><span className="font-semibold text-slate-900">Ancillaries:</span> {tests.join(", ")}</p>}
              </div>
            </div>

            <div>
              <label htmlFor={`ai-logic-instruction-${patient.id}`} className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                What should AI learn or consider?
              </label>
              <textarea
                id={`ai-logic-instruction-${patient.id}`}
                value={aiInstruction}
                onChange={(e) => {
                  setAiInstruction(e.target.value);
                  setSavedDraftMessage(null);
                }}
                placeholder="Example: When HX/DX shows diabetic neuropathy with leg pain or burning feet, suggest VitalWave reasoning and include source-linked medical necessity in clinician reasoning, patient reasoning, and the order note."
                className="mt-2 min-h-[116px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-300"
                data-testid={`textarea-ai-logic-${patient.id}`}
              />
            </div>

            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">
                Rule scope
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "patient", label: "Patient only" },
                  { value: "clinic", label: "Clinic draft" },
                  { value: "global", label: "Global draft" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRuleScope(option.value as "patient" | "clinic" | "global")}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                      ruleScope === option.value
                        ? "border-violet-200 bg-violet-50 text-violet-700"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                    data-testid={`button-rule-scope-${option.value}-${patient.id}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {savedDraftMessage && (
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700" data-testid={`text-ai-logic-save-message-${patient.id}`}>
                {savedDraftMessage}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-6 py-4">
            <button
              type="button"
              onClick={() => setAiLogicOpen(false)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSaveAiLogicDraft}
              className="rounded-xl bg-plexus-navy-800 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-plexus-navy-700"
              data-testid={`button-save-ai-logic-draft-${patient.id}`}
            >
              Save draft logic
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
