// Deterministic parser for the Plexus IQ clinical bulk-paste format.
//
// Supported input shapes (in detection order):
//
// 1. Clinical spreadsheet — tab-separated rows with column boundaries
//    Start | DATE | TIME | NAME | DOB | AGE | SEX | MRN | Dx | Hx | Rx |
//    Ancillaries Completed | INSURANCE | End
//
//    Either with a header row (column names in the first row) or without
//    (positional). Multi-line clinical text inside a cell is preserved as
//    long as the cell uses CRLF/LF line breaks and not literal tabs.
//
// 2. Start/End labeled blocks — multi-line free-form blocks delimited by
//    "Start" and "End" markers, with label-driven extraction. This is the
//    short-form fallback the modal already supported; we delegate to the
//    existing parser in PlexusIQBulkImportModal so behavior is preserved.
//
// 3. Legacy CSV — `facility,date,name,type,time` header. Also delegated.
//
// No AI is used. Long Dx/Hx/Rx/Ancillaries Completed text is preserved
// exactly; only outer whitespace is trimmed.

export type PlexusIqClinicalImportRow = {
  rowIndex: number;
  facility?: string;
  clinician?: string;
  scheduleDate?: string;
  time?: string;
  name: string;
  dob?: string;
  age?: string;
  sex?: string;
  mrn?: string;
  phone?: string;
  email?: string;
  diagnoses?: string;
  history?: string;
  medications?: string;
  previousAncillaries?: string;
  insurance?: string;
  patientType?: "visit" | "outreach";
  dateAdded?: string;
  // Non-fatal warnings (e.g. missing DOB / phone). The row is still
  // accepted into the row list — these populate the import preview's
  // "Missing Info" counts and the per-row notes so the operator
  // knows what they need to fix before sending to Engagement.
  warnings?: string[];
  raw: string;
};

export type PlexusIqClinicalImportError = {
  rowIndex: number;
  reason: string;
  raw?: string;
};

export type PlexusIqClinicalImportFormat =
  | "clinical-spreadsheet"
  | "start-end-labels"
  | "legacy-csv"
  | "unknown";

export type PlexusIqClinicalImportParseResult = {
  rows: PlexusIqClinicalImportRow[];
  errors: PlexusIqClinicalImportError[];
  format: PlexusIqClinicalImportFormat;
};

export type PlexusIqClinicalImportDefaults = {
  facility?: string;
  scheduleDate?: string;
  patientType?: "visit" | "outreach";
};

// Canonical columns (positional fallback when header row is absent).
// Columns added in the clinic-first batch (`CLINIC`, `CLINICIAN`,
// `PATIENT_TYPE`, `PHONE`, `EMAIL`, `DATE_ADDED`) are header-only —
// the Start/End positional layout doesn't include them, so the
// positional `getCell` switch returns undefined for these keys.
const CLINICAL_COLUMNS = [
  "Start",
  "DATE",
  "TIME",
  "NAME",
  "DOB",
  "AGE",
  "SEX",
  "MRN",
  "Dx",
  "Hx",
  "Rx",
  "Ancillaries Completed",
  "INSURANCE",
  "End",
  "CLINIC",
  "CLINICIAN",
  "PATIENT_TYPE",
  "PHONE",
  "EMAIL",
  "DATE_ADDED",
] as const;

type ClinicalCol = (typeof CLINICAL_COLUMNS)[number];

const HEADER_ALIASES: Record<ClinicalCol, string[]> = {
  Start: ["start"],
  DATE: [
    "date",
    "schedule date",
    "appointment date",
    "appt date",
    "dos",
    "visit date",
  ],
  TIME: ["time", "appointment time", "appt time", "visit time"],
  NAME: ["name", "patient", "patient name", "full name"],
  DOB: ["dob", "date of birth"],
  AGE: ["age"],
  SEX: ["sex", "gender"],
  MRN: [
    "mrn",
    "medical record number",
    "chart",
    "chart number",
    "patient id",
    "external patient id",
    "external id",
  ],
  Dx: ["dx", "diagnosis", "diagnoses", "problems", "problem list"],
  Hx: [
    "hx",
    "hpi",
    "history",
    "pmh",
    "medical history",
    "past medical history",
  ],
  Rx: ["rx", "meds", "medications", "medication list"],
  "Ancillaries Completed": [
    "ancillaries completed",
    "ancillary completed",
    "ancillaries",
    "previous ancillaries",
    "previous screens",
    "previous tests",
    "prior ancillaries",
    "prior screens",
    "no record of plexus ancillary screens",
  ],
  INSURANCE: ["insurance", "payer", "plan", "primary insurance"],
  End: ["end"],
  CLINIC: ["clinic", "facility", "location", "office", "practice", "site"],
  CLINICIAN: [
    "clinician",
    "provider",
    "rendering provider",
    "ordering provider",
    "doctor",
    "physician",
  ],
  PATIENT_TYPE: [
    "patient type",
    "type",
    "visit type",
    "source",
    "patient source",
  ],
  PHONE: ["phone", "phone number", "mobile", "cell", "contact number"],
  EMAIL: ["email", "email address"],
  DATE_ADDED: ["date added", "imported date", "added date"],
};

// Clinic alias normalization. TFP → Taylor Family Practice, etc.
// Returns the original trimmed value when no alias matches, and
// `undefined` for blank input.
const CLINIC_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  {
    canonical: "Taylor Family Practice",
    aliases: ["tfp", "taylor", "taylor family practice"],
  },
  {
    canonical: "NWPG - Spring",
    aliases: ["nwpg spring", "nwpg - spring", "nwpg-spring", "nwpg.spring"],
  },
  {
    canonical: "NWPG - Veterans",
    aliases: [
      "nwpg veterans",
      "nwpg - veterans",
      "nwpg-veterans",
      "nwpg.veterans",
    ],
  },
];

export function normalizeClinicAlias(
  value: string | undefined | null,
): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  const norm = trimmed.toLowerCase().replace(/\s+/g, " ").trim();
  for (const entry of CLINIC_ALIASES) {
    if (entry.aliases.includes(norm)) return entry.canonical;
    if (norm === entry.canonical.toLowerCase()) return entry.canonical;
  }
  return trimmed;
}

function normalizePatientTypeFromCell(
  raw: string | undefined,
  fallback: "visit" | "outreach" | undefined,
): "visit" | "outreach" | undefined {
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  if (!v) return fallback;
  if (
    v === "visit" ||
    v === "scheduled" ||
    v === "schedule" ||
    v === "in-clinic" ||
    v === "in clinic" ||
    v === "clinic"
  )
    return "visit";
  if (v === "outreach" || v === "outbound" || v === "call list" || v === "o")
    return "outreach";
  return fallback;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeDate(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const t = String(raw).trim();
  if (!t) return undefined;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (us) {
    let year = us[3];
    if (year.length === 2) year = (parseInt(year, 10) > 50 ? "19" : "20") + year;
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  return undefined;
}

function normalizePatientType(
  raw: string | undefined,
  fallback: "visit" | "outreach" | undefined,
): "visit" | "outreach" | undefined {
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "visit" || v === "v") return "visit";
  if (v === "outreach" || v === "o") return "outreach";
  return fallback;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s ? s : undefined;
}

// Split into rows by Start…End markers, treating the entire content
// between the two markers as one logical row even when the source has
// embedded newlines inside Dx/Hx/Rx cells. The marker tokens themselves
// also count as the row's first and last cells.
type RawRow = { rowIndex: number; raw: string; cells: string[] };

function splitTabbedRow(line: string): string[] {
  return line.split("\t");
}

function findStartEndRows(text: string): RawRow[] {
  // Strategy:
  //   - First, normalize line endings.
  //   - Scan the text token-stream for occurrences of the literal token
  //     "Start" at a cell boundary (start of file, after a newline, or
  //     after a tab). Capture until the matching "End" token at a cell
  //     boundary. The captured segment is one row.
  //   - Cells inside the captured segment are split by tabs. Newlines
  //     stay inside the cell they appeared in.
  //
  // We use a deterministic regex over the normalized stream.
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: RawRow[] = [];
  // ([^\S\n]?) — optional non-newline whitespace; allows "  Start" line.
  const re = /(^|\n|\t)[\t ]*Start[\t ]*(\t|\n)([\s\S]*?)(?:\t|\n)[\t ]*End[\t ]*(?=\t|\n|$)/gi;
  let m: RegExpExecArray | null;
  let rowIndex = 0;
  while ((m = re.exec(normalized)) !== null) {
    rowIndex += 1;
    const segment = m[3];
    // Cells in the segment, split by tabs. Newlines inside the segment
    // are preserved within whichever cell they fall in.
    const cells = segment.split("\t");
    const raw = m[0].trim();
    rows.push({ rowIndex, raw, cells });
  }
  return rows;
}

// If the first physical line of the input looks like a clinical header
// row (contains the column tokens), pull it out and use it to build a
// header→column mapping. Returns a header-to-index map and the input
// without that header row, so detection of Start/End markers is not
// confused.
function detectClinicalHeader(text: string): {
  headerMap: Record<string, number> | null;
  bodyText: string;
} {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // Header line, if present, is the FIRST non-blank line and contains
  // tabs separating tokens. The tokens (case-insensitive) include at
  // least Start, NAME, and Dx OR a known alias.
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length) return { headerMap: null, bodyText: text };
  const firstLine = lines[i];
  if (!firstLine.includes("\t")) return { headerMap: null, bodyText: text };
  const cells = splitTabbedRow(firstLine).map((c) => c.trim());
  const lowered = cells.map((c) => c.toLowerCase());
  const startIdx = lowered.findIndex((c) => c === "start");
  const endIdx = lowered.findIndex((c) => c === "end");
  if (startIdx < 0 || endIdx < 0) return { headerMap: null, bodyText: text };
  const headerMap: Record<string, number> = {};
  for (const col of CLINICAL_COLUMNS) {
    const aliases = HEADER_ALIASES[col].map((a) => a.toLowerCase());
    const idx = lowered.findIndex((c) => aliases.includes(c));
    if (idx >= 0) headerMap[col] = idx;
  }
  // If at least Start, NAME, End mapped, accept.
  if (headerMap["Start"] == null || headerMap["NAME"] == null || headerMap["End"] == null) {
    return { headerMap: null, bodyText: text };
  }
  // Strip the header line from the body so it isn't picked up as a row.
  const bodyText = lines.slice(i + 1).join("\n");
  return { headerMap, bodyText };
}

function getCell(
  rawRow: RawRow,
  headerMap: Record<string, number> | null,
  col: ClinicalCol,
  fallbackPos: number,
): string | undefined {
  let idx: number | undefined;
  if (headerMap) {
    // Header indices are zero-based against the FULL row, but the
    // splitter we used for rawRow.cells excluded the Start marker (it
    // was consumed by the regex). Shift indices left by 1 since the
    // first cell after Start is index 0 in rawRow.cells.
    const headerIdx = headerMap[col];
    if (headerIdx != null) {
      idx = headerIdx - 1;
    }
  } else {
    // Positional fallback: rawRow.cells starts at column 1 (DATE) since
    // we already consumed the Start marker. So DATE is index 0, TIME is
    // index 1, ..., INSURANCE is index 11. End is consumed by the regex.
    // The Start/End positional layout does NOT include the
    // clinic-first batch's extra columns (CLINIC / CLINICIAN /
    // PATIENT_TYPE / PHONE / EMAIL / DATE_ADDED). Those are
    // header-only — positional reads return undefined for them.
    const positional: Record<ClinicalCol, number> = {
      Start: -1,
      DATE: 0,
      TIME: 1,
      NAME: 2,
      DOB: 3,
      AGE: 4,
      SEX: 5,
      MRN: 6,
      Dx: 7,
      Hx: 8,
      Rx: 9,
      "Ancillaries Completed": 10,
      INSURANCE: 11,
      End: -1,
      CLINIC: -1,
      CLINICIAN: -1,
      PATIENT_TYPE: -1,
      PHONE: -1,
      EMAIL: -1,
      DATE_ADDED: -1,
    };
    idx = positional[col];
    if (idx === -1) idx = fallbackPos;
  }
  if (idx == null || idx < 0 || idx >= rawRow.cells.length) return undefined;
  return trimOrUndefined(rawRow.cells[idx]);
}

// Count Start markers in body text — anything that looks like a row
// boundary but has no matching End is a dangling row that the
// row-extractor will silently drop. We surface them as explicit errors
// so a missing End marker can never produce a phantom-skipped patient.
function countStartMarkers(body: string): number {
  const re = /(?:^|\n|\t)[\t ]*Start[\t ]*(?:\t|\n)/gi;
  let count = 0;
  while (re.exec(body) !== null) count += 1;
  return count;
}

function parseClinicalSpreadsheet(
  text: string,
  defaults: PlexusIqClinicalImportDefaults,
): PlexusIqClinicalImportParseResult {
  const { headerMap, bodyText } = detectClinicalHeader(text);
  const rows = findStartEndRows(bodyText);
  if (rows.length === 0) {
    return { rows: [], errors: [], format: "unknown" };
  }
  const out: PlexusIqClinicalImportRow[] = [];
  const errors: PlexusIqClinicalImportError[] = [];

  const expectedStarts = countStartMarkers(bodyText);
  if (expectedStarts > rows.length) {
    const missing = expectedStarts - rows.length;
    for (let i = 0; i < missing; i++) {
      errors.push({
        rowIndex: rows.length + i + 1,
        reason: "Unterminated clinical row — missing End marker",
      });
    }
  }

  for (const r of rows) {
    const name = getCell(r, headerMap, "NAME", 2);
    if (!name) {
      errors.push({ rowIndex: r.rowIndex, reason: "Missing NAME", raw: r.raw });
      continue;
    }
    const dateRaw = getCell(r, headerMap, "DATE", 0);
    const scheduleDate =
      normalizeDate(dateRaw) ?? defaults.scheduleDate ?? undefined;
    const time = getCell(r, headerMap, "TIME", 1);
    const dob = normalizeDate(getCell(r, headerMap, "DOB", 3)) ?? getCell(r, headerMap, "DOB", 3);
    const age = getCell(r, headerMap, "AGE", 4);
    const sex = getCell(r, headerMap, "SEX", 5);
    const mrn = getCell(r, headerMap, "MRN", 6);
    const diagnoses = getCell(r, headerMap, "Dx", 7);
    const history = getCell(r, headerMap, "Hx", 8);
    const medications = getCell(r, headerMap, "Rx", 9);
    const previousAncillaries = getCell(r, headerMap, "Ancillaries Completed", 10);
    const insurance = getCell(r, headerMap, "INSURANCE", 11);

    out.push({
      rowIndex: r.rowIndex,
      facility: defaults.facility,
      scheduleDate,
      time,
      name,
      dob,
      age,
      sex,
      mrn,
      diagnoses,
      history,
      medications,
      previousAncillaries,
      insurance,
      patientType: normalizePatientType(undefined, defaults.patientType ?? "visit"),
      raw: r.raw,
    });
  }

  return {
    rows: out,
    errors,
    format: "clinical-spreadsheet",
  };
}

// ─── Header-driven table path (delimiter = tab or comma) ───────────────
//
// Goal: parse a pasted spreadsheet table where the FIRST non-blank row
// is a header row whose tokens we recognise via HEADER_ALIASES. Column
// order does not matter — NAME, Dx, Hx, Rx, MRN, INSURANCE, etc. can
// be in any position. Start/End cells are not required.
//
// Multiline cells are supported when properly quoted ("foo\nbar"). If a
// data line under-fills the expected column count and quote-state is
// closed, we emit a structured error rather than trying to merge
// physical lines (which would risk silently rebuilding the wrong row).
//
// The parser is independent of the Start/End path. The dispatcher in
// parsePlexusIqClinicalImport tries this path first when the first
// non-blank line looks like a header.

type DelimitedRow = { rowIndex: number; cells: string[]; raw: string };

function detectDelimiter(text: string): "\t" | "," {
  const firstLine =
    text.replace(/\r\n/g, "\n").split("\n").find((l) => l.trim()) ?? "";
  if (firstLine.includes("\t")) return "\t";
  return ",";
}

// Quote-aware row reader. Returns DelimitedRow[] where each row's
// cells[] preserves any newlines that appeared inside quoted cells.
// Sets `closedAtEOF` to false if EOF was reached mid-quote — callers
// should report that as an unterminated-quote error.
function parseDelimitedRows(
  text: string,
  delim: "\t" | ",",
): { rows: DelimitedRow[]; closedAtEOF: boolean } {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: DelimitedRow[] = [];
  let cur = "";
  let cells: string[] = [];
  let rawStart = 0;
  let inQuote = false;
  let rowIndex = 0;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (inQuote) {
      if (c === '"' && normalized[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (c === '"') {
        inQuote = false;
        continue;
      }
      cur += c;
      continue;
    }
    if (c === '"') {
      inQuote = true;
      continue;
    }
    if (c === delim) {
      cells.push(cur);
      cur = "";
      continue;
    }
    if (c === "\n") {
      cells.push(cur);
      const raw = normalized.slice(rawStart, i);
      // Skip rows that are entirely empty (no content on this line)
      if (cells.length > 1 || cells[0].trim() !== "") {
        rowIndex += 1;
        rows.push({ rowIndex, cells, raw });
      }
      cells = [];
      cur = "";
      rawStart = i + 1;
      continue;
    }
    cur += c;
  }
  // Final row (no trailing newline)
  if (cur.length > 0 || cells.length > 0) {
    cells.push(cur);
    if (cells.length > 1 || cells[0].trim() !== "") {
      rowIndex += 1;
      rows.push({ rowIndex, cells, raw: normalized.slice(rawStart) });
    }
  }
  return { rows, closedAtEOF: !inQuote };
}

// Clinical-only columns — the presence of one of these in the header
// distinguishes a clinical-spreadsheet table from the legacy CSV
// (`facility,date,name,type,time`), whose columns are all non-clinical.
const CLINICAL_HEADER_KEYS: ClinicalCol[] = [
  "DOB",
  "AGE",
  "SEX",
  "MRN",
  "Dx",
  "Hx",
  "Rx",
  "Ancillaries Completed",
  "INSURANCE",
];

function looksLikeHeaderRow(cells: string[]): {
  ok: boolean;
  headerMap: Record<string, number>;
} {
  const lowered = cells.map((c) => c.trim().toLowerCase());
  const headerMap: Record<string, number> = {};
  for (const col of CLINICAL_COLUMNS) {
    const aliases = HEADER_ALIASES[col].map((a) => a.toLowerCase());
    const idx = lowered.findIndex((c) => aliases.includes(c));
    if (idx >= 0) headerMap[col] = idx;
  }
  // Header-driven detection requires:
  //   - NAME is present (so we can identify the patient), AND
  //   - at least one clinical-only column is present (so we don't
  //     accidentally swallow the legacy CSV import, whose columns are
  //     facility/date/name/type/time — non-clinical).
  const hasName = headerMap["NAME"] != null;
  const hasClinical = CLINICAL_HEADER_KEYS.some((k) => headerMap[k] != null);
  return { ok: hasName && hasClinical, headerMap };
}

function pickCellByHeader(
  cells: string[],
  headerMap: Record<string, number>,
  col: ClinicalCol,
): string | undefined {
  const idx = headerMap[col];
  if (idx == null) return undefined;
  if (idx < 0 || idx >= cells.length) return undefined;
  return trimOrUndefined(cells[idx]);
}

function parseHeaderDrivenTable(
  text: string,
  defaults: PlexusIqClinicalImportDefaults,
): PlexusIqClinicalImportParseResult {
  const delim = detectDelimiter(text);
  const { rows, closedAtEOF } = parseDelimitedRows(text, delim);
  if (rows.length === 0) {
    return { rows: [], errors: [], format: "unknown" };
  }
  const headerCheck = looksLikeHeaderRow(rows[0].cells);
  if (!headerCheck.ok) {
    return { rows: [], errors: [], format: "unknown" };
  }
  const headerMap = headerCheck.headerMap;
  const expectedCellCount = rows[0].cells.length;
  const out: PlexusIqClinicalImportRow[] = [];
  const errors: PlexusIqClinicalImportError[] = [];

  if (!closedAtEOF) {
    errors.push({
      rowIndex: rows.length,
      reason: "Unterminated quoted cell — closing \" expected before EOF",
    });
  }

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    // A data row that's wildly short suggests an unquoted multiline
    // cell that fragmented across lines. We don't try to merge — emit
    // a visible error so the user fixes the source rather than us
    // guessing where the row continues.
    if (r.cells.length < Math.max(2, Math.floor(expectedCellCount / 2))) {
      errors.push({
        rowIndex: r.rowIndex,
        reason:
          "Multiline clinical cells require either quoted spreadsheet export/upload or Start/End boundaries.",
        raw: r.raw,
      });
      continue;
    }
    const name = pickCellByHeader(r.cells, headerMap, "NAME");
    if (!name) {
      errors.push({ rowIndex: r.rowIndex, reason: "Missing NAME", raw: r.raw });
      continue;
    }
    // Per-row clinic column overrides the modal/default facility.
    // TFP, "Taylor", etc. are normalized to their canonical name.
    const clinicCell = pickCellByHeader(r.cells, headerMap, "CLINIC");
    const facilityResolved =
      normalizeClinicAlias(clinicCell) ??
      (defaults.facility ? normalizeClinicAlias(defaults.facility) : undefined);

    const dateRaw = pickCellByHeader(r.cells, headerMap, "DATE");
    const scheduleDate =
      normalizeDate(dateRaw) ?? defaults.scheduleDate ?? undefined;
    const dobRaw = pickCellByHeader(r.cells, headerMap, "DOB");
    const phone = pickCellByHeader(r.cells, headerMap, "PHONE");
    const email = pickCellByHeader(r.cells, headerMap, "EMAIL");

    // Non-fatal warnings: missing DOB/phone do not block import or AI
    // qualification. They populate the row's `warnings[]` so the modal
    // preview can show "Missing Info" counts and so the send-to-
    // Engagement action can gate on completeness later.
    const warnings: string[] = [];
    if (!dobRaw) warnings.push("Missing DOB");
    if (!phone) warnings.push("Missing phone number");

    out.push({
      rowIndex: r.rowIndex,
      facility: facilityResolved,
      clinician: pickCellByHeader(r.cells, headerMap, "CLINICIAN"),
      scheduleDate,
      time: pickCellByHeader(r.cells, headerMap, "TIME"),
      name,
      dob: normalizeDate(dobRaw) ?? dobRaw,
      age: pickCellByHeader(r.cells, headerMap, "AGE"),
      sex: pickCellByHeader(r.cells, headerMap, "SEX"),
      mrn: pickCellByHeader(r.cells, headerMap, "MRN"),
      phone,
      email,
      diagnoses: pickCellByHeader(r.cells, headerMap, "Dx"),
      history: pickCellByHeader(r.cells, headerMap, "Hx"),
      medications: pickCellByHeader(r.cells, headerMap, "Rx"),
      previousAncillaries: pickCellByHeader(r.cells, headerMap, "Ancillaries Completed"),
      insurance: pickCellByHeader(r.cells, headerMap, "INSURANCE"),
      patientType: normalizePatientTypeFromCell(
        pickCellByHeader(r.cells, headerMap, "PATIENT_TYPE"),
        defaults.patientType ?? "visit",
      ),
      dateAdded: pickCellByHeader(r.cells, headerMap, "DATE_ADDED"),
      warnings: warnings.length > 0 ? warnings : undefined,
      raw: r.raw,
    });
  }

  return { rows: out, errors, format: "clinical-spreadsheet" };
}

// Detect whether the pasted text looks like clinical-spreadsheet: it must
// contain a Start...End pair separated by at least one tab somewhere in
// the segment. Pure label-block paste (Start\n…\nEnd) has no tabs.
function looksLikeClinicalSpreadsheet(text: string): boolean {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Quick win: header row that starts with literal "Start\t".
  const firstNonBlank = normalized.split("\n").find((l) => l.trim().length > 0) ?? "";
  if (/^\s*start\b/i.test(firstNonBlank) && firstNonBlank.includes("\t")) {
    return true;
  }
  // Otherwise: any occurrence of "Start" followed by content with tabs
  // then "End" at a cell boundary.
  return /(^|\n|\t)\s*Start\s*\t[\s\S]*?\t\s*End\s*(\t|\n|$)/i.test(normalized);
}

export function parsePlexusIqClinicalImport(
  text: string,
  defaults: PlexusIqClinicalImportDefaults = {},
): PlexusIqClinicalImportParseResult {
  const resolvedDefaults: PlexusIqClinicalImportDefaults = {
    facility: defaults.facility,
    scheduleDate: defaults.scheduleDate || todayIso(),
    patientType: defaults.patientType ?? "visit",
  };

  if (!text || !text.trim()) {
    return { rows: [], errors: [], format: "unknown" };
  }

  // Detection order:
  //   1. Header-driven delimited table (no Start/End needed). Wins when
  //      the first non-blank line looks like a recognisable header row.
  //   2. Start/End spreadsheet with header or positional layout.
  //   3. Fall through — caller handles legacy Start/End label-blocks
  //      and legacy CSV (`facility,date,name,type,time`).
  const firstNonBlank =
    text.replace(/\r\n/g, "\n").split("\n").find((l) => l.trim()) ?? "";
  if (firstNonBlank.includes("\t") || firstNonBlank.includes(",")) {
    const delim = firstNonBlank.includes("\t") ? "\t" : ",";
    const { rows: probeRows } = parseDelimitedRows(text, delim);
    if (probeRows.length > 0) {
      const probe = looksLikeHeaderRow(probeRows[0].cells);
      if (probe.ok) {
        return parseHeaderDrivenTable(text, resolvedDefaults);
      }
    }
  }

  if (looksLikeClinicalSpreadsheet(text)) {
    return parseClinicalSpreadsheet(text, resolvedDefaults);
  }

  // Not clinical-spreadsheet. Caller (the modal) handles the existing
  // Start/End label-block and legacy CSV paths. We return a sentinel.
  return { rows: [], errors: [], format: "unknown" };
}
