import * as XLSX from "xlsx";
import { parse } from "csv-parse/sync";
import { openai, withRetry } from "./aiClient";

export interface ParsedPatient {
  time?: string;
  name: string;
  age?: number;
  gender?: string;
  insurance?: string;
  diagnoses?: string;
  history?: string;
  medications?: string;
  notes?: string;
  rawText?: string;
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

export function csvToText(buffer: Buffer): string {
  try {
    const records = parse(buffer.toString("utf-8"), {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as Record<string, string>[];
    if (records.length === 0) return buffer.toString("utf-8");
    const headers = Object.keys(records[0]);
    return [
      headers.join("\t"),
      ...records.map((r) => headers.map((h) => r[h] ?? "").join("\t")),
    ].join("\n");
  } catch {
    return buffer.toString("utf-8");
  }
}

const END_BLOCK_SYSTEM_PROMPT = `You are a clinical data parser. The input contains numbered patient records separated by "---". Extract clinical data from each record IN ORDER.

For each record extract:
- "time": appointment time if present (e.g. "9:00 AM"), or null
- "age": age as a number if present, or null
- "gender": gender if present (M/F/Male/Female), or null
- "insurance": insurance carrier/plan name if present (e.g. "Blue Cross Blue Shield", "Medicare", "Cigna", "Aetna", "United Healthcare"), or null
- "diagnoses": all diagnoses/conditions/Dx combined into one string, or null
- "history": past medical history/Hx/PMH combined into one string, or null
- "medications": all medications/Rx/prescriptions combined into one string, or null

Rules:
- Expand abbreviations: HTN=hypertension, DM=diabetes mellitus, HLD=hyperlipidemia, CAD, CHF, COPD, CKD, OA=osteoarthritis, GERD, A-fib, etc.
- For medications: only include actual drug/prescription names and dosages. If the only value looks like a visit reason, test name, or scheduling code (e.g. "BrainWave", "FU HGA", "med refills", "follow up", "physical"), set medications to null.
- Return exactly one result object per record, in the same order as the input.
- Do NOT include a name field — names are managed externally.

Respond with JSON: { "records": [ ...one object per input record, in order... ] }. No markdown. Do not truncate.`;

const PARSE_SYSTEM_PROMPT = `You are a clinical data parser. Extract EVERY patient record from the input text — do not stop early, do not skip any.

For each patient return:
- "name": full patient name (required — skip rows with no name)
- "time": appointment time if present (e.g. "9:00 AM"), or null
- "age": age as a number if present, or null
- "gender": gender if present (M/F/Male/Female), or null
- "insurance": insurance carrier/plan name if present (e.g. "Blue Cross", "Medicare", "Cigna"), or null
- "diagnoses": all diagnoses/conditions/Dx combined into one string, or null
- "history": past medical history/Hx/PMH combined into one string, or null
- "medications": all medications/Rx combined into one string, or null

Rules:
- Extract ALL patients in the input — even if there are 20 or more.
- Expand common abbreviations: HTN=hypertension, DM=diabetes mellitus, HLD=hyperlipidemia, CAD, CHF, COPD, CKD, OA=osteoarthritis, GERD, A-fib, etc.
- The input may be tab-separated spreadsheet data, a simple name list, or mixed clinical notes — handle all formats.
- If a row is clearly a header, summary, or empty — skip it.
- If there is no clinical data for a patient, still include them with null clinical fields.
- For the "medications" field: only include actual drug/prescription names and dosages. If the only value present looks like a visit reason, appointment note, scheduling code, or test name (e.g. "BrainWave", "VitalWave", "EEG", "FU HGA", "med refills", "follow up", "HGA", "new patient", "physical", "wellness"), set medications to null instead.

Respond with a JSON object: { "patients": [ ...array of ALL patient objects... ] }. No markdown. Do not truncate.`;

async function parseSingleChunk(chunk: string): Promise<ParsedPatient[]> {
  const aiResponse = await withRetry(
    () =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: PARSE_SYSTEM_PROMPT },
          { role: "user", content: chunk },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
        max_completion_tokens: 16000,
      }),
    3,
    "parseSingleChunk"
  );

  const content = aiResponse.choices[0]?.message?.content?.trim() || "{}";
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    parsed = JSON.parse(cleaned);
  }

  const arr: any[] = Array.isArray(parsed) ? parsed : (parsed.patients || parsed.records || []);
  return arr
    .filter((p: any) => p.name && typeof p.name === "string" && p.name.trim())
    .map((p: any) => ({
      name: p.name.trim(),
      time: p.time || undefined,
      age: p.age ? parseInt(String(p.age)) : undefined,
      gender: p.gender || undefined,
      insurance: p.insurance || undefined,
      diagnoses: p.diagnoses || undefined,
      history: p.history || undefined,
      medications: p.medications || undefined,
    }));
}

const PROVIDER_CREDENTIAL_RE = /\b(D\.O\.|M\.D\.|NP-BC|NP-C|APRN|ARNP|PA-C|PA\b|RN\b|DO\b|MD\b|NP\b|Ph\.D\.)/i;

export function isProviderName(name: string): boolean {
  return PROVIDER_CREDENTIAL_RE.test(name);
}

export function splitByEndDelimiter(text: string): { name: string; block: string; insurance?: string }[] | null {
  const lines = text.split("\n");

  function isInlineEndRow(line: string): boolean {
    const t = line.trim();
    if (!t.includes("\t")) return false;
    const fields = t.split("\t").map((f) => f.trim());
    return fields.length >= 2 && fields[fields.length - 1].toLowerCase() === "end";
  }

  const hasEnd = lines.some((l) => l.trim().toLowerCase() === "end" || isInlineEndRow(l));
  if (!hasEnd) return null;

  const segments: { name: string; block: string; insurance?: string }[] = [];
  let patientName: string | null = null;
  let bodyLines: string[] = [];
  let currentInsurance: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    if (lower === "end") {
      if (patientName) {
        segments.push({ name: patientName, block: bodyLines.join("\n"), insurance: currentInsurance });
      }
      patientName = null;
      bodyLines = [];
      currentInsurance = undefined;
      continue;
    }

    if (isInlineEndRow(line)) {
      if (patientName) {
        segments.push({ name: patientName, block: bodyLines.join("\n"), insurance: currentInsurance });
        patientName = null;
        bodyLines = [];
        currentInsurance = undefined;
      }
      const fields = trimmed.split("\t").map((f) => f.trim());
      const nonEndFields = fields.slice(0, -1);
      const first = nonEndFields[0] || "";
      const second = nonEndFields[1] || "";
      const combinedName = second ? `${first} ${second}` : first;
      if (!isProviderName(combinedName)) {
        const insurance = nonEndFields[nonEndFields.length - 1] || undefined;
        segments.push({ name: combinedName, block: nonEndFields.join("\t"), insurance });
      }
      continue;
    }

    if (!patientName) {
      if (!trimmed) continue;
      if (trimmed.includes("\t")) {
        const fields = trimmed.split("\t").map((f) => f.trim()).filter(Boolean);
        const first = fields[0] || "";
        const second = fields[1] || "";
        const combinedName = second ? `${first} ${second}` : first;
        if (isProviderName(combinedName)) continue;
        patientName = combinedName;
        bodyLines = [trimmed];
        currentInsurance = fields.length >= 6 ? (fields[fields.length - 1] || undefined) : undefined;
      } else {
        if (isProviderName(trimmed)) continue;
        patientName = trimmed;
      }
    } else {
      bodyLines.push(line);
    }
  }
  if (patientName) {
    segments.push({ name: patientName, block: bodyLines.join("\n"), insurance: currentInsurance });
  }

  return segments.length > 0 ? segments : null;
}

async function parseEndDelimitedBatch(batch: { name: string; block: string; insurance?: string }[], offset: number): Promise<ParsedPatient[]> {
  const combined = batch.map((s, i) => `Record ${offset + i + 1}:\n${s.block}`).join("\n\n---\n\n");

  const aiResponse = await withRetry(
    () =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: END_BLOCK_SYSTEM_PROMPT },
          { role: "user", content: combined },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
        max_completion_tokens: 16000,
      }),
    3,
    "parseEndDelimitedBatch"
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

  return batch.map((seg, i) => {
    const r = arr[i] || {};
    return {
      name: seg.name.trim(),
      time: r.time || undefined,
      age: r.age ? parseInt(String(r.age)) : undefined,
      gender: r.gender || undefined,
      insurance: r.insurance || seg.insurance || undefined,
      diagnoses: r.diagnoses || undefined,
      history: r.history || undefined,
      medications: r.medications || undefined,
    };
  });
}

async function parseEndDelimitedBlocks(segments: { name: string; block: string; insurance?: string }[]): Promise<ParsedPatient[]> {
  const MAX_BATCH_CHARS = 160000;
  const batches: { name: string; block: string; insurance?: string }[][] = [];
  let currentBatch: { name: string; block: string; insurance?: string }[] = [];
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
  let offset = 0;
  for (const batch of batches) {
    const batchResults = await parseEndDelimitedBatch(batch, offset);
    results.push(...batchResults);
    offset += batch.length;
  }
  return results;
}

function splitIntoChunks(text: string, chunkSize = 8000): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + chunkSize;
    if (end < text.length) {
      const breakAt = text.lastIndexOf("\n\n", end);
      if (breakAt > start + chunkSize / 2) end = breakAt;
    }
    chunks.push(text.slice(start, Math.min(end, text.length)));
    start = end;
  }
  return chunks;
}

function getNormalizedKeys(name: string): string[] {
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

function richness(p: ParsedPatient): number {
  return [p.time, p.age, p.gender, p.diagnoses, p.history, p.medications].filter(Boolean).length;
}

function pickRicher(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a.length >= b.length ? a : b;
}

function mergePatients(a: ParsedPatient, b: ParsedPatient): ParsedPatient {
  const richerName = richness(a) >= richness(b) ? a.name : b.name;
  return {
    name: richerName,
    time: pickRicher(a.time, b.time),
    age: a.age ?? b.age,
    gender: pickRicher(a.gender, b.gender),
    insurance: a.insurance || b.insurance,
    diagnoses: pickRicher(a.diagnoses, b.diagnoses),
    history: pickRicher(a.history, b.history),
    medications: pickRicher(a.medications, b.medications),
  };
}

export async function parseWithAI(rawText: string): Promise<ParsedPatient[]> {
  if (!rawText.trim()) return [];
  try {
    const trimmed = rawText.substring(0, 400000);

    const segments = splitByEndDelimiter(trimmed);
    let allPatients: ParsedPatient[];

    if (segments) {
      allPatients = await parseEndDelimitedBlocks(segments);
    } else {
      const chunks = splitIntoChunks(trimmed, 12000);
      const results = await Promise.all(chunks.map(parseSingleChunk));
      allPatients = results.flat();
    }

    const grouped = new Map<string, ParsedPatient>();
    const keyIndex = new Map<string, string>();

    for (const p of allPatients) {
      if (isProviderName(p.name)) continue;
      const keys = getNormalizedKeys(p.name);
      if (!keys.length || !keys[0]) continue;

      let existingCanonical: string | undefined;
      for (const k of keys) {
        if (keyIndex.has(k)) {
          existingCanonical = keyIndex.get(k)!;
          break;
        }
      }

      if (existingCanonical) {
        const existing = grouped.get(existingCanonical)!;
        grouped.set(existingCanonical, mergePatients(existing, p));
        for (const k of keys) {
          if (!keyIndex.has(k)) keyIndex.set(k, existingCanonical);
        }
      } else {
        const canonical = keys[0];
        grouped.set(canonical, p);
        for (const k of keys) keyIndex.set(k, canonical);
      }
    }
    return Array.from(grouped.values());
  } catch (err: any) {
    console.error("parseWithAI failed:", err.message);
    return [];
  }
}

export const CSV_COLUMN_ALIASES: Record<string, string> = {
  patientname: "patientName",
  patient: "patientName",
  name: "patientName",
  "patient name": "patientName",
  testname: "testName",
  test: "testName",
  "test name": "testName",
  service: "testName",
  dos: "dateOfService",
  "date of service": "dateOfService",
  date: "dateOfService",
  servicedate: "dateOfService",
  insurancetype: "insuranceType",
  insurance: "insuranceType",
  "insurance type": "insuranceType",
  payer: "insuranceType",
  dob: "dob",
  "date of birth": "dob",
  dateofbirth: "dob",
  birthdate: "dob",
  birthday: "dob",
  "birth date": "dob",
};

export function parseHistoryCsv(text: string): { patientName: string; dob?: string; testName: string; dateOfService: string; insuranceType: string }[] | null {
  try {
    const rows = parse(text, { skip_empty_lines: true, relax_column_count: true }) as string[][];
    if (rows.length < 2) return null;

    const headerRow = rows[0].map((h) => h.trim().toLowerCase());
    const colMap: Record<string, number> = {};
    for (let i = 0; i < headerRow.length; i++) {
      const normalized = CSV_COLUMN_ALIASES[headerRow[i]];
      if (normalized && !(normalized in colMap)) {
        colMap[normalized] = i;
      }
    }

    const required = ["patientName", "testName", "dateOfService"];
    if (!required.every((k) => k in colMap)) return null;

    const results: { patientName: string; dob?: string; testName: string; dateOfService: string; insuranceType: string }[] = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const patientName = (row[colMap.patientName] || "").trim();
      const testName = (row[colMap.testName] || "").trim();
      const dateOfService = (row[colMap.dateOfService] || "").trim();
      if (!patientName || !testName || !dateOfService) continue;
      const rawInsurance = colMap.insuranceType !== undefined ? (row[colMap.insuranceType] || "") : "";
      const insuranceType = normalizeInsuranceType(rawInsurance);
      const dob = colMap.dob !== undefined ? ((row[colMap.dob] || "").trim() || undefined) : undefined;
      results.push({ patientName, dob, testName, dateOfService, insuranceType });
    }
    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

export async function parseHistoryImport(text: string): Promise<{ patientName: string; dob?: string; testName: string; dateOfService: string; insuranceType: string }[]> {
  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a clinical data parser. You will receive raw text data from a patient test history spreadsheet/database. Extract patient records with:
- patientName: The patient's full name (Last, First format)
- dob: Date of birth in MM/DD/YYYY or YYYY-MM-DD format if available, otherwise null
- testName: The type of test performed. Look at the section header or context to determine the test type. Common tests: BrainWave, VitalWave, Bilateral Carotid Duplex, Echocardiogram TTE, Renal Artery Doppler, Lower Extremity Arterial Doppler, Upper Extremity Arterial Doppler, Abdominal Aortic Aneurysm Duplex, Stress Echocardiogram, Lower Extremity Venous Duplex, Upper Extremity Venous Duplex
- dateOfService: The date in YYYY-MM-DD format
- insuranceType: "medicare" or "ppo". Use "medicare" ONLY for straight/traditional/original Medicare. Medicare Advantage, HMO Medicare, MA plan, MAPD → use "ppo". Default to "ppo" when unclear.

The data is tab-separated and may have multiple columns. Focus on extracting the Date of Service (first column usually), Patient name (second column), DOB if present, and any insurance information available.

Return JSON: { "records": [ { "patientName": "...", "dob": "...", "testName": "...", "dateOfService": "...", "insuranceType": "..." } ] }

Skip rows that are headers, empty, or don't contain valid patient data (no date or no name).`,
          },
          {
            role: "user",
            content: text.substring(0, 30000),
          },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
        max_completion_tokens: 16000,
      }),
    3,
    "parseHistoryImport"
  );

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{"records":[]}');
    return parsed.records || [];
  } catch {
    console.error("Failed to parse history import response");
    return [];
  }
}

export function normalizeInsuranceType(raw: string): "medicare" | "ppo" {
  const s = raw.toLowerCase().trim();
  const isMedicareAdvantage =
    s.includes("medicare advantage") ||
    s.includes("hmo medicare") ||
    s.includes("ma plan") ||
    s.includes("mapd") ||
    s.includes("ma-pd");
  if (isMedicareAdvantage) return "ppo";
  if (s.includes("medicare")) return "medicare";
  return "ppo";
}
