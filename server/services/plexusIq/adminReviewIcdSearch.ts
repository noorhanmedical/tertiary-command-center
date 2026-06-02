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

function safeMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 240);
  return String(err ?? "unknown").slice(0, 240);
}

function parseResults(raw: string): AdminReviewIcdSuggestion[] {
  let parsed: { results?: Array<Partial<AdminReviewIcdSuggestion>> };
  try {
    parsed = JSON.parse(raw) as { results?: Array<Partial<AdminReviewIcdSuggestion>> };
  } catch (err) {
    throw new Error(`OpenAI universal ICD search returned invalid JSON: ${safeMessage(err)}`);
  }
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
  return out.slice(0, 10);
}

export async function searchAdminReviewIcdCodes(
  input: AdminReviewIcdSearchInput,
): Promise<AdminReviewIcdSuggestion[]> {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("ICD search requires AI_INTEGRATIONS_OPENAI_API_KEY or OPENAI_API_KEY");
  }
  const query = input.query.trim();
  if (query.length < 2) {
    return [];
  }

  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined;
  const client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  // Patient context is OPTIONAL — it only helps rank or disambiguate ties.
  // The search itself is over the full ICD-10-CM code universe and must not
  // be restricted to whatever is already on this patient's chart.
  const dx = input.patientContext?.diagnoses ?? input.patient.diagnoses ?? "";
  const hx = input.patientContext?.history ?? input.patient.history ?? "";
  const rx = input.patientContext?.medications ?? input.patient.medications ?? "";

  const systemPrompt = [
    "You are a universal ICD-10-CM search assistant.",
    "Perform universal ICD-10-CM search across the full ICD-10-CM code universe.",
    "Do not limit results to the patient chart. patient context is optional.",
    "Patient context may help rank or disambiguate, but must not restrict the search.",
    "It is acceptable to return ICD-10-CM codes not already present in Hx/Dx/Rx.",
    "Return only real ICD-10-CM codes. Do not invent codes.",
    "If the query is ambiguous, return up to 10 plausible options ranked by confidence.",
    "Each result must include: code, label, short rationale (one sentence), confidence (high/medium/low).",
    "Return strict JSON only matching the schema.",
  ].join("\n");

  const userPrompt = [
    `Query: ${query}`,
    "",
    "Patient context (optional — may be empty; used only for ranking):",
    `Diagnoses: ${dx}`,
    `History: ${hx}`,
    `Medications: ${rx}`,
  ].join("\n");

  let response;
  try {
    response = await client.responses.create({
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
  } catch (err) {
    throw new Error(`OpenAI universal ICD search failed: ${safeMessage(err)}`);
  }

  return parseResults(response.output_text);
}
