// Patient Directory import preview parsing + classification (Batch B12).
//
// Pure module. Supports CSV/TXT today. DOC/DOCX/PDF parsing is not
// included — see docs/architecture/patient-directory-runtime-blockers
// for the reason.

import {
  buildPatientIdentityIndex,
  buildPatientIdentityKeys,
  lookupPatientInIndex,
  type PatientIdentityInput,
} from "../../../shared/patientIdentity";

export type ParsedImportRow = {
  rowIndex: number; // 0-based, header excluded
  raw: Record<string, string>;
  identity: PatientIdentityInput;
};

export type ImportClassification =
  | "new"
  | "matched_existing"
  | "missing_required_fields"
  | "dnc"
  | "active_cooldown"
  | "prior_ancillary"
  | "duplicate_in_import"
  | "previously_sent_to_engagement";

export type ImportPreviewRow = {
  rowIndex: number;
  identity: PatientIdentityInput;
  classifications: ReadonlyArray<ImportClassification>;
  missingFields: ReadonlyArray<string>;
  matchedExistingId?: number | null;
  selected: boolean;
};

export type ImportPreviewFacts = {
  existing: ReadonlyArray<{ patientScreeningId: number; identity: PatientIdentityInput }>;
  dnc: ReadonlyArray<{ identity: PatientIdentityInput }>;
  cooldown: ReadonlyArray<{ identity: PatientIdentityInput; active: boolean }>;
  priorTests: ReadonlyArray<{ identity: PatientIdentityInput }>;
  sentToEngagement: ReadonlyArray<{ identity: PatientIdentityInput }>;
};

const REQUIRED_FIELDS: ReadonlyArray<keyof PatientIdentityInput> = ["name", "dob"];

// CSV / TSV parsing -------------------------------------------------------

function detectDelimiter(line: string): string {
  if (line.includes("\t")) return "\t";
  if (line.includes(",")) return ",";
  if (line.includes("|")) return "|";
  return ",";
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === "\"" && line[i + 1] === "\"") { cur += "\""; i++; continue; }
      if (c === "\"") { inQuote = false; continue; }
      cur += c;
      continue;
    }
    if (c === "\"") { inQuote = true; continue; }
    if (c === delim) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const HEADER_ALIASES: Record<string, keyof PatientIdentityInput> = {
  "name": "name",
  "patient name": "name",
  "patient_name": "name",
  "full name": "name",
  "fullname": "name",
  "facility": "facility",
  "site": "facility",
  "clinic": "facility",
  "mrn": "mrn",
  "medical record number": "mrn",
  "chart": "mrn",
  "dob": "dob",
  "date of birth": "dob",
  "birthdate": "dob",
  "birth date": "dob",
  "phone": "phoneNumber",
  "phone number": "phoneNumber",
  "phone_number": "phoneNumber",
  "phonenumber": "phoneNumber",
  "mobile": "phoneNumber",
  "cell": "phoneNumber",
  "telephone": "phoneNumber",
};

export function parseCsv(text: string): ReadonlyArray<ParsedImportRow> {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const delim = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase().trim());
  const headerMap: Array<keyof PatientIdentityInput | null> = headers.map(
    (h) => HEADER_ALIASES[h] ?? null,
  );

  const rows: ParsedImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delim);
    const raw: Record<string, string> = {};
    const identity: PatientIdentityInput = {};
    for (let c = 0; c < headers.length; c++) {
      const headerName = headers[c];
      const value = cells[c] ?? "";
      raw[headerName] = value;
      const key = headerMap[c];
      if (!key) continue;
      (identity as Record<string, string>)[key] = value;
    }
    rows.push({ rowIndex: i - 1, raw, identity });
  }
  return rows;
}

// TXT parsing — operator can dump newline-separated patients in
// "Name | DOB | Phone | Facility | MRN" form. Heuristic: each line
// becomes one identity input.
export function parseTxt(text: string): ReadonlyArray<ParsedImportRow> {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.map((line, idx) => {
    const cells = line.split(/\s*\|\s*/);
    const identity: PatientIdentityInput = {
      name: cells[0] ?? "",
      dob: cells[1] ?? "",
      phoneNumber: cells[2] ?? "",
      facility: cells[3] ?? "",
      mrn: cells[4] ?? "",
    };
    return { rowIndex: idx, raw: { line }, identity };
  });
}

// Classification ---------------------------------------------------------

export function classifyImportRows(
  parsed: ReadonlyArray<ParsedImportRow>,
  facts: ImportPreviewFacts,
): ReadonlyArray<ImportPreviewRow> {
  const existingIdx = buildPatientIdentityIndex(facts.existing, (r) => r.identity);
  const dncIdx = buildPatientIdentityIndex(facts.dnc, (r) => r.identity);
  const cooldownIdx = buildPatientIdentityIndex(facts.cooldown, (r) => r.identity);
  const priorIdx = buildPatientIdentityIndex(facts.priorTests, (r) => r.identity);
  const sentIdx = buildPatientIdentityIndex(facts.sentToEngagement, (r) => r.identity);

  // Detect duplicates within the import itself.
  const intraIdx = new Map<string, number>();
  for (const row of parsed) {
    const k = buildPatientIdentityKeys(row.identity);
    for (const key of [k.facilityMrnDob, k.mrnDob, k.nameDobPhone]) {
      if (!key) continue;
      intraIdx.set(key, (intraIdx.get(key) ?? 0) + 1);
    }
  }

  return parsed.map((row) => {
    const classifications = new Set<ImportClassification>();
    const missingFields = REQUIRED_FIELDS.filter((f) => !row.identity[f] || String(row.identity[f]).trim() === "");
    if (missingFields.length > 0) classifications.add("missing_required_fields");

    const k = buildPatientIdentityKeys(row.identity);
    const existing = lookupPatientInIndex(existingIdx, row.identity);
    if (existing) classifications.add("matched_existing");
    if (lookupPatientInIndex(dncIdx, row.identity)) classifications.add("dnc");
    const cd = lookupPatientInIndex(cooldownIdx, row.identity);
    if (cd && cd.row.active) classifications.add("active_cooldown");
    if (lookupPatientInIndex(priorIdx, row.identity)) classifications.add("prior_ancillary");
    if (lookupPatientInIndex(sentIdx, row.identity)) classifications.add("previously_sent_to_engagement");

    for (const key of [k.facilityMrnDob, k.mrnDob, k.nameDobPhone]) {
      if (key && (intraIdx.get(key) ?? 0) > 1) classifications.add("duplicate_in_import");
    }

    if (classifications.size === 0) classifications.add("new");

    return {
      rowIndex: row.rowIndex,
      identity: row.identity,
      classifications: [...classifications],
      missingFields: missingFields as string[],
      matchedExistingId: existing?.row.patientScreeningId ?? null,
      // Default: select rows that classify cleanly as "new". Operator
      // can flip selection in the UI.
      selected: classifications.has("new") && !classifications.has("missing_required_fields"),
    } satisfies ImportPreviewRow;
  });
}

// Selection helpers ------------------------------------------------------

export function selectAllImportRows(rows: ReadonlyArray<ImportPreviewRow>): ReadonlyArray<ImportPreviewRow> {
  return rows.map((r) => ({ ...r, selected: true }));
}
export function clearAllImportRows(rows: ReadonlyArray<ImportPreviewRow>): ReadonlyArray<ImportPreviewRow> {
  return rows.map((r) => ({ ...r, selected: false }));
}
export function toggleImportRow(rows: ReadonlyArray<ImportPreviewRow>, rowIndex: number): ReadonlyArray<ImportPreviewRow> {
  return rows.map((r) => (r.rowIndex === rowIndex ? { ...r, selected: !r.selected } : r));
}
