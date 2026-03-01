import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import * as XLSX from "xlsx";
import { parse } from "csv-parse/sync";
import OpenAI from "openai";
import { batchProcess } from "./replit_integrations/batch";
import { z } from "zod";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const createBatchSchema = z.object({
  name: z.string().optional(),
});

const addTestHistorySchema = z.object({
  patientName: z.string(),
  testName: z.string(),
  dateOfService: z.string(),
  insuranceType: z.string().default("ppo"),
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
  diagnoses?: string;
  history?: string;
  medications?: string;
  notes?: string;
  rawText?: string;
}

function parseExcelFile(buffer: Buffer): ParsedPatient[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const patients: ParsedPatient[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

    for (const row of rows) {
      const keys = Object.keys(row);
      const findCol = (patterns: string[]) => {
        const key = keys.find((k) =>
          patterns.some((p) => k.toLowerCase().includes(p.toLowerCase()))
        );
        return key ? String(row[key] || "").trim() : undefined;
      };

      const name = findCol(["name", "patient", "pt name"]);
      if (!name) continue;

      const ageStr = findCol(["age", "dob"]);
      const age = ageStr ? parseInt(ageStr) : undefined;

      patients.push({
        time: findCol(["time", "appt", "appointment", "schedule"]),
        name,
        age: age && !isNaN(age) ? age : undefined,
        gender: findCol(["gender", "sex", "m/f"]),
        diagnoses: findCol(["dx", "diagnos", "icd", "assessment", "problem"]),
        history: findCol(["hx", "history", "hpi", "pmh", "subjective", "chief complaint"]),
        medications: findCol(["rx", "med", "prescription", "drug"]),
        notes: findCol(["note", "comment", "plan", "assessment"]),
        rawText: JSON.stringify(row),
      });
    }
  }

  return patients;
}

function parseCsvFile(buffer: Buffer): ParsedPatient[] {
  const text = buffer.toString("utf-8");
  try {
    const records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as Record<string, string>[];

    return records
      .map((row) => {
        const keys = Object.keys(row);
        const findCol = (patterns: string[]) => {
          const key = keys.find((k) =>
            patterns.some((p) => k.toLowerCase().includes(p.toLowerCase()))
          );
          return key ? String(row[key] || "").trim() : undefined;
        };

        const name = findCol(["name", "patient", "pt name"]);
        if (!name) return null;

        const ageStr = findCol(["age", "dob"]);
        const age = ageStr ? parseInt(ageStr) : undefined;

        return {
          time: findCol(["time", "appt", "appointment", "schedule"]),
          name,
          age: age && !isNaN(age) ? age : undefined,
          gender: findCol(["gender", "sex", "m/f"]),
          diagnoses: findCol(["dx", "diagnos", "icd", "assessment", "problem"]),
          history: findCol(["hx", "history", "hpi", "pmh", "subjective"]),
          medications: findCol(["rx", "med", "prescription", "drug"]),
          notes: findCol(["note", "comment", "plan"]),
          rawText: JSON.stringify(row),
        } as ParsedPatient;
      })
      .filter((p): p is ParsedPatient => p !== null);
  } catch {
    return [];
  }
}

function parseTextForPatientNames(text: string): ParsedPatient[] {
  const lines = text.split(/\n/).filter((l) => l.trim());
  const patients: ParsedPatient[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const timeMatch = trimmed.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)\s*[-–,\s]\s*(.+)/i);
    if (timeMatch) {
      patients.push({
        time: timeMatch[1].trim(),
        name: timeMatch[2].trim(),
      });
    } else {
      patients.push({ name: trimmed });
    }
  }

  return patients;
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

async function screenPatientsWithAI(patients: { name: string; time?: string | null; age?: number | null; gender?: string | null; diagnoses?: string | null; history?: string | null; medications?: string | null; notes?: string | null }[]): Promise<any[]> {
  const results: any[] = [];

  const patientChunks: typeof patients[] = [];
  for (let i = 0; i < patients.length; i += 3) {
    patientChunks.push(patients.slice(i, i + 3));
  }

  const chunkResults = await batchProcess(
    patientChunks,
    async (chunk) => {
      const patientDescriptions = chunk
        .map((p, i) => {
          const parts = [`Patient ${i + 1}:`];
          if (p.name) parts.push(`Name: ${p.name}`);
          if (p.time) parts.push(`Time: ${p.time}`);
          if (p.age) parts.push(`Age: ${p.age}`);
          if (p.gender) parts.push(`Gender: ${p.gender}`);
          if (p.diagnoses) parts.push(`Diagnoses: ${p.diagnoses}`);
          if (p.history) parts.push(`History/HPI: ${p.history}`);
          if (p.medications) parts.push(`Medications: ${p.medications}`);
          if (p.notes) parts.push(`Notes: ${p.notes}`);
          return parts.join("\n");
        })
        .join("\n\n---\n\n");

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: SCREENING_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Analyze the following patient(s) and qualify them for ancillary tests. Be VERY LENIENT - try to qualify for as many tests as possible.\n\n${patientDescriptions}`,
          },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
        max_completion_tokens: 8192,
      });

      const content = response.choices[0]?.message?.content || "{}";
      try {
        return JSON.parse(content);
      } catch {
        console.error("Failed to parse AI response:", content.substring(0, 200));
        return { patients: [] };
      }
    },
    { concurrency: 2, retries: 5 }
  );

  for (const chunkResult of chunkResults) {
    if (chunkResult?.patients && Array.isArray(chunkResult.patients)) {
      results.push(...chunkResult.patients);
    }
  }

  return results;
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
          allPatients.push(...parseExcelFile(file.buffer));
        } else if (ext === "csv") {
          allPatients.push(...parseCsvFile(file.buffer));
        } else if (ext === "pdf") {
          const pdfData = await pdfParse(file.buffer);
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
          allPatients.push(...parseTextForPatientNames(file.buffer.toString("utf-8")));
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

      res.json({ imported: created.length, patients: created });
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

      const hasClinicalData = /\b(dx|hx|rx|diagnos|history|medicat|pmh|htn|dm|copd|chf|a-?fib|metformin|lisinopril|amlodipine|atorvastatin|aspirin|insulin|omeprazole|gabapentin|prednisone|levothyroxine|losartan|hydrochlorothiazide)\b/i.test(text);

      if (hasClinicalData) {
        try {
          const aiResponse = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are a clinical data parser. Extract patient information from pasted text.
Return a JSON array of patients. For each patient extract:
- "name": Patient full name (required)
- "time": Appointment time if present (e.g. "9:00 AM"), or null
- "age": Age as a number if present, or null
- "gender": Gender if present (M/F/Male/Female), or null
- "diagnoses": All diagnoses, conditions, Dx mentioned (combine into one string), or null
- "history": Past medical history, Hx, PMH, surgical history (combine into one string), or null  
- "medications": All medications, Rx listed (combine into one string), or null

Parse common abbreviations: HTN=hypertension, DM=diabetes mellitus, COPD, CHF, CAD, A-fib, HLD=hyperlipidemia, CKD, OA=osteoarthritis, GERD, etc.

If the text is just a simple list of names with no clinical data, still return each name as a patient with null for clinical fields.

Respond ONLY with a valid JSON array, no markdown fences.`
              },
              {
                role: "user",
                content: text
              }
            ],
            temperature: 0.1,
          });

          const content = aiResponse.choices[0]?.message?.content?.trim() || "[]";
          const cleanedContent = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
          const aiPatients = JSON.parse(cleanedContent);

          if (Array.isArray(aiPatients)) {
            patients = aiPatients
              .filter((p: any) => p.name && typeof p.name === "string")
              .map((p: any) => ({
                name: p.name.trim(),
                time: p.time || undefined,
                age: p.age ? parseInt(String(p.age)) : undefined,
                gender: p.gender || undefined,
                diagnoses: p.diagnoses || undefined,
                history: p.history || undefined,
                medications: p.medications || undefined,
              }));
          }
        } catch (aiError: any) {
          console.error("AI parse failed, falling back to simple parse:", aiError.message);
          patients = parseTextForPatientNames(text);
        }
      } else {
        patients = parseTextForPatientNames(text);
      }

      if (patients.length === 0) {
        patients = parseTextForPatientNames(text);
      }

      const created = [];
      for (const p of patients) {
        const patient = await storage.createPatientScreening({
          batchId,
          name: p.name,
          time: p.time || null,
          age: p.age || null,
          gender: p.gender || null,
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

      res.json({ imported: created.length, patients: created });
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

      const patientData = [{
        name: patient.name,
        time: patient.time,
        age: patient.age,
        gender: patient.gender,
        diagnoses: patient.diagnoses,
        history: patient.history,
        medications: patient.medications,
        notes: patient.notes,
      }];

      const aiResults = await screenPatientsWithAI(patientData);

      const match = aiResults.find(
        (r) => r.name && r.name.toLowerCase().trim() === patient.name.toLowerCase().trim()
      );

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

      const patientData = patients.map((p) => ({
        name: p.name,
        time: p.time,
        age: p.age,
        gender: p.gender,
        diagnoses: p.diagnoses,
        history: p.history,
        medications: p.medications,
        notes: p.notes,
      }));

      const aiResults = await screenPatientsWithAI(patientData);

      const patientsForCooldown: { name: string; qualifyingTests: string[] }[] = [];
      const matchMap = new Map<number, any>();

      for (const patient of patients) {
        const match = aiResults.find(
          (r) => r.name && r.name.toLowerCase().trim() === patient.name.toLowerCase().trim()
        );
        matchMap.set(patient.id, match);
        if (match?.qualifyingTests?.length > 0) {
          patientsForCooldown.push({ name: patient.name, qualifyingTests: match.qualifyingTests });
        }
      }

      let cooldownResults: Record<string, any[]> = {};
      if (patientsForCooldown.length > 0) {
        try {
          cooldownResults = await checkCooldownsForPatients(patientsForCooldown);
        } catch (e) {
          console.error("Batch cooldown check failed:", e);
        }
      }

      for (const patient of patients) {
        const match = matchMap.get(patient.id);
        const cooldowns = cooldownResults[patient.name];

        if (match) {
          await storage.updatePatientScreening(patient.id, {
            qualifyingTests: match.qualifyingTests || [],
            reasoning: match.reasoning || {},
            cooldownTests: cooldowns && cooldowns.length > 0 ? cooldowns : null,
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
            cooldownTests: null,
            status: "completed",
          });
        }
      }

      await storage.updateScreeningBatch(batchId, {
        status: "completed",
        patientCount: patients.length,
      });

      res.json({ success: true, patientCount: patients.length });
    } catch (error: any) {
      console.error("Analysis error:", error);
      res.status(500).json({ error: error.message || "Analysis failed" });
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

  return httpServer;
}
