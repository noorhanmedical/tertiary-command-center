import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, Plus, Loader2, Sparkles, X, ShieldCheck } from "lucide-react";
import type { PatientScreening } from "@shared/schema";
import { ClinicalDataEditor } from "@/components/ClinicalDataEditor";
import { ANCILLARY_TESTS } from "@shared/plexus";
import { getAncillaryCategory, getBadgeColor } from "@/features/schedule/ancillaryMeta";
import { getPatientCompleteness } from "@/lib/patientCompleteness";
import { computeAdminReview } from "@/lib/adminReviewStatus";

const ALL_AVAILABLE_TESTS: string[] = [...ANCILLARY_TESTS];

function extractMostRecentDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const monthMap: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  const dates: Date[] = [];
  let m: RegExpExecArray | null;
  const p0 = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  while ((m = p0.exec(text)) !== null) {
    const d = new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  const p1 = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = p1.exec(text)) !== null) {
    const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  const p2 = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/gi;
  while ((m = p2.exec(text)) !== null) {
    const d = new Date(parseInt(m[3]), monthMap[m[1].toLowerCase()], parseInt(m[2]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  if (dates.length === 0) return null;
  const latest = dates.reduce((a, b) => (b > a ? b : a));
  const yr = latest.getFullYear();
  const mo = String(latest.getMonth() + 1).padStart(2, "0");
  const dy = String(latest.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}

interface PatientEditDialogProps {
  patient: PatientScreening;
  open: boolean;
  onClose: () => void;
  onUpdate: (
    field: string,
    value: string | string[] | boolean | Record<string, unknown>,
  ) => void;
  showTime?: boolean;
  // Whether this patient is a visit-type row. Drives the completeness check
  // (Time is required only for Visit). Defaults to `showTime` for back-compat
  // with any caller that hasn't been updated.
  isVisit?: boolean;
  qualifyingTests: string[];
  generatingTests: Set<string>;
  onAddTest: (test: string) => void;
  onRemoveTest: (test: string) => void;
  onAnalyze?: () => void;
  isAnalyzing?: boolean;
  isCompleted?: boolean;
  // Opens the unified Admin Review modal from inside the edit dialog.
  // Wired by PatientCard; optional so older callers compile.
  onOpenAdminReview?: () => void;
}

export function PatientEditDialog({
  patient,
  open,
  onClose,
  onUpdate,
  showTime = true,
  isVisit,
  qualifyingTests,
  generatingTests,
  onAddTest,
  onRemoveTest,
  onAnalyze,
  isAnalyzing = false,
  isCompleted = false,
  onOpenAdminReview,
}: PatientEditDialogProps) {
  const visitContext = isVisit ?? showTime;
  const [localName, setLocalName] = useState(patient.name || "");
  const [localTime, setLocalTime] = useState(patient.time || "");
  const [localDob, setLocalDob] = useState(patient.dob || "");
  const [localPhone, setLocalPhone] = useState(patient.phoneNumber || "");
  const [localInsurance, setLocalInsurance] = useState(patient.insurance || "");
  const [localDx, setLocalDx] = useState(patient.diagnoses || "");
  const [localHx, setLocalHx] = useState(patient.history || "");
  const [localRx, setLocalRx] = useState(patient.medications || "");
  const [localPrevTests, setLocalPrevTests] = useState(patient.previousTests || "");
  const [localPrevTestsDate, setLocalPrevTestsDate] = useState(patient.previousTestsDate || "");
  const [localNoPrevTests, setLocalNoPrevTests] = useState(patient.noPreviousTests || false);

  useEffect(() => { setLocalName(patient.name || ""); }, [patient.name]);
  useEffect(() => { setLocalTime(patient.time || ""); }, [patient.time]);
  useEffect(() => { setLocalDob(patient.dob || ""); }, [patient.dob]);
  useEffect(() => { setLocalPhone(patient.phoneNumber || ""); }, [patient.phoneNumber]);
  useEffect(() => { setLocalInsurance(patient.insurance || ""); }, [patient.insurance]);
  useEffect(() => { setLocalDx(patient.diagnoses || ""); }, [patient.diagnoses]);
  useEffect(() => { setLocalHx(patient.history || ""); }, [patient.history]);
  useEffect(() => { setLocalRx(patient.medications || ""); }, [patient.medications]);
  useEffect(() => { setLocalPrevTests(patient.previousTests || ""); }, [patient.previousTests]);
  useEffect(() => { setLocalPrevTestsDate(patient.previousTestsDate || ""); }, [patient.previousTestsDate]);
  useEffect(() => { setLocalNoPrevTests(patient.noPreviousTests || false); }, [patient.noPreviousTests]);

  const displayAge = ((): string => {
    if (patient.age != null) return String(patient.age);
    if (!localDob) return "";
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDob);
    const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(localDob);
    let y: number | null = null;
    let m: number | null = null;
    let d: number | null = null;
    if (ymd) {
      y = parseInt(ymd[1]); m = parseInt(ymd[2]); d = parseInt(ymd[3]);
    } else if (mdy) {
      y = parseInt(mdy[3]); m = parseInt(mdy[1]); d = parseInt(mdy[2]);
    }
    if (y === null || m === null || d === null) return "";
    const dob = new Date(y, m - 1, d);
    if (Number.isNaN(dob.getTime())) return "";
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const monthDelta = now.getMonth() - dob.getMonth();
    if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) age -= 1;
    if (age < 0 || age > 130) return "";
    return String(age);
  })();

  // Live completeness — runs against the in-flight local* state so the
  // missing chip + Generate disable flip the moment a required field is
  // filled, without waiting for onBlur to commit through onUpdate.
  const completeness = getPatientCompleteness(
    {
      name: localName,
      dob: localDob,
      phoneNumber: localPhone,
      insurance: localInsurance,
      diagnoses: localDx,
      history: localHx,
      medications: localRx,
      time: localTime,
    },
    { isVisit: visitContext },
  );
  const generateDisabled = isAnalyzing || !completeness.isComplete;
  const generateTitle = !completeness.isComplete
    ? `Complete required info before generating · Missing: ${completeness.missing.join(", ")}`
    : isCompleted
      ? "Re-generate"
      : "Generate";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-3xl max-h-[88vh] overflow-y-auto p-0 gap-0 rounded-2xl"
        data-testid={`dialog-patient-edit-${patient.id}`}
      >
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="text-base font-semibold tracking-tight">Edit Patient</DialogTitle>
            {/* Admin Review entry moves into the header so the body
                doesn't carry a large duplicate CTA. Admin-only is still
                enforced by the parent — onOpenAdminReview is only wired
                when the role check passes. */}
            {onOpenAdminReview && (() => {
              const review = computeAdminReview({
                name: patient.name,
                dob: patient.dob,
                phoneNumber: patient.phoneNumber,
                facility: patient.facility,
                qualifyingTests,
                commitStatus: patient.commitStatus,
                adminApprovalStatus:
                  (patient as { adminApprovalStatus?: string | null })
                    .adminApprovalStatus ?? null,
              });
              const title =
                review.approval === "approved"
                  ? "Approved · Open Admin Review"
                  : review.approval === "rejected"
                    ? "Rejected · Open Admin Review"
                    : review.approval === "needs_info"
                      ? "Needs Info · Open Admin Review"
                      : review.readyForAdminReview
                        ? "Admin Review"
                        : "Open Admin Review";
              const tone =
                review.readyForAdminReview
                  ? "text-violet-700 hover:text-violet-900 hover:bg-violet-50"
                  : review.approval === "approved"
                    ? "text-emerald-700 hover:bg-emerald-50"
                    : review.approval === "rejected"
                      ? "text-rose-700 hover:bg-rose-50"
                      : "text-slate-700 hover:bg-slate-50";
              return (
                <button
                  type="button"
                  onClick={onOpenAdminReview}
                  aria-label={title}
                  title={title}
                  className={`inline-flex items-center justify-center h-7 w-7 rounded transition-colors ${tone}`}
                  data-testid={`dialog-button-admin-review-${patient.id}`}
                >
                  <ShieldCheck className="h-4 w-4" />
                </button>
              );
            })()}
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-5">
          <section className="space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
              Patient Basics
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                Patient Name
              </label>
              <Input
                placeholder="Patient name"
                value={localName}
                onChange={(e) => setLocalName(e.target.value)}
                onBlur={() => {
                  if (localName !== (patient.name || "")) onUpdate("name", localName);
                }}
                className="h-9 text-sm font-medium mt-1"
                data-testid={`dialog-input-patient-name-${patient.id}`}
              />
            </div>

            <div className={`grid grid-cols-2 gap-2 ${showTime ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                  DOB
                </label>
                <Input
                  placeholder="YYYY-MM-DD"
                  value={localDob}
                  onChange={(e) => setLocalDob(e.target.value)}
                  onBlur={() => {
                    if (localDob !== (patient.dob || "")) onUpdate("dob", localDob);
                  }}
                  className="h-8 text-xs mt-1"
                  data-testid={`dialog-input-patient-dob-${patient.id}`}
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                  Age
                </label>
                <Input
                  placeholder="—"
                  value={displayAge}
                  readOnly
                  tabIndex={-1}
                  className="h-8 text-xs bg-finance-bg-soft mt-1"
                  data-testid={`dialog-input-patient-age-${patient.id}`}
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                  Insurance
                </label>
                <Input
                  placeholder="Insurance"
                  value={localInsurance}
                  onChange={(e) => setLocalInsurance(e.target.value)}
                  onBlur={() => {
                    if (localInsurance !== (patient.insurance || "")) onUpdate("insurance", localInsurance);
                  }}
                  className="h-8 text-xs mt-1"
                  data-testid={`dialog-input-patient-insurance-${patient.id}`}
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                  Phone
                </label>
                <Input
                  placeholder="Phone"
                  value={localPhone}
                  onChange={(e) => setLocalPhone(e.target.value)}
                  onBlur={() => {
                    if (localPhone !== (patient.phoneNumber || "")) onUpdate("phoneNumber", localPhone);
                  }}
                  className="h-8 text-xs mt-1"
                  data-testid={`dialog-input-patient-phone-${patient.id}`}
                />
              </div>
              {showTime && (
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                    Time
                  </label>
                  <Input
                    placeholder="Time"
                    value={localTime}
                    onChange={(e) => setLocalTime(e.target.value)}
                    onBlur={() => {
                      if (localTime !== (patient.time || "")) onUpdate("time", localTime);
                    }}
                    className="h-8 text-xs mt-1"
                    data-testid={`dialog-input-patient-time-${patient.id}`}
                  />
                </div>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
              Clinical
            </div>
            <div className="rounded-xl border border-finance-border bg-finance-bg-soft/40 -mx-1">
              <ClinicalDataEditor
                patient={patient}
                localDx={localDx}
                setLocalDx={setLocalDx}
                localHx={localHx}
                setLocalHx={setLocalHx}
                localRx={localRx}
                setLocalRx={setLocalRx}
                localPrevTests={localPrevTests}
                setLocalPrevTests={setLocalPrevTests}
                localPrevTestsDate={localPrevTestsDate}
                setLocalPrevTestsDate={setLocalPrevTestsDate}
                localNoPrevTests={localNoPrevTests}
                setLocalNoPrevTests={setLocalNoPrevTests}
                onUpdate={onUpdate}
                onExtractDate={extractMostRecentDate}
              />
            </div>
          </section>

          <section className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
              Qualifying Tests
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {qualifyingTests.map((test) => {
                const cat = getAncillaryCategory(test);
                const isGenerating = generatingTests.has(test);
                return (
                  <span
                    key={test}
                    className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-[10px] font-medium ${getBadgeColor(cat)}`}
                  >
                    {isGenerating && <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />}
                    {test}
                    <button
                      className="rounded transition-colors p-0.5 -mr-0.5 shrink-0"
                      title={`Remove ${test}`}
                      onClick={() => onRemoveTest(test)}
                      data-testid={`dialog-button-remove-test-${patient.id}-${test.replace(/\s+/g, "-")}`}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                );
              })}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[10px] gap-1"
                    data-testid={`dialog-button-add-test-${patient.id}`}
                  >
                    <Plus className="w-3 h-3" />
                    Add Test
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="start">
                  <p className="text-xs font-semibold text-muted-foreground mb-2 px-1">Select tests to add</p>
                  <div className="space-y-1">
                    {ALL_AVAILABLE_TESTS.map((test) => {
                      const isSelected = qualifyingTests.includes(test);
                      const cat = getAncillaryCategory(test);
                      return (
                        <button
                          key={test}
                          disabled={isSelected}
                          onClick={() => onAddTest(test)}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors ${
                            isSelected
                              ? "opacity-50 cursor-not-allowed"
                              : "hover:bg-accent cursor-pointer"
                          }`}
                          data-testid={`dialog-option-test-${patient.id}-${test.replace(/\s+/g, "-")}`}
                        >
                          <span
                            className={`w-3.5 h-3.5 flex items-center justify-center shrink-0 rounded border ${
                              isSelected ? "bg-primary border-primary" : "border-muted-foreground/40"
                            }`}
                          >
                            {isSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                          </span>
                          <span className={`flex-1 ${isSelected ? "line-through" : ""}`}>{test}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-sm font-medium ${getBadgeColor(cat)}`}>
                            {cat === "brainwave" ? "BW" : cat === "vitalwave" ? "VW" : "US"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </section>

          {/* Admin Review CTA moved to the header (top-right shield
              icon). Keeps capability without the large body section. */}
        </div>

        {!completeness.isComplete && (
          <div
            className="px-5 pt-2 pb-1"
            data-testid={`dialog-missing-${patient.id}`}
          >
            <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-0.5 text-[10px] font-medium">
              <span className="uppercase tracking-wider text-[9px] opacity-70">
                Required before generation
              </span>
              <span>{completeness.missing.join(" · ")}</span>
            </div>
          </div>
        )}

        <DialogFooter className="px-5 pb-5 pt-3 border-t sm:justify-between gap-2">
          {onAnalyze ? (
            <Button
              variant="outline"
              onClick={() => {
                if (generateDisabled) return;
                onAnalyze();
              }}
              disabled={generateDisabled}
              title={generateTitle}
              aria-label={generateTitle}
              className="gap-1.5"
              data-testid={`dialog-button-generate-${patient.id}`}
            >
              {isAnalyzing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {isCompleted ? "Re-Generate" : "Generate"}
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={onClose} data-testid={`dialog-button-done-${patient.id}`}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
