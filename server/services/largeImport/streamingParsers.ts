// Streaming, memory-safe parsers for large patient-source files.
//
// PRIMARY RULE: never hold the whole file (128 MB) in application RAM. CSV/TSV
// stream row-by-row from disk; XLSX uses ExcelJS's streaming WorkbookReader
// which reads cells incrementally and does NOT load embedded media/images.
// The only thing kept in memory is the array of NORMALIZED rows (small: a few
// MB even at 15k rows), never the raw bytes.
//
// Deterministic column detection runs FIRST (shared/patientColumnMap). AI is
// used ONLY for genuinely ambiguous/headerless free-text — and then only on
// bounded chunks, never the whole file, and never a silent slice() that drops
// the remainder.

import fs from "node:fs";
import ExcelJS from "exceljs";
import { parse as csvParse } from "csv-parse";
import type { ImportFileFormat } from "@shared/schema";
import { detectColumns, type ColumnDetectionResult } from "@shared/patientColumnMap";
import { buildNormalizedRow, type NormalizedImportRow } from "@shared/patientImportRow";

export type WorkbookInfo = {
  sheets: Array<{ name: string; rowCount: number; chosen: boolean }>;
  chosenSheet: string | null;
  mediaLoaded: false; // streaming mode never loads embedded media/images
  note: string;
};

export type ParseResult = {
  format: ImportFileFormat;
  headers: string[];
  detection: ColumnDetectionResult;
  rows: NormalizedImportRow[];
  workbookInfo?: WorkbookInfo;
  warnings: string[];
};

const RAW_SNIPPET_MAX = 2000; // per-row verbatim trace cap
// Safety ceiling on useful patient rows regardless of file bytes. 15k target
// with generous headroom; a file yielding more rows than this fails visibly
// rather than silently importing a partial set.
const MAX_ROWS = 200_000;

export function detectFormat(filename: string, mime?: string | null): ImportFileFormat {
  const ext = (filename.toLowerCase().split(".").pop() ?? "").trim();
  if (ext === "csv") return "csv";
  if (ext === "tsv" || ext === "tab") return "tsv";
  if (ext === "xlsx" || ext === "xls" || ext === "xlsm") return "xlsx";
  if (ext === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "gif", "bmp", "webp"].includes(ext)) return "image";
  // Fall back to MIME sniffing when the extension is missing/unknown.
  const m = (mime ?? "").toLowerCase();
  if (m.includes("csv")) return "csv";
  if (m.includes("tab-separated")) return "tsv";
  if (m.includes("spreadsheet") || m.includes("excel")) return "xlsx";
  if (m.includes("pdf")) return "pdf";
  if (m.startsWith("image/")) return "image";
  return "unknown";
}

function firstNonEmptyHeader(records: string[][]): { headerIdx: number; headers: string[] } | null {
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r && r.some((c) => (c ?? "").toString().trim().length > 0)) {
      return { headerIdx: i, headers: r.map((c) => (c ?? "").toString()) };
    }
  }
  return null;
}

/** Stream a delimited (CSV/TSV) file row-by-row from disk. */
export async function parseDelimitedFile(
  path: string,
  format: "csv" | "tsv",
  opts: { defaultFacility?: string | null } = {},
): Promise<ParseResult> {
  const delimiter = format === "tsv" ? "\t" : ",";
  const warnings: string[] = [];

  const parser = csvParse({
    delimiter,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  const stream = fs.createReadStream(path);
  stream.pipe(parser);

  let headers: string[] = [];
  let detection: ColumnDetectionResult | null = null;
  const rows: NormalizedImportRow[] = [];
  let dataRowIndex = 0;
  let sawHeader = false;

  for await (const record of parser as AsyncIterable<string[]>) {
    if (!sawHeader) {
      const cells = record.map((c) => (c ?? "").toString());
      if (!cells.some((c) => c.trim().length > 0)) continue; // skip leading blanks
      headers = cells;
      detection = detectColumns(headers);
      sawHeader = true;
      if (detection.ambiguous) {
        warnings.push("ambiguous_headers");
      }
      continue;
    }
    if (!detection) break;
    if (rows.length >= MAX_ROWS) {
      warnings.push(`row_cap_reached:${MAX_ROWS}`);
      break;
    }
    dataRowIndex += 1;
    const rawLine = record.join(delimiter).slice(0, RAW_SNIPPET_MAX);
    rows.push(
      buildNormalizedRow(record, detection.mapping, dataRowIndex, {
        rawLine,
        defaultFacility: opts.defaultFacility ?? null,
      }),
    );
  }

  if (!sawHeader || !detection) {
    return {
      format,
      headers: [],
      detection: { mapping: {}, fieldToHeader: {}, unmapped: [], ambiguous: true },
      rows: [],
      warnings: [...warnings, "empty_or_headerless_file"],
    };
  }

  return { format, headers, detection, rows, warnings };
}

type SheetCollect = {
  name: string;
  headers: string[];
  detection: ColumnDetectionResult;
  rows: NormalizedImportRow[];
};

// Files at/under this size may fall back to a non-streaming read if the
// streaming reader fails (a known exceljs 4.4 + Node interaction on some
// runtimes). Above this we NEVER buffer the whole workbook into RAM — a
// streaming failure surfaces as a retryable error instead.
const SAFE_INMEMORY_XLSX_BYTES = 60 * 1024 * 1024;

/** Collect (headers + normalized rows) for one sheet from its raw row-cell arrays. */
function collectSheet(
  name: string,
  rowCellArrays: Iterable<string[]>,
  opts: { defaultFacility?: string | null },
  warnings: string[],
): SheetCollect {
  let headers: string[] = [];
  let detection: ColumnDetectionResult | null = null;
  const rows: NormalizedImportRow[] = [];
  let dataRowIndex = 0;
  for (const cells of rowCellArrays) {
    if (!detection) {
      if (!cells.some((c) => c.trim().length > 0)) continue;
      headers = cells;
      detection = detectColumns(headers);
      continue;
    }
    if (rows.length >= MAX_ROWS) { warnings.push(`row_cap_reached:${MAX_ROWS}`); break; }
    if (!cells.some((c) => c.trim().length > 0)) continue;
    dataRowIndex += 1;
    const rawLine = cells.join("\t").slice(0, RAW_SNIPPET_MAX);
    rows.push(
      buildNormalizedRow(cells, detection.mapping, dataRowIndex, {
        rawLine,
        defaultFacility: opts.defaultFacility ?? null,
      }),
    );
  }
  return {
    name,
    headers,
    detection: detection ?? { mapping: {}, fieldToHeader: {}, unmapped: [], ambiguous: true },
    rows,
  };
}

/** Streaming collection — incremental, never loads media. */
async function collectSheetsStreaming(
  path: string,
  opts: { defaultFacility?: string | null },
  warnings: string[],
): Promise<SheetCollect[]> {
  const sheets: SheetCollect[] = [];
  // Minimal option set: emit worksheets, cache shared strings. Defaults already
  // ignore styles/hyperlinks/media, so embedded media/images are never loaded.
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    worksheets: "emit",
    sharedStrings: "cache",
  });
  for await (const worksheet of reader as AsyncIterable<any>) {
    const name: string = worksheet.name ?? `Sheet${sheets.length + 1}`;
    const rowCells: string[][] = [];
    for await (const row of worksheet as AsyncIterable<any>) {
      const values: unknown[] = Array.isArray(row.values) ? row.values.slice(1) : [];
      rowCells.push(values.map((v) => cellToString(v)));
      if (rowCells.length > MAX_ROWS + 5) break;
    }
    sheets.push(collectSheet(name, rowCells, opts, warnings));
  }
  return sheets;
}

/** Non-streaming fallback — loads the workbook (bounded by size guard). */
async function collectSheetsReadFile(
  path: string,
  opts: { defaultFacility?: string | null },
  warnings: string[],
): Promise<SheetCollect[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const sheets: SheetCollect[] = [];
  wb.eachSheet((ws) => {
    const rowCells: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values: unknown[] = Array.isArray(row.values) ? (row.values as unknown[]).slice(1) : [];
      rowCells.push(values.map((v) => cellToString(v)));
    });
    sheets.push(collectSheet(ws.name, rowCells, opts, warnings));
  });
  return sheets;
}

/**
 * Parse an XLSX workbook. Buffers only NORMALIZED rows per worksheet (small),
 * inspects every sheet's header row, and selects the patient-bearing sheet
 * (most confidently-mapped, non-ambiguous, then most rows). Embedded media and
 * decorative assets are never loaded by the streaming path.
 *
 * Streaming is primary (memory-safe for 128 MB+). If it fails on a smaller
 * file, we fall back to a bounded non-streaming read; large files fail visibly
 * rather than risk loading the whole workbook (media included) into RAM.
 */
export async function parseXlsxFile(
  path: string,
  opts: { defaultFacility?: string | null } = {},
): Promise<ParseResult> {
  const warnings: string[] = [];
  let sheets: SheetCollect[];
  try {
    sheets = await collectSheetsStreaming(path, opts, warnings);
  } catch (streamErr) {
    let bytes = Number.POSITIVE_INFINITY;
    try { bytes = fs.statSync(path).size; } catch { /* unknown */ }
    if (bytes > SAFE_INMEMORY_XLSX_BYTES) {
      throw new Error(
        `XLSX streaming parse failed and file (${Math.round(bytes / 1024 / 1024)} MB) exceeds the ` +
          `${SAFE_INMEMORY_XLSX_BYTES / 1024 / 1024} MB in-memory fallback limit: ${(streamErr as Error)?.message}`,
      );
    }
    warnings.push("xlsx_streaming_fallback_readfile");
    sheets = await collectSheetsReadFile(path, opts, warnings);
  }

  // Choose the patient-bearing sheet: non-ambiguous first, then most mapped
  // columns, then most rows. Decorative/summary sheets lose on all three.
  const scored = sheets
    .map((s) => ({
      s,
      mapped: Object.keys(s.detection.mapping).length,
      ambiguous: s.detection.ambiguous,
      rowCount: s.rows.length,
    }))
    .sort((a, b) => {
      if (a.ambiguous !== b.ambiguous) return a.ambiguous ? 1 : -1;
      if (a.mapped !== b.mapped) return b.mapped - a.mapped;
      return b.rowCount - a.rowCount;
    });

  const chosen = scored[0]?.s ?? null;
  const workbookInfo: WorkbookInfo = {
    sheets: sheets.map((s) => ({ name: s.name, rowCount: s.rows.length, chosen: s === chosen })),
    chosenSheet: chosen?.name ?? null,
    mediaLoaded: false,
    note: "Streaming reader skips embedded media/images and decorative assets; only cell values are read.",
  };

  if (!chosen || chosen.rows.length === 0) {
    warnings.push("no_patient_bearing_sheet");
    return {
      format: "xlsx",
      headers: chosen?.headers ?? [],
      detection: chosen?.detection ?? { mapping: {}, fieldToHeader: {}, unmapped: [], ambiguous: true },
      rows: [],
      workbookInfo,
      warnings,
    };
  }
  if (chosen.detection.ambiguous) warnings.push("ambiguous_headers");
  if (sheets.length > 1) warnings.push(`multi_sheet_selected:${chosen.name}`);

  return {
    format: "xlsx",
    headers: chosen.headers,
    detection: chosen.detection,
    rows: chosen.rows,
    workbookInfo,
    warnings,
  };
}

function cellToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const anyV = v as Record<string, unknown>;
    // ExcelJS rich-text / hyperlink / formula result shapes.
    if (typeof anyV.text === "string") return anyV.text;
    if (typeof anyV.result !== "undefined") return String(anyV.result);
    if (anyV.richText && Array.isArray(anyV.richText)) {
      return (anyV.richText as Array<{ text?: string }>).map((r) => r.text ?? "").join("");
    }
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v).trim();
}

/**
 * Top-level dispatcher. Structured formats (CSV/TSV/XLSX) parse deterministically
 * with no AI. PDF/image return a bounded, explicit "needs specialized workflow"
 * result rather than shoving hundreds of MB into an LLM — they are handled by
 * the interactive quick-import path, not the large-file bulk path.
 */
export async function parseLargeFile(
  path: string,
  format: ImportFileFormat,
  opts: { defaultFacility?: string | null } = {},
): Promise<ParseResult> {
  switch (format) {
    case "csv":
    case "tsv":
      return parseDelimitedFile(path, format, opts);
    case "xlsx":
      return parseXlsxFile(path, opts);
    case "pdf":
    case "image":
      return {
        format,
        headers: [],
        detection: { mapping: {}, fieldToHeader: {}, unmapped: [], ambiguous: true },
        rows: [],
        warnings: [
          `${format}_not_supported_in_bulk`,
          "Use the interactive quick-import for PDFs/images; large-file bulk supports CSV/TSV/XLSX.",
        ],
      };
    default:
      return {
        format: "unknown",
        headers: [],
        detection: { mapping: {}, fieldToHeader: {}, unmapped: [], ambiguous: true },
        rows: [],
        warnings: ["unknown_format"],
      };
  }
}
