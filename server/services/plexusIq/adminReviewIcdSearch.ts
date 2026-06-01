import OpenAI from "openai";
import type { PatientScreening } from "@shared/schema";

export type AdminReviewIcdSuggestion = {
  code: string;
  label: string;
  rationale: string;
  confidence: "high" | "medium" | "low";
};

export type AdminReviewIcdSearchInput = {
  query: string;
  patient: PatientScreening;
  patientContext?: {
    diagnoses?: string;
    history?: string;
    medications?: string;
  };
};

function parseResults(raw: string): AdminReviewIcdSuggestion[] {
  const parsed = JSON.parse(raw) as {
    results?: Array<Partial<AdminReviewIcdSuggestion>>;
  };
  const out: AdminReviewIcdSuggestion[] = [];
  for (const item of parsed.results ?? []) {
    const code = String(item?.code ?? "").trim();
    if (!code) continue;
    const conf = item?.confidence;
    out.push({
      code,
      label: String(item?.label ?? "").trim(),
      rationale: String(item?.rationale ?? "").trim(),
      confidence: conf === "high" || conf === "medium" || conf === "low" ? conf : "medium",
    });
  }
  return out.slice(0, 8);
}

export async function searchAdminReviewIcdCodes(
  input: AdminReviewIcdSearchInput,
): Promise<AdminReviewIcdSuggestion[]> {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY) is not configured",
    );
  }
  const query = input.query.trim();
  if (query.length < 2) {
    return [];
  }

  const client = new OpenAI({ apiKey });

  const dx = input.patientContext?.diagnoses ?? input.patient.diagnoses ?? "";
  const hx = input.patientContext?.history ?? input.patient.history ?? "";
  const rx = input.patientContext?.medications ?? input.patient.medications ?? "";

  const systemPrompt = [
    "You are an ICD-10-CM coding assistant for an ancillary screening platform.",
    "Return real ICD-10-CM codes only. Do not invent diagnoses unrelated to the query or patient context.",
    "Disambiguate using the patient's diagnoses, history, and medications when provided.",
    "If the query is ambiguous, return up to 8 plausible options ranked by confidence.",
    "Each result must include: code, label, short rationale (one sentence), and confidence (high/medium/low).",
    "Return strict JSON only matching the schema.",
  ].join("\n");

  const userPrompt = [
    `Query: ${query}`,
    "",
    "Patient context (optional, may be empty):",
    `Diagnoses: ${dx}`,
    `History: ${hx}`,
    `Medications: ${rx}`,
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
        name: "admin_review_icd_search",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  code: { type: "string" },
                  label: { type: "string" },
                  rationale: { type: "string" },
                  confidence: { type: "string", enum: ["high", "medium", "low"] },
                },
                required: ["code", "label", "rationale", "confidence"],
              },
            },
          },
          required: ["results"],
        },
      },
    },
  });

  return parseResults(response.output_text);
}
