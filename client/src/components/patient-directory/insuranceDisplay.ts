// Presentation-layer insurance normalizer.
//
// The EHR stores insurance as a single raw string, e.g.:
//   "[INS-Primary] Type: ANSI-Commercial | Member: LCB839985816 | Group: P14602 | Rel: self | Status: active | Since: 2024-09-01"
// That is not acceptable user-facing UI. This module turns raw source (and/or
// structured fields when they exist) into a readable display model. It NEVER
// fabricates data and NEVER mutates the source — structured inputs are always
// preferred over parsing the legacy string.
//
// Architecture: raw source → normalizer → structured display model → UI.

/** Structured insurance inputs (preferred when present). */
export interface InsuranceStructuredInput {
  payerName?: string | null;
  planName?: string | null;
  planType?: string | null;
  memberId?: string | null;
  groupNumber?: string | null;
  relationship?: string | null;
  coverageStatus?: string | null;
  effectiveDate?: string | null;
  eligibilityStatus?: string | null;
  lastVerified?: string | null;
}

export interface InsuranceDisplayField {
  label: string;
  value: string;
}

export interface NormalizedInsurance {
  /** Whether any meaningful insurance data was found. */
  hasData: boolean;
  /** Headline label — payer/carrier name when known, else e.g. "Primary Commercial Plan". */
  planLabel: string | null;
  /** Priority (Primary / Secondary) when present in the source. */
  priority: string | null;
  planType: string | null;
  memberId: string | null;
  groupNumber: string | null;
  relationship: string | null;
  coverageStatus: string | null;
  effectiveSince: string | null;
  eligibilityStatus: string | null;
  lastVerified: string | null;
  /** Concise one-line summary for compact surfaces (e.g. the patient header). */
  summaryLine: string;
  /** Ordered label/value pairs for the detail card (only populated fields). */
  fields: InsuranceDisplayField[];
  /** The untouched source string, preserved for provenance/debugging. */
  raw: string | null;
}

// Known payer/carrier names we may surface verbatim when detected in the source.
// (Detection only — we never invent a payer that isn't in the data.)
const KNOWN_PAYERS: { pattern: RegExp; name: string }[] = [
  { pattern: /\bblue\s*cross\b.*\bblue\s*shield\b|\bbcbs\b/i, name: "Blue Cross Blue Shield" },
  { pattern: /\bunited\s*health(care)?\b|\buhc\b/i, name: "UnitedHealthcare" },
  { pattern: /\baetna\b/i, name: "Aetna" },
  { pattern: /\bcigna\b/i, name: "Cigna" },
  { pattern: /\bhumana\b/i, name: "Humana" },
  { pattern: /\bkaiser\b/i, name: "Kaiser Permanente" },
  { pattern: /\banthem\b/i, name: "Anthem" },
  { pattern: /\btricare\b/i, name: "Tricare" },
  { pattern: /\bmedicare\b/i, name: "Medicare" },
  { pattern: /\bmedicaid\b/i, name: "Medicaid" },
];

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** ISO / date-ish string → "Sep 1, 2024". Falls back to the input if unparseable. */
function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed.includes("T") ? trimmed : `${trimmed}T00:00:00`);
  if (isNaN(d.getTime())) return trimmed;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Normalize a plan-type token: "ANSI-Commercial" → "Commercial". */
function normalizePlanType(value: string | null | undefined): string | null {
  if (!value) return null;
  let v = value.trim();
  if (!v) return null;
  v = v.replace(/^ansi[-_\s]*/i, ""); // drop technical "ANSI-" prefix
  v = v.replace(/[-_]+/g, " ").trim();
  return v ? titleCase(v) : null;
}

function detectPayer(text: string): string | null {
  for (const p of KNOWN_PAYERS) if (p.pattern.test(text)) return p.name;
  return null;
}

/** Parse the legacy raw insurance string into loosely-typed parts. */
function parseRawString(raw: string): {
  priority: string | null;
  planType: string | null;
  memberId: string | null;
  groupNumber: string | null;
  relationship: string | null;
  coverageStatus: string | null;
  effectiveSince: string | null;
  leftover: string;
} {
  let priority: string | null = null;
  let rest = raw.trim();

  // Leading "[INS-Primary]" / "[INS-Secondary]" prefix → priority.
  const prefix = rest.match(/^\[\s*INS[-_\s]*([A-Za-z]+)\s*\]\s*/i);
  if (prefix) {
    priority = titleCase(prefix[1]);
    rest = rest.slice(prefix[0].length);
  }

  const parts = rest.split("|").map((p) => p.trim()).filter(Boolean);
  const kv = new Map<string, string>();
  const unkeyed: string[] = [];
  for (const part of parts) {
    const m = part.match(/^([A-Za-z ]+?)\s*:\s*(.+)$/);
    if (m) kv.set(m[1].trim().toLowerCase(), m[2].trim());
    else unkeyed.push(part);
  }

  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = kv.get(k);
      if (v) return v;
    }
    return null;
  };

  const relRaw = get("rel", "relationship");
  const statusRaw = get("status", "coverage", "coverage status");
  return {
    priority,
    planType: normalizePlanType(get("type", "plan type", "plan")),
    memberId: get("member", "member id", "member #", "policy", "policy id"),
    groupNumber: get("group", "group number", "group #"),
    relationship: relRaw ? titleCase(relRaw) : null,
    coverageStatus: statusRaw ? titleCase(statusRaw) : null,
    effectiveSince: formatDate(get("since", "effective", "effective since", "effective date")),
    leftover: unkeyed.join(" "),
  };
}

const EMPTY: NormalizedInsurance = {
  hasData: false,
  planLabel: null,
  priority: null,
  planType: null,
  memberId: null,
  groupNumber: null,
  relationship: null,
  coverageStatus: null,
  effectiveSince: null,
  eligibilityStatus: null,
  lastVerified: null,
  summaryLine: "—",
  fields: [],
  raw: null,
};

/**
 * Normalize insurance for display. Pass the raw source string and/or structured
 * fields; structured fields win when both are present. Returns a display model
 * — never mutates or invents data.
 */
export function normalizeInsuranceDisplay(
  raw: string | null | undefined,
  structured: InsuranceStructuredInput = {},
): NormalizedInsurance {
  const rawStr = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  const hasStructured = Object.values(structured).some((v) => v != null && String(v).trim() !== "");
  if (!rawStr && !hasStructured) return { ...EMPTY };

  const parsed = rawStr ? parseRawString(rawStr) : null;

  // Structured fields take precedence over parsed legacy values.
  const priority = parsed?.priority ?? null;
  const planType = normalizePlanType(structured.planType) ?? parsed?.planType ?? null;
  const memberId = (structured.memberId ?? null) || (parsed?.memberId ?? null);
  const groupNumber = (structured.groupNumber ?? null) || (parsed?.groupNumber ?? null);
  const relationship =
    (structured.relationship ? titleCase(structured.relationship) : null) || (parsed?.relationship ?? null);
  const coverageStatus =
    (structured.coverageStatus ? titleCase(structured.coverageStatus) : null) || (parsed?.coverageStatus ?? null);
  const effectiveSince = formatDate(structured.effectiveDate) ?? parsed?.effectiveSince ?? null;
  const eligibilityStatus = structured.eligibilityStatus ? titleCase(structured.eligibilityStatus) : null;
  const lastVerified = formatDate(structured.lastVerified);

  // Determine the headline label. Prefer an explicit payer/plan name, then a
  // detected known payer, then a "<Priority> <Type> Plan" descriptor, then any
  // leftover text from the raw string.
  const explicitName =
    (structured.payerName && structured.payerName.trim()) ||
    (structured.planName && structured.planName.trim()) ||
    null;
  const detectedPayer = !explicitName && rawStr ? detectPayer(rawStr) : null;
  let planLabel: string | null = explicitName ?? detectedPayer ?? null;
  if (!planLabel) {
    if (planType) planLabel = [priority, planType, "Plan"].filter(Boolean).join(" ");
    else if (parsed?.leftover) planLabel = titleCase(parsed.leftover);
  }

  // Concise summary line for compact surfaces.
  const payerForSummary = explicitName ?? detectedPayer ?? null;
  let summaryLine: string;
  if (payerForSummary && planType) summaryLine = `${payerForSummary} • ${planType}`;
  else if (payerForSummary) summaryLine = payerForSummary;
  else if (planType && memberId) summaryLine = `${planType} • Member ${memberId}`;
  else if (planType) summaryLine = priority ? `${priority} • ${planType}` : planType;
  else summaryLine = planLabel ?? "—";

  const fields: InsuranceDisplayField[] = [];
  const push = (label: string, value: string | null) => {
    if (value && value.trim()) fields.push({ label, value: value.trim() });
  };
  push("Insurance", planLabel);
  if (planType && (!planLabel || !planLabel.includes(planType))) push("Plan Type", planType);
  push("Member ID", memberId);
  push("Group Number", groupNumber);
  push("Relationship", relationship);
  push("Coverage Status", coverageStatus);
  push("Effective Since", effectiveSince);
  push("Eligibility", eligibilityStatus);
  push("Last Verified", lastVerified);

  return {
    hasData: true,
    planLabel,
    priority,
    planType,
    memberId,
    groupNumber,
    relationship,
    coverageStatus,
    effectiveSince,
    eligibilityStatus,
    lastVerified,
    summaryLine,
    fields,
    raw: rawStr,
  };
}
