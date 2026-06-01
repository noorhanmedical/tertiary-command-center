import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Loader2,
  ShieldCheck,
  AlertCircle,
  Clock,
  XCircle,
  X,
  Save,
  Pencil,
  CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient as defaultQueryClient } from "@/lib/queryClient";
import {
  categoryIcons,
  categoryLabels,
  categoryStyles,
  getAncillaryCategory,
  type AncillaryCategory,
} from "@/features/schedule/ancillaryMeta";
import type { PatientScreening } from "@shared/schema";
import { computeAdminReview, type AdminApprovalStatus } from "@/lib/adminReviewStatus";

// One-stop premium Admin Review modal. Replaces the three
// per-category reasoning popups with a single wide modal that
// surfaces every qualifying test alongside the canonical AI
// reasoning, lets the admin add/edit a per-test justification, and
// hosts the approval footer (Approve / Needs Info / Reject) so the
// reviewer never has to chase a tiny chip.
//
// Source of truth:
//   - `qualifyingTests` and `reasoning` come from the canonical
//     patient_screenings row.
//   - Edits write back through the existing onUpdate(field, value)
//     prop (same path PatientEditDialog uses), so any other surface
//     reading the same row re-renders correctly.

export type AdminReviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: PatientScreening;
  facility?: string | null;
  scheduleDate?: string | null;
  onUpdate: (field: string, value: string | string[] | boolean | Record<string, unknown>) => void;
  onAddTest?: (test: string) => void;
  onRemoveTest?: (test: string) => void;
};

const ANCILLARY_COLUMNS: AncillaryCategory[] = ["brainwave", "vitalwave", "ultrasound"];

type Reasoning = NonNullable<PatientScreening["reasoning"]>;
type ReasoningValue = string | {
  clinician_understanding?: string;
  patient_talking_points?: string;
  confidence?: "high" | "medium" | "low";
  qualifying_factors?: string[];
  icd10_codes?: string[];
  pearls?: string[];
  approvalRequired?: boolean;
  admin_justification?: string;
  admin_justification_updated_at?: string;
};

const STATUS_META: Record<
  AdminApprovalStatus,
  { label: string; tone: string; ringTone: string; Icon: typeof Clock }
> = {
  pending: {
    label: "Pending review",
    tone: "bg-amber-50 border-amber-200 text-amber-900",
    ringTone: "ring-amber-200",
    Icon: Clock,
  },
  approved: {
    label: "Approved",
    tone: "bg-emerald-50 border-emerald-200 text-emerald-900",
    ringTone: "ring-emerald-200",
    Icon: ShieldCheck,
  },
  needs_info: {
    label: "Needs info",
    tone: "bg-sky-50 border-sky-200 text-sky-900",
    ringTone: "ring-sky-200",
    Icon: AlertCircle,
  },
  rejected: {
    label: "Rejected",
    tone: "bg-rose-50 border-rose-200 text-rose-900",
    ringTone: "ring-rose-200",
    Icon: XCircle,
  },
};

function asReasoningRecord(value: unknown): Record<string, ReasoningValue> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, ReasoningValue>;
  }
  return {};
}

function reasonObj(r: ReasoningValue | undefined): Exclude<ReasoningValue, string> {
  if (!r) return {};
  if (typeof r === "string") return { clinician_understanding: r };
  return r;
}

function adminJustificationFrom(r: ReasoningValue | undefined): string {
  return reasonObj(r).admin_justification ?? "";
}

export function AdminReviewDialog({
  open,
  onOpenChange,
  patient,
  facility,
  scheduleDate,
  onUpdate,
  onRemoveTest,
}: AdminReviewDialogProps) {
  const queryClient = useQueryClient() ?? defaultQueryClient;
  const { toast } = useToast();

  const tests: string[] = useMemo(
    () => (Array.isArray(patient.qualifyingTests) ? patient.qualifyingTests : []),
    [patient.qualifyingTests],
  );
  const reasoning: Record<string, ReasoningValue> = useMemo(
    () => asReasoningRecord(patient.reasoning as Reasoning | null),
    [patient.reasoning],
  );

  // Local edit buffer for per-test admin justification. Seeded from
  // the canonical reasoning whenever the dialog opens or the
  // underlying patient updates.
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [adminNote, setAdminNote] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    const seeded: Record<string, string> = {};
    for (const test of tests) {
      seeded[test] = adminJustificationFrom(reasoning[test]);
    }
    setDrafts(seeded);
    setAdminNote(
      typeof (patient as { adminApprovalNote?: string | null }).adminApprovalNote === "string"
        ? ((patient as { adminApprovalNote?: string | null }).adminApprovalNote ?? "")
        : "",
    );
    setEditing(null);
  }, [open, tests, reasoning, patient]);

  // Group tests by ancillary category for the 3-column layout
  const groups: Record<AncillaryCategory, string[]> = useMemo(() => {
    const g: Record<AncillaryCategory, string[]> = {
      brainwave: [],
      vitalwave: [],
      ultrasound: [],
      other: [],
    };
    for (const t of tests) {
      const cat = getAncillaryCategory(t);
      g[cat].push(t);
    }
    return g;
  }, [tests]);

  const review = computeAdminReview(patient);
  const meta = STATUS_META[review.approval];

  // Write a justification edit back through the canonical onUpdate path
  function saveJustification(test: string) {
    const newVal = drafts[test] ?? "";
    const existing = reasoning[test];
    const existingObj = reasonObj(existing);
    const merged: Record<string, ReasoningValue> = {
      ...reasoning,
      [test]: {
        ...existingObj,
        // Preserve the AI-generated fields verbatim; only the admin
        // fields are written here.
        admin_justification: newVal.trim() ? newVal : undefined,
        admin_justification_updated_at: newVal.trim() ? new Date().toISOString() : undefined,
      },
    };
    onUpdate("reasoning", merged);
    setEditing(null);
    toast({ title: "Justification saved", description: test });
  }

  function deleteTest(test: string) {
    if (!confirm(`Remove ${test}?`)) return;
    if (onRemoveTest) {
      onRemoveTest(test);
    } else {
      // Fallback: update qualifyingTests directly through the canonical
      // patient update path if a removal handler wasn't wired.
      const next = tests.filter((t) => t !== test);
      onUpdate("qualifyingTests", next);
    }
    // Drop the per-test reasoning entry so we don't leak orphan
    // justifications on the next re-generation.
    const nextReasoning = { ...reasoning };
    delete nextReasoning[test];
    onUpdate("reasoning", nextReasoning);
    toast({ title: "Qualifying test removed", description: test });
  }

  // POST /api/patient-screenings/:id/admin-approval is the canonical
  // approval endpoint added in the prior batch — same path as
  // AdminApprovalControl uses.
  const approvalMutation = useMutation<
    unknown,
    Error,
    { status: AdminApprovalStatus; closeOnSuccess: boolean }
  >({
    mutationFn: async ({ status }) => {
      return apiRequest("POST", `/api/patient-screenings/${patient.id}/admin-approval`, {
        status,
        note: adminNote.trim() || undefined,
      });
    },
    onSuccess: (_data, vars) => {
      toast({
        title: `Admin approval: ${vars.status.replace("_", " ")}`,
        description: patient.name,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      queryClient.invalidateQueries({ queryKey: ["portal-command-center", patient.id] });
      if (vars.closeOnSuccess) onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "Could not update admin approval",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  function setApproval(status: AdminApprovalStatus, closeOnSuccess = false) {
    approvalMutation.mutate({ status, closeOnSuccess });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-6xl max-h-[90vh] flex flex-col p-0 gap-0 rounded-2xl bg-white"
        data-testid={`admin-review-dialog-${patient.id}`}
      >
        {/* ─── Header ───────────────────────────────────────────── */}
        <DialogHeader className="px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-lg font-semibold text-slate-900">
                Admin Review · {patient.name}
              </DialogTitle>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                {patient.dob && <span>DOB {patient.dob}</span>}
                {patient.phoneNumber && <span>{patient.phoneNumber}</span>}
                {(facility ?? patient.facility) && (
                  <span>{facility ?? patient.facility}</span>
                )}
                {patient.time && <span>{patient.time}</span>}
                {scheduleDate && <span>{scheduleDate}</span>}
              </div>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${meta.tone}`}
              data-testid={`admin-review-status-${patient.id}`}
            >
              <meta.Icon className="h-3.5 w-3.5" />
              {meta.label}
            </span>
          </div>
          {review.readyForAdminReview && (
            <div
              className="mt-2 inline-flex items-center gap-1.5 self-start rounded-full bg-violet-50 text-violet-800 border border-violet-200 px-2.5 py-0.5 text-[10px] font-medium"
              data-testid={`admin-review-ribbon-${patient.id}`}
            >
              <CheckCircle2 className="h-3 w-3" />
              Ready for Admin Review
            </div>
          )}
          {!review.hasQualification && (
            <div className="mt-2 text-[11px] text-amber-700">
              Qualification has not been generated for this patient. The admin
              review section will populate after the next Generate run.
            </div>
          )}
        </DialogHeader>

        {/* ─── Body: 3-column qualifying tests ──────────────────── */}
        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="px-6 py-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Qualifying Tests
                </div>
                <div className="text-[11px] text-slate-500">
                  Edits update the canonical patient row immediately. Reasoning
                  panels mirror the prior per-category popups.
                </div>
              </div>
              <span className="text-[11px] text-slate-500 tabular-nums">
                {tests.length} test{tests.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {ANCILLARY_COLUMNS.map((cat) => {
                const Icon = categoryIcons[cat];
                const style = categoryStyles[cat];
                const colTests = groups[cat];
                return (
                  <div
                    key={cat}
                    className={`rounded-2xl border ${style.border} bg-white shadow-sm flex flex-col`}
                    data-testid={`admin-review-column-${cat}`}
                  >
                    <div
                      className={`flex items-center justify-between gap-2 px-4 py-3 rounded-t-2xl ${style.bg} ${style.border} border-b`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${style.icon}`} />
                        <span className={`text-sm font-semibold ${style.accent}`}>
                          {categoryLabels[cat]}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] font-semibold tabular-nums ${style.accent}`}
                      >
                        {colTests.length}
                      </span>
                    </div>

                    <div className="flex-1 p-3 space-y-3">
                      {colTests.length === 0 ? (
                        <div className="text-[11px] italic text-slate-400 py-4 text-center">
                          No {categoryLabels[cat].toLowerCase()} tests qualified.
                        </div>
                      ) : (
                        colTests.map((test) => {
                          const reason = reasoning[test];
                          const r = reasonObj(reason);
                          const clinician = typeof reason === "string" ? reason : r.clinician_understanding;
                          const talking = r.patient_talking_points;
                          const confidence = r.confidence;
                          const qf = r.qualifying_factors ?? [];
                          const icd10 = r.icd10_codes ?? [];
                          const pearls = r.pearls ?? [];
                          const justification = drafts[test] ?? "";
                          const isEditing = editing === test;
                          const savedJustification = r.admin_justification ?? "";

                          const confidenceClass =
                            confidence === "high"
                              ? "bg-emerald-100 text-emerald-800"
                              : confidence === "medium"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-slate-100 text-slate-700";

                          return (
                            <div
                              key={test}
                              className={`rounded-xl border ${style.border} ${style.bg} p-3`}
                              data-testid={`admin-review-test-${test}`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className={`text-[12px] font-semibold ${style.accent}`}>
                                    {test}
                                  </span>
                                  {confidence && (
                                    <span
                                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold ${confidenceClass}`}
                                    >
                                      {confidence.toUpperCase()}
                                    </span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => deleteTest(test)}
                                  className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                                  title={`Remove ${test}`}
                                  aria-label={`Remove ${test}`}
                                  data-testid={`admin-review-remove-${test}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>

                              {qf.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {qf.map((factor, idx) => (
                                    <span
                                      key={idx}
                                      className="inline-flex items-center px-1.5 py-0 rounded-full text-[9px] font-medium bg-blue-50 text-blue-700 border border-blue-200/60"
                                    >
                                      {factor}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {clinician && (
                                <div className="mt-2 rounded-lg bg-white/80 backdrop-blur-sm p-2 shadow-sm">
                                  <div className="text-[9px] font-semibold text-slate-900 uppercase tracking-wider mb-1">
                                    Clinician Understanding
                                  </div>
                                  <p className="text-[11px] leading-relaxed text-slate-900">
                                    {clinician}
                                  </p>
                                </div>
                              )}

                              {talking && (
                                <div className="mt-1.5 rounded-lg bg-white/80 backdrop-blur-sm p-2 shadow-sm">
                                  <div className="text-[9px] font-semibold text-slate-900 uppercase tracking-wider mb-1">
                                    Patient Talking Points
                                  </div>
                                  <p className="text-[11px] leading-relaxed text-slate-900">
                                    {talking}
                                  </p>
                                </div>
                              )}

                              {icd10.length > 0 && (
                                <div className="mt-1.5 rounded-lg bg-white/80 p-2 shadow-sm">
                                  <div className="text-[9px] font-semibold text-slate-900 uppercase tracking-wider mb-1">
                                    ICD-10
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {icd10.map((code, idx) => (
                                      <span
                                        key={idx}
                                        className="inline-flex items-center px-1.5 py-0 rounded-full text-[9px] font-medium bg-slate-100 text-slate-700 border border-slate-200"
                                      >
                                        {code}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {pearls.length > 0 && (
                                <div className="mt-1.5 rounded-lg bg-white/80 p-2 shadow-sm">
                                  <div className="text-[9px] font-semibold text-slate-900 uppercase tracking-wider mb-1">
                                    Clinical Pearls
                                  </div>
                                  <div className="space-y-0.5">
                                    {pearls.map((pear, idx) => (
                                      <p
                                        key={idx}
                                        className="text-[10px] leading-relaxed text-slate-900"
                                      >
                                        • {pear}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Admin justification — editable */}
                              <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50/60 p-2">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[9px] font-semibold text-violet-900 uppercase tracking-wider">
                                    Admin Justification
                                  </span>
                                  {!isEditing && (
                                    <button
                                      type="button"
                                      onClick={() => setEditing(test)}
                                      className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-violet-700 hover:text-violet-900"
                                      data-testid={`admin-review-edit-${test}`}
                                    >
                                      <Pencil className="h-2.5 w-2.5" />
                                      {savedJustification ? "Edit" : "Add"}
                                    </button>
                                  )}
                                </div>
                                {isEditing ? (
                                  <div className="space-y-1.5">
                                    <Textarea
                                      value={justification}
                                      onChange={(e) =>
                                        setDrafts((d) => ({ ...d, [test]: e.target.value }))
                                      }
                                      placeholder="Why does this test belong on this patient's packet?"
                                      className="min-h-[60px] text-[11px] bg-white"
                                      data-testid={`admin-review-justification-input-${test}`}
                                    />
                                    <div className="flex items-center justify-end gap-1.5">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-6 text-[10px] px-2"
                                        onClick={() => {
                                          setDrafts((d) => ({
                                            ...d,
                                            [test]: savedJustification,
                                          }));
                                          setEditing(null);
                                        }}
                                      >
                                        Cancel
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        className="h-6 text-[10px] px-2 gap-1 bg-violet-600 hover:bg-violet-700"
                                        onClick={() => saveJustification(test)}
                                        data-testid={`admin-review-justification-save-${test}`}
                                      >
                                        <Save className="h-2.5 w-2.5" />
                                        Save
                                      </Button>
                                    </div>
                                  </div>
                                ) : savedJustification ? (
                                  <p className="text-[11px] leading-relaxed text-slate-900 whitespace-pre-wrap">
                                    {savedJustification}
                                  </p>
                                ) : (
                                  <p className="text-[10px] italic text-violet-600/80">
                                    No admin justification yet.
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <Separator className="my-5" />

            {/* ─── Approval block ────────────────────────────────── */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Admin Review</div>
                  <div className="text-[11px] text-slate-500">
                    Approval flows through{" "}
                    <code className="font-mono text-[10px]">
                      POST /api/patient-screenings/:id/admin-approval
                    </code>
                    . Send to Engagement remains blocked until
                    <em> approved</em>.
                  </div>
                </div>
                {review.missing.length > 0 && (
                  <div className="text-[11px] text-amber-700">
                    Missing for Engagement: {review.missing.join(" · ")}
                  </div>
                )}
              </div>

              <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Admin note (optional)
              </Label>
              <Textarea
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="What is the reviewer recording here?"
                className="mt-1 min-h-[60px] text-xs"
                data-testid={`admin-review-note-${patient.id}`}
              />
            </div>
          </div>
        </ScrollArea>

        {/* ─── Footer: approval actions ─────────────────────────── */}
        <DialogFooter className="px-6 py-3 border-t border-slate-100 shrink-0 flex-wrap gap-2">
          <div className="flex flex-1 items-center gap-2 flex-wrap">
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={() => setApproval("rejected", false)}
              disabled={approvalMutation.isPending}
              data-testid={`admin-review-reject-${patient.id}`}
            >
              <XCircle className="h-4 w-4 text-rose-600" />
              Reject
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={() => setApproval("needs_info", false)}
              disabled={approvalMutation.isPending}
              data-testid={`admin-review-needs-info-${patient.id}`}
            >
              <AlertCircle className="h-4 w-4 text-sky-600" />
              Needs Info
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={() => setApproval("pending", false)}
              disabled={approvalMutation.isPending || review.approval === "pending"}
              data-testid={`admin-review-pending-${patient.id}`}
            >
              <Clock className="h-4 w-4 text-amber-600" />
              Reset to Pending
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={approvalMutation.isPending}
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={() => setApproval("approved", true)}
              disabled={approvalMutation.isPending || review.approval === "approved"}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              data-testid={`admin-review-approve-${patient.id}`}
            >
              {approvalMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              Approve
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
