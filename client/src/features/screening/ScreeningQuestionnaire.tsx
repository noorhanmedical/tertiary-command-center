// A0-UI — the real ACS/PCS structured BrainWave/VitalWave screening form.
//
// Renders the EXACT shared A0 registry (no duplicated question definitions),
// captures provenance (direct entry vs paper transcription + source form),
// validates required answers, and submits structured evidence through the
// real A0 backend (POST /api/screening-evidence). Completing it triggers A1
// server-side (Order Note refresh) — the frontend never generates the note.
//
// NOTE: compiles against the shared contract + app conventions; runtime
// behavior is not verified here (requires the running app + DB + canonical
// flags).

import { useMemo, useState } from "react";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  sectionsFor,
  scaleLabels,
  scaleMeaning,
  requiredCount,
} from "./screeningRegistryView";
import type { Questionnaire } from "@shared/schema/screeningEvidence";

export type ScreeningContextResolved = {
  clinicId: number;
  ancillaryCaseId: number;
  serviceType: string;
  questionnaire: Questionnaire;
  questionnaireVersion: string;
  screeningReadinessId: number;
};

type CaptureRole = "ACS" | "PCS" | "clinician" | "admin";
type Origin = "direct_entry" | "transcribed_from_paper";
type AnswerMap = Record<string, number | boolean | undefined>;

const DEFAULT_FORM_NAME: Record<Questionnaire, string> = {
  brainwave: "BrainWave Patient Questionnaire",
  vitalwave: "VitalWave Patient Questionnaire",
};

function draftKey(ctx: ScreeningContextResolved): string {
  return `screening-draft:${ctx.ancillaryCaseId}:${ctx.questionnaire}:${ctx.questionnaireVersion}`;
}

export function ScreeningQuestionnaire({
  context,
  patientName,
  onSubmitted,
}: {
  context: ScreeningContextResolved;
  patientName?: string | null;
  onSubmitted: () => void;
}) {
  const { toast } = useToast();
  const sections = useMemo(() => sectionsFor(context.questionnaire, context.questionnaireVersion), [context]);
  const totalRequired = useMemo(() => requiredCount(context.questionnaire, context.questionnaireVersion), [context]);

  const initialDraft = (() => {
    try {
      const raw = localStorage.getItem(draftKey(context));
      return raw ? (JSON.parse(raw) as { answers?: AnswerMap; role?: CaptureRole; origin?: Origin }) : null;
    } catch {
      return null;
    }
  })();

  const [answers, setAnswers] = useState<AnswerMap>(initialDraft?.answers ?? {});
  const [role, setRole] = useState<CaptureRole>(initialDraft?.role ?? "ACS");
  const [origin, setOrigin] = useState<Origin>(initialDraft?.origin ?? "direct_entry");
  const [sourceFormName, setSourceFormName] = useState(DEFAULT_FORM_NAME[context.questionnaire]);
  const [sourceFormRevision, setSourceFormRevision] = useState("");
  const [sourceDocRefId, setSourceDocRefId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const requiredItems = useMemo(() => sections.flatMap((s) => s.items).filter((i) => !i.control), [sections]);
  const missing = requiredItems.filter((i) => answers[i.questionId] === undefined);
  const answeredCount = totalRequired - missing.length;
  const complete = missing.length === 0;

  function setAnswer(id: string, value: number | boolean) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function saveDraft() {
    try {
      localStorage.setItem(draftKey(context), JSON.stringify({ answers, role, origin }));
      toast({ title: "Draft saved", description: `${answeredCount}/${totalRequired} answered.` });
    } catch {
      toast({ title: "Could not save draft", variant: "destructive" });
    }
  }

  function buildPayload() {
    const responses = sections
      .flatMap((s) => s.items)
      .map((item) => {
        const v = answers[item.questionId];
        if (v === undefined) return null;
        if (item.responseType === "boolean") {
          return {
            questionId: item.questionId,
            questionnaire: item.questionnaire,
            section: item.section,
            questionVersion: item.questionnaireVersion,
            responseType: "boolean" as const,
            value: v as boolean,
            concept: item.concept,
            evidenceClass: item.evidenceClass,
            ...(item.recency ? { recency: "recent" as const } : {}),
          };
        }
        const num = v as number;
        return {
          questionId: item.questionId,
          questionnaire: item.questionnaire,
          section: item.section,
          questionVersion: item.questionnaireVersion,
          responseType: item.responseType,
          value: num,
          normalizedMeaning: scaleMeaning(item.responseType as "severity_scale" | "frequency_scale", num),
          concept: item.concept,
          evidenceClass: item.evidenceClass,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    const capture: Record<string, unknown> = {
      origin,
      documentedByRole: role,
      documentedAt: new Date().toISOString(),
      sourceForm: { name: sourceFormName, revision: sourceFormRevision.trim() || null },
      // documentedByUserId (+ transcribedByUserId) are stamped server-side
      // from the authenticated session — never trusted from the client.
    };
    if (origin === "transcribed_from_paper") {
      capture.transcription = {
        transcribedByRole: role,
        transcribedAt: new Date().toISOString(),
        sourceReadinessId: context.screeningReadinessId,
        ...(sourceDocRefId.trim() && Number.isFinite(Number(sourceDocRefId)) ? { sourceDocumentReferenceId: Number(sourceDocRefId) } : {}),
      };
    }

    return {
      schemaVersion: 1,
      questionnaire: context.questionnaire,
      questionnaireVersion: context.questionnaireVersion,
      ancillaryCaseId: context.ancillaryCaseId,
      clinicId: context.clinicId,
      serviceType: context.serviceType,
      screeningReadinessId: context.screeningReadinessId,
      completionMode: "structured_questionnaire",
      capture,
      responses,
      ...(notes.trim() ? { screeningNotes: notes.trim() } : {}),
    };
  }

  async function submit() {
    if (!complete) {
      toast({ title: "Screening incomplete", description: `${missing.length} required item(s) unanswered.`, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/screening-evidence", buildPayload());
      const body = await res.json();
      if (body?.status === "completed") {
        try { localStorage.removeItem(draftKey(context)); } catch { /* ignore */ }
        toast({ title: "Screening submitted", description: "Order Note is being refreshed with the screening findings." });
        onSubmitted();
      } else if (body?.mode === "validate_and_log") {
        toast({
          title: body.accepted ? "Validated (enforcement off)" : "Validation failed (enforcement off)",
          description: body.accepted ? "Enable FEATURE_SCREENING_EVIDENCE_ENFORCE to persist." : (body.reasons ?? []).slice(0, 3).join("; "),
        });
      } else if (body?.status === "incomplete") {
        toast({ title: "Screening incomplete", description: `${(body.missing ?? []).length} required item(s) missing.`, variant: "destructive" });
      } else {
        toast({ title: "Submitted", description: JSON.stringify(body).slice(0, 140) });
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.body : (e as Error).message;
      toast({ title: "Submission failed", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="screening-questionnaire">
      <div className="rounded-lg border p-4 space-y-3">
        <div className="text-sm font-medium">
          {context.questionnaire === "brainwave" ? "BrainWave" : "VitalWave"} Screening
          {patientName ? ` — ${patientName}` : ""}
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Source</span>
            <select className="border rounded px-2 py-1" value={origin} onChange={(e) => setOrigin(e.target.value as Origin)} data-testid="screening-origin">
              <option value="direct_entry">Direct entry</option>
              <option value="transcribed_from_paper">Transcribed from paper/PDF</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Role</span>
            <select className="border rounded px-2 py-1" value={role} onChange={(e) => setRole(e.target.value as CaptureRole)} data-testid="screening-role">
              <option value="ACS">ACS</option>
              <option value="PCS">PCS</option>
              <option value="clinician">Clinician</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Form</span>
            <input className="border rounded px-2 py-1 w-64" value={sourceFormName} onChange={(e) => setSourceFormName(e.target.value)} />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Form revision</span>
            <input className="border rounded px-2 py-1 w-28" placeholder="(optional)" value={sourceFormRevision} onChange={(e) => setSourceFormRevision(e.target.value)} />
          </label>
          {origin === "transcribed_from_paper" && (
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Source PDF ref id</span>
              <input className="border rounded px-2 py-1 w-28" placeholder="(optional)" value={sourceDocRefId} onChange={(e) => setSourceDocRefId(e.target.value)} />
            </label>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {answeredCount}/{totalRequired} answered{origin === "transcribed_from_paper" ? " · transcribed from the paper questionnaire; answers remain patient-reported" : ""}.
        </div>
      </div>

      {sections.map((section) => (
        <div key={section.key} className="space-y-2">
          <div className="text-sm font-semibold">{section.title}</div>
          <div className="divide-y rounded-lg border">
            {section.items.map((item) => {
              const v = answers[item.questionId];
              return (
                <div key={item.questionId} className="flex items-center justify-between gap-4 px-3 py-2">
                  <div className="text-sm">
                    {item.label}
                    {item.control ? <span className="ml-1 text-xs text-muted-foreground">(optional)</span> : null}
                  </div>
                  {item.responseType === "boolean" ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className={`rounded px-2 py-1 text-xs border ${v === true ? "bg-emerald-600 text-white" : ""}`}
                        onClick={() => setAnswer(item.questionId, true)}
                        data-testid={`ans-${item.questionId}-yes`}
                      >Yes</button>
                      <button
                        type="button"
                        className={`rounded px-2 py-1 text-xs border ${v === false ? "bg-slate-700 text-white" : ""}`}
                        onClick={() => setAnswer(item.questionId, false)}
                        data-testid={`ans-${item.questionId}-no`}
                      >No</button>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      {scaleLabels(item.responseType as "severity_scale" | "frequency_scale").map((lbl, n) => (
                        <button
                          key={n}
                          type="button"
                          title={lbl}
                          className={`w-7 rounded px-1 py-1 text-xs border ${v === n ? "bg-indigo-600 text-white" : ""}`}
                          onClick={() => setAnswer(item.questionId, n)}
                          data-testid={`ans-${item.questionId}-${n}`}
                        >{n}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="space-y-2">
        <div className="text-sm font-semibold">Screening notes (optional)</div>
        <textarea className="w-full border rounded p-2 text-sm" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex items-center justify-between gap-3 sticky bottom-0 bg-background py-3 border-t">
        <div className="text-xs text-muted-foreground">
          {complete ? "All required items answered." : `${missing.length} required item(s) remaining.`}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={saveDraft} disabled={submitting}>Save Draft</Button>
          <Button onClick={submit} disabled={submitting || !complete} data-testid="screening-submit">
            {submitting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            Submit Screening
          </Button>
        </div>
      </div>
    </div>
  );
}
