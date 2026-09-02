// Canonical ancillary service identity + alias normalization.
//
// PROBLEM
// -------
// Display-name drift ("Lower Extremity Venous Doppler" vs "Lower Extremity
// Venous Duplex", "LE Venous Duplex", etc.) must NOT create a separate clinical
// lifecycle. Every ancillary case, appointment, document, prerequisite lookup,
// and billing evaluation must key off ONE stable service identity.
//
// MODEL
// -----
//   canonical key (== ancillary_service_registry.internal_code)
//       ↑ resolved from ↑
//   an EXPLICIT alias set (display names + known variants)
//
// Resolution is EXPLICIT (an alias table), never fuzzy matching. An unknown
// string is returned unchanged so nothing is silently mis-mapped or dropped —
// callers that must reject unknowns can check isCanonicalServiceType().
//
// The canonical keys here MUST match ancillary_service_registry.internal_code
// (migration 0058). This module is the single source of truth for normalizing a
// raw service string to that identity BEFORE case lookup/creation, eligibility,
// appointment linkage, document generation, prerequisite lookup, and billing.

/** The stable canonical service identities (== registry internal_code). */
export const CANONICAL_SERVICE_TYPES = [
  "BrainWave",
  "VitalWave",
  "Bilateral Carotid Duplex",
  "Echocardiogram TTE",
  "Renal Artery Doppler",
  "Lower Extremity Arterial Doppler",
  "Upper Extremity Arterial Doppler",
  "Lower Extremity Venous Duplex",
  "Upper Extremity Venous Duplex",
  "Stress Echocardiogram",
  "Abdominal Aortic Aneurysm Duplex",
] as const;
export type CanonicalServiceType = (typeof CANONICAL_SERVICE_TYPES)[number];

const CANONICAL_SET = new Set<string>(CANONICAL_SERVICE_TYPES);

/** Normalize a raw string for lookup: trim, collapse internal whitespace,
 *  normalize dashes, and lowercase. Purely for MATCHING — never stored. */
function normKey(raw: string): string {
  return String(raw ?? "")
    .replace(/[\u2010-\u2015]/g, "-") // various unicode dashes → hyphen
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// EXPLICIT alias table: normalized-alias → canonical service type. The canonical
// display forms are added programmatically below, so this table only needs the
// KNOWN VARIANTS (abbreviations, Doppler/Duplex drift, registry display_name
// variants). Add a new row here to teach the system a new alias — never fuzzy.
const RAW_ALIASES: Record<string, CanonicalServiceType> = {
  // BrainWave
  "brainwave": "BrainWave",
  "brain wave": "BrainWave",
  "brainwave - comprehensive assessment": "BrainWave",
  "brainwave – comprehensive assessment": "BrainWave",

  // VitalWave
  "vitalwave": "VitalWave",
  "vital wave": "VitalWave",
  "vitalwave - comprehensive autonomic & vascular assessment": "VitalWave",
  "vitalwave – comprehensive autonomic & vascular assessment": "VitalWave",

  // Carotid
  "carotid duplex": "Bilateral Carotid Duplex",
  "bilateral carotid duplex ultrasound": "Bilateral Carotid Duplex",
  "carotid duplex ultrasound": "Bilateral Carotid Duplex",

  // Echocardiogram (registry display_name = "Complete Transthoracic Echocardiogram")
  "complete transthoracic echocardiogram": "Echocardiogram TTE",
  "transthoracic echocardiogram": "Echocardiogram TTE",
  "echocardiogram": "Echocardiogram TTE",
  "echocardiogram tte": "Echocardiogram TTE",
  "tte": "Echocardiogram TTE",

  // Renal (registry display_name = "Renal Artery Duplex — Complete")
  "renal artery duplex": "Renal Artery Doppler",
  "renal artery duplex - complete": "Renal Artery Doppler",
  "renal artery doppler": "Renal Artery Doppler",
  "renal artery ultrasound": "Renal Artery Doppler",

  // Lower Extremity Arterial (registry internal_code uses "Doppler")
  "lower extremity arterial duplex": "Lower Extremity Arterial Doppler",
  "lower extremity arterial duplex - complete bilateral": "Lower Extremity Arterial Doppler",
  "lower extremity arterial doppler": "Lower Extremity Arterial Doppler",
  "le arterial duplex": "Lower Extremity Arterial Doppler",
  "le arterial doppler": "Lower Extremity Arterial Doppler",

  // Upper Extremity Arterial
  "upper extremity arterial duplex": "Upper Extremity Arterial Doppler",
  "upper extremity arterial duplex - complete bilateral": "Upper Extremity Arterial Doppler",
  "upper extremity arterial doppler": "Upper Extremity Arterial Doppler",
  "ue arterial duplex": "Upper Extremity Arterial Doppler",
  "ue arterial doppler": "Upper Extremity Arterial Doppler",

  // Lower Extremity Venous (registry internal_code uses "Duplex") — the drift
  // that caused a duplicate case for "…Venous Doppler".
  "lower extremity venous duplex - complete bilateral": "Lower Extremity Venous Duplex",
  "lower extremity venous doppler": "Lower Extremity Venous Duplex",
  "le venous duplex": "Lower Extremity Venous Duplex",
  "le venous doppler": "Lower Extremity Venous Duplex",

  // Upper Extremity Venous
  "upper extremity venous duplex - complete bilateral": "Upper Extremity Venous Duplex",
  "upper extremity venous doppler": "Upper Extremity Venous Duplex",
  "ue venous duplex": "Upper Extremity Venous Duplex",
  "ue venous doppler": "Upper Extremity Venous Duplex",

  // Stress echo
  "stress echo": "Stress Echocardiogram",
  "stress echocardiogram": "Stress Echocardiogram",

  // AAA
  "complete aortoiliac / aaa duplex": "Abdominal Aortic Aneurysm Duplex",
  "aaa duplex": "Abdominal Aortic Aneurysm Duplex",
  "abdominal aortic aneurysm duplex": "Abdominal Aortic Aneurysm Duplex",
};

// Build the final lookup: canonical forms + known aliases, all normalized.
const ALIAS_LOOKUP: Map<string, CanonicalServiceType> = (() => {
  const m = new Map<string, CanonicalServiceType>();
  for (const canonical of CANONICAL_SERVICE_TYPES) {
    m.set(normKey(canonical), canonical);
  }
  for (const [alias, canonical] of Object.entries(RAW_ALIASES)) {
    m.set(normKey(alias), canonical);
  }
  return m;
})();

/**
 * Resolve a raw service string to its canonical service type (registry
 * internal_code). EXPLICIT alias resolution only — never fuzzy. An unknown
 * string is returned trimmed/unchanged (never silently dropped or mis-mapped);
 * use isCanonicalServiceType() to detect unknowns when strictness is needed.
 */
export function resolveCanonicalServiceType(raw: string | null | undefined): string {
  const cleaned = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return cleaned;
  return ALIAS_LOOKUP.get(normKey(cleaned)) ?? cleaned;
}

/** True when the string is (or resolves to) a known canonical service type. */
export function isCanonicalServiceType(raw: string | null | undefined): boolean {
  return CANONICAL_SET.has(resolveCanonicalServiceType(raw));
}

// ─── Structured-screening services (canonical identities) ─────────────────────
// The EXPLICIT set of canonical services that require a completed structured
// (A0) screening as an Order Note prerequisite. This MIRRORS the server-side
// authority `orderNoteServiceConfig` (`requiredEvidence.structuredScreening ===
// true`, currently BrainWave + VitalWave) and MUST be kept in sync with it — it
// exists only so shared/client callers can resolve the requirement through the
// canonical alias table instead of a fragile service-name substring regex. It is
// an explicit canonical list, never inferred from the service string. The server
// remains the authority for enforcement (signing gate / refresh); this is a
// display/navigation aid only.
export const STRUCTURED_SCREENING_SERVICE_TYPES: readonly CanonicalServiceType[] = [
  "BrainWave",
  "VitalWave",
] as const;

const STRUCTURED_SCREENING_SET = new Set<string>(STRUCTURED_SCREENING_SERVICE_TYPES);

/** True when the raw/aliased service resolves to a canonical service that
 *  requires structured screening. Resolves display-name drift via the alias
 *  table first (so "brain wave" / "BrainWave – Comprehensive Assessment" all
 *  match) — never a substring/regex check. */
export function serviceRequiresStructuredScreening(raw: string | null | undefined): boolean {
  return STRUCTURED_SCREENING_SET.has(resolveCanonicalServiceType(raw));
}
