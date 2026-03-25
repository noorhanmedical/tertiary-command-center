import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import * as XLSX from "xlsx";
import { parse } from "csv-parse/sync";
import OpenAI from "openai";
import { batchProcess } from "./replit_integrations/batch";
import { z } from "zod";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const createBatchSchema = z.object({
  name: z.string().optional(),
});

const addTestHistorySchema = z.object({
  patientName: z.string(),
  testName: z.string(),
  dateOfService: z.string(),
  insuranceType: z.string().default("ppo"),
  clinic: z.string().default("NWPG"),
  notes: z.string().optional(),
});

const addPatientSchema = z.object({
  name: z.string().default(""),
  time: z.string().optional(),
  age: z.union([z.string(), z.number()]).optional(),
  gender: z.string().optional(),
  diagnoses: z.string().optional(),
  history: z.string().optional(),
  medications: z.string().optional(),
  notes: z.string().optional(),
});

const updatePatientSchema = z.object({
  name: z.string().optional(),
  time: z.string().nullable().optional(),
  age: z.union([z.string(), z.number()]).nullable().optional(),
  gender: z.string().nullable().optional(),
  diagnoses: z.string().nullable().optional(),
  history: z.string().nullable().optional(),
  medications: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const importTextSchema = z.object({
  text: z.string().min(1, "Text is required"),
});

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface ParsedPatient {
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

function excelToText(buffer: Buffer): string {
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

function csvToText(buffer: Buffer): string {
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
  const aiResponse = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: PARSE_SYSTEM_PROMPT },
      { role: "user", content: chunk },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
    max_completion_tokens: 16000,
  });

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

function isProviderName(name: string): boolean {
  return PROVIDER_CREDENTIAL_RE.test(name);
}

function splitByEndDelimiter(text: string): { name: string; block: string; insurance?: string }[] | null {
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

  const aiResponse = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: END_BLOCK_SYSTEM_PROMPT },
      { role: "user", content: combined },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
    max_completion_tokens: 16000,
  });

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

async function parseWithAI(rawText: string): Promise<ParsedPatient[]> {
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

const SCREENING_SYSTEM_PROMPT = `You are a clinical ancillary qualification specialist. Your job is to analyze patient clinical data and determine which ancillary diagnostic tests each patient qualifies for.

IMPORTANT RULES:
1. Be EXTREMELY LENIENT in qualifying patients. If there is ANY possible connection between the patient's conditions/symptoms/medications and a test, qualify them.
2. Err heavily on the side of qualifying. Even tangential or indirect connections count.
3. Common conditions like hypertension, diabetes, obesity, hyperlipidemia, anxiety, depression, pain, or being on multiple medications should qualify for MOST tests.
4. Age over 40 with ANY chronic condition qualifies for cardiovascular tests.
5. Any patient with mood disorders or neurological complaints qualifies for BrainWave.
6. Any patient with cardiovascular risk factors (HTN, DM, HLD, smoking, obesity, family history) qualifies for Bilateral Carotid Duplex, Echocardiogram, VitalWave, and most vascular ultrasounds.
7. Leg pain, swelling, or edema qualifies for lower extremity ultrasounds (both arterial and venous).
8. Medications often reveal diagnoses not listed (e.g., metformin = diabetes, amlodipine = hypertension, statins = hyperlipidemia, gabapentin = neuropathy).
9. Multiple risk factors compound qualification. Even minor risk factors together justify screening.
10. When in doubt, QUALIFY. Only exclude if the test is clearly inappropriate.

Available ancillary tests (ONLY qualify for these 11 tests - no others):
- BrainWave: EEG/neurocognitive testing for cognitive, neurological, mood disorders, headaches, migraines, dizziness, vertigo, syncope, seizures, memory issues, neuropathy, TBI, anxiety, depression, insomnia, brain fog, fatigue, numbness/tingling, stroke/TIA history, tremors, balance issues, tinnitus, chronic pain
- VitalWave: ANS/autonomic nervous system and ABI testing for cardiac risk, neuropathy, dysautonomia, hypertension, diabetes, hyperlipidemia, PAD, claudication, obesity, cardiovascular disease, age >50 with CV risk factors
- Bilateral Carotid Duplex (93880): Carotid artery duplex ultrasound for stroke risk, hypertension, atherosclerosis, carotid stenosis, diabetes with circulatory complications, headache with vascular features, dizziness, visual disturbances, TIA history
- Echocardiogram TTE (93306): Transthoracic echocardiogram for cardiac function, valve disease, heart failure, hypertension, chest pain, dyspnea, murmur, palpitations, AFib, arrhythmia, edema, cardiomyopathy, CAD, syncope, sleep apnea
- Renal Artery Doppler (93975): Renal artery duplex for renovascular hypertension, kidney disease, resistant hypertension, diabetes with CKD, atherosclerosis of renal artery
- Lower Extremity Arterial Doppler (93925): Lower extremity arterial duplex for PAD, claudication, arterial insufficiency, leg pain, diabetes with peripheral angiopathy, smoking with vascular risk, diminished pulses, non-healing wounds
- Upper Extremity Arterial Doppler (93930): Upper extremity arterial duplex for arterial insufficiency, Raynaud's, arm pain, upper extremity numbness or coldness, thoracic outlet syndrome
- Abdominal Aortic Aneurysm Duplex (93978): AAA screening for hypertension, atherosclerosis of aorta, family history of vascular disease, male age >65, smoking history, abdominal pain with vascular concern
- Stress Echocardiogram (93350): Stress echocardiogram for exertional symptoms, CAD evaluation, chest pain, dyspnea on exertion, angina, abnormal ECG, pre-operative cardiac risk
- Lower Extremity Venous Duplex (93971): Lower extremity venous duplex for DVT, venous insufficiency, leg edema, varicose veins, limb swelling, post-phlebitic syndrome
- Upper Extremity Venous Duplex (93970): Upper extremity venous duplex for DVT, arm swelling, thrombosis, upper extremity skin redness

For each test the patient qualifies for, provide:
- clinician_understanding: A detailed, technical, evidence-based explanation citing the patient's specific conditions/medications. Include clinical indications and explain the diagnostic value. Reference specific comorbidities and how they interact to increase risk. Do NOT include any ICD-10 codes in this text. 4-5 sentences.
- patient_talking_points: A warm, detailed explanation a non-clinical outreach caller can read to the patient on the phone explaining why their doctor recommends this test. Use their specific conditions in plain language, explain what the test looks for and why it matters for their health. Be reassuring and informative. Do NOT include any ICD-10 codes in this text. 4-5 sentences. Start with "Based on..." or "Your doctor noticed..."
- confidence: "high" | "medium" | "low" (how strong the clinical indication is)
- qualifying_factors: Array of specific conditions/symptoms/medications from the patient's data that support qualification
- icd10_codes: Array of relevant ICD-10 codes that support the qualification

For each patient, respond with a JSON object:
{
  "patients": [
    {
      "name": "PATIENT NAME",
      "time": "appointment time if available",
      "age": number or null,
      "gender": "M/F or full",
      "diagnoses": "extracted diagnoses summary",
      "history": "relevant medical history summary",
      "medications": "medications list",
      "qualifyingTests": ["Test1", "Test2", ...],
      "reasoning": {
        "Test1": {
          "clinician_understanding": "...",
          "patient_talking_points": "...",
          "confidence": "high",
          "qualifying_factors": ["hypertension", "diabetes"],
          "icd10_codes": ["I10", "E11.9"]
        }
      }
    }
  ]
}

Return ALL qualifying tests in qualifyingTests array, ordered by confidence (high first). Include reasoning for EVERY qualifying test.`;

async function screenSinglePatientWithAI(patient: { name: string; time?: string | null; age?: number | null; gender?: string | null; diagnoses?: string | null; history?: string | null; medications?: string | null; notes?: string | null }): Promise<any | null> {
  const parts = [`Patient:`];
  if (patient.name) parts.push(`Name: ${patient.name}`);
  if (patient.time) parts.push(`Time: ${patient.time}`);
  if (patient.age) parts.push(`Age: ${patient.age}`);
  if (patient.gender) parts.push(`Gender: ${patient.gender}`);
  if (patient.diagnoses) parts.push(`Diagnoses: ${patient.diagnoses}`);
  if (patient.history) parts.push(`History/HPI: ${patient.history}`);
  if (patient.medications) parts.push(`Medications: ${patient.medications}`);
  if (patient.notes) parts.push(`Notes: ${patient.notes}`);
  const description = parts.join("\n");

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: SCREENING_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Analyze the following patient and qualify them for ancillary tests. Be VERY LENIENT - try to qualify for as many tests as possible.\n\n${description}`,
      },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
    max_completion_tokens: 16000,
  });

  const content = response.choices[0]?.message?.content || "{}";
  const finishReason = response.choices[0]?.finish_reason;

  const tryParse = (text: string): any | null => {
    try {
      const parsed = JSON.parse(text);
      if (parsed?.patients && Array.isArray(parsed.patients)) {
        return parsed.patients[0] || null;
      }
      return parsed;
    } catch {
      return null;
    }
  };

  if (finishReason === "length") {
    console.error(`AI response truncated for patient: ${patient.name}. Attempting partial recovery.`);
    const partial = tryParse(content);
    if (partial && partial.qualifyingTests && Array.isArray(partial.qualifyingTests) && partial.qualifyingTests.length > 0) {
      console.warn(`Partial recovery succeeded for patient: ${patient.name}. Recovered ${partial.qualifyingTests.length} qualifying tests.`);
      return partial;
    }
    const arrayMatch = content.match(/"qualifyingTests"\s*:\s*(\[[\s\S]*?\])/);
    if (arrayMatch) {
      try {
        const recoveredTests = JSON.parse(arrayMatch[1]);
        console.warn(`Regex partial recovery succeeded for patient: ${patient.name}. Recovered ${recoveredTests.length} qualifying tests.`);
        return { qualifyingTests: recoveredTests };
      } catch {
        // fall through to full parse attempt
      }
    }
    console.error(`Partial recovery failed for patient: ${patient.name}. Returning null.`);
    return null;
  }

  const result = tryParse(content);
  if (result === null) {
    console.error(`Failed to parse AI response for patient: ${patient.name}. First 300 chars: ${content.substring(0, 300)}`);
  }
  return result;
}

async function checkCooldownsForPatients(
  patients: { name: string; qualifyingTests: string[] }[]
): Promise<Record<string, { test: string; lastDate: string; insuranceType: string; cooldownMonths: number }[]>> {
  const allHistory = await storage.getAllTestHistory();
  if (allHistory.length === 0) return {};

  const historyText = allHistory.map(h =>
    `${h.patientName} | ${h.testName} | ${h.dateOfService} | ${h.insuranceType}`
  ).join("\n");

  const patientsText = patients.map(p =>
    `${p.name}: [${p.qualifyingTests.join(", ")}]`
  ).join("\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a patient name matching and cooldown checking assistant. You will be given:
1. A database of historical patient test records (name | test | date | insurance_type)
2. A list of patients with their currently qualifying tests

Your job is to match patients by name (fuzzy matching - handle "Last, First" vs "First Last", nicknames, minor spelling differences) and determine which qualifying tests have been done within the cooldown period.

COOLDOWN RULES:
- PPO insurance: 6 month cooldown from date of service
- Medicare insurance: 12 month cooldown from date of service
- Today's date is: ${new Date().toISOString().split('T')[0]}

TEST NAME MATCHING:
- "BrainWave" in history matches "BrainWave" in qualifying tests
- "VitalWave" or "VitalScan" in history matches "VitalWave" in qualifying tests
- Any ultrasound test name should be matched to the specific qualifying test (e.g., "Bilateral Carotid Duplex", "Echocardiogram", "Renal Artery Doppler", etc.)
- "Ultrasound" in history could match any ultrasound qualifying test - list all that apply

Return a JSON object where keys are the EXACT patient names from the qualifying tests list, and values are arrays of cooldown violations:
{
  "Patient Name": [
    {
      "test": "exact test name from qualifying tests",
      "lastDate": "YYYY-MM-DD",
      "insuranceType": "ppo or medicare",
      "cooldownMonths": 6 or 12
    }
  ]
}

Only include patients who have cooldown violations. If no violations found, return empty object {}.`
      },
      {
        role: "user",
        content: `HISTORICAL TEST RECORDS:\n${historyText}\n\nPATIENTS TO CHECK:\n${patientsText}`
      }
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  try {
    return JSON.parse(response.choices[0]?.message?.content || "{}");
  } catch {
    console.error("Failed to parse cooldown check response");
    return {};
  }
}

async function parseHistoryImport(text: string): Promise<{ patientName: string; testName: string; dateOfService: string; insuranceType: string }[]> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a clinical data parser. You will receive raw text data from a patient test history spreadsheet/database. Extract patient records with:
- patientName: The patient's full name (Last, First format)
- testName: The type of test performed. Look at the section header or context to determine the test type. Common tests: BrainWave, VitalWave, Bilateral Carotid Duplex, Echocardiogram TTE, Renal Artery Doppler, Lower Extremity Arterial Doppler, Upper Extremity Arterial Doppler, Abdominal Aortic Aneurysm Duplex, Stress Echocardiogram, Lower Extremity Venous Duplex, Upper Extremity Venous Duplex
- dateOfService: The date in YYYY-MM-DD format
- insuranceType: "medicare" or "ppo". Look for insurance info in the record. If it mentions Medicare, HMO Medicare, use "medicare". Otherwise default to "ppo".

The data is tab-separated and may have multiple columns. Focus on extracting the Date of Service (first column usually), Patient name (second column), and any insurance information available.

Return JSON: { "records": [ { "patientName": "...", "testName": "...", "dateOfService": "...", "insuranceType": "..." } ] }

Skip rows that are headers, empty, or don't contain valid patient data (no date or no name).`
      },
      {
        role: "user",
        content: text.substring(0, 30000)
      }
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
    max_completion_tokens: 16000,
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{"records":[]}');
    return parsed.records || [];
  } catch {
    console.error("Failed to parse history import response");
    return [];
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  async function enrichFromReferenceDb(patients: any[]): Promise<void> {
    const allRefs = await storage.getAllPatientReferences();
    if (allRefs.length === 0 || patients.length === 0) return;

    const patientNames = patients.filter(p => p.name).map(p => ({ id: p.id, name: p.name }));
    if (patientNames.length === 0) return;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a patient name matcher. Match newly added patients to a reference database of known patients.
For each new patient, find the best match in the reference database using fuzzy name matching.
Handle variations like "Last, First" vs "First Last", nicknames (Bill/William, Bob/Robert), minor spelling differences, and missing middle names.
Only match if you're confident it's the same person. Return a JSON array of matches.

Each match: { "patientId": <number>, "referenceId": <number> }
If no match, omit that patient. Respond with ONLY a valid JSON array.`
          },
          {
            role: "user",
            content: `New patients:\n${JSON.stringify(patientNames)}\n\nReference database:\n${JSON.stringify(allRefs.map(r => ({ id: r.id, name: r.patientName })))}`
          }
        ],
        temperature: 0,
      });

      const content = response.choices[0]?.message?.content?.trim() || "[]";
      const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const matches: { patientId: number; referenceId: number }[] = JSON.parse(cleaned);

      const refMap = new Map(allRefs.map(r => [r.id, r]));

      for (const match of matches) {
        const ref = refMap.get(match.referenceId);
        if (!ref) continue;

        const patient = patients.find(p => p.id === match.patientId);
        if (!patient) continue;

        const updates: any = {};
        if (!patient.diagnoses && ref.diagnoses) updates.diagnoses = ref.diagnoses;
        if (!patient.history && ref.history) updates.history = ref.history;
        if (!patient.medications && ref.medications) updates.medications = ref.medications;
        if (!patient.age && ref.age) updates.age = parseInt(ref.age) || null;
        if (!patient.gender && ref.gender) updates.gender = ref.gender;
        if (!patient.notes && ref.insurance) updates.notes = `Insurance: ${ref.insurance}`;

        if (Object.keys(updates).length > 0) {
          await storage.updatePatientScreening(match.patientId, updates);
        }
      }
    } catch (err: any) {
      console.error("Reference DB auto-fill failed:", err.message);
    }
  }

  app.post("/api/batches", async (req, res) => {
    try {
      const parsed = createBatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });

      const batch = await storage.createScreeningBatch({
        name: parsed.data.name || `Batch - ${new Date().toLocaleDateString()}`,
        patientCount: 0,
        status: "draft",
      });
      res.json(batch);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/batches/:id/patients", async (req, res) => {
    try {
      const batchId = parseInt(req.params.id);
      const batch = await storage.getScreeningBatch(batchId);
      if (!batch) return res.status(404).json({ error: "Batch not found" });

      const parsed = addPatientSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const { name, time, age, gender, diagnoses, history, medications, notes } = parsed.data;

      const patient = await storage.createPatientScreening({
        batchId,
        name: name.trim(),
        time: time || null,
        age: age ? parseInt(String(age)) : null,
        gender: gender || null,
        diagnoses: diagnoses || null,
        history: history || null,
        medications: medications || null,
        notes: notes || null,
        qualifyingTests: [],
        reasoning: {},
        status: "draft",
      });

      await storage.updateScreeningBatch(batchId, {
        patientCount: (await storage.getPatientScreeningsByBatch(batchId)).length,
      });

      if (name.trim()) {
        await enrichFromReferenceDb([patient]);
        const updated = await storage.getPatientScreening(patient.id);
        if (updated) {
          res.json(updated);
          return;
        }
      }

      res.json(patient);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/batches/:id/import-file", upload.array("files", 10), async (req: any, res) => {
    try {
      const batchId = parseInt(req.params.id);
      const batch = await storage.getScreeningBatch(batchId);
      if (!batch) return res.status(404).json({ error: "Batch not found" });

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) return res.status(400).json({ error: "No files uploaded" });

      let allPatients: ParsedPatient[] = [];

      for (const file of files) {
        const ext = file.originalname.toLowerCase().split(".").pop();
        if (ext === "xlsx" || ext === "xls") {
          allPatients.push(...await parseWithAI(excelToText(file.buffer)));
        } else if (ext === "csv") {
          allPatients.push(...await parseWithAI(csvToText(file.buffer)));
        } else if (ext === "pdf") {
          const pdfParseModule = await import("pdf-parse");
          const pdfParseFn = pdfParseModule.default || pdfParseModule;
          const pdfData = await pdfParseFn(file.buffer);
          const extractionPrompt = `Extract all patient names and appointment times from this document/image. Return a JSON object: { "patients": [{ "name": "Full Name", "time": "time if visible" }] }. Only include actual patient names, not doctor names or staff.`;
          const response = await openai.chat.completions.create({
            model: "gpt-5.2",
            messages: [
              { role: "user", content: `${extractionPrompt}\n\nDocument text:\n${pdfData.text}` },
            ],
            response_format: { type: "json_object" },
          });
          const content = response.choices[0]?.message?.content || "{}";
          try {
            const parsed = JSON.parse(content);
            if (parsed.patients && Array.isArray(parsed.patients)) {
              for (const p of parsed.patients) {
                if (p.name) {
                  allPatients.push({ name: p.name, time: p.time || undefined });
                }
              }
            }
          } catch {
            console.error("Failed to parse PDF AI extraction response");
          }
        } else if (["jpg", "jpeg", "png", "gif", "bmp", "webp"].includes(ext || "")) {
          const base64 = file.buffer.toString("base64");
          const mimeType = file.mimetype || `image/${ext === "jpg" ? "jpeg" : ext}`;
          const dataUrl = `data:${mimeType};base64,${base64}`;
          const extractionPrompt = `Extract all patient names and appointment times from this document/image. Return a JSON object: { "patients": [{ "name": "Full Name", "time": "time if visible" }] }. Only include actual patient names, not doctor names or staff.`;
          const response = await openai.chat.completions.create({
            model: "gpt-5.2",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: extractionPrompt },
                  { type: "image_url", image_url: { url: dataUrl } },
                ],
              },
            ],
            response_format: { type: "json_object" },
          });
          const content = response.choices[0]?.message?.content || "{}";
          try {
            const parsed = JSON.parse(content);
            if (parsed.patients && Array.isArray(parsed.patients)) {
              for (const p of parsed.patients) {
                if (p.name) {
                  allPatients.push({ name: p.name, time: p.time || undefined });
                }
              }
            }
          } catch {
            console.error("Failed to parse image AI extraction response");
          }
        } else {
          allPatients.push(...await parseWithAI(file.buffer.toString("utf-8")));
        }
      }

      const created = [];
      for (const p of allPatients) {
        const patient = await storage.createPatientScreening({
          batchId,
          name: p.name,
          time: p.time || null,
          age: p.age || null,
          gender: p.gender || null,
          insurance: p.insurance || null,
          diagnoses: p.diagnoses || null,
          history: p.history || null,
          medications: p.medications || null,
          notes: p.notes || null,
          qualifyingTests: [],
          reasoning: {},
          status: "draft",
        });
        created.push(patient);
      }

      await storage.updateScreeningBatch(batchId, {
        patientCount: (await storage.getPatientScreeningsByBatch(batchId)).length,
      });

      await enrichFromReferenceDb(created);
      const refreshed = await storage.getPatientScreeningsByBatch(batchId);
      const createdIds = new Set(created.map(p => p.id));
      const enrichedPatients = refreshed.filter(p => createdIds.has(p.id));

      res.json({ imported: enrichedPatients.length, patients: enrichedPatients });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/batches/:id/import-text", async (req, res) => {
    try {
      const batchId = parseInt(req.params.id);
      const batch = await storage.getScreeningBatch(batchId);
      if (!batch) return res.status(404).json({ error: "Batch not found" });

      const parsed = importTextSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const { text } = parsed.data;

      let patients: ParsedPatient[] = [];

      patients = await parseWithAI(text);

      const created = [];
      for (const p of patients) {
        const patient = await storage.createPatientScreening({
          batchId,
          name: p.name,
          time: p.time || null,
          age: p.age || null,
          gender: p.gender || null,
          insurance: p.insurance || null,
          diagnoses: p.diagnoses || null,
          history: p.history || null,
          medications: p.medications || null,
          notes: null,
          qualifyingTests: [],
          reasoning: {},
          status: "draft",
        });
        created.push(patient);
      }

      await storage.updateScreeningBatch(batchId, {
        patientCount: (await storage.getPatientScreeningsByBatch(batchId)).length,
      });

      await enrichFromReferenceDb(created);
      const refreshed2 = await storage.getPatientScreeningsByBatch(batchId);
      const createdIds2 = new Set(created.map(p => p.id));
      const enrichedPatients2 = refreshed2.filter(p => createdIds2.has(p.id));

      res.json({ imported: enrichedPatients2.length, patients: enrichedPatients2 });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/patients/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = updatePatientSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });

      const data = parsed.data;
      const updates: any = {};
      if (data.name !== undefined) updates.name = data.name;
      if (data.time !== undefined) updates.time = data.time || null;
      if (data.age !== undefined) updates.age = data.age ? parseInt(String(data.age)) : null;
      if (data.gender !== undefined) updates.gender = data.gender || null;
      if (data.diagnoses !== undefined) updates.diagnoses = data.diagnoses || null;
      if (data.history !== undefined) updates.history = data.history || null;
      if (data.medications !== undefined) updates.medications = data.medications || null;
      if (data.notes !== undefined) updates.notes = data.notes || null;

      const patient = await storage.updatePatientScreening(id, updates);
      if (!patient) return res.status(404).json({ error: "Patient not found" });

      if (data.name && data.name.trim() && !patient.diagnoses && !patient.history && !patient.medications) {
        await enrichFromReferenceDb([patient]);
        const enriched = await storage.getPatientScreening(id);
        if (enriched) {
          res.json(enriched);
          return;
        }
      }

      res.json(patient);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/patients/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const patient = await storage.getPatientScreening(id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });

      await storage.deletePatientScreening(id);

      await storage.updateScreeningBatch(patient.batchId, {
        patientCount: (await storage.getPatientScreeningsByBatch(patient.batchId)).length,
      });

      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/patients/:id/analyze", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const patient = await storage.getPatientScreening(id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });

      const match = await screenSinglePatientWithAI({
        name: patient.name,
        time: patient.time,
        age: patient.age,
        gender: patient.gender,
        diagnoses: patient.diagnoses,
        history: patient.history,
        medications: patient.medications,
        notes: patient.notes,
      });

      const qualTests = match?.qualifyingTests || [];

      let cooldownData: any = null;
      if (qualTests.length > 0) {
        try {
          const cooldowns = await checkCooldownsForPatients([{ name: patient.name, qualifyingTests: qualTests }]);
          const patientCooldowns = cooldowns[patient.name];
          if (patientCooldowns && patientCooldowns.length > 0) {
            cooldownData = patientCooldowns;
          }
        } catch (e) {
          console.error("Cooldown check failed:", e);
        }
      }

      const updated = await storage.updatePatientScreening(id, {
        qualifyingTests: qualTests,
        reasoning: match?.reasoning || {},
        cooldownTests: cooldownData,
        diagnoses: match?.diagnoses || patient.diagnoses || null,
        history: match?.history || patient.history || null,
        medications: match?.medications || patient.medications || null,
        age: match?.age || patient.age || null,
        gender: match?.gender || patient.gender || null,
        status: "completed",
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Per-patient analysis error:", error);
      res.status(500).json({ error: error.message || "Analysis failed" });
    }
  });

  app.post("/api/batches/:id/analyze", async (req, res) => {
    try {
      const batchId = parseInt(req.params.id);
      const batch = await storage.getScreeningBatch(batchId);
      if (!batch) return res.status(404).json({ error: "Batch not found" });

      const patients = await storage.getPatientScreeningsByBatch(batchId);
      if (patients.length === 0) return res.status(400).json({ error: "No patients in batch" });

      await storage.updateScreeningBatch(batchId, { status: "processing" });

      res.json({ success: true, patientCount: patients.length, async: true });

      const aiResults: Map<number, any> = new Map();

      await batchProcess(
        patients,
        async (patient) => {
          try {
            const result = await screenSinglePatientWithAI({
              name: patient.name,
              time: patient.time,
              age: patient.age,
              gender: patient.gender,
              diagnoses: patient.diagnoses,
              history: patient.history,
              medications: patient.medications,
              notes: patient.notes,
            });

            if (result) {
              const match = result?.patients?.[0] || result;
              aiResults.set(patient.id, match);
              await storage.updatePatientScreening(patient.id, {
                qualifyingTests: match.qualifyingTests || [],
                reasoning: match.reasoning || {},
                diagnoses: match.diagnoses || patient.diagnoses || null,
                history: match.history || patient.history || null,
                medications: match.medications || patient.medications || null,
                age: match.age || patient.age || null,
                gender: match.gender || patient.gender || null,
                status: "completed",
              });
            } else {
              await storage.updatePatientScreening(patient.id, {
                qualifyingTests: [],
                reasoning: {},
                status: "completed",
              });
            }
          } catch (err: any) {
            console.error(`Failed to analyze patient ${patient.name}:`, err.message);
            await storage.updatePatientScreening(patient.id, {
              qualifyingTests: [],
              reasoning: {},
              status: "completed",
            });
          }
        },
        { concurrency: 5, retries: 3 }
      );

      const patientsForCooldown: { name: string; qualifyingTests: string[] }[] = [];
      for (const patient of patients) {
        const match = aiResults.get(patient.id);
        if (match?.qualifyingTests?.length > 0) {
          patientsForCooldown.push({ name: patient.name, qualifyingTests: match.qualifyingTests });
        }
      }

      if (patientsForCooldown.length > 0) {
        try {
          const cooldownResults = await checkCooldownsForPatients(patientsForCooldown);
          for (const patient of patients) {
            const cooldowns = cooldownResults[patient.name];
            if (cooldowns && cooldowns.length > 0) {
              await storage.updatePatientScreening(patient.id, { cooldownTests: cooldowns });
            }
          }
        } catch (e) {
          console.error("Batch cooldown check failed:", e);
        }
      }

      await storage.updateScreeningBatch(batchId, {
        status: "completed",
        patientCount: patients.length,
      });
    } catch (error: any) {
      console.error("Analysis error:", error);
    }
  });

  app.get("/api/screening-batches", async (_req, res) => {
    try {
      const batches = await storage.getAllScreeningBatches();
      res.json(batches);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/screening-batches/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const batch = await storage.getScreeningBatch(id);
      if (!batch) return res.status(404).json({ error: "Batch not found" });

      const patients = await storage.getPatientScreeningsByBatch(id);
      res.json({ ...batch, patients });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/screening-batches/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { clinicianName } = req.body;
      const updated = await storage.updateScreeningBatch(id, { clinicianName: clinicianName ?? null });
      if (!updated) return res.status(404).json({ error: "Batch not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/screening-batches/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteScreeningBatch(id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/screening-batches/:id/export", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const batch = await storage.getScreeningBatch(id);
      if (!batch) return res.status(404).json({ error: "Batch not found" });

      const patients = await storage.getPatientScreeningsByBatch(id);

      const escCsv = (val: string) => `"${(val || "").replace(/"/g, '""')}"`;
      const csvHeader = "TIME,NAME,AGE,GENDER,Dx,Hx,Rx,QUALIFYING TESTS\n";
      const csvRows = patients
        .map((p) => {
          const fields = [
            escCsv(p.time || ""),
            escCsv(p.name || ""),
            escCsv(p.age?.toString() || ""),
            escCsv(p.gender || ""),
            escCsv(p.diagnoses || ""),
            escCsv(p.history || ""),
            escCsv(p.medications || ""),
            escCsv((p.qualifyingTests || []).join(", ")),
          ];
          return fields.join(",");
        })
        .join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="screening-${id}.csv"`);
      res.send(csvHeader + csvRows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/test-history", async (_req, res) => {
    try {
      const records = await storage.getAllTestHistory();
      res.json(records);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/test-history", async (req, res) => {
    try {
      const parsed = addTestHistorySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const record = await storage.createTestHistory(parsed.data);
      res.json(record);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/test-history/import", upload.single("file"), async (req, res) => {
    try {
      let text = "";
      const clinic = req.body.clinic || "NWPG";

      if (req.file) {
        const ext = req.file.originalname.toLowerCase();
        if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) {
          const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            text += sheetName + "\n" + XLSX.utils.sheet_to_csv(sheet) + "\n\n";
          }
        } else if (ext.endsWith(".csv")) {
          text = req.file.buffer.toString("utf-8");
        } else {
          text = req.file.buffer.toString("utf-8");
        }
      } else if (req.body.text) {
        text = req.body.text;
      } else {
        return res.status(400).json({ error: "No file or text provided" });
      }

      if (!text.trim()) return res.status(400).json({ error: "Empty data" });

      const records = await parseHistoryImport(text);
      if (records.length === 0) return res.json({ imported: 0, records: [] });

      const validRecords = records
        .filter(r => r.patientName && r.testName && r.dateOfService)
        .map(r => ({
          patientName: r.patientName,
          testName: r.testName,
          dateOfService: r.dateOfService,
          insuranceType: r.insuranceType || "ppo",
          clinic,
        }));

      const created = await storage.createTestHistoryBulk(validRecords);
      res.json({ imported: created.length, records: created });
    } catch (error: any) {
      console.error("Test history import error:", error);
      res.status(500).json({ error: error.message || "Import failed" });
    }
  });

  app.delete("/api/test-history/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteTestHistory(id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/test-history", async (_req, res) => {
    try {
      await storage.deleteAllTestHistory();
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/patient-references", async (req, res) => {
    try {
      const search = req.query.search as string | undefined;
      if (search && search.trim()) {
        const records = await storage.searchPatientReferences(search.trim());
        res.json(records);
      } else {
        const records = await storage.getAllPatientReferences();
        res.json(records);
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/patient-references/import", upload.single("file"), async (req: any, res) => {
    try {
      let text = "";

      if (req.file) {
        const ext = req.file.originalname.toLowerCase().split(".").pop();
        if (ext === "xlsx" || ext === "xls") {
          const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            text += sheetName + "\n" + XLSX.utils.sheet_to_csv(sheet) + "\n\n";
          }
        } else if (ext === "csv") {
          text = req.file.buffer.toString("utf-8");
        } else {
          text = req.file.buffer.toString("utf-8");
        }
      } else if (req.body.text) {
        text = req.body.text;
      } else {
        return res.status(400).json({ error: "No file or text provided" });
      }

      if (!text.trim()) return res.status(400).json({ error: "Empty data" });

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a clinical data parser. Extract patient reference records from the provided data.
For each patient, extract:
- patientName: Full name (required)
- age: Age as string if present, or null
- gender: Gender if present (M/F/Male/Female), or null
- diagnoses: All diagnoses, conditions, Dx mentioned (combine into one string), or null
- history: Past medical history, Hx, PMH (combine into one string), or null
- medications: All medications, Rx listed (combine into one string), or null
- insurance: Insurance type/plan if present, or null
- notes: Any additional notes, or null

Parse common abbreviations: HTN=hypertension, DM=diabetes mellitus, COPD, CHF, CAD, A-fib, HLD=hyperlipidemia, CKD, OA=osteoarthritis, GERD, etc.

Return JSON: { "records": [ { "patientName": "...", "age": "...", "gender": "...", "diagnoses": "...", "history": "...", "medications": "...", "insurance": "...", "notes": "..." } ] }

Skip rows that are headers, empty, or don't contain valid patient data.`
          },
          {
            role: "user",
            content: text.substring(0, 30000)
          }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
        max_completion_tokens: 16000,
      });

      let records: any[] = [];
      try {
        const parsed = JSON.parse(response.choices[0]?.message?.content || '{"records":[]}');
        records = parsed.records || [];
      } catch {
        return res.status(500).json({ error: "Failed to parse AI response" });
      }

      const validRecords = records
        .filter((r: any) => r.patientName && typeof r.patientName === "string")
        .map((r: any) => ({
          patientName: r.patientName.trim(),
          diagnoses: r.diagnoses || null,
          history: r.history || null,
          medications: r.medications || null,
          age: r.age ? String(r.age) : null,
          gender: r.gender || null,
          insurance: r.insurance || null,
          notes: r.notes || null,
        }));

      if (validRecords.length === 0) {
        return res.json({ imported: 0, records: [] });
      }

      const created = await storage.createPatientReferenceBulk(validRecords);
      res.json({ imported: created.length, records: created });
    } catch (error: any) {
      console.error("Patient reference import error:", error);
      res.status(500).json({ error: error.message || "Import failed" });
    }
  });

  app.delete("/api/patient-references/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deletePatientReference(id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/patient-references", async (_req, res) => {
    try {
      await storage.deleteAllPatientReferences();
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
