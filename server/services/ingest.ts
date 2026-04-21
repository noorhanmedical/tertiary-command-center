export type { ParsedPatient } from "../parsers/types";
export { excelToText, excelToSegments, parseExcelFile, parseTsvBlocks } from "../parsers/excel";
export { csvToText, CSV_COLUMN_ALIASES, normalizeInsuranceType, parseHistoryCsv, parseHistoryImport } from "../parsers/csv";
export { parseWithAI, isProviderName, splitByEndDelimiter, getNormalizedKeys } from "../parsers/plainText";
export { parsePdfFile } from "../parsers/pdf";

import type { ParsedPatient } from "../parsers/types";
import { parseExcelFile } from "../parsers/excel";
import { csvToText } from "../parsers/csv";
import { parseWithAI } from "../parsers/plainText";
import { parsePdfFile } from "../parsers/pdf";

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp"]);

export async function parseFileBuffer(
  buffer: Buffer,
  filename: string,
  mimetype?: string
): Promise<ParsedPatient[]> {
  const ext = (filename.toLowerCase().split(".").pop() || "").replace(/\?.*$/, "");

  if (ext === "xlsx" || ext === "xls") {
    return parseExcelFile(buffer);
  }

  if (ext === "csv") {
    return parseWithAI(csvToText(buffer));
  }

  if (ext === "pdf") {
    return parsePdfFile(buffer);
  }

  if (IMAGE_EXTS.has(ext)) {
    const { extractImagePatients } = await import("./screening");
    const base64 = buffer.toString("base64");
    const mime = mimetype || `image/${ext === "jpg" ? "jpeg" : ext}`;
    const extracted = await extractImagePatients(base64, mime);
    return extracted
      .filter((p) => p.name && p.name.trim())
      .map((p) => ({ name: p.name.trim(), time: p.time || undefined }));
  }

  return parseWithAI(buffer.toString("utf-8"));
}
