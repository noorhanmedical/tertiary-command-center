// Deterministic patient column detection — single source of truth for mapping
// spreadsheet/CSV header labels to canonical patient fields. Pure module, no
// runtime deps, lives in shared/ so client preview and server ingestion agree.
//
// This is the DETERMINISTIC-FIRST layer. A large clean spreadsheet should map
// 100% of its columns here and NEVER touch the LLM. Only genuinely ambiguous
// or headerless input falls back to AI (handled by the server parser, not
// here). The mapper recognizes the common header variants used by EHR exports.

export type CanonicalPatientField =
  | "name"
  | "firstName"
  | "lastName"
  | "dob"
  | "phone"
  | "email"
  | "gender"
  | "age"
  | "insurance"
  | "memberId"
  | "mrn"
  | "facility"
  | "provider"
  | "address"
  | "diagnoses"
  | "medications"
  | "history"
  | "allergies"
  | "previousTests"
  | "notes"
  | "time"
  | "scheduleDate"
  | "patientType";

// Each canonical field maps to a set of normalized header aliases. Matching is
// done on the NORMALIZED header (lowercased, non-alphanumerics collapsed), so
// "Date of Birth", "DOB", and "birth_date" all collapse to the same probe.
const FIELD_ALIASES: Record<CanonicalPatientField, string[]> = {
  name: ["name", "patient", "patient name", "patientname", "full name", "fullname", "pt name", "pt", "member name"],
  firstName: ["first name", "firstname", "first", "given name", "givenname", "fname"],
  lastName: ["last name", "lastname", "last", "surname", "family name", "familyname", "lname"],
  dob: ["dob", "date of birth", "dateofbirth", "birth date", "birthdate", "birthday", "d o b"],
  phone: ["phone", "phone number", "phonenumber", "mobile", "cell", "cell phone", "cellphone", "telephone", "tel", "contact number", "home phone", "primary phone"],
  email: ["email", "email address", "emailaddress", "e mail"],
  gender: ["gender", "sex", "gender identity"],
  age: ["age", "patient age"],
  insurance: ["insurance", "payer", "payor", "insurance type", "insurancetype", "insurance plan", "insuranceplan", "carrier", "plan", "coverage", "primary insurance"],
  memberId: ["member id", "memberid", "subscriber id", "subscriberid", "policy number", "policynumber", "group id", "groupid", "insurance id", "insuranceid"],
  address: ["address", "street", "street address", "streetaddress", "home address", "mailing address", "residence"],
  allergies: ["allergies", "allergy", "allergen", "allergens", "drug allergies"],
  mrn: ["mrn", "medical record number", "medicalrecordnumber", "medical record", "medical record no", "med rec", "medrec", "record number", "record no", "patient id", "patientid", "chart number", "chartnumber", "chart id", "account number", "account", "account no", "acct", "acct number", "external id", "externalid", "emr id"],
  facility: ["facility", "clinic", "location", "site", "practice", "office", "clinic name", "facility name"],
  provider: ["provider", "physician", "doctor", "pcp", "referring provider", "rendering provider", "clinician", "attending", "npi provider"],
  diagnoses: ["diagnoses", "diagnosis", "dx", "conditions", "condition", "problem list", "problems", "assessment", "icd", "icd10", "icd 10"],
  medications: ["medications", "medication", "meds", "rx", "prescriptions", "current medications", "currentmedications", "current meds", "drug list", "druglist"],
  history: ["history", "hpi", "pmh", "past medical history", "pastmedicalhistory", "medical history", "medicalhistory", "past history", "hx", "clinical history"],
  previousTests: ["previous tests", "prior tests", "ancillaries completed", "ancillariescompleted", "completed ancillaries", "hga records", "hgarecords", "ancillary history", "tests completed", "testscompleted", "prior imaging", "priorimaging", "past studies", "paststudies", "previous imaging", "prior ancillaries", "previous ancillaries", "previousancillaries"],
  notes: ["notes", "note", "comments", "comment", "chief complaint", "chiefcomplaint", "cc", "reason", "visit reason", "visitreason", "remarks"],
  time: ["time", "appt time", "appttime", "appointment time", "appointmenttime", "start", "start time", "starttime", "slot"],
  scheduleDate: ["schedule date", "scheduledate", "appointment date", "appointmentdate", "appt date", "apptdate", "date of service", "dateofservice", "dos", "service date", "servicedate", "visit date", "visitdate", "date"],
  patientType: ["patient type", "patienttype", "type", "visit type", "visittype", "encounter type"],
};

/** Normalize a header label for alias comparison. */
export function normalizeHeader(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Precompute alias → field lookup for O(1) exact-normalized matching.
const ALIAS_TO_FIELD = new Map<string, CanonicalPatientField>();
for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [CanonicalPatientField, string[]][]) {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (!ALIAS_TO_FIELD.has(key)) ALIAS_TO_FIELD.set(key, field);
  }
}

/** Map ONE header/label to a canonical field (exact-normalized alias first,
 *  then a bounded whole-word contains pass). Returns null when unmapped.
 *  Reused by smart-paste label:value parsing. */
export function mapHeaderToField(header: string): CanonicalPatientField | null {
  const norm = normalizeHeader(header);
  if (!norm) return null;
  const exact = ALIAS_TO_FIELD.get(norm);
  if (exact) return exact;
  let best: { field: CanonicalPatientField; len: number } | null = null;
  for (const [alias, f] of ALIAS_TO_FIELD) {
    if (alias.length < 3) continue;
    if (norm === alias || norm.includes(` ${alias} `) || norm.startsWith(`${alias} `) || norm.endsWith(` ${alias}`)) {
      if (!best || alias.length > best.len) best = { field: f, len: alias.length };
    }
  }
  return best?.field ?? null;
}

export type ColumnDetectionResult = {
  // headerIndex → canonical field (only confident deterministic mappings).
  mapping: Record<number, CanonicalPatientField>;
  // Canonical field → source header label (for display / job.detectedColumns).
  fieldToHeader: Partial<Record<CanonicalPatientField, string>>;
  // Headers we could not confidently map (candidates for AI or "notes").
  unmapped: Array<{ index: number; header: string }>;
  // True when the header row lacks even a name/first+last signal — the caller
  // should fall back to AI parsing rather than trusting positional columns.
  ambiguous: boolean;
};

/**
 * Deterministically map a header row to canonical fields. Exact normalized
 * alias match first; then a bounded "contains" pass for compound headers like
 * "Patient Name (Last, First)". Returns `ambiguous: true` when no name signal
 * is found so the server can decide to fall back to AI.
 */
export function detectColumns(
  headers: ReadonlyArray<string>,
  // Manager-approved global corrections keyed by source header (exact or
  // normalized). Value is a canonical field or "ignore" to drop the column.
  overrides?: Record<string, CanonicalPatientField | "ignore">,
): ColumnDetectionResult {
  const mapping: Record<number, CanonicalPatientField> = {};
  const fieldToHeader: Partial<Record<CanonicalPatientField, string>> = {};
  const unmapped: Array<{ index: number; header: string }> = [];
  const usedFields = new Set<CanonicalPatientField>();

  // Normalize override keys for tolerant lookup.
  const normOverrides = new Map<string, CanonicalPatientField | "ignore">();
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) normOverrides.set(normalizeHeader(k), v);
  }

  headers.forEach((raw, index) => {
    const norm = normalizeHeader(raw);
    if (!norm) {
      unmapped.push({ index, header: raw });
      return;
    }
    // A manager override wins over auto-detection (and can force a field even
    // when a different field is already used — the override is authoritative).
    const ov = normOverrides.get(norm);
    if (ov === "ignore") { unmapped.push({ index, header: raw }); return; }
    if (ov) { mapping[index] = ov; fieldToHeader[ov] = raw; usedFields.add(ov); return; }
    let field = ALIAS_TO_FIELD.get(norm);

    // Bounded contains-pass: longest alias that appears as a whole word run.
    if (!field) {
      let best: { field: CanonicalPatientField; len: number } | null = null;
      for (const [alias, f] of ALIAS_TO_FIELD) {
        if (alias.length < 3) continue; // avoid noise like "dx"/"cc" here
        if (norm === alias || norm.includes(` ${alias} `) || norm.startsWith(`${alias} `) || norm.endsWith(` ${alias}`)) {
          if (!best || alias.length > best.len) best = { field: f, len: alias.length };
        }
      }
      if (best) field = best.field;
    }

    if (field && !usedFields.has(field)) {
      mapping[index] = field;
      fieldToHeader[field] = raw;
      usedFields.add(field);
    } else {
      unmapped.push({ index, header: raw });
    }
  });

  const hasName = usedFields.has("name") || (usedFields.has("firstName") && usedFields.has("lastName")) || usedFields.has("lastName");
  return { mapping, fieldToHeader, unmapped, ambiguous: !hasName };
}
