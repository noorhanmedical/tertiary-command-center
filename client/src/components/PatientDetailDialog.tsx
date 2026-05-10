import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronRight } from "lucide-react";
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

export function PatientDetailDialog({
  patient,
  open,
  onClose,
  onOpenAncillary,
  patientType = "Visit",
  tasksSlot,
}: PatientDetailDialogProps) {
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

  return (
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
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">
                Clinical
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
  );
}
