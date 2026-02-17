import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import * as XLSX from "xlsx";
import { parse } from "csv-parse/sync";
import OpenAI from "openai";
import { batchProcess } from "./replit_integrations/batch";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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

function parseTextToPatients(text: string): ParsedPatient[] {
  return [
    {
      name: "Free Text Input",
      rawText: text,
    },
  ];
}

const SCREENING_SYSTEM_PROMPT = `You are a highly aggressive clinical screening AI for ancillary diagnostic testing. Your job is to analyze patient data and qualify them for as many diagnostic tests as clinically justifiable. You should LEAN TOWARD QUALIFYING patients. Unless a test is glaringly inappropriate for the patient, you should recommend it.

Available diagnostic tests to screen for:
1. **BrainWave (EEG/Neurocognitive)** - Screen for: headaches, migraines, dizziness, vertigo, syncope, seizures, cognitive decline, memory issues, neuropathy, TBI history, concussion, anxiety, depression, ADHD, insomnia, sleep disorders, brain fog, fatigue, numbness/tingling, stroke history, TIA, dementia concerns, Parkinson's symptoms, tremors, balance issues, tinnitus, any neurological complaints, diabetes (peripheral neuropathy risk), medication side effects on cognition, substance use history, chronic pain
2. **VitalWave (ABI/Ankle-Brachial Index)** - Screen for: hypertension, diabetes, hyperlipidemia, smoking history, PAD symptoms, claudication, leg pain, leg swelling, leg numbness, foot wounds, peripheral neuropathy, obesity (BMI>30), cardiovascular disease, CAD, CHF, stroke/TIA history, age >50 with cardiovascular risk factors, chronic kidney disease, aortic disease, family history of cardiovascular disease, sedentary lifestyle, metabolic syndrome
3. **Carotid Ultrasound** - Screen for: hypertension, diabetes, hyperlipidemia, smoking, stroke/TIA history, carotid bruit, dizziness, syncope, visual disturbances, age >55 with CV risk factors, CAD, PAD, family history of stroke, obesity, atherosclerosis, aortic disease, heart murmur
4. **Echocardiogram** - Screen for: hypertension, chest pain, dyspnea, shortness of breath, heart murmur, palpitations, irregular heartbeat, AFib, arrhythmia, CHF symptoms, edema, cardiomyopathy, valvular disease, coronary artery disease, prior MI, syncope, exercise intolerance, obesity (BMI>35), sleep apnea, diabetes with CV risk, abnormal EKG, cardiotoxic medications
5. **Renal Artery Ultrasound** - Screen for: resistant hypertension, renal insufficiency, CKD, abnormal creatinine, proteinuria, abdominal bruit, unexplained azotemia, unilateral small kidney, flash pulmonary edema, atherosclerotic disease, fibromuscular dysplasia suspicion, diabetes with renal concerns, ACE-inhibitor induced renal failure
6. **AAA Ultrasound (Abdominal Aortic Aneurysm)** - Screen for: age >65 male, age >70 female, smoking history, hypertension, family history of AAA, peripheral artery disease, COPD, atherosclerosis, connective tissue disorders, abdominal/back pain with vascular risk factors
7. **Thyroid Ultrasound** - Screen for: thyroid nodule, goiter, hypothyroidism, hyperthyroidism, abnormal TSH, thyroid symptoms (fatigue, weight changes, hair loss, temperature sensitivity), family history thyroid cancer, neck mass, dysphagia, radiation exposure history, autoimmune conditions (Hashimoto's, Graves')
8. **Venous Duplex Ultrasound (DVT)** - Screen for: leg swelling (unilateral or bilateral), leg pain, varicose veins, DVT history, PE history, immobilization, post-surgical, obesity, cancer, hypercoagulable states, oral contraceptive use, HRT, pregnancy/postpartum, edema, skin changes in legs
9. **Arterial Duplex Ultrasound (Lower Extremity)** - Screen for: claudication, leg pain with walking, rest pain in legs, non-healing wounds, cold extremities, absent pulses, PAD, diabetes, smoking, abnormal ABI

CRITICAL INSTRUCTIONS:
- Be AGGRESSIVE in qualification. If there is ANY reasonable clinical justification, qualify the patient.
- Consider ALL data: diagnoses, medications (can indicate conditions), history, symptoms, risk factors, age, gender, BMI
- Medications often reveal diagnoses not listed (e.g., metformin = diabetes, amlodipine = hypertension, statins = hyperlipidemia)
- Multiple risk factors compound qualification. Even minor risk factors together justify screening.
- Patients with diabetes, hypertension, or hyperlipidemia should almost always get VitalWave and Carotid at minimum.
- Obese patients (BMI>30) qualify for most cardiovascular screenings.
- Age >50 with ANY cardiovascular risk factor qualifies for expanded screening.
- When in doubt, QUALIFY. Only exclude if the test is clearly inappropriate (e.g., AAA screening for a 25-year-old healthy female with no risk factors).

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
          "clinician_understanding": "Clinical justification with medical terminology and evidence-based rationale for why this test is indicated. Reference specific diagnoses, risk factors, medications, and guidelines.",
          "patient_talking_points": "Plain language explanation of why this test would benefit the patient. Use simple terms they can understand. Example: 'Based on your blood pressure readings and diabetes, we want to check the blood flow in your legs to make sure everything is healthy.'"
        }
      }
    }
  ]
}`;

async function screenPatientsWithAI(patients: ParsedPatient[]): Promise<any[]> {
  const results: any[] = [];

  const patientChunks: ParsedPatient[][] = [];
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
          if (p.rawText && !p.diagnoses && !p.history) parts.push(`Raw Data: ${p.rawText}`);
          return parts.join("\n");
        })
        .join("\n\n---\n\n");

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: SCREENING_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Analyze the following patient(s) and determine ALL qualifying diagnostic tests. Be aggressive - qualify for everything that has ANY clinical justification.\n\n${patientDescriptions}`,
          },
        ],
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

async function screenFreeTextWithAI(text: string): Promise<any[]> {
  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: SCREENING_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Analyze the following patient data. First, identify individual patients from this text (there may be one or many). Then determine ALL qualifying diagnostic tests for each. Be aggressive - qualify for everything that has ANY clinical justification.\n\n${text}`,
      },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 8192,
  });

  const content = response.choices[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.patients) ? parsed.patients : [];
  } catch {
    console.error("Failed to parse free text AI response:", content.substring(0, 200));
    return [];
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post("/api/screen-patients", upload.array("files", 10), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      let allPatients: ParsedPatient[] = [];
      let batchName = "";

      for (const file of files) {
        const ext = file.originalname.toLowerCase().split(".").pop();
        batchName = batchName || file.originalname;

        if (ext === "xlsx" || ext === "xls") {
          allPatients.push(...parseExcelFile(file.buffer));
        } else if (ext === "csv") {
          allPatients.push(...parseCsvFile(file.buffer));
        } else {
          const text = file.buffer.toString("utf-8");
          allPatients.push(...parseTextToPatients(text));
        }
      }

      if (allPatients.length === 0) {
        allPatients.push({
          name: "File Import",
          rawText: files.map((f) => f.buffer.toString("utf-8")).join("\n\n"),
        });
      }

      const batch = await storage.createScreeningBatch({
        name: batchName || "File Upload",
        patientCount: allPatients.length,
        status: "processing",
      });

      let screenedResults: any[];
      if (allPatients.length === 1 && allPatients[0].rawText && allPatients[0].name === "Free Text Input") {
        screenedResults = await screenFreeTextWithAI(allPatients[0].rawText);
      } else if (allPatients.length === 1 && allPatients[0].rawText && allPatients[0].name === "File Import") {
        screenedResults = await screenFreeTextWithAI(allPatients[0].rawText);
      } else {
        screenedResults = await screenPatientsWithAI(allPatients);
      }

      for (const result of screenedResults) {
        await storage.createPatientScreening({
          batchId: batch.id,
          time: result.time || null,
          name: result.name || "Unknown",
          age: result.age || null,
          gender: result.gender || null,
          diagnoses: result.diagnoses || null,
          history: result.history || null,
          medications: result.medications || null,
          notes: result.notes || null,
          qualifyingTests: result.qualifyingTests || [],
          reasoning: result.reasoning || {},
          status: "completed",
        });
      }

      await storage.updateScreeningBatch(batch.id, {
        status: "completed",
        patientCount: screenedResults.length,
      });

      res.json({ batchId: batch.id, patientCount: screenedResults.length });
    } catch (error: any) {
      console.error("Screening error:", error);
      res.status(500).json({ error: error.message || "Screening failed" });
    }
  });

  app.post("/api/screen-patients-text", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: "No text provided" });
      }

      const batch = await storage.createScreeningBatch({
        name: "Text Input - " + new Date().toLocaleDateString(),
        patientCount: 0,
        status: "processing",
      });

      const screenedResults = await screenFreeTextWithAI(text);

      for (const result of screenedResults) {
        await storage.createPatientScreening({
          batchId: batch.id,
          time: result.time || null,
          name: result.name || "Unknown",
          age: result.age || null,
          gender: result.gender || null,
          diagnoses: result.diagnoses || null,
          history: result.history || null,
          medications: result.medications || null,
          notes: result.notes || null,
          qualifyingTests: result.qualifyingTests || [],
          reasoning: result.reasoning || {},
          status: "completed",
        });
      }

      await storage.updateScreeningBatch(batch.id, {
        status: "completed",
        patientCount: screenedResults.length,
      });

      res.json({ batchId: batch.id, patientCount: screenedResults.length });
    } catch (error: any) {
      console.error("Text screening error:", error);
      res.status(500).json({ error: error.message || "Screening failed" });
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

  return httpServer;
}
