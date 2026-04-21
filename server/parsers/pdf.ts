import type { ParsedPatient } from "./types";

export async function parsePdfFile(buffer: Buffer): Promise<ParsedPatient[]> {
  let text = "";
  try {
    const pdfParseModule = await import("pdf-parse");
    const pdfParseFn: any = (pdfParseModule as any).default ?? pdfParseModule;
    const pdfData = await pdfParseFn(buffer);
    text = pdfData.text || "";
  } catch {
    text = "";
  }

  const { extractPdfPatients } = await import("../services/screening");
  const extracted = await extractPdfPatients(text);

  return extracted
    .filter((p) => p.name && p.name.trim())
    .map((p) => ({
      name: p.name.trim(),
      time: p.time || undefined,
    }));
}
