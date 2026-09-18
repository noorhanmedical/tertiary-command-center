// Deterministic clinical grouping helpers for the EHR chart.
//
// These are PRESENTATION-ONLY groupings driven by standard, maintained rules
// (ICD-10 chapter letters, explicit frequency tokens). They never infer
// clinical meaning heuristically/AI and always fall back to a safe bucket, so
// the chart can organize long lists without changing source data.

/**
 * Map an ICD-10 code to an organ-system group using the standard ICD-10-CM
 * chapter letter. Deterministic; unknown/absent codes fall back to "Other".
 */
export function icd10System(code?: string | null): string {
  if (!code) return "Other";
  const c = code.trim().toUpperCase();
  const letter = c[0];
  const num = Number.parseInt(c.slice(1, 3), 10);
  switch (letter) {
    case "I": return "Cardiovascular";
    case "G": return "Neurologic";
    case "F": return "Psychiatric";
    case "E": return "Endocrine / Metabolic";
    case "J": return "Pulmonary";
    case "K": return "Gastrointestinal";
    case "N": return "Renal / Genitourinary";
    case "M": return "Musculoskeletal";
    case "C": return "Neoplasm";
    case "L": return "Dermatologic";
    case "D":
      // D00–D49 neoplasms; D50–D89 blood/immune.
      return !Number.isNaN(num) && num <= 49 ? "Neoplasm" : "Blood / Immune";
    case "H":
      // H00–H59 eye; H60–H95 ear.
      return !Number.isNaN(num) && num <= 59 ? "Ophthalmologic" : "Ear / Mastoid";
    default:
      return "Other";
  }
}

/** Canonical display order for organ-system groups; "Other" always last. */
export const ORGAN_SYSTEM_ORDER = [
  "Cardiovascular",
  "Neurologic",
  "Endocrine / Metabolic",
  "Pulmonary",
  "Gastrointestinal",
  "Renal / Genitourinary",
  "Musculoskeletal",
  "Psychiatric",
  "Neoplasm",
  "Blood / Immune",
  "Dermatologic",
  "Ophthalmologic",
  "Ear / Mastoid",
  "Other",
] as const;

/** True when a medication frequency string explicitly denotes PRN / as-needed. */
export function isPrnFrequency(freq?: string | null): boolean {
  if (!freq) return false;
  return /\bprn\b|as[\s-]?needed/i.test(freq);
}

export type AllergyTone = "rose" | "amber" | "neutral";

/** Map an allergy severity to a restrained semantic tone. Unknown → neutral. */
export function allergySeverityTone(severity?: string | null): AllergyTone {
  const s = (severity ?? "").toLowerCase();
  if (/severe|anaphyla|life[\s-]?threat/.test(s)) return "rose";
  if (/moderate/.test(s)) return "amber";
  return "neutral";
}
