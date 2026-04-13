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
  previousTests?: string;
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

const EXCEL_COL_MAP_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: "name",       pattern: /^(name|patientname|patient)$/ },
  { key: "time",       pattern: /^(time|appttime|appointmenttime|start|starttime)$/ },
  { key: "age",        pattern: /^(age)$/ },
  { key: "gender",     pattern: /^(gender|sex)$/ },
  { key: "dob",        pattern: /^(dob|dateofbirth|birthdate)$/ },
  { key: "insurance",  pattern: /^(insurance|payer|insurancetype|insuranceplan)$/ },
  { key: "diagnoses",  pattern: /^(diagnoses|dx|diagnosis|conditions|assessmentplan|assessment)$/ },
  { key: "history",    pattern: /^(hpi|history|pmh|medicalhistory|pastmedicalhistory|pasthistory)$/ },
  { key: "medications",pattern: /^(medications|rx|meds|prescriptions|currentmeds|currentmedications)$/ },
  { key: "notes",      pattern: /^(notes|note|comments|comment|chiefcomplaint|cc|reason|visitreason)$/ },
];

export function excelToSegments(buffer: Buffer): { name: string; block: string; insurance?: string }[] | null {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const allSegments: { name: string; block: string; insurance?: string }[] = [];

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

      const insurance = colMap.insurance
        ? (String(row[colMap.insurance] ?? "").trim() || undefined)
        : undefined;

      allSegments.push({ name, block: parts.join("\n"), insurance });
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
- "diagnoses": medical conditions/diagnoses/problems ONLY — e.g. hypertension, diabetes, COPD, chest pain, neuropathy. NEVER put medication names, drug names, dosages, test names, imaging study results, or previous ancillary history here.
- "history": past medical history/Hx/PMH copied verbatim from the source, joined into one string if multiple sections, or null
- "medications": all medications/Rx/prescriptions copied verbatim from the source, joined into one string if multiple sections, or null
- "previousTests": ALL mentions of previously performed tests or imaging anywhere in the note — including BrainWave, VitalWave, Carotid Duplex, Echocardiogram, Echo TTE, Renal Artery Doppler, LE Arterial Doppler, LE Venous Duplex, Abdominal Aorta, EKG, ABI, stress test, ultrasound, or any prior study. Look throughout the entire narrative, not just labeled sections. Copy verbatim.

Rules:
- CRITICAL: Copy diagnoses, history, medications, and previousTests EXACTLY as written in the source. Do NOT rephrase, reword, expand abbreviations, or alter the text in any way. Preserve original wording, abbreviations, capitalization, and punctuation.
- FIELD SEPARATION: Diagnoses must contain ONLY disease names and medical conditions. If you see drug/medication names in what appears to be a diagnoses section, move them to medications. If you see test names or "COMPLETED ✅" style entries, move them to previousTests.
- For medications: only include actual drug/prescription names and dosages. If the only value looks like a visit reason, test name, or scheduling code (e.g. "BrainWave", "FU HGA", "med refills", "follow up", "physical"), set medications to null.
- For previousTests: scan the ENTIRE note — do not rely solely on labeled sections. Any list of completed tests or prior imaging found anywhere in the record belongs here, even if unlabeled. Recognized labels include: "Previous Tests:", "Prior Imaging:", "HGA Records:", "Past Studies:", "Ancillary History:", "Ancillaries Completed:", "Completed Ancillaries:", "Ancillaries:", "Tests Completed:".
- Return exactly one result object per record, in the same order as the input.
- Do NOT include a name field — names are managed externally.

Respond with JSON: { "records": [ ...one object per input record, in order... ] }. No markdown. Do not truncate.`;

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
- "previousTests": copy the entire text under any label for previous tests or prior imaging (e.g. "Previous Tests:", "Prior Imaging:", "HGA Records:", "Past Studies:") verbatim, or null if absent

Rules:
- CRITICAL: Copy diagnoses, history, medications, and previousTests EXACTLY as written under their labeled sections. Do NOT rephrase, reword, summarize, or alter the text in any way.
- Each labeled section (Diagnoses:, History/HPI:, Medications:) is a discrete column from the source EHR — do not mix content between sections.
- For medications: if no "Medications:" section exists, set to null. Do not infer medications from the history text.
- Return exactly one result object per record. Include the "name" field in every result.

Respond with JSON: { "records": [ ...one object per patient record... ] }. No markdown. Do not truncate.`;

const PARSE_SYSTEM_PROMPT = `You are a clinical data parser. Extract EVERY patient record from the input text — do not stop early, do not skip any.

For each patient return:
- "name": full patient name (required — skip rows with no name)
- "time": appointment time if present (e.g. "9:00 AM"), or null
- "age": age as a number if present, or null
- "gender": gender if present (M/F/Male/Female), or null
- "insurance": insurance carrier/plan name if present (e.g. "Blue Cross", "Medicare", "Cigna"), or null
- "diagnoses": medical conditions/diagnoses/problems ONLY — e.g. hypertension, diabetes, COPD, chest pain, neuropathy. NEVER put medication names, drug names, dosages, test names, imaging study results, or previous ancillary history here.
- "history": past medical history/Hx/PMH copied verbatim from the source, joined into one string if multiple sections, or null
- "medications": all medications/Rx copied verbatim from the source, joined into one string if multiple sections, or null
- "previousTests": ALL mentions of previously performed tests or imaging anywhere in the note — including BrainWave, VitalWave, Carotid Duplex, Echocardiogram, Echo TTE, Renal Artery Doppler, LE Arterial Doppler, LE Venous Duplex, Abdominal Aorta, EKG, ABI, stress test, ultrasound, or any prior study. Look throughout the entire narrative, not just labeled sections. Copy verbatim.

Rules:
- CRITICAL: Copy diagnoses, history, medications, and previousTests EXACTLY as written in the source. Do NOT rephrase, reword, expand abbreviations, or alter the text in any way. Preserve original wording, abbreviations, capitalization, and punctuation.
- FIELD SEPARATION: Diagnoses must contain ONLY disease names and medical conditions. If you see drug/medication names mixed into a diagnoses section, move them to medications. If you see test names, "COMPLETED ✅" entries, or prior imaging listed, move them to previousTests — NEVER leave them in diagnoses.
- Extract ALL patients in the input — even if there are 20 or more.
- The input may be tab-separated spreadsheet data, a simple name list, or mixed clinical notes — handle all formats.
- If a row is clearly a header, summary, or empty — skip it.
- If there is no clinical data for a patient, still include them with null clinical fields.
- For the "medications" field: only include actual drug/prescription names and dosages. If the only value present looks like a visit reason, appointment note, scheduling code, or test name (e.g. "BrainWave", "VitalWave", "EEG", "FU HGA", "med refills", "follow up", "HGA", "new patient", "physical", "wellness"), set medications to null instead.
- For the "previousTests" field: scan the ENTIRE note — do not rely solely on labeled sections. Any list of completed tests or prior imaging found anywhere in the record belongs here, even if unlabeled. Recognized labels include: "Previous Tests:", "Prior Imaging:", "HGA Records:", "Past Studies:", "Ancillary History:", "Ancillaries Completed:", "Completed Ancillaries:", "Ancillaries:", "Tests Completed:". Also capture inline mentions like "had an Echo last year" or "COMPLETED ✅ - BrainWave on 04/01/2026".

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
      previousTests: p.previousTests || undefined,
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
      previousTests: r.previousTests || undefined,
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

async function parseTsvBatch(batch: { name: string; block: string; insurance?: string }[]): Promise<ParsedPatient[]> {
  const combined = batch.map((s) => s.block).join("\n\n---\n\n");

  const aiResponse = await withRetry(
    () =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
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
      const keys = getNormalizedKeys(r.name);
      for (const k of keys) {
        if (!byName.has(k)) byName.set(k, r);
      }
    }
  }

  return batch.map((seg) => {
    const segKeys = getNormalizedKeys(seg.name);
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
    };
  });
}

async function parseTsvBlocks(segments: { name: string; block: string; insurance?: string }[]): Promise<ParsedPatient[]> {
  const MAX_BATCH_CHARS = 15000;
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
  for (const batch of batches) {
    const batchResults = await parseTsvBatch(batch);
    results.push(...batchResults);
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
    previousTests: pickRicher(a.previousTests, b.previousTests),
  };
}

const EHR_TSV_COLUMN_LABELS = [
  "time",
  "name",
  "gender",
  "age",
  "dob",
  "insurance",
  "diagnoses",
  "hpi",
  "medications",
  "notes",
  "reason",
  "dx",
  "pmh",
  "rx",
  "hx",
];

function looksLikeEhrTsvRow(row: string[]): boolean {
  if (row.length < 2) return false;
  const col0 = row[0]?.trim() ?? "";
  const col1 = row[1]?.trim() ?? "";
  const hasTime = /^\d{1,2}:\d{2}/.test(col0) || /^(am|pm)/i.test(col0);
  const hasName = col1.length > 0 && /[A-Za-z]/.test(col1) && col1.length < 80;
  return hasTime && hasName;
}

function isEhrTsvHeader(row: string[]): boolean {
  if (row.length < 2) return false;
  const lower = row.map((c) => c.trim().toLowerCase());
  return lower.some((c) => EHR_TSV_COLUMN_LABELS.includes(c));
}

function parseTsvWithQuotedFields(text: string): string[][] | null {
  try {
    const rows = parse(text, {
      delimiter: "\t",
      relax_column_count: true,
      skip_empty_lines: false,
      relax_quotes: true,
    }) as string[][];
    return rows;
  } catch {
    return null;
  }
}

type TsvColKind = "diagnoses" | "history" | "medications" | "insurance" | "scalar" | "skip" | "previousTests";

type TsvSegment = {
  name: string;
  time?: string;
  age?: number;
  gender?: string;
  insurance?: string;
  diagnoses?: string;
  history?: string;
  medications?: string;
  previousTests?: string;
};

function classifyTsvColumn(val: string): TsvColKind {
  const trimmed = val.trim();
  if (!trimmed) return "skip";

  // Skip trivially short non-alphanumeric junk (e.g. single backslash, punctuation)
  if (trimmed.length < 2 && !/[A-Za-z0-9]/.test(trimmed)) return "skip";

  // Short scalar: gender, age, MRN — no newlines, short
  if (!trimmed.includes("\n") && trimmed.length < 40) {
    if (/^(m|f|male|female)$/i.test(trimmed)) return "scalar"; // gender
    if (/^\d{1,3}$/.test(trimmed)) return "scalar"; // age
    if (/^[a-z]?\d{4,10}$/i.test(trimmed)) return "skip"; // MRN/patient ID — not clinically useful
    if (/medicare|medicaid|blue\s*cross|blue\s*shield|aetna|cigna|humana|united|anthem|molina|kaiser|tricare|bcbs|bcbsm|ppo|hmo|self[\s-]?pay|private|commercial|uninsured/i.test(trimmed)) return "insurance";
  }

  // History/HPI: starts with known narrative headers or contains HPI sections
  if (/^(reason for appointment|history of present illness|hpi:|chief complaint|hpi\b|subjective|assessment|medical history|past medical history|constitutional:)/i.test(trimmed)) return "history";

  // Medications: EHR medication list patterns
  // - "Taking - by" pattern (this EHR's format)
  // - Drug name followed by dose (mg/mcg/ml/tablet/capsule/unit) then frequency keywords
  const medPatterns = [
    /Taking\s*-\s*by\s+[A-Z]/,
    /\b\d+\s*(mg|mcg|ml|units?|tablet|capsule|cap|grain|iu)\b/i,
    /\b(once|twice|three times|QD|BID|TID|QID|QAM|QPM|QHS|PRN|daily|nightly|weekly)\b/i,
    /\b(Orally|by Mouth|Subcutaneous|Nasally|Topically|Externally|Under the Tongue)\b/i,
  ];
  const medMatchCount = medPatterns.filter((p) => p.test(trimmed)).length;
  if (medMatchCount >= 2) return "medications";

  // Previous tests: content-based detection — catches "COMPLETED ✅" entries and known
  // ancillary test names regardless of what column header was used
  const prevTestContentRE = /COMPLETED\s*✅|COMPLETED\s*-|BrainWave|VitalWave|Carotid\s*Duplex|Echocardiogram|Echo\s*TTE|Renal\s*Artery|LE\s*Arterial|LE\s*Venous|Abdominal\s*Aort|Lower\s*Extremity|Upper\s*Extremity|Venous\s*Duplex|Arterial\s*Doppler|\bEKG\b|\bABI\b|stress\s*test|stress\s*echo/i;
  if (prevTestContentRE.test(trimmed)) return "previousTests";

  // Diagnoses: multi-line list of condition names, or a single condition line
  // Typical diagnosis fields are shorter per line and contain medical condition terminology
  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 1 && lines.every((l) => l.length < 200 && !/^(Taking|H\s+|R\d{2}|by [A-Z])/.test(l))) {
    // Looks like a list of conditions rather than a narrative
    if (!trimmed.includes("History of Present Illness") && !trimmed.includes("Reason for Appointment")) {
      return "diagnoses";
    }
  }

  return "history"; // default large text blocks to history/notes
}

const PREV_TESTS_HEADER_RE = /hga\s*records?|previous\s*tests?|prior\s*imaging|previous\s*imaging|past\s*studies|ancillary\s*history|ancillaries?\s*completed|completed\s*ancillaries?|ancillaries?\s*done|tests?\s*completed|completed\s*tests?|prior\s*ancillaries?|^ancillaries?$/i;

function detectAndParseTsvSegments(text: string): TsvSegment[] | null {
  const rows = parseTsvWithQuotedFields(text);
  if (!rows || rows.length < 2) return null;

  const patientRows = rows.filter((row) => looksLikeEhrTsvRow(row) && !isEhrTsvHeader(row));
  if (patientRows.length === 0) return null;

  const totalRows = rows.filter((r) => r.some((c) => c.trim())).length;
  if (patientRows.length < Math.max(1, totalRows * 0.3)) return null;

  // Detect column indices that correspond to "HGA RECORDS" or similar previous-tests headers
  const headerRow = rows.find(isEhrTsvHeader);
  const prevTestsColIndices = new Set<number>();
  if (headerRow) {
    headerRow.forEach((cell, i) => {
      if (PREV_TESTS_HEADER_RE.test(cell.trim())) prevTestsColIndices.add(i);
    });
  }

  const segments: TsvSegment[] = [];

  for (const row of patientRows) {
    const time = row[0]?.trim() ?? "";
    const name = row[1]?.trim() ?? "";
    if (!name) continue;

    let gender: string | undefined;
    let age: number | undefined;
    let detectedInsurance: string | undefined;
    // Per-kind accumulator: store the longest/richest value seen for each kind
    const kindValues: Partial<Record<"diagnoses" | "history" | "medications" | "previousTests", string>> = {};

    for (let colIdx = 2; colIdx < row.length; colIdx++) {
      const val = row[colIdx]?.trim() ?? "";
      if (!val) continue;

      // Header-declared previousTests column — route directly, skip content classifier
      if (prevTestsColIndices.has(colIdx)) {
        if (!kindValues["previousTests"] || val.length > kindValues["previousTests"].length) {
          kindValues["previousTests"] = val;
        }
        continue;
      }

      const kind = classifyTsvColumn(val);
      if (kind === "skip") continue;

      if (kind === "insurance") { detectedInsurance = val; continue; }

      if (kind === "scalar") {
        if (/^(m|f|male|female)$/i.test(val)) gender = val;
        else if (/^\d{1,3}$/.test(val)) age = parseInt(val, 10);
        continue;
      }

      // Keep the longest version (richest content) for each kind
      const k = kind as "diagnoses" | "history" | "medications";
      if (!kindValues[k] || val.length > kindValues[k]!.length) {
        kindValues[k] = val;
      }
    }

    // Insurance: prefer column-detected, fall back to last-col heuristic
    const lastCol = row[row.length - 1]?.trim();
    const lastColIsInsurance =
      lastCol &&
      lastCol !== name &&
      lastCol !== time &&
      /[A-Za-z]/.test(lastCol) &&
      lastCol.length < 100 &&
      /medicare|medicaid|blue\s*cross|blue\s*shield|aetna|cigna|humana|united|anthem|molina|kaiser|tricare|bcbs|bcbsm|ppo|hmo|self[\s-]?pay|private|commercial|uninsured/i.test(lastCol);
    const insurance = detectedInsurance || (lastColIsInsurance ? lastCol : undefined);

    segments.push({
      name,
      time: time || undefined,
      age,
      gender,
      insurance,
      diagnoses: kindValues["diagnoses"] || undefined,
      history: kindValues["history"] || undefined,
      medications: kindValues["medications"] || undefined,
      previousTests: kindValues["previousTests"] || undefined,
    });
  }

  return segments.length > 0 ? segments : null;
}

/** Convert TSV segments directly to ParsedPatient[] without any AI call.
 *  Since each column is already classified by content, no inference is needed. */
function parseTsvSegmentsDirect(segments: TsvSegment[]): ParsedPatient[] {
  return segments.map((seg) => ({
    name: seg.name,
    time: seg.time,
    age: seg.age,
    gender: seg.gender,
    insurance: seg.insurance,
    diagnoses: seg.diagnoses,
    history: seg.history,
    medications: seg.medications,
    previousTests: seg.previousTests,
  }));
}

export async function parseWithAI(rawText: string): Promise<ParsedPatient[]> {
  if (!rawText.trim()) return [];
  try {
    const trimmed = rawText.substring(0, 400000);

    const endSegments = splitByEndDelimiter(trimmed);
    const tsvSegments = !endSegments ? detectAndParseTsvSegments(trimmed) : null;

    let allPatients: ParsedPatient[];

    if (endSegments) {
      allPatients = await parseEndDelimitedBlocks(endSegments);
    } else if (tsvSegments) {
      allPatients = parseTsvSegmentsDirect(tsvSegments);
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
