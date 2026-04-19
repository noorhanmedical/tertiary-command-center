import * as XLSX from "xlsx";
import { openai, withRetry } from "../services/aiClient";
import type { ParsedPatient } from "./types";
import { isProviderName, parseWithAI } from "./plainText";

const NO_PREV_TESTS_RE = /\bno\s+record\b|\bno\s+prior\b|\bno\s+previous\b|\bnone\b|\bn\/a\b|\bno\s+tests?\b|\bnot\s+applicable\b|\bno\s+ancillar|\bno\s+hga\b/i;

const EXCEL_COL_MAP_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: "name",          pattern: /^(name|patientname|patient)$/ },
  { key: "time",          pattern: /^(time|appttime|appointmenttime|start|starttime)$/ },
  { key: "age",           pattern: /^(age)$/ },
  { key: "gender",        pattern: /^(gender|sex)$/ },
  { key: "dob",           pattern: /^(dob|dateofbirth|birthdate)$/ },
  { key: "insurance",     pattern: /^(insurance|payer|insurancetype|insuranceplan)$/ },
  { key: "diagnoses",     pattern: /^(diagnoses|dx|diagnosis|conditions|assessmentplan|assessment)$/ },
  { key: "history",       pattern: /^(hpi|history|pmh|medicalhistory|pastmedicalhistory|pasthistory)$/ },
  { key: "medications",   pattern: /^(medications|rx|meds|prescriptions|currentmeds|currentmedications)$/ },
  { key: "notes",         pattern: /^(notes|note|comments|comment|chiefcomplaint|cc|reason|visitreason)$/ },
  { key: "previousTests", pattern: /^(ancillariescompleted|ancillariesdone|completedancillaries|hgarecords|previouslycompleted|testscompleted|ancillaryhistory|previousimaging|priorimaging)$/ },
];

const TSV_BLOCK_SYSTEM_PROMPT = `You are a clinical data parser. The input contains patient records separated by "---". Each record starts with "Patient: <name>" and has pre-labeled sections (Diagnoses:, History/HPI:, Medications:). Extract clinical data and return each patient's name exactly as given.

For each record extract:
- "name": patient name exactly as it appears after "Patient:" (required)
- "time": appointment time if present after "Time:" (e.g. "9:00 AM"), or null
- "age": age as a number if present after "Age:", or null
- "gender": gender if present after "Gender:" (M/F/Male/Female), or null
- "insurance": insurance carrier/plan if present, or null
- "diagnoses": copy the entire text under "Diagnoses:" verbatim, or null if absent
- "history": copy the entire text under "History/HPI:" verbatim, or null if absent
- "medications": copy the entire text under "Medications:" verbatim, or null if absent
- "previousTests": ONLY copy text from an explicitly labeled section: "Ancillaries Completed:", "Previous Tests:", "HGA Records:", "Ancillary History:", "Tests Completed:", "Prior Imaging:", "Past Studies:", "Completed Ancillaries:". Copy verbatim. If no such section exists, return null. NEVER extract from Diagnoses, History, Medications, or any other section.

Rules:
- CRITICAL: Copy diagnoses, history, medications, and previousTests EXACTLY as written under their labeled sections. Do NOT rephrase, reword, summarize, or alter the text in any way.
- Each labeled section (Diagnoses:, History/HPI:, Medications:, Ancillaries Completed:) is a discrete column from the source EHR — NEVER mix content between sections.
- For medications: if no "Medications:" section exists, set to null. Do not infer medications from the history text.
- For previousTests: if no labeled ancillaries section exists, return null. Do not infer from diagnoses or history.
- Return exactly one result object per record. Include the "name" field in every result.

Respond with JSON: { "records": [ ...one object per patient record... ] }. No markdown. Do not truncate.`;

function getNormalizedKeysExcel(name: string): string[] {
  const t = name.trim();
  let parts: string[];
  if (t.includes(",")) {
    const commaIdx = t.indexOf(",");
    const last = t.slice(0, commaIdx).trim().toLowerCase();
    const firstMiddle = t.slice(commaIdx + 1).trim().toLowerCase().replace(/\s+/g, " ");
    const fmParts = firstMiddle.split(" ").filter(Boolean);
    const full = `${firstMiddle} ${last}`.trim();
    if (fmParts.length > 1) {
      const short = `${fmParts[0]} ${last}`.trim();
      return [full, short];
    }
    return [full];
  }
  parts = t.toLowerCase().replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (parts.length >= 3) {
    const full = parts.join(" ");
    const short = `${parts[0]} ${parts[parts.length - 1]}`;
    return [full, short];
  }
  return [parts.join(" ")];
}

async function parseTsvBatch(batch: { name: string; block: string; insurance?: string; noPreviousTests?: boolean }[]): Promise<ParsedPatient[]> {
  const combined = batch.map((s) => s.block).join("\n\n---\n\n");

  const aiResponse = await withRetry(
    () =>
      openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: TSV_BLOCK_SYSTEM_PROMPT },
          { role: "user", content: combined },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
        max_completion_tokens: 16000,
      }),
    3,
    "parseTsvBatch"
  );

  const content = aiResponse.choices[0]?.message?.content?.trim() || "{}";
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    parsed = JSON.parse(cleaned);
  }

  const arr: any[] = Array.isArray(parsed) ? parsed : (parsed.records || parsed.patients || []);

  const byName = new Map<string, any>();
  for (const r of arr) {
    if (r.name && typeof r.name === "string") {
      const keys = getNormalizedKeysExcel(r.name);
      for (const k of keys) {
        if (!byName.has(k)) byName.set(k, r);
      }
    }
  }

  return batch.map((seg) => {
    const segKeys = getNormalizedKeysExcel(seg.name);
    let r: any = null;
    for (const k of segKeys) {
      if (byName.has(k)) {
        r = byName.get(k);
        break;
      }
    }
    if (!r) {
      console.warn(`parseTsvBatch: no AI result matched patient "${seg.name}" by name; record will have no clinical data`);
      r = {};
    }
    return {
      name: seg.name.trim(),
      time: r.time || undefined,
      age: r.age ? parseInt(String(r.age)) : undefined,
      gender: r.gender || undefined,
      insurance: r.insurance || seg.insurance || undefined,
      diagnoses: r.diagnoses || undefined,
      history: r.history || undefined,
      medications: r.medications || undefined,
      previousTests: r.previousTests || undefined,
      noPreviousTests: seg.noPreviousTests,
    };
  });
}

export async function parseTsvBlocks(segments: { name: string; block: string; insurance?: string; noPreviousTests?: boolean }[]): Promise<ParsedPatient[]> {
  const MAX_BATCH_CHARS = 15000;
  const batches: { name: string; block: string; insurance?: string; noPreviousTests?: boolean }[][] = [];
  let currentBatch: { name: string; block: string; insurance?: string; noPreviousTests?: boolean }[] = [];
  let currentLen = 0;

  for (const seg of segments) {
    const segLen = seg.block.length + 20;
    if (currentBatch.length > 0 && currentLen + segLen > MAX_BATCH_CHARS) {
      batches.push(currentBatch);
      currentBatch = [];
      currentLen = 0;
    }
    currentBatch.push(seg);
    currentLen += segLen;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  const results: ParsedPatient[] = [];
  for (const batch of batches) {
    const batchResults = await parseTsvBatch(batch);
    results.push(...batchResults);
  }
  return results;
}

export function excelToText(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const lines: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
    if (rows.length === 0) continue;
    const headers = Object.keys(rows[0]);
    const endColIdx = headers.findIndex((h) => h.trim().toLowerCase() === "end");
    if (endColIdx >= 0) {
      const dataHeaders = headers.filter((_, i) => i !== endColIdx);
      for (const row of rows) {
        const values = dataHeaders.map((h) => String(row[h] ?? ""));
        if (values.every((v) => !v.trim())) continue;
        lines.push(values.join("\t"));
        lines.push("end");
      }
    } else {
      lines.push(headers.join("\t"));
      for (const row of rows) {
        lines.push(headers.map((h) => String(row[h] ?? "")).join("\t"));
      }
    }
  }
  return lines.join("\n");
}

export function excelToSegments(buffer: Buffer): { name: string; block: string; insurance?: string; noPreviousTests?: boolean }[] | null {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const allSegments: { name: string; block: string; insurance?: string; noPreviousTests?: boolean }[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
    if (rows.length === 0) continue;

    const headers = Object.keys(rows[0]);
    const colMap: Record<string, string> = {};
    for (const h of headers) {
      const normalized = h.trim().toLowerCase().replace(/[\s_\-./]/g, "");
      for (const { key, pattern } of EXCEL_COL_MAP_PATTERNS) {
        if (!colMap[key] && pattern.test(normalized)) {
          colMap[key] = h;
          break;
        }
      }
    }

    if (!colMap.name) continue;

    for (const row of rows) {
      const name = String(row[colMap.name] ?? "").trim();
      if (!name || isProviderName(name)) continue;

      const parts: string[] = [];
      if (colMap.time) {
        const val = String(row[colMap.time] ?? "").trim();
        if (val) parts.push(`Time: ${val}`);
      }
      parts.push(`Patient: ${name}`);
      if (colMap.age) {
        const val = String(row[colMap.age] ?? "").trim();
        if (val) parts.push(`Age: ${val}`);
      }
      if (colMap.gender) {
        const val = String(row[colMap.gender] ?? "").trim();
        if (val) parts.push(`Gender: ${val}`);
      }
      if (colMap.dob) {
        const val = String(row[colMap.dob] ?? "").trim();
        if (val) parts.push(`DOB: ${val}`);
      }
      if (colMap.diagnoses) {
        const val = String(row[colMap.diagnoses] ?? "").trim();
        if (val) parts.push(`Diagnoses: ${val}`);
      }
      if (colMap.history) {
        const val = String(row[colMap.history] ?? "").trim();
        if (val) parts.push(`History: ${val}`);
      }
      if (colMap.medications) {
        const val = String(row[colMap.medications] ?? "").trim();
        if (val) parts.push(`Medications: ${val}`);
      }
      if (colMap.notes) {
        const val = String(row[colMap.notes] ?? "").trim();
        if (val) parts.push(`Notes: ${val}`);
      }

      let noPreviousTests: boolean | undefined;
      if (colMap.previousTests) {
        const val = String(row[colMap.previousTests] ?? "").trim();
        if (val) {
          if (NO_PREV_TESTS_RE.test(val)) {
            noPreviousTests = true;
          } else {
            parts.push(`Ancillaries Completed: ${val}`);
          }
        }
      }

      const insurance = colMap.insurance
        ? (String(row[colMap.insurance] ?? "").trim() || undefined)
        : undefined;

      allSegments.push({ name, block: parts.join("\n"), insurance, noPreviousTests });
    }
  }

  return allSegments.length > 0 ? allSegments : null;
}

export async function parseExcelFile(buffer: Buffer): Promise<ParsedPatient[]> {
  const segments = excelToSegments(buffer);
  if (segments && segments.length > 0) {
    return parseTsvBlocks(segments);
  }
  return parseWithAI(excelToText(buffer));
}
