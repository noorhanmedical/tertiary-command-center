// Order Note standard — SLICE AI-2: OpenAI Responses API narrative generator.
//
// Generates ONLY the two narrative sections of the Order Note:
//   • clinicalHistoryIndication
//   • assessmentMedicalNecessity
// from the deterministic, provenance-tagged evidence bundle (AI-1). Everything
// else (patient info, order/plan, attestation, identifiers, signatures) is
// rendered deterministically downstream. Reuses the SHARED OpenAI client
// (services/aiClient) + the existing Responses API pattern — no duplicate
// client stack. Strict JSON-schema output; no ICD/CPT; ordered-components-only.

import { openai, withRetry } from "../aiClient";
import type { OrderNoteEvidenceBundle, EvidenceFact } from "./orderNoteEvidenceBundle";

export const ORDER_NOTE_PROMPT_VERSION = "order_note_narrative_v1";

export type OrderNoteReasoningEffort = "low" | "medium" | "high";

export function orderNoteAiModel(): string {
  return process.env.ORDER_NOTE_AI_MODEL || "gpt-5.6-sol";
}
export function orderNoteAiReasoningEffort(): OrderNoteReasoningEffort {
  const raw = (process.env.ORDER_NOTE_AI_REASONING_EFFORT || "medium").toLowerCase();
  return raw === "low" || raw === "high" ? raw : "medium";
}

export type OrderNoteNarrative = { clinicalHistoryIndication: string; assessmentMedicalNecessity: string };

export type OrderNoteNarrativeResult = {
  narrative: OrderNoteNarrative;
  modelUsed: string;
  reasoningEffort: OrderNoteReasoningEffort;
  promptVersion: string;
  generatedAt: string;
  rawResponse: string;
};

const SYSTEM_PROMPT = [
  "You are drafting a focused physician ancillary Order Note for a diagnostic testing service.",
  "You write ONLY two sections: (1) Clinical History / Indication, (2) Assessment / Medical Necessity.",
  "Use ONLY the supplied case-scoped evidence. Do not use outside knowledge to add patient facts.",
  "",
  "Clinical History / Indication: summarize the patient-specific history and current findings relevant to the ordered service, using the patient's name naturally. Distinguish patient-reported information from chart-documented information. Do not list every problem or every negative screening response.",
  "",
  "Assessment / Medical Necessity: write ONE cohesive, extensive physician-level narrative (not sub-sections). Explain the dominant clinical concerns, how chart evidence and screening evidence corroborate one another, how relevant medications/labs/vitals/prior imaging affect the clinical context, why objective testing is reasonable, and specifically why EACH ordered component is appropriate and what clinical question it helps evaluate — as one integrated narrative. Explain reasoning; do not write 'patient has X therefore test Y is necessary'.",
  "",
  "Hard rules:",
  "- Preserve evidence certainty. Patient-reported findings stay patient-reported ('the patient reports ...'); only chart-documented items may be stated as documented ('documented history of ...'). Never upgrade a patient-reported item to a documented disease.",
  "- Prior imaging findings may be stated ONLY when an actual prior imaging result is supplied, and attributed as such ('prior imaging documented ...'). Never infer prior findings from diagnoses, symptoms, medications, or the procedure name.",
  "- A specific lab value, vital, or imaging finding may be stated ONLY if it appears in the supplied evidence.",
  "- Medication use may corroborate context but must NOT be converted into a new diagnosis.",
  "- Discuss ONLY components listed in orderedComponents as ordered. Never mention a component that is not in that list.",
  "- Do NOT presume any specific abnormality, result, diagnosis, stenosis, reduced function, or disease detection. No specific abnormal finding is presumed by the order.",
  "- Do NOT include any ICD-10 or CPT codes.",
  "- Do NOT claim testing already occurred; the study has not yet been performed.",
  "- Do NOT fabricate signatures, dates, providers, or NPI.",
  "- Do NOT produce generic boilerplate that could apply to any patient; the content must reflect THIS patient's specific evidence.",
  "- The two sections must not substantially duplicate one another.",
  "Return strict JSON only, matching the provided schema.",
].join("\n");

function factLines(label: string, facts: EvidenceFact[]): string {
  if (!facts.length) return `${label}: (none supplied)`;
  return `${label}:\n${facts.map((f) => `  - [${f.evidenceClass}] ${f.displayText}${f.date ? ` (${f.date})` : ""} {src ${f.sourceType}#${f.sourceRecordId ?? "-"}}`).join("\n")}`;
}

function buildUserPrompt(bundle: OrderNoteEvidenceBundle): string {
  const p = bundle.patient;
  const screening = bundle.structuredScreening;
  const screeningLines = screening && screening.findings.length
    ? `Structured ${screening.questionnaire} screening (version ${screening.version}) — patient-reported positives:\n${screening.findings
        .map((f) => `  - ${f.displayText}${f.normalizedMeaning ? ` (${f.normalizedMeaning})` : typeof f.value === "boolean" ? " (reported)" : ` (${f.value}/5)`} [${f.evidenceClass}]`)
        .join("\n")}`
    : "Structured screening: (none / no positive responses)";

  return [
    `Ancillary service: ${bundle.serviceLabel} (${bundle.service})`,
    "",
    "Ordered components (justify ONLY these, and only where the patient's evidence supports them):",
    ...bundle.orderedComponents.map((c) => `  - ${c.label} — purpose: ${c.clinicalPurpose}`),
    "",
    "Patient context:",
    `  Name: ${p.name}`,
    `  Age: ${p.age ?? "unknown"}${p.sex ? ` | Sex: ${p.sex}` : ""}`,
    "",
    factLines("Chart-documented diagnoses (DX)", bundle.diagnoses),
    factLines("Chart-documented history (HX)", bundle.history),
    factLines("Medications (chart)", bundle.medications),
    factLines("Recent labs", bundle.labs),
    factLines("Recent vitals", bundle.vitals),
    factLines("Prior imaging / diagnostic results", bundle.priorImaging),
    factLines("Clinical notes / encounters (summaries)", bundle.clinicalNotes),
    factLines("Clinician-entered findings", bundle.clinicianFindings),
    "",
    screeningLines,
    "",
    `Qualification factors: ${bundle.qualification.factors.length ? bundle.qualification.factors.join("; ") : "(none)"}`,
    `Clinician understanding (qualification): ${bundle.qualification.clinicianUnderstanding ?? "(none)"}`,
    "",
    "Write clinicalHistoryIndication and assessmentMedicalNecessity for THIS patient per the rules.",
  ].join("\n");
}

const OUTPUT_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    clinicalHistoryIndication: { type: "string" as const },
    assessmentMedicalNecessity: { type: "string" as const },
  },
  required: ["clinicalHistoryIndication", "assessmentMedicalNecessity"],
};

/**
 * Generate the two AI narrative sections. Uses the shared client + existing
 * transient-retry policy. `correctiveFeedback` (from a failed compliance
 * validation) is appended so a retry can fix specific violations.
 */
export async function generateOrderNoteNarrative(
  bundle: OrderNoteEvidenceBundle,
  opts?: { reasoningEffort?: OrderNoteReasoningEffort; correctiveFeedback?: string },
): Promise<OrderNoteNarrativeResult> {
  const model = orderNoteAiModel();
  const effort = opts?.reasoningEffort ?? orderNoteAiReasoningEffort();
  const userPrompt = buildUserPrompt(bundle)
    + (opts?.correctiveFeedback ? `\n\nThe previous draft failed compliance validation. Fix ALL of these issues and regenerate:\n${opts.correctiveFeedback}` : "");

  const response = await withRetry(
    () => openai.responses.create({
      model,
      reasoning: { effort },
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "order_note_narrative",
          strict: true,
          schema: OUTPUT_SCHEMA,
        },
      },
    }),
    3,
    "order_note_narrative",
  );

  const raw = (response as { output_text?: string }).output_text ?? "";
  let parsed: Partial<OrderNoteNarrative> = {};
  try { parsed = JSON.parse(raw) as Partial<OrderNoteNarrative>; } catch { parsed = {}; }

  return {
    narrative: {
      clinicalHistoryIndication: String(parsed.clinicalHistoryIndication ?? "").trim(),
      assessmentMedicalNecessity: String(parsed.assessmentMedicalNecessity ?? "").trim(),
    },
    modelUsed: (response as { model?: string }).model ?? model,
    reasoningEffort: effort,
    promptVersion: ORDER_NOTE_PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    rawResponse: raw,
  };
}
