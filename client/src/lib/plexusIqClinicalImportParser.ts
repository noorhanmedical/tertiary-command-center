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
  scheduleDate?: string;
  time?: string;
  name: string;
  dob?: string;
  age?: string;
  sex?: string;
  mrn?: string;
  diagnoses?: string;
  history?: string;
  medications?: string;
  previousAncillaries?: string;
  insurance?: string;
  patientType?: "visit" | "outreach";
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
] as const;

type ClinicalCol = (typeof CLINICAL_COLUMNS)[number];

const HEADER_ALIASES: Record<ClinicalCol, string[]> = {
  Start: ["start"],
  DATE: ["date", "schedule date", "appt date", "appointment date"],
  TIME: ["time", "appt time", "appointment time"],
  NAME: ["name", "patient", "patient name"],
  DOB: ["dob", "date of birth"],
  AGE: ["age"],
  SEX: ["sex", "gender"],
  MRN: ["mrn", "medical record number", "chart"],
  Dx: ["dx", "diagnoses", "diagnosis", "problems"],
  Hx: ["hx", "history", "pmh"],
  Rx: ["rx", "medications", "meds"],
  "Ancillaries Completed": [
    "ancillaries completed",
    "ancillaries",
    "previous ancillaries",
    "previous tests",
  ],
  INSURANCE: ["insurance", "payer", "plan"],
  End: ["end"],
};

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
    };
    idx = positional[col];
    if (idx === -1) idx = fallbackPos;
  }
  if (idx == null || idx < 0 || idx >= rawRow.cells.length) return undefined;
  return trimOrUndefined(rawRow.cells[idx]);
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

  if (looksLikeClinicalSpreadsheet(text)) {
    return parseClinicalSpreadsheet(text, resolvedDefaults);
  }

  // Not clinical-spreadsheet. Caller (the modal) handles the existing
  // Start/End label-block and legacy CSV paths. We return a sentinel.
  return { rows: [], errors: [], format: "unknown" };
}
