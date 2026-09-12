// Smart-paste → PATIENT DRAFT parser.
//
// Reuses the DETERMINISTIC shared column vocabulary (patientColumnMap) FIRST.
// A pasted block of "Label: value" lines (the common EHR/referral copy-paste)
// is parsed with zero AI. Only genuinely unstructured prose falls back to a
// BOUNDED AI extraction. The parser NEVER invents values and NEVER arbitrarily
// resolves an ambiguous field (e.g. Account # vs Medical Record #) — it surfaces
// the candidates for the human to choose. Output is a DRAFT, never a DB write.

import { mapHeaderToField, type CanonicalPatientField } from "@shared/patientColumnMap";
import { normalizePatientDraft, type CanonicalPatientDraft } from "@shared/canonicalPatientDraft";

export type FieldAmbiguity = {
  field: CanonicalPatientField;
  candidates: Array<{ label: string; value: string }>;
};

export type PatientDraftParseResult = {
  draft: CanonicalPatientDraft;
  ambiguities: FieldAmbiguity[];
  warnings: string[];
  method: "deterministic" | "ai" | "empty";
};

// Provider credential pattern — a "name" that is really a clinician, so it is
// NOT treated as the patient.
const PROVIDER_CREDENTIAL_RE =
  /\b(D\.O\.|M\.D\.|NP-BC|NP-C|APRN|ARNP|PA-C|PA\b|RN\b|DO\b|MD\b|NP\b|Ph\.D\.)/i;

// A line is "label: value" when it has a colon with a short-ish label on the left.
const LABEL_VALUE_RE = /^\s*([A-Za-z][A-Za-z0-9 #/._'-]{0,40}?)\s*[:\-]\s*(.+?)\s*$/;

const MAX_AI_CHARS = 20000;

/** Map a canonical field to the draft key it populates. */
const FIELD_TO_DRAFT: Partial<Record<CanonicalPatientField, keyof CanonicalPatientDraft>> = {
  name: "name",
  dob: "dob",
  gender: "gender",
  age: "age",
  phone: "phoneNumber",
  email: "email",
  address: "address",
  mrn: "mrn",
  insurance: "insurance",
  memberId: "memberId",
  facility: "facility",
  provider: "provider",
  diagnoses: "diagnoses",
  medications: "medications",
  history: "history",
  allergies: "allergies",
  notes: "notes",
};

/**
 * Deterministic label:value parse. Collects every mapped label; when two
 * DIFFERENT labels map to the same field with different values it is recorded
 * as an ambiguity (not silently resolved). firstName/lastName combine into name.
 */
function parseDeterministic(text: string): PatientDraftParseResult | null {
  const lines = text.split(/\r?\n/);
  // field → list of {label,value}
  const byField = new Map<CanonicalPatientField, Array<{ label: string; value: string }>>();
  let firstName: string | null = null;
  let lastName: string | null = null;
  let labeledCount = 0;

  for (const line of lines) {
    const m = line.match(LABEL_VALUE_RE);
    if (!m) continue;
    const label = m[1].trim();
    const value = m[2].trim();
    if (!value) continue;
    const field = mapHeaderToField(label);
    if (!field) continue;
    labeledCount += 1;
    if (field === "firstName") { firstName = value; continue; }
    if (field === "lastName") { lastName = value; continue; }
    const arr = byField.get(field) ?? [];
    arr.push({ label, value });
    byField.set(field, arr);
  }

  // Require at least a name signal from labels to trust the deterministic path.
  const hasNameLabel = byField.has("name") || firstName != null || lastName != null;
  if (labeledCount < 2 || !hasNameLabel) return null;

  const draftRaw: Partial<CanonicalPatientDraft> & { firstName?: string | null; lastName?: string | null } = {
    firstName, lastName,
  };
  const ambiguities: FieldAmbiguity[] = [];
  const warnings: string[] = [];

  for (const [field, candidates] of byField) {
    const draftKey = FIELD_TO_DRAFT[field];
    if (!draftKey) continue;
    const distinct = dedupeByValue(candidates);
    if (distinct.length > 1) {
      // Two different labels/values for one field → surface, don't guess.
      ambiguities.push({ field, candidates: distinct });
      continue;
    }
    const value = distinct[0].value;
    if (field === "name" && PROVIDER_CREDENTIAL_RE.test(value)) {
      warnings.push(`ignored_provider_as_name:${value}`);
      continue;
    }
    (draftRaw as Record<string, unknown>)[draftKey] =
      draftKey === "age" ? (/^\d{1,3}$/.test(value) ? parseInt(value, 10) : null) : value;
  }

  const draft = normalizePatientDraft(draftRaw);
  if (!draft.name) return null;
  return { draft, ambiguities, warnings, method: "deterministic" };
}

function dedupeByValue(cands: Array<{ label: string; value: string }>): Array<{ label: string; value: string }> {
  const seen = new Set<string>();
  const out: Array<{ label: string; value: string }> = [];
  for (const c of cands) {
    const k = c.value.trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/**
 * Bounded AI fallback for unstructured prose. Strict no-fabrication prompt;
 * input capped at MAX_AI_CHARS. Returns a draft with only what was explicitly
 * present. Never writes to the DB.
 */
async function parseWithBoundedAi(text: string): Promise<PatientDraftParseResult> {
  const bounded = text.slice(0, MAX_AI_CHARS);
  const truncated = text.length > MAX_AI_CHARS;
  const { openai, withRetry } = await import("../aiClient");
  const resp = await withRetry(
    () =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Extract ONE patient's fields from the text. Return JSON with keys: " +
              "name, dob, gender, phoneNumber, email, address, mrn, insurance, memberId, " +
              "facility, provider, diagnoses, medications, history, allergies, notes. " +
              "RULES: Use ONLY values explicitly present. NEVER infer or fabricate — if a " +
              "field is absent, return null. Do NOT derive DOB from age, MRN from account " +
              "number, insurance id from another number, diagnoses from medications, or " +
              "facility from prose. If the text names a provider/clinician distinct from the " +
              "patient, do NOT use the provider as the patient name. dob as YYYY-MM-DD only if " +
              "explicitly present.",
          },
          { role: "user", content: bounded },
        ],
      }),
    2,
    "patient_draft_ai",
  );
  const content = resp.choices[0]?.message?.content ?? "{}";
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(content); } catch { parsed = {}; }
  const draft = normalizePatientDraft(parsed as Partial<CanonicalPatientDraft>);
  const warnings: string[] = [];
  if (truncated) warnings.push(`input_truncated_at:${MAX_AI_CHARS}`);
  if (!draft.name) warnings.push("no_name_detected");
  return { draft, ambiguities: [], warnings, method: "ai" };
}

/**
 * Parse pasted text into a patient draft. Deterministic-first; bounded AI only
 * when the text is not recognizable label:value structure.
 */
export async function parsePatientDraft(text: string): Promise<PatientDraftParseResult> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { draft: normalizePatientDraft({}), ambiguities: [], warnings: ["empty_input"], method: "empty" };

  const deterministic = parseDeterministic(trimmed);
  if (deterministic) return deterministic;

  return parseWithBoundedAi(trimmed);
}
