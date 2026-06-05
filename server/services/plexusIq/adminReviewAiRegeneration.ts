import OpenAI from "openai";
import type { PatientScreening } from "@shared/schema";
import type {
  AdminEvidenceChip,
  AdminReviewAncillaryId,
} from "@shared/plexus-iq/adminReviewEvidence";

type RegenerateMode = "clinician" | "patient" | "all";

export type AdminReviewAiRegenerationInput = {
  patient: PatientScreening;
  ancillaryId: AdminReviewAncillaryId | string;
  mode: RegenerateMode;
  assignedEvidence: AdminEvidenceChip[];
  ancillaryNote?: string;
  previousClinicianReasoning?: string;
  previousPatientExplanation?: string;
};

export type AdminReviewAiRegenerationOutput = {
  clinicianReasoning: string;
  patientExplanation: string;
  ancillaryNote: string;
};

function patientAge(patient: PatientScreening): number | null {
  if (typeof patient.age === "number") return patient.age;
  if (!patient.dob) return null;

  const dob = new Date(patient.dob);
  if (Number.isNaN(dob.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDelta = now.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

function evidenceLine(item: AdminEvidenceChip): string {
  const icd = item.icdCode
    ? ` ICD ${item.icdCode}${item.icdLabel ? ` (${item.icdLabel})` : ""}`
    : "";
  const source = item.source ? ` source ${item.source}` : "";
  const detail = item.detail ? ` detail ${item.detail}` : "";
  return `- ${item.kind}: ${item.label}${icd}${source}${detail}`;
}

function parseJsonOutput(raw: string): AdminReviewAiRegenerationOutput {
  const parsed = JSON.parse(raw) as Partial<AdminReviewAiRegenerationOutput>;
  return {
    clinicianReasoning: String(parsed.clinicianReasoning ?? "").trim(),
    patientExplanation: String(parsed.patientExplanation ?? "").trim(),
    ancillaryNote: String(parsed.ancillaryNote ?? "").trim(),
  };
}

export async function regenerateAdminReviewReasoning(
  input: AdminReviewAiRegenerationInput,
): Promise<AdminReviewAiRegenerationOutput> {
  // Repo convention: AI_INTEGRATIONS_OPENAI_API_KEY is the canonical key (set
  // by Replit integration). Fall back to OPENAI_API_KEY for local/dev setups.
  // AI_INTEGRATIONS_OPENAI_BASE_URL is the Replit-side proxy/base override.
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY) is not configured",
    );
  }

  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined;
  const client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
  const age = patientAge(input.patient);
  const under16 = typeof age === "number" && age < 16;
  const evidenceText = input.assignedEvidence.length
    ? input.assignedEvidence.map(evidenceLine).join("\n")
    : "- no selected evidence";

  const systemPrompt = [
    "You generate concise clinician-facing and patient-facing ancillary review text.",
    "Use only the patient context and selected evidence provided.",
    "Do not invent diagnoses, medications, symptoms, ICD codes, prior tests, or eligibility.",
    "Do not say the patient automatically qualifies.",
    "If evidence is weak or missing, state what is missing.",
    "Clinician/admin approval is final.",
    "For patients under 16, clearly state admin approval is required and routine ancillary testing is generally not performed.",
    "Return strict JSON only.",
  ].join("\n");

  const userPrompt = [
    `Ancillary: ${input.ancillaryId}`,
    `Mode requested: ${input.mode}`,
    `Under 16: ${under16 ? "yes" : "no"}`,
    "",
    "Patient context:",
    `Name: ${input.patient.name ?? ""}`,
    `Age: ${age ?? ""}`,
    `Hx: ${input.patient.history ?? ""}`,
    `Dx: ${input.patient.diagnoses ?? ""}`,
    `Rx: ${input.patient.medications ?? ""}`,
    `Admin ancillary note: ${input.ancillaryNote ?? ""}`,
    "",
    "Selected evidence:",
    evidenceText,
    "",
    "Write:",
    "- clinicianReasoning: concise medical rationale tied to selected evidence.",
    "- patientExplanation: simple, patient-friendly explanation.",
    "- ancillaryNote: short admin-facing note for the ancillary card.",
  ].join("\n");

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "admin_review_regeneration",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            clinicianReasoning: { type: "string" },
            patientExplanation: { type: "string" },
            ancillaryNote: { type: "string" },
          },
          required: ["clinicianReasoning", "patientExplanation", "ancillaryNote"],
        },
      },
    },
  });

  const output = parseJsonOutput(response.output_text);

  return {
    clinicianReasoning:
      output.clinicianReasoning || input.previousClinicianReasoning || "",
    patientExplanation:
      output.patientExplanation || input.previousPatientExplanation || "",
    ancillaryNote: output.ancillaryNote || input.ancillaryNote || "",
  };
}

// ─── Canonical reasoning (one entry per qualifying test) ─────────────
// Produces the same shape every other surface already reads from:
//   patient.reasoning[testName] = {
//     clinician_understanding, patient_talking_points,
//     qualifying_factors, icd10_codes, pearls, confidence, approvalRequired
//   }
// Powers QualificationReasoningDialog, the patient-card icon popup, and
// pdfGeneration. Returned as a sparse map of testName -> object.

export type CanonicalReasoningEntry = {
  clinician_understanding: string;
  patient_talking_points: string;
  qualifying_factors: string[];
  icd10_codes: string[];
  pearls: string[];
  confidence: "high" | "medium" | "low";
  approvalRequired: boolean;
};

export type CanonicalReasoningRegenerationInput = {
  patient: PatientScreening;
  qualifyingTests: string[];
  assignedEvidenceByAncillary: Record<AdminReviewAncillaryId, AdminEvidenceChip[]>;
  ancillaryNotes: Record<AdminReviewAncillaryId, string>;
  adminNote?: string;
  icdCodes: Array<{ code: string; label: string }>;
  // Per-test additive merge inputs. These are read by the deterministic
  // pre-merge and re-enforced after OpenAI returns.
  existingReasoningByTest?: Record<string, CanonicalReasoningEntry | undefined>;
  removedFactorsByTest?: Record<string, string[]>;
  selectedSupportButtonsByTest?: Record<string, AdminEvidenceChip[]>;
  // Authoritative qualifying-factor floor. When the client sends this
  // (it does today — read directly from patient.reasoning[testName] in
  // the dialog), it overrides the inferred prior from
  // existingReasoningByTest. This guards against patients whose stored
  // reasoning has lost the array via round-trip.
  priorQualifyingFactorsByTest?: Record<string, string[]>;
};

export type CanonicalReasoningRegenerationOutput = {
  reasoningByTest: Record<string, CanonicalReasoningEntry>;
};

function parseCanonicalOutput(raw: string): CanonicalReasoningRegenerationOutput {
  const parsed = JSON.parse(raw) as { entries?: Array<{ testName?: string } & Partial<CanonicalReasoningEntry>> };
  const out: Record<string, CanonicalReasoningEntry> = {};
  for (const entry of parsed.entries ?? []) {
    if (!entry?.testName) continue;
    const conf = entry.confidence;
    out[entry.testName] = {
      clinician_understanding: String(entry.clinician_understanding ?? "").trim(),
      patient_talking_points: String(entry.patient_talking_points ?? "").trim(),
      qualifying_factors: Array.isArray(entry.qualifying_factors)
        ? entry.qualifying_factors.map((f) => String(f))
        : [],
      icd10_codes: Array.isArray(entry.icd10_codes) ? entry.icd10_codes.map((c) => String(c)) : [],
      pearls: Array.isArray(entry.pearls) ? entry.pearls.map((p) => String(p)) : [],
      confidence: conf === "high" || conf === "medium" || conf === "low" ? conf : "medium",
      approvalRequired: !!entry.approvalRequired,
    };
  }
  return { reasoningByTest: out };
}

export async function regenerateCanonicalReasoning(
  input: CanonicalReasoningRegenerationInput,
): Promise<CanonicalReasoningRegenerationOutput> {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY) is not configured",
    );
  }
  if (input.qualifyingTests.length === 0) {
    return { reasoningByTest: {} };
  }

  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined;
  const client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
  const age = patientAge(input.patient);
  const under16 = typeof age === "number" && age < 16;

  const evidenceBlocks = (
    ["brainwave", "vitalwave", "ultrasound"] as AdminReviewAncillaryId[]
  )
    .map((id) => {
      const lines = (input.assignedEvidenceByAncillary[id] ?? []).map(evidenceLine);
      const note = (input.ancillaryNotes[id] ?? "").trim();
      const body = lines.length ? lines.join("\n") : "  (none assigned)";
      const noteLine = note ? `\n  Admin note: ${note}` : "";
      return `[${id}]\n${body}${noteLine}`;
    })
    .join("\n\n");

  const icdLines = input.icdCodes.length
    ? input.icdCodes.map((c) => `- ${c.code} ${c.label}`).join("\n")
    : "- (none)";

  // Deterministic merge of existing qualifying_factors + selected
  // support buttons - explicitly removed factors. The merged value is
  // sent to OpenAI as the starting point so the model preserves rather
  // than wipes prior context. After OpenAI returns, the same merge is
  // enforced again on the output (post-process).
  const existingReasoning = input.existingReasoningByTest ?? {};
  const removedByTest = input.removedFactorsByTest ?? {};
  const selectedByTest = input.selectedSupportButtonsByTest ?? {};

  function labelForQualifyingFactor(chip: AdminEvidenceChip): string {
    if (chip.icdCode && chip.label) return `${chip.icdCode} · ${chip.label}`;
    return chip.label;
  }

  function dedupePreserveOrder(items: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of items) {
      const v = String(raw ?? "").trim();
      if (!v) continue;
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }

  // Authoritative client-supplied prior wins over inferred reasoning.
  const priorByTest = input.priorQualifyingFactorsByTest ?? {};

  function mergedQualifyingFactorsFor(testName: string): string[] {
    const prior =
      priorByTest[testName] ??
      existingReasoning[testName]?.qualifying_factors ??
      [];
    const selectedLabels = (selectedByTest[testName] ?? []).map(labelForQualifyingFactor);
    const removedSet = new Set(
      (removedByTest[testName] ?? []).map((s) => s.trim().toLowerCase()),
    );
    const combined = dedupePreserveOrder([...prior, ...selectedLabels]);
    return combined.filter((f) => !removedSet.has(f.toLowerCase()));
  }

  const mergedQualifyingFactorsByTest: Record<string, string[]> = {};
  for (const t of input.qualifyingTests) {
    mergedQualifyingFactorsByTest[t] = mergedQualifyingFactorsFor(t);
  }

  const priorReasoningBlock = input.qualifyingTests
    .map((t) => {
      const e = existingReasoning[t];
      if (!e) return `[${t}]\n  (no prior reasoning on file)`;
      const lines = [
        `[${t}]`,
        `  clinician_understanding: ${e.clinician_understanding || "(empty)"}`,
        `  patient_talking_points: ${e.patient_talking_points || "(empty)"}`,
        `  qualifying_factors (preserve unless explicitly removed):`,
        ...mergedQualifyingFactorsByTest[t].map((f) => `    - ${f}`),
        `  icd10_codes: ${(e.icd10_codes ?? []).join(", ") || "(none)"}`,
        `  pearls: ${(e.pearls ?? []).join("; ") || "(none)"}`,
      ];
      const removedHere = removedByTest[t] ?? [];
      if (removedHere.length) {
        lines.push(
          `  explicitly removed factors (do not reintroduce):`,
          ...removedHere.map((f) => `    - ${f}`),
        );
      }
      return lines.join("\n");
    })
    .join("\n\n");

  const systemPrompt = [
    "You generate concise canonical per-test reasoning objects for an ancillary screening platform.",
    "Use only the patient context, selected evidence per ancillary, and ICD codes provided.",
    "Do not invent diagnoses, medications, symptoms, ICD codes, or prior tests beyond what is supplied.",
    "Each test object must include clinician_understanding (concise medical rationale tied to evidence),",
    "patient_talking_points (plain-language explanation), qualifying_factors (short bullet strings),",
    "icd10_codes (only codes drawn from supplied ICD list), pearls (1-3 short clinical pearls),",
    "confidence (high/medium/low), and approvalRequired (true if under 16 or evidence is weak).",
    "If a test has no supporting evidence, mark approvalRequired true and state what is missing.",
    // Additive merge contract (deterministic post-process enforces it too).
    "Preserve existing qualifying_factors unless the admin-selected support items explicitly remove or contradict them.",
    "Do not drop previous qualifying factors.",
    "Add new qualifying factors from selected support buttons.",
    "Do not reintroduce explicitly removed qualifying factors.",
    "Selected support buttons are the active qualifying support layer.",
    "Return strict JSON only matching the provided schema.",
  ].join("\n");

  const userPrompt = [
    `Under 16: ${under16 ? "yes — approvalRequired must be true for every test" : "no"}`,
    "",
    "Patient context:",
    `Name: ${input.patient.name ?? ""}`,
    `Age: ${age ?? ""}`,
    `Hx: ${input.patient.history ?? ""}`,
    `Dx: ${input.patient.diagnoses ?? ""}`,
    `Rx: ${input.patient.medications ?? ""}`,
    `Admin note: ${input.adminNote ?? ""}`,
    "",
    "ICD codes available:",
    icdLines,
    "",
    "Selected evidence by ancillary:",
    evidenceBlocks,
    "",
    "Existing reasoning per test (preserve unless explicitly removed; mergedQualifyingFactors below is the floor):",
    priorReasoningBlock,
    "",
    "Qualifying tests to regenerate (one entry per test name, preserve exact spelling):",
    input.qualifyingTests.map((t) => `- ${t}`).join("\n"),
  ].join("\n");

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "admin_review_canonical_regeneration",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            entries: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  testName: { type: "string" },
                  clinician_understanding: { type: "string" },
                  patient_talking_points: { type: "string" },
                  qualifying_factors: { type: "array", items: { type: "string" } },
                  icd10_codes: { type: "array", items: { type: "string" } },
                  pearls: { type: "array", items: { type: "string" } },
                  confidence: { type: "string", enum: ["high", "medium", "low"] },
                  approvalRequired: { type: "boolean" },
                },
                required: [
                  "testName",
                  "clinician_understanding",
                  "patient_talking_points",
                  "qualifying_factors",
                  "icd10_codes",
                  "pearls",
                  "confidence",
                  "approvalRequired",
                ],
              },
            },
          },
          required: ["entries"],
        },
      },
    },
  });

  const parsed = parseCanonicalOutput(response.output_text);

  // Post-process: enforce the deterministic merge so OpenAI cannot
  // drop preserved factors and cannot resurrect explicitly removed ones.
  for (const t of input.qualifyingTests) {
    const aiEntry = parsed.reasoningByTest[t];
    const floorFactors = mergedQualifyingFactorsByTest[t] ?? [];
    const removedSet = new Set(
      (removedByTest[t] ?? []).map((s) => s.trim().toLowerCase()),
    );
    const aiFactors = Array.isArray(aiEntry?.qualifying_factors)
      ? aiEntry!.qualifying_factors
      : [];
    const combined = dedupePreserveOrder([...floorFactors, ...aiFactors]).filter(
      (f) => !removedSet.has(f.toLowerCase()),
    );

    const existing = existingReasoning[t];
    const fallback: CanonicalReasoningEntry = {
      clinician_understanding: existing?.clinician_understanding ?? "",
      patient_talking_points: existing?.patient_talking_points ?? "",
      qualifying_factors: combined,
      icd10_codes: existing?.icd10_codes ?? [],
      pearls: existing?.pearls ?? [],
      confidence: existing?.confidence ?? "medium",
      approvalRequired: existing?.approvalRequired ?? false,
    };

    if (aiEntry) {
      parsed.reasoningByTest[t] = {
        ...aiEntry,
        qualifying_factors: combined,
        clinician_understanding:
          aiEntry.clinician_understanding || fallback.clinician_understanding,
        patient_talking_points:
          aiEntry.patient_talking_points || fallback.patient_talking_points,
      };
    } else {
      parsed.reasoningByTest[t] = fallback;
    }
  }

  return parsed;
}
