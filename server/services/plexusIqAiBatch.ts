// Plexus IQ runtime hardening — optional micro-batch AI path.
//
// **OPT-IN ONLY.** Default PLEXUS_IQ_AI_BATCH_SIZE=1 ships the safe
// single-patient behaviour. When operators raise the env var (e.g. 5),
// this module:
//   1. Builds a single structured-output request that asks the model
//      to qualify N patients in one call. Each patient carries a
//      stable `patientIndex` so we can re-key the response by id, not
//      by name.
//   2. Validates the JSON shape AND verifies every requested index is
//      returned exactly once.
//   3. Returns either { ok: true, results } where results[i]
//      corresponds to inputs[i], or { ok: false, reason } so the
//      runner can fall back to single-patient calls.
//
// The runner is responsible for the per-patient fallback (it already
// knows how to call screenSinglePatientWithAI). This module never
// touches the database.

import { openai } from "./aiClient";
import type { ScreeningPatientInput, QualificationMode } from "./screening";

export type MicroBatchPatientInput = ScreeningPatientInput & {
  /** Stable 1-based index for re-keying the model's response. */
  patientIndex: number;
};

export type MicroBatchSuccess = {
  ok: true;
  results: Array<{
    patientIndex: number;
    qualifyingTests: string[];
    reasoning: Record<string, unknown>;
    diagnoses?: string | null;
    history?: string | null;
    medications?: string | null;
    age?: number | null;
    gender?: string | null;
  }>;
};

export type MicroBatchFailure = {
  ok: false;
  reason: string;
};

export type MicroBatchResult = MicroBatchSuccess | MicroBatchFailure;

const MICRO_BATCH_SYSTEM_PROMPT = `You are a clinical ancillary qualification specialist. You will receive several patients in one request; you must qualify each one independently.

For each patient, return the SAME shape used in single-patient mode, plus the original 1-based "patientIndex" key so the caller can match your response back to its input. The qualifying-test catalog and reasoning conventions are unchanged.

Return a JSON object exactly of this shape:

{
  "patients": [
    {
      "patientIndex": 1,
      "name": "PATIENT NAME",
      "qualifyingTests": ["Test1", "Test2"],
      "reasoning": {
        "Test1": {
          "clinician_understanding": "...",
          "patient_talking_points": "...",
          "confidence": "high",
          "qualifying_factors": ["..."],
          "icd10_codes": ["..."],
          "pearls": ["..."],
          "approvalRequired": false
        }
      },
      "diagnoses": "extracted diagnoses",
      "history": "extracted history",
      "medications": "extracted medications",
      "age": 67,
      "gender": "M"
    }
  ]
}

Rules:
1. Every input patientIndex must appear exactly once in the response — do not drop, merge, or reorder.
2. If a patient does not qualify for any tests, return them with "qualifyingTests": [] and "reasoning": {}.
3. Use the same threshold/criteria for every patient — do not adapt across patients.`;

function patientToBlock(p: MicroBatchPatientInput): string {
  const parts = [`[patientIndex=${p.patientIndex}] Patient ${p.patientIndex}:`];
  if (p.name) parts.push(`Name: ${p.name}`);
  if (p.age != null) parts.push(`Age: ${p.age}`);
  if (p.gender) parts.push(`Gender: ${p.gender}`);
  if (p.diagnoses) parts.push(`Diagnoses: ${p.diagnoses}`);
  if (p.history) parts.push(`History/HPI: ${p.history}`);
  if (p.medications) parts.push(`Medications: ${p.medications}`);
  if (p.notes) parts.push(`Notes: ${p.notes}`);
  return parts.join("\n");
}

/**
 * Issue one AI call for N patients. Returns a validated, re-keyable
 * result on success. On any validation failure the caller MUST run
 * single-patient calls for the same patients (if
 * PLEXUS_IQ_AI_BATCH_FALLBACK_ENABLED) or mark them
 * `technical_failed: { category: 'batch_parse_failure' }`.
 */
export async function screenPatientsWithAIBatch(
  patients: MicroBatchPatientInput[],
  mode: QualificationMode,
  options: { timeoutMs: number },
): Promise<MicroBatchResult> {
  if (patients.length === 0) return { ok: true, results: [] };

  // Stable ordering: caller's patientIndex sequence. Verified post-parse.
  const description = patients.map(patientToBlock).join("\n\n");
  const requestedIndices = new Set(patients.map((p) => p.patientIndex));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await openai.chat.completions.create(
      {
        model: "gpt-4o",
        messages: [
          { role: "system", content: MICRO_BATCH_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Qualify each patient (mode=${mode}). Return one entry per patientIndex, in order.\n\n${description}`,
          },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
        max_completion_tokens: Math.min(16000, 2000 + patients.length * 1500),
      },
      { signal: controller.signal },
    );

    const content = response.choices[0]?.message?.content || "{}";
    const finishReason = response.choices[0]?.finish_reason;
    if (finishReason === "length") {
      return { ok: false, reason: "AI response truncated (finish_reason=length)" };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      return {
        ok: false,
        reason: `Invalid JSON from micro-batch: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!parsed || !Array.isArray(parsed.patients)) {
      return { ok: false, reason: "Response missing patients array" };
    }
    if (parsed.patients.length !== patients.length) {
      return {
        ok: false,
        reason: `Response had ${parsed.patients.length} patients, expected ${patients.length}`,
      };
    }

    const results: MicroBatchSuccess["results"] = [];
    const seenIndices = new Set<number>();
    for (const entry of parsed.patients as any[]) {
      const idx = Number(entry?.patientIndex);
      if (!Number.isFinite(idx) || !requestedIndices.has(idx)) {
        return {
          ok: false,
          reason: `Response contained unknown patientIndex ${entry?.patientIndex}`,
        };
      }
      if (seenIndices.has(idx)) {
        return {
          ok: false,
          reason: `Response contained duplicate patientIndex ${idx}`,
        };
      }
      seenIndices.add(idx);
      const qualifyingTests = Array.isArray(entry.qualifyingTests) ? entry.qualifyingTests : [];
      const reasoning =
        entry.reasoning && typeof entry.reasoning === "object" ? entry.reasoning : {};
      results.push({
        patientIndex: idx,
        qualifyingTests,
        reasoning,
        diagnoses: entry.diagnoses ?? null,
        history: entry.history ?? null,
        medications: entry.medications ?? null,
        age: entry.age ?? null,
        gender: entry.gender ?? null,
      });
    }

    return { ok: true, results };
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, reason: `Micro-batch AI call timed out after ${options.timeoutMs}ms` };
    }
    return {
      ok: false,
      reason: `Micro-batch AI call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}
