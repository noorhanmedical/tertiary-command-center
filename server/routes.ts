import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import * as XLSX from "xlsx";
import { z } from "zod";
import { batchProcess } from "./replit_integrations/batch";
import {
  parseWithAI,
  parseExcelFile,
  csvToText,
  parseHistoryCsv,
  parseHistoryImport,
  normalizeInsuranceType,
} from "./services/ingest";
import {
  screenSinglePatientWithAI,
  checkCooldownsForPatients,
  enrichFromReferenceDb,
  parseReferenceImportWithAI,
  analyzeTestWithAI,
  extractPdfPatients,
  extractImagePatients,
} from "./services/screening";
import type { InsertBillingRecord } from "../shared/schema";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const VALID_FACILITIES = ["Taylor Family Practice", "NWPG - Spring", "NWPG - Veterans"] as const;

const MONTH_MAP: Record<string, number> = {
  january:0,february:1,march:2,april:3,may:4,june:5,
  july:6,august:7,september:8,october:9,november:10,december:11,
};

function extractDateFromPrevTests(text: string | null | undefined): string | null {
  if (!text) return null;
  const dates: Date[] = [];
  let m: RegExpExecArray | null;
  // MM/DD/YYYY
  const p0 = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  while ((m = p0.exec(text)) !== null) {
    const d = new Date(parseInt(m[3]), parseInt(m[1])-1, parseInt(m[2]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  // MM/DD/YY
  const p1 = /\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b/g;
  while ((m = p1.exec(text)) !== null) {
    const yr = parseInt(m[3]);
    const fullYr = yr >= 0 && yr <= 30 ? 2000 + yr : 1900 + yr;
    const d = new Date(fullYr, parseInt(m[1])-1, parseInt(m[2]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  // YYYY-MM-DD
  const p2 = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = p2.exec(text)) !== null) {
    const d = new Date(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  // Month DD, YYYY
  const p3 = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/gi;
  while ((m = p3.exec(text)) !== null) {
    const d = new Date(parseInt(m[3]), MONTH_MAP[m[1].toLowerCase()], parseInt(m[2]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  // DD Month YYYY
  const p4 = /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/gi;
  while ((m = p4.exec(text)) !== null) {
    const d = new Date(parseInt(m[3]), MONTH_MAP[m[2].toLowerCase()], parseInt(m[1]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  // MM/YYYY (month/year only — day defaults to 1)
  // Negative lookbehind (?<!\/) prevents matching DD portion of MM/DD/YYYY
  const p5 = /(?<!\/)\b(\d{1,2})\/(\d{4})\b/g;
  while ((m = p5.exec(text)) !== null) {
    const mo = parseInt(m[1]);
    const yr = parseInt(m[2]);
    if (mo >= 1 && mo <= 12) {
      const d = new Date(yr, mo-1, 1);
      if (!isNaN(d.getTime())) dates.push(d);
    }
  }
  if (dates.length === 0) return null;
  const latest = dates.reduce((a, b) => b > a ? b : a);
  const mm = String(latest.getMonth() + 1).padStart(2, "0");
  const dd = String(latest.getDate()).padStart(2, "0");
  return `${latest.getFullYear()}-${mm}-${dd}`;
}

function facilityToSettingKey(facility: string): string {
  return `QUALIFICATION_MODE_${facility.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

async function getQualificationMode(facility: string | null): Promise<import("./services/screening").QualificationMode> {
  if (!facility) return "permissive";
  const { getSetting } = await import("./dbSettings");
  const val = await getSetting(facilityToSettingKey(facility));
  if (val === "standard" || val === "conservative") return val;
  return "permissive";
}

const createBatchSchema = z.object({
  name: z.string().optional(),
  facility: z.enum(VALID_FACILITIES),
  scheduleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const addTestHistorySchema = z.object({
  patientName: z.string(),
  dob: z.string().optional(),
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
  dob: z.string().optional(),
  phoneNumber: z.string().optional(),
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
  dob: z.string().nullable().optional(),
  phoneNumber: z.string().nullable().optional(),
  insurance: z.string().nullable().optional(),
  diagnoses: z.string().nullable().optional(),
  history: z.string().nullable().optional(),
  medications: z.string().nullable().optional(),
  previousTests: z.string().nullable().optional(),
  previousTestsDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  qualifyingTests: z.array(z.string()).optional(),
  appointmentStatus: z.string().nullable().optional(),
  patientType: z.string().nullable().optional(),
});

const importTextSchema = z.object({
  text: z.string().min(1, "Text is required"),
});

const saveGeneratedNoteSchema = z.object({
  patientId: z.number().int(),
  batchId: z.number().int(),
  facility: z.string().nullable().optional(),
  scheduleDate: z.string().nullable().optional(),
  patientName: z.string(),
  service: z.string(),
  docKind: z.string(),
  title: z.string(),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ─── Reset any batches stuck in "processing" from a previous server run ────
  // Analysis jobs are in-process async tasks that do not survive a server restart.
  // Any batch still marked "processing" at startup must have been interrupted;
  // reset to "draft" so users can re-run analysis.
  try {
    const allBatches = await storage.getAllScreeningBatches();
    let resetCount = 0;
    for (const batch of allBatches) {
      if (batch.status === "processing") {
        await storage.updateScreeningBatch(batch.id, { status: "draft" });
        const patients = await storage.getPatientScreeningsByBatch(batch.id);
        const processingPatients = patients.filter((patient) => patient.status === "processing");
        for (const p of processingPatients) {
          await storage.updatePatientScreening(p.id, { status: "pending", qualifyingTests: [] });
        }
        console.log(`[startup] Reset interrupted batch #${batch.id} → draft (${processingPatients.length} patients reset)`);
        resetCount++;
      }
    }
    if (resetCount > 0) {
      console.log(`[startup] Reset ${resetCount} interrupted batch(es) to draft status`);
    }
  } catch (startupErr: any) {
    console.error("[startup] Failed to reset stuck batches:", startupErr.message);
  }

  // ─── API Key auth middleware ───────────────────────────────────────────────
  const PLEXUS_API_KEY = process.env.PLEXUS_API_KEY;
  if (!PLEXUS_API_KEY) {
    console.error("[auth] FATAL: PLEXUS_API_KEY is not set — all /api routes will return 401");
  }

  app.use("/api", (req, res, next) => {
    const EXEMPT_GET_PATHS = [
      /^\/schedule\/[^/]+$/,
      /^\/schedule\/[^/]+\/patients$/,
    ];
    if (req.method === "GET" && EXEMPT_GET_PATHS.some((re) => re.test(req.path))) {
      return next();
    }

    if (!PLEXUS_API_KEY) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const authHeader = req.headers["authorization"];
    if (!authHeader || authHeader !== `Bearer ${PLEXUS_API_KEY}`) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    return next();
  });

  // ─── Health check (exempt from auth) ──────────────────────────────────────
  app.get("/healthz", async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`SELECT 1`);
      res.json({ status: "ok", db: true });
    } catch {
      res.status(503).json({ status: "error", db: false });
    }
  });

  // ─── Batches ───────────────────────────────────────────────────────────────
  app.post("/api/batches", async (req, res) => {
    try {
      const parsed = createBatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });

      const batch = await storage.createScreeningBatch({
        name: parsed.data.name || `Batch - ${new Date().toLocaleDateString()}`,
        patientCount: 0,
        status: "draft",
        facility: parsed.data.facility || null,
        scheduleDate: parsed.data.scheduleDate || null,
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
      const { name, time, age, gender, dob, phoneNumber, diagnoses, history, medications, notes } = parsed.data;

      const patient = await storage.createPatientScreening({
        batchId,
        name: name.trim(),
        time: time || null,
        age: age ? parseInt(String(age)) : null,
        gender: gender || null,
        dob: dob || null,
        phoneNumber: phoneNumber || null,
        facility: batch.facility || null,
        diagnoses: diagnoses || null,
        history: history || null,
        medications: medications || null,
        notes: notes || null,
        qualifyingTests: [],
        reasoning: {},
        status: "draft",
        appointmentStatus: "pending",
        patientType: time ? "visit" : "outreach",
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

      let allPatients: Awaited<ReturnType<typeof parseWithAI>> = [];

      for (const file of files) {
        const ext = file.originalname.toLowerCase().split(".").pop();
        if (ext === "xlsx" || ext === "xls") {
          allPatients.push(...await parseExcelFile(file.buffer));
        } else if (ext === "csv") {
          allPatients.push(...await parseWithAI(csvToText(file.buffer)));
        } else if (ext === "pdf") {
          const pdfParseModule = await import("pdf-parse");
          const pdfParseFn = pdfParseModule.default || pdfParseModule;
          const pdfData = await pdfParseFn(file.buffer);
          const extracted = await extractPdfPatients(pdfData.text);
          allPatients.push(...extracted);
        } else if (["jpg", "jpeg", "png", "gif", "bmp", "webp"].includes(ext || "")) {
          const base64 = file.buffer.toString("base64");
          const mimeType = file.mimetype || `image/${ext === "jpg" ? "jpeg" : ext}`;
          const extracted = await extractImagePatients(base64, mimeType);
          allPatients.push(...extracted);
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
          facility: batch.facility || null,
          diagnoses: p.diagnoses || null,
          history: p.history || null,
          medications: p.medications || null,
          previousTests: p.previousTests || null,
          previousTestsDate: extractDateFromPrevTests(p.previousTests) || null,
          notes: p.notes || null,
          qualifyingTests: [],
          reasoning: {},
          status: "draft",
          appointmentStatus: "pending",
          patientType: p.time ? "visit" : "outreach",
        });
        created.push(patient);
      }

      await storage.updateScreeningBatch(batchId, {
        patientCount: (await storage.getPatientScreeningsByBatch(batchId)).length,
      });

      const refreshed = await storage.getPatientScreeningsByBatch(batchId);
      const createdIds = new Set(created.map((p) => p.id));
      const enrichedPatients = refreshed.filter((p) => createdIds.has(p.id));

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

      const patients = await parseWithAI(text);

      const created = [];
      for (const p of patients) {
        const patient = await storage.createPatientScreening({
          batchId,
          name: p.name,
          time: p.time || null,
          age: p.age || null,
          gender: p.gender || null,
          insurance: p.insurance || null,
          facility: batch.facility || null,
          diagnoses: p.diagnoses || null,
          history: p.history || null,
          medications: p.medications || null,
          previousTests: p.previousTests || null,
          previousTestsDate: extractDateFromPrevTests(p.previousTests) || null,
          notes: null,
          qualifyingTests: [],
          reasoning: {},
          status: "draft",
          appointmentStatus: "pending",
          patientType: p.time ? "visit" : "outreach",
        });
        created.push(patient);
      }

      await storage.updateScreeningBatch(batchId, {
        patientCount: (await storage.getPatientScreeningsByBatch(batchId)).length,
      });

      const refreshed2 = await storage.getPatientScreeningsByBatch(batchId);
      const createdIds2 = new Set(created.map((p) => p.id));
      const enrichedPatients2 = refreshed2.filter((p) => createdIds2.has(p.id));

      res.json({ imported: enrichedPatients2.length, patients: enrichedPatients2 });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Patients ──────────────────────────────────────────────────────────────
  app.patch("/api/patients/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = updatePatientSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });

      const data = parsed.data;
      const previousPatient = data.appointmentStatus ? await storage.getPatientScreening(id) : null;

      const updates: any = {};
      if (data.name !== undefined) updates.name = data.name;
      if (data.time !== undefined) updates.time = data.time || null;
      if (data.age !== undefined) updates.age = data.age ? parseInt(String(data.age)) : null;
      if (data.gender !== undefined) updates.gender = data.gender || null;
      if (data.dob !== undefined) updates.dob = data.dob || null;
      if (data.phoneNumber !== undefined) updates.phoneNumber = data.phoneNumber || null;
      if (data.insurance !== undefined) updates.insurance = data.insurance || null;
      if (data.diagnoses !== undefined) updates.diagnoses = data.diagnoses || null;
      if (data.history !== undefined) updates.history = data.history || null;
      if (data.medications !== undefined) updates.medications = data.medications || null;
      if (data.previousTests !== undefined) updates.previousTests = data.previousTests || null;
      if (data.previousTestsDate !== undefined) {
        updates.previousTestsDate = data.previousTestsDate || null;
      } else if (data.previousTests !== undefined) {
        updates.previousTestsDate = extractDateFromPrevTests(data.previousTests) || null;
      }
      if (data.notes !== undefined) updates.notes = data.notes || null;
      if (data.qualifyingTests !== undefined) updates.qualifyingTests = data.qualifyingTests;
      if (data.appointmentStatus !== undefined) updates.appointmentStatus = data.appointmentStatus || "pending";
      if (data.patientType !== undefined) updates.patientType = data.patientType || "visit";

      const patient = await storage.updatePatientScreening(id, updates);
      if (!patient) return res.status(404).json({ error: "Patient not found" });

      const wasAlreadyCompleted = previousPatient?.appointmentStatus?.toLowerCase() === "completed";
      if (data.appointmentStatus && data.appointmentStatus.toLowerCase() === "completed" && !wasAlreadyCompleted) {
        try {
          const qualTests: string[] = patient.qualifyingTests || [];
          if (qualTests.length > 0) {
            const batch = await storage.getScreeningBatch(patient.batchId);
            const _d = new Date();
            const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;
            const dos = batch?.scheduleDate || today;
            const insuranceType = normalizeInsuranceType(patient.insurance || "");
            const records = qualTests.map((testName: string) => ({
              patientName: patient.name,
              testName,
              dateOfService: dos,
              insuranceType,
              clinic: "NWPG",
            }));
            await storage.bulkInsertTestHistoryIfNotExists(records);
            void backgroundSyncPatients();
          }
        } catch (e) {
          console.error("Auto test history capture on completion failed:", e);
        }
      }

      res.json(patient);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/patients/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const patient = await storage.getPatientScreening(id);
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

      const patientQualMode = await getQualificationMode(patient.facility ?? null);

      let match: any = null;
      try {
        match = await screenSinglePatientWithAI({
          name: patient.name,
          time: patient.time,
          age: patient.age,
          gender: patient.gender,
          diagnoses: patient.diagnoses,
          history: patient.history,
          medications: patient.medications,
          notes: patient.notes,
        }, patientQualMode);
      } catch (aiErr: any) {
        console.error(`AI screening failed for patient ${patient.name}:`, aiErr.message);
        await storage.updatePatientScreening(id, { status: "error" });
        return res.status(500).json({ error: "AI analysis failed after retries" });
      }

      const qualTests = match?.qualifyingTests || [];

      let cooldownData: any[] = [];
      if (qualTests.length > 0) {
        try {
          const batch = await storage.getScreeningBatch(patient.batchId);
          const visitDate = batch?.scheduleDate || undefined;
          const cooldowns = await checkCooldownsForPatients([{ name: patient.name, qualifyingTests: qualTests }], visitDate);
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

  app.post("/api/patients/:id/analyze-test", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { testName } = req.body;
      if (!testName || typeof testName !== "string") {
        return res.status(400).json({ error: "testName is required" });
      }
      const patient = await storage.getPatientScreening(id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });

      let testReasoning: any = null;
      try {
        testReasoning = await analyzeTestWithAI(
          {
            name: patient.name,
            age: patient.age,
            gender: patient.gender,
            diagnoses: patient.diagnoses,
            history: patient.history,
            medications: patient.medications,
            notes: patient.notes,
          },
          testName
        );
      } catch (aiErr: any) {
        console.error(`AI analyze-test failed for ${patient.name} / ${testName}:`, aiErr.message);
        return res.status(500).json({ error: "AI analysis failed after retries" });
      }

      if (
        !testReasoning ||
        typeof testReasoning.clinician_understanding !== "string" ||
        typeof testReasoning.patient_talking_points !== "string"
      ) {
        return res.status(500).json({ error: "AI returned malformed reasoning" });
      }

      if (testReasoning.pearls !== undefined) {
        if (
          !Array.isArray(testReasoning.pearls) ||
          testReasoning.pearls.some((p: unknown) => typeof p !== "string")
        ) {
          testReasoning.pearls = undefined;
        }
      }

      const existingReasoning = (patient.reasoning as Record<string, any>) || {};
      const mergedReasoning = { ...existingReasoning, [testName]: testReasoning };

      const updated = await storage.updatePatientScreening(id, {
        reasoning: mergedReasoning,
      });

      res.json({ reasoning: mergedReasoning, testName, patient: updated });
    } catch (error: any) {
      console.error("Single-test analysis error:", error);
      res.status(500).json({ error: error.message || "Analysis failed" });
    }
  });

  // ─── Batch analyze ─────────────────────────────────────────────────────────
  app.post("/api/batches/:id/analyze", async (req, res) => {
    const batchId = parseInt(req.params.id);
    try {
      const batch = await storage.getScreeningBatch(batchId);
      if (!batch) return res.status(404).json({ error: "Batch not found" });

      const patients = await storage.getPatientScreeningsByBatch(batchId);
      if (patients.length === 0) return res.status(400).json({ error: "No patients in batch" });

      if (batch.status === "processing") {
        await storage.updateScreeningBatch(batchId, { status: "draft" });
        for (const p of patients.filter((p) => p.status === "processing")) {
          await storage.updatePatientScreening(p.id, { status: "draft", qualifyingTests: [], reasoning: {} });
        }
      }

      await storage.updateScreeningBatch(batchId, { status: "processing" });

      res.json({ success: true, patientCount: patients.length, async: true });

      const facilityQualMode = await getQualificationMode(batch.facility ?? null);
      console.log(`[batch:${batchId}] Qualification mode: ${facilityQualMode} (facility: ${batch.facility ?? "none"})`);

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
            }, facilityQualMode);

            if (result) {
              const match = result?.patients?.[0] || result;
              aiResults.set(patient.id, match);
              const rawReasoning: Record<string, any> = match.reasoning || {};
              for (const testKey of Object.keys(rawReasoning)) {
                const entry = rawReasoning[testKey];
                if (entry && typeof entry === "object" && entry.pearls !== undefined) {
                  if (!Array.isArray(entry.pearls) || entry.pearls.some((p: unknown) => typeof p !== "string")) {
                    entry.pearls = undefined;
                  }
                }
              }
              await storage.updatePatientScreening(patient.id, {
                qualifyingTests: match.qualifyingTests || [],
                reasoning: rawReasoning,
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
              status: "error",
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

      for (const patient of patients) {
        await storage.updatePatientScreening(patient.id, { cooldownTests: [] });
      }

      if (patientsForCooldown.length > 0) {
        try {
          const visitDate = batch?.scheduleDate || undefined;
          const cooldownResults = await checkCooldownsForPatients(patientsForCooldown, visitDate);
          for (const patient of patients) {
            const violations = cooldownResults[patient.name];
            if (violations && violations.length > 0) {
              await storage.updatePatientScreening(patient.id, { cooldownTests: violations });
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
    } catch (error: unknown) {
      console.error("Analysis error:", error);
      try {
        await storage.updateScreeningBatch(batchId, { status: "draft" });
      } catch (resetErr: unknown) {
        console.error("Failed to reset batch status after analysis error:", resetErr);
      }
    }
  });

  // ─── Archive / Screening batches ───────────────────────────────────────────
  app.get("/api/archive", async (_req, res) => {
    try {
      const batches = await storage.getAllScreeningBatches();
      const result = [];
      for (const batch of batches) {
        const patients = await storage.getPatientScreeningsByBatch(batch.id);
        result.push({ ...batch, patients });
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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
      const { clinicianName, facility } = req.body;
      const batchUpdates: Partial<{ clinicianName: string | null; facility: string | null }> = {};
      if (clinicianName !== undefined) batchUpdates.clinicianName = clinicianName ?? null;
      if (facility !== undefined) batchUpdates.facility = facility ?? null;
      const updated = await storage.updateScreeningBatch(id, batchUpdates);
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

  // ─── Test History ──────────────────────────────────────────────────────────
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
      void backgroundSyncPatients();
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

      const isCsvFile = req.file && req.file.originalname.toLowerCase().endsWith(".csv");
      let records: { patientName: string; dob?: string; testName: string; dateOfService: string; insuranceType: string }[] | null = null;
      if (isCsvFile) {
        records = parseHistoryCsv(text);
      }
      if (!records) {
        records = await parseHistoryImport(text);
      }
      if (records.length === 0) return res.json({ imported: 0, records: [] });

      const validRecords = records
        .filter((r) => r.patientName && r.testName && r.dateOfService)
        .map((r) => ({
          patientName: r.patientName,
          dob: r.dob || undefined,
          testName: r.testName,
          dateOfService: r.dateOfService,
          insuranceType: r.insuranceType || "ppo",
          clinic,
        }));

      const created = await storage.createTestHistoryBulk(validRecords);
      res.json({ imported: created.length, records: created });
      void backgroundSyncPatients();
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
      void backgroundSyncPatients();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/test-history", async (_req, res) => {
    try {
      await storage.deleteAllTestHistory();
      res.status(204).send();
      void backgroundSyncPatients();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Patient References ────────────────────────────────────────────────────
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

      const records = await parseReferenceImportWithAI(text);

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
      void backgroundSyncPatients();
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
      void backgroundSyncPatients();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/patient-references", async (_req, res) => {
    try {
      await storage.deleteAllPatientReferences();
      res.status(204).send();
      void backgroundSyncPatients();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Generated Notes ───────────────────────────────────────────────────────
  app.get("/api/generated-notes", async (_req, res) => {
    try {
      const notes = await storage.getAllGeneratedNotes();
      res.json(notes);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/generated-notes/batch/:batchId", async (req, res) => {
    try {
      const batchId = parseInt(req.params.batchId);
      if (isNaN(batchId)) return res.status(400).json({ error: "Invalid batchId" });
      const notes = await storage.getGeneratedNotesByBatch(batchId);
      res.json(notes);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/generated-notes", async (req, res) => {
    try {
      const body = req.body;
      if (!Array.isArray(body)) return res.status(400).json({ error: "Expected array of note records" });
      const records = body.map((r: any) => saveGeneratedNoteSchema.parse(r));
      if (records.length === 0) return res.json([]);
      const patientId = records[0].patientId;
      await storage.deleteGeneratedNotesByPatient(patientId);
      const saved = await storage.saveGeneratedNotes(records);
      res.status(201).json(saved);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/generated-notes/service", async (req, res) => {
    try {
      const body = req.body;
      if (!Array.isArray(body)) return res.status(400).json({ error: "Expected array of note records" });
      const records = body.map((r: any) => saveGeneratedNoteSchema.parse(r));
      if (records.length === 0) return res.json([]);
      const patientId = records[0].patientId;
      const service = records[0].service;
      await storage.deleteGeneratedNotesByPatientAndService(patientId, service);
      const saved = await storage.saveGeneratedNotes(records);
      res.status(201).json(saved);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/generated-notes/patient/:patientId", async (req, res) => {
    try {
      const patientId = parseInt(req.params.patientId);
      if (isNaN(patientId)) return res.status(400).json({ error: "Invalid patientId" });
      await storage.deleteGeneratedNotesByPatient(patientId);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/generated-notes/patient/:patientId", async (req, res) => {
    try {
      const patientId = parseInt(req.params.patientId);
      if (isNaN(patientId)) return res.status(400).json({ error: "Invalid patientId" });
      const notes = await storage.getGeneratedNotesByPatient(patientId);
      res.json(notes);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Billing Records ───────────────────────────────────────────────────────
  const ULTRASOUND_TESTS = [
    "Bilateral Carotid Duplex",
    "Echocardiogram TTE",
    "Renal Artery Doppler",
    "Lower Extremity Arterial Doppler",
    "Upper Extremity Arterial Doppler",
    "Abdominal Aortic Aneurysm Duplex",
    "Stress Echocardiogram",
    "Lower Extremity Venous Duplex",
    "Upper Extremity Venous Duplex",
    "Carotid Duplex",
    "Renal Artery Duplex",
    "Aorta/Iliac Duplex",
    "Mesenteric Artery Duplex",
    "Lower Extremity Arterial Duplex",
    "ABI (Ankle-Brachial Index)",
    "TBI (Toe-Brachial Index)",
  ];

  const updateBillingRecordSchema = z.object({
    dateOfService: z.string().nullable().optional(),
    patientName: z.string().min(1).optional(),
    service: z.string().nullable().optional(),
    clinician: z.string().nullable().optional(),
    facility: z.string().nullable().optional(),
    insuranceInfo: z.string().nullable().optional(),
    documentationStatus: z.string().nullable().optional(),
    billingStatus: z.string().nullable().optional(),
    response: z.string().nullable().optional(),
    paidStatus: z.string().nullable().optional(),
    balanceRemaining: z.string().nullable().optional(),
    dateSubmitted: z.string().nullable().optional(),
    followUpDate: z.string().nullable().optional(),
    paidAmount: z.string().nullable().optional(),
    totalCharges: z.string().nullable().optional(),
    allowedAmount: z.string().nullable().optional(),
    patientResponsibility: z.string().nullable().optional(),
    adjustmentAmount: z.string().nullable().optional(),
  });

  app.get("/api/billing-records", async (_req, res) => {
    try {
      const batches = await storage.getAllScreeningBatches();
      const allScreenedPatients: any[] = [];
      for (const batch of batches) {
        const patients = await storage.getPatientScreeningsByBatch(batch.id);
        for (const p of patients) {
          if (p.status === "completed" && p.qualifyingTests && p.qualifyingTests.length > 0) {
            allScreenedPatients.push({ patient: p, batch });
          }
        }
      }

      let billingAutoCreated = 0;
      for (const { patient, batch } of allScreenedPatients) {
        const tests: string[] = patient.qualifyingTests || [];
        for (const test of tests) {
          const existing = await storage.getBillingRecordByPatientAndService(patient.id, test);
          if (!existing) {
            await storage.createBillingRecord({
              patientId: patient.id,
              batchId: batch.id,
              service: test,
              facility: batch.facility || null,
              dateOfService: batch.scheduleDate || null,
              patientName: patient.name,
              clinician: batch.clinicianName || null,
              billingStatus: "Not Billed",
              paidStatus: "Unpaid",
            });
            billingAutoCreated++;
          }
        }
      }

      if (billingAutoCreated > 0) {
        void backgroundSyncBilling();
      }

      const records = await storage.getAllBillingRecords();
      res.json(records);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const createBillingRecordSchema = z.object({
    patientId: z.number().int().nullable().optional(),
    batchId: z.number().int().nullable().optional(),
    service: z.string().min(1),
    facility: z.string().nullable().optional(),
    dateOfService: z.string().nullable().optional(),
    patientName: z.string().min(1),
    clinician: z.string().nullable().optional(),
    insuranceInfo: z.string().nullable().optional(),
  });

  app.post("/api/billing-records", async (req, res) => {
    try {
      const parsed = createBillingRecordSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const { patientId, batchId, service, facility, dateOfService, patientName, clinician, insuranceInfo } = parsed.data;
      const record = await storage.createBillingRecord({
        patientId: patientId ?? null,
        batchId: batchId ?? null,
        service,
        facility: facility ?? null,
        dateOfService: dateOfService ?? null,
        patientName,
        clinician: clinician ?? null,
        insuranceInfo: insuranceInfo ?? null,
      });
      res.status(201).json(record);
      void backgroundSyncBilling();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/billing-records/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = updateBillingRecordSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const updates: Partial<InsertBillingRecord> = Object.fromEntries(
        Object.entries(parsed.data).filter(([, v]) => v !== undefined)
      ) as Partial<InsertBillingRecord>;
      const record = await storage.updateBillingRecord(id, updates);
      if (!record) return res.status(404).json({ error: "Billing record not found" });
      res.json(record);
      void backgroundSyncBilling();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/billing-records/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteBillingRecord(id);
      res.status(204).send();
      void backgroundSyncBilling();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Google Workspace Integration ──────────────────────────────────────────

  const patientsSyncState = { lastSyncedAt: null as string | null };
  const billingSyncState = { lastSyncedAt: null as string | null };
  const patientsSyncLock = { running: false, pending: false };
  const billingSyncLock = { running: false, pending: false };
  const exportNotesLock = { running: false, pending: false };

  interface PatientsSyncResult {
    spreadsheetId: string;
    patientCount: number;
    testHistoryCount: number;
    syncedAt: string;
  }

  async function executeSyncPatients(): Promise<PatientsSyncResult> {
    const { getOrCreateSpreadsheet, upsertSheetData } = await import("./googleSheets");
    const { setSetting } = await import("./dbSettings");
    const spreadsheetId = await getOrCreateSpreadsheet("GOOGLE_SHEETS_PATIENTS_ID", "Plexus Patient Directory");
    const [references, testHistory] = await Promise.all([
      storage.getAllPatientReferences(),
      storage.getAllTestHistory(),
    ]);
    await upsertSheetData(
      spreadsheetId, "Patient Directory",
      ["ID", "Patient Name", "Age", "Gender", "Insurance", "Diagnoses", "History", "Medications", "Notes", "Created At"],
      references.map((r) => [r.id, r.patientName, r.age ?? "", r.gender ?? "", r.insurance ?? "", r.diagnoses ?? "", r.history ?? "", r.medications ?? "", r.notes ?? "", r.createdAt.toISOString()])
    );
    await upsertSheetData(
      spreadsheetId, "Test History",
      ["ID", "Patient Name", "DOB", "Test Name", "Date of Service", "Insurance Type", "Clinic", "Notes", "Created At"],
      testHistory.map((t) => [t.id, t.patientName, t.dob ?? "", t.testName, t.dateOfService, t.insuranceType, t.clinic, t.notes ?? "", t.createdAt.toISOString()])
    );
    const syncedAt = new Date().toISOString();
    patientsSyncState.lastSyncedAt = syncedAt;
    await setSetting("PATIENTS_LAST_SYNCED_AT", syncedAt);
    await setSetting("PATIENTS_SPREADSHEET_ID", spreadsheetId);
    return { spreadsheetId, patientCount: references.length, testHistoryCount: testHistory.length, syncedAt };
  }

  async function runPatientsSyncWithLock(throwOnError: boolean): Promise<PatientsSyncResult | null> {
    if (patientsSyncLock.running) {
      patientsSyncLock.pending = true;
      return null;
    }
    patientsSyncLock.running = true;
    try {
      return await executeSyncPatients();
    } catch (err) {
      if (throwOnError) throw err;
      console.warn("Background patient sync skipped:", (err as Error).message);
      return null;
    } finally {
      patientsSyncLock.running = false;
      if (patientsSyncLock.pending) {
        patientsSyncLock.pending = false;
        void runPatientsSyncWithLock(false);
      }
    }
  }

  function backgroundSyncPatients(): void {
    void runPatientsSyncWithLock(false);
  }

  interface BillingSyncResult {
    spreadsheetId: string;
    recordCount: number;
    syncedAt: string;
  }

  async function executeSyncBilling(): Promise<BillingSyncResult> {
    const { getOrCreateSpreadsheetInFolder, upsertSheetData } = await import("./googleSheets");
    const { getFacilityFolderId } = await import("./googleDrive");
    const { setSetting } = await import("./dbSettings");
    const records = await storage.getAllBillingRecords();

    const BILLING_HEADERS = ["Date of Service", "Patient Name", "Facility", "Rendering Provider", "Service Type", "Primary Insurance", "Documentation Status", "Claim Status", "Payer Status", "Date Submitted", "Days in A/R", "Follow-Up Date", "Payment Status", "Paid Amount", "Total Charges", "Allowed Amount", "Patient Responsibility", "Adjustment Amount", "Balance Remaining"];

    const facilityGroups = new Map<string, typeof records>();
    for (const r of records) {
      const fac = r.facility || "Unknown Facility";
      if (!facilityGroups.has(fac)) facilityGroups.set(fac, []);
      facilityGroups.get(fac)!.push(r);
    }

    let totalSynced = 0;
    let lastSpreadsheetId = "";

    for (const [facility, facRecords] of Array.from(facilityGroups.entries())) {
      let folderId: string | null = null;
      try {
        folderId = await getFacilityFolderId(facility);
      } catch (e) {
        console.warn(`Could not get Drive folder for facility ${facility}, skipping folder placement:`, (e as Error).message);
      }

      const billingSettingKey = `GOOGLE_SHEETS_BILLING_ID_${facility.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "")}`;
      let spreadsheetId: string;
      if (folderId) {
        spreadsheetId = await getOrCreateSpreadsheetInFolder(
          billingSettingKey,
          `Plexus Billing Tracker — ${facility}`,
          folderId
        );
      } else {
        const { getOrCreateSpreadsheet } = await import("./googleSheets");
        spreadsheetId = await getOrCreateSpreadsheet(billingSettingKey, `Plexus Billing Tracker — ${facility}`);
      }

      await upsertSheetData(
        spreadsheetId, "Billing Records",
        BILLING_HEADERS,
        facRecords.map((r) => {
          const daysInAR = (() => {
            if (!r.dateSubmitted) return "";
            const start = new Date(r.dateSubmitted);
            if (isNaN(start.getTime())) return "";
            return Math.max(0, Math.round((Date.now() - start.getTime()) / 86400000)).toString();
          })();
          return [
            r.dateOfService ?? "", r.patientName, r.facility ?? "", r.clinician ?? "",
            r.service, r.insuranceInfo ?? "", r.documentationStatus ?? "", r.billingStatus ?? "",
            r.response ?? "", r.dateSubmitted ?? "", daysInAR, r.followUpDate ?? "",
            r.paidStatus ?? "", r.paidAmount ?? "", r.totalCharges ?? "", r.allowedAmount ?? "",
            r.patientResponsibility ?? "", r.adjustmentAmount ?? "", r.balanceRemaining ?? ""
          ];
        })
      );

      totalSynced += facRecords.length;
      lastSpreadsheetId = spreadsheetId;
      await setSetting(`BILLING_SPREADSHEET_ID_${facility.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "")}`, spreadsheetId);
    }

    const syncedAt = new Date().toISOString();
    billingSyncState.lastSyncedAt = syncedAt;
    await setSetting("BILLING_LAST_SYNCED_AT", syncedAt);
    if (lastSpreadsheetId) {
      await setSetting("BILLING_SPREADSHEET_ID", lastSpreadsheetId);
    }
    return { spreadsheetId: lastSpreadsheetId || "", recordCount: totalSynced, syncedAt };
  }

  async function runBillingSyncWithLock(throwOnError: boolean): Promise<BillingSyncResult | null> {
    if (billingSyncLock.running) {
      billingSyncLock.pending = true;
      return null;
    }
    billingSyncLock.running = true;
    try {
      return await executeSyncBilling();
    } catch (err) {
      if (throwOnError) throw err;
      console.warn("Background billing sync skipped:", (err as Error).message);
      return null;
    } finally {
      billingSyncLock.running = false;
      if (billingSyncLock.pending) {
        billingSyncLock.pending = false;
        void runBillingSyncWithLock(false);
      }
    }
  }

  function backgroundSyncBilling(): void {
    void runBillingSyncWithLock(false);
  }

  interface ExportNotesResult {
    exported: number;
    failed: number;
    remaining: number;
    results: { noteId: number; driveFileId: string; webViewLink: string }[];
    errors: { noteId: number; error: string }[];
  }

  async function executeExportNotes(): Promise<ExportNotesResult> {
    const { uploadTextAsGoogleDoc, ensurePlexusFolderTree } = await import("./googleDrive");
    const BATCH_LIMIT = 50;
    const allNotes = await storage.getAllGeneratedNotes();
    const unsynced = allNotes.filter((n) => !n.driveFileId).slice(0, BATCH_LIMIT);
    const DRIVE_ANCILLARY_TYPES_ALL: readonly string[] = ["BrainWave", "VitalWave", "Ultrasound"];
    const results: { noteId: number; driveFileId: string; webViewLink: string }[] = [];
    const errors: { noteId: number; error: string }[] = [];

    for (const note of unsynced) {
      try {
        const sections = (note.sections as { heading: string; body: string }[]) || [];
        const content = sections
          .filter((s) => !s.heading.startsWith("__"))
          .map((s) => `${s.heading}\n${s.body}`)
          .join("\n\n");
        const filename = `${note.patientName} - ${note.title} (${note.scheduleDate || note.generatedAt.toISOString().split("T")[0]})`;
        let clinicalDocsFolderId: string | undefined;
        if (note.facility && note.patientName && note.service && DRIVE_ANCILLARY_TYPES_ALL.includes(note.service)) {
          try {
            const tree = await ensurePlexusFolderTree(note.facility, note.patientName, note.service);
            clinicalDocsFolderId = tree.clinicalDocsFolderId;
          } catch (e) {
            console.warn(`Could not resolve Drive folder for note ${note.id}, uploading to root:`, (e as Error).message);
          }
        }
        const { id: driveFileId, webViewLink } = await uploadTextAsGoogleDoc(filename, content, clinicalDocsFolderId);
        await storage.updateGeneratedNoteDriveInfo(note.id, driveFileId, webViewLink);
        results.push({ noteId: note.id, driveFileId, webViewLink });
      } catch (e: any) {
        errors.push({ noteId: note.id, error: e.message });
      }
    }

    const totalUnsynced = allNotes.filter((n) => !n.driveFileId).length;
    const remaining = Math.max(0, totalUnsynced - results.length - errors.length);
    return { exported: results.length, failed: errors.length, remaining, results, errors };
  }

  async function runExportNotesWithLock(throwOnError: boolean): Promise<ExportNotesResult | null> {
    if (exportNotesLock.running) {
      exportNotesLock.pending = true;
      return null;
    }
    exportNotesLock.running = true;
    try {
      return await executeExportNotes();
    } catch (err) {
      if (throwOnError) throw err;
      console.warn("Background notes export skipped:", (err as Error).message);
      return null;
    } finally {
      exportNotesLock.running = false;
      if (exportNotesLock.pending) {
        exportNotesLock.pending = false;
        void runExportNotesWithLock(false);
      }
    }
  }

  function backgroundExportNotes(): void {
    void runExportNotesWithLock(false);
  }

  app.get("/api/google/status", async (_req, res) => {
    try {
      const { isGoogleSheetsConnected } = await import("./googleSheets");
      const { getDriveStatus } = await import("./googleDrive");
      const { getSetting } = await import("./dbSettings");
      const [sheets, driveStatus, dbPatientsAt, dbBillingAt, dbPatientsSid, dbBillingSid] = await Promise.all([
        isGoogleSheetsConnected(),
        getDriveStatus(),
        getSetting("PATIENTS_LAST_SYNCED_AT"),
        getSetting("BILLING_LAST_SYNCED_AT"),
        getSetting("PATIENTS_SPREADSHEET_ID"),
        getSetting("BILLING_SPREADSHEET_ID"),
      ]);
      const patientsAt = patientsSyncState.lastSyncedAt ?? dbPatientsAt;
      const billingAt = billingSyncState.lastSyncedAt ?? dbBillingAt;
      const patientsSid = dbPatientsSid ?? process.env.GOOGLE_SHEETS_PATIENTS_ID ?? null;
      const billingSid = dbBillingSid ?? process.env.GOOGLE_SHEETS_BILLING_ID ?? null;
      res.json({
        sheets: {
          connected: sheets,
          lastSyncedPatients: patientsAt,
          lastSyncedBilling: billingAt,
          patientsSpreadsheetUrl: patientsSid ? `https://docs.google.com/spreadsheets/d/${patientsSid}` : null,
          billingSpreadsheetUrl: billingSid ? `https://docs.google.com/spreadsheets/d/${billingSid}` : null,
        },
        drive: { connected: driveStatus.connected, email: driveStatus.email },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/google/sync/patients", async (_req, res) => {
    try {
      const result = await runPatientsSyncWithLock(true);
      if (!result) {
        res.json({ success: true, message: "Sync already in progress, queued" });
        return;
      }
      res.json({
        success: true,
        spreadsheetId: result.spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${result.spreadsheetId}`,
        syncedAt: result.syncedAt,
        patientCount: result.patientCount,
        testHistoryCount: result.testHistoryCount,
      });
    } catch (error: any) {
      console.error("Patient sync error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/google/sync/billing", async (_req, res) => {
    try {
      const result = await runBillingSyncWithLock(true);
      if (!result) {
        res.json({ success: true, message: "Sync already in progress, queued" });
        return;
      }
      res.json({
        success: true,
        spreadsheetId: result.spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${result.spreadsheetId}`,
        syncedAt: result.syncedAt,
        recordCount: result.recordCount,
      });
    } catch (error: any) {
      console.error("Billing sync error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/google/drive/export-note", async (req, res) => {
    try {
      const { noteId } = req.body;
      if (!noteId || typeof noteId !== "number") {
        return res.status(400).json({ error: "noteId is required" });
      }

      const note = await storage.getGeneratedNote(noteId);
      if (!note) return res.status(404).json({ error: "Note not found" });

      const { uploadTextAsGoogleDoc, ensurePlexusFolderTree } = await import("./googleDrive");

      const sections = (note.sections as { heading: string; body: string }[]) || [];
      const content = sections
        .filter((s) => !s.heading.startsWith("__"))
        .map((s) => `${s.heading}\n${s.body}`)
        .join("\n\n");

      const filename = `${note.patientName} - ${note.title} (${note.scheduleDate || note.generatedAt.toISOString().split("T")[0]})`;

      const DRIVE_ANCILLARY_TYPES: readonly string[] = ["BrainWave", "VitalWave", "Ultrasound"];
      let clinicalDocsFolderId: string | undefined;
      if (note.facility && note.patientName && note.service && DRIVE_ANCILLARY_TYPES.includes(note.service)) {
        try {
          const tree = await ensurePlexusFolderTree(note.facility, note.patientName, note.service);
          clinicalDocsFolderId = tree.clinicalDocsFolderId;
        } catch (e) {
          console.warn("Could not resolve Drive folder for note export, uploading to root:", (e as Error).message);
        }
      }

      const { id: driveFileId, webViewLink } = await uploadTextAsGoogleDoc(filename, content, clinicalDocsFolderId);

      const updated = await storage.updateGeneratedNoteDriveInfo(noteId, driveFileId, webViewLink);

      res.json({
        success: true,
        driveFileId,
        webViewLink,
        note: updated,
      });
    } catch (error: any) {
      console.error("Drive export error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/google/drive/export-all", async (_req, res) => {
    try {
      const result = await runExportNotesWithLock(true);
      if (!result) {
        res.json({ success: true, message: "Export already in progress, queued" });
        return;
      }
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Drive export-all error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  type ValidAncillaryType = "BrainWave" | "VitalWave" | "Ultrasound";
  const VALID_ANCILLARY_TYPES: readonly ValidAncillaryType[] = ["BrainWave", "VitalWave", "Ultrasound"];

  function isValidFacility(f: string): f is typeof VALID_FACILITIES[number] {
    return (VALID_FACILITIES as readonly string[]).includes(f);
  }

  function isValidAncillaryType(a: string): a is ValidAncillaryType {
    return (VALID_ANCILLARY_TYPES as readonly string[]).includes(a);
  }

  app.get("/api/patients-by-facility", async (req, res) => {
    try {
      const facilityParam = req.query.facility;
      const facility = typeof facilityParam === "string" ? facilityParam : "";
      if (!isValidFacility(facility)) {
        return res.status(400).json({ error: "Valid facility is required" });
      }
      const batches = await storage.getAllScreeningBatches();
      const facilityBatches = batches.filter((b) => b.facility === facility);
      const nameSet = new Set<string>();
      for (const batch of facilityBatches) {
        const patients = await storage.getPatientScreeningsByBatch(batch.id);
        for (const p of patients) {
          if (p.name && p.name.trim()) nameSet.add(p.name.trim());
        }
      }
      const sorted = Array.from(nameSet).sort();
      res.json(sorted);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/google/drive/upload-report", upload.single("file"), async (req, res) => {
    try {
      const body = req.body as { facility?: string; patientName?: string; ancillaryType?: string };
      const { facility, patientName, ancillaryType } = body;
      if (!facility || !isValidFacility(facility)) {
        return res.status(400).json({ error: "Valid facility is required" });
      }
      if (!patientName || typeof patientName !== "string" || !patientName.trim()) {
        return res.status(400).json({ error: "patientName is required" });
      }
      if (!ancillaryType || !isValidAncillaryType(ancillaryType)) {
        return res.status(400).json({ error: "ancillaryType must be BrainWave, VitalWave, or Ultrasound" });
      }
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "PDF file is required" });
      }
      const isPdf =
        file.mimetype === "application/pdf" ||
        (file.originalname?.toLowerCase().endsWith(".pdf") ?? false);
      if (!isPdf) {
        return res.status(400).json({ error: "Only PDF files are accepted" });
      }

      const { ensurePlexusFolderTree, uploadPdfToFolder } = await import("./googleDrive");
      const tree = await ensurePlexusFolderTree(facility, patientName.trim(), ancillaryType);

      const filename = file.originalname || `${patientName.trim()} - ${ancillaryType} Report.pdf`;
      const { id: driveFileId, webViewLink } = await uploadPdfToFolder(filename, file.buffer, tree.reportFolderId);

      res.json({ success: true, driveFileId, webViewLink });
    } catch (error: any) {
      console.error("Report upload error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Document Upload (dedicated page) ---

  app.post("/api/documents/ocr-name", upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "PDF file is required" });

      let extractedText = "";
      try {
        const pdfParseModule = await import("pdf-parse");
        const pdfParseFn = (pdfParseModule as any).default || pdfParseModule;
        const pdfData = await pdfParseFn(file.buffer);
        extractedText = (pdfData.text || "").slice(0, 3000);
      } catch {
        extractedText = "";
      }

      const { openai, withRetry } = await import("./services/aiClient");
      const prompt = extractedText.trim().length > 20
        ? `Extract the patient's full name from the following medical document text. Return ONLY the patient name, nothing else. If no patient name is found, return "Unknown".\n\nDocument text:\n${extractedText}`
        : `This appears to be a scanned or image-based PDF with no readable text. Return "Unknown" as the patient name.`;

      const response = await withRetry(() =>
        openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 50,
        }),
        3,
        "ocr-name"
      );

      const patientName = (response.choices[0]?.message?.content || "").trim().replace(/^["']|["']$/g, "") || "Unknown";
      res.json({ patientName });
    } catch (error: any) {
      console.error("OCR name extraction error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/documents/upload", upload.single("file"), async (req, res) => {
    try {
      const body = req.body as { facility?: string; patientName?: string; ancillaryType?: string; docType?: string };
      const { facility, patientName, ancillaryType, docType } = body;
      if (!facility || !isValidFacility(facility)) {
        return res.status(400).json({ error: "Valid facility is required" });
      }
      if (!patientName || typeof patientName !== "string" || !patientName.trim()) {
        return res.status(400).json({ error: "patientName is required" });
      }
      if (!ancillaryType || !isValidAncillaryType(ancillaryType)) {
        return res.status(400).json({ error: "ancillaryType must be BrainWave, VitalWave, or Ultrasound" });
      }
      if (!docType || !["report", "informed_consent", "screening_form"].includes(docType)) {
        return res.status(400).json({ error: "docType must be 'report', 'informed_consent', or 'screening_form'" });
      }
      const file = req.file;
      if (!file) return res.status(400).json({ error: "PDF file is required" });
      const isPdf = file.mimetype === "application/pdf" || (file.originalname?.toLowerCase().endsWith(".pdf") ?? false);
      if (!isPdf) return res.status(400).json({ error: "Only PDF files are accepted" });

      const { ensurePlexusFolderTree, uploadPdfToFolder } = await import("./googleDrive");
      const tree = await ensurePlexusFolderTree(facility, patientName.trim(), ancillaryType);

      const folderId =
        docType === "informed_consent" ? tree.informedConsentFolderId :
        docType === "screening_form" ? tree.screeningFormFolderId :
        tree.reportFolderId;
      const typeLabel =
        docType === "informed_consent" ? "Informed Consent" :
        docType === "screening_form" ? "Screening Form" :
        "Report";
      const filename = file.originalname || `${patientName.trim()} - ${ancillaryType} ${typeLabel}.pdf`;
      const { id: driveFileId, webViewLink } = await uploadPdfToFolder(filename, file.buffer, folderId);

      const record = await storage.saveUploadedDocument({
        facility,
        patientName: patientName.trim(),
        ancillaryType,
        docType,
        driveFileId,
        driveWebViewLink: webViewLink || null,
      });

      backgroundSyncPatients();
      backgroundSyncBilling();
      void backgroundExportNotes();

      res.json({ success: true, record, driveFileId, webViewLink });
    } catch (error: any) {
      console.error("Document upload error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/documents/uploaded", async (_req, res) => {
    try {
      const records = await storage.getAllUploadedDocuments();
      res.json(records);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  async function getPlexusRootId(): Promise<string> {
    const { getUncachableGoogleDriveClient, getOrCreateFolder } = await import("./googleDrive");
    const { getSetting, setSetting } = await import("./dbSettings");
    const rootKey = "DRIVE_FOLDER_plexus_ancillary_platform";
    let rootId = await getSetting(rootKey);
    if (!rootId) {
      const drive = await getUncachableGoogleDriveClient();
      rootId = await getOrCreateFolder(drive, "Plexus Ancillary Platform");
      await setSetting(rootKey, rootId);
    }
    return rootId;
  }

  async function isDescendantOfRoot(
    drive: any,
    folderId: string,
    rootId: string
  ): Promise<boolean> {
    if (folderId === rootId) return true;
    let currentId = folderId;
    let depth = 0;
    while (currentId && depth < 15) {
      try {
        const resp = await drive.files.get({ fileId: currentId, fields: "parents" });
        const parents = resp.data.parents || [];
        if (parents.includes(rootId)) return true;
        currentId = parents[0] || "";
      } catch {
        return false;
      }
      depth++;
    }
    return false;
  }

  async function requireDriveConnected(res: any): Promise<boolean> {
    const { isGoogleDriveConnected } = await import("./googleDrive");
    const connected = await isGoogleDriveConnected();
    if (!connected) {
      res.status(503).json({ error: "Google Drive is not connected", connected: false });
      return false;
    }
    return true;
  }

  app.get("/api/plexus-drive/folder", async (req, res) => {
    try {
      if (!await requireDriveConnected(res)) return;
      const { getUncachableGoogleDriveClient } = await import("./googleDrive");

      const rootId = await getPlexusRootId();
      const requestedId = req.query.folderId as string | undefined;
      const targetFolderId = requestedId || rootId;

      if (targetFolderId !== rootId) {
        const drive = await getUncachableGoogleDriveClient();
        const inScope = await isDescendantOfRoot(drive, targetFolderId, rootId);
        if (!inScope) {
          return res.status(403).json({ error: "Folder is outside the Plexus Ancillary Platform tree" });
        }
      }

      const drive = await getUncachableGoogleDriveClient();
      const escapedId = targetFolderId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const listResp = await drive.files.list({
        q: `'${escapedId}' in parents and trashed = false`,
        fields: "files(id,name,mimeType,webViewLink,size,modifiedTime)",
        orderBy: "folder,name",
        pageSize: 200,
        spaces: "drive",
      });

      const files = (listResp.data.files || []).map((f) => ({
        id: f.id!,
        name: f.name!,
        mimeType: f.mimeType!,
        isFolder: f.mimeType === "application/vnd.google-apps.folder",
        webViewLink: f.webViewLink || null,
        size: f.size || null,
        modifiedTime: f.modifiedTime || null,
      }));

      res.json({ folderId: targetFolderId, files });
    } catch (error: any) {
      console.error("Plexus Drive folder error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/plexus-drive/search", async (req, res) => {
    try {
      if (!await requireDriveConnected(res)) return;
      const query = req.query.q as string;
      if (!query || query.trim().length < 1) {
        return res.status(400).json({ error: "Search query is required" });
      }

      const { getUncachableGoogleDriveClient } = await import("./googleDrive");
      const rootId = await getPlexusRootId();
      const drive = await getUncachableGoogleDriveClient();

      const escapedQuery = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const searchResp = await drive.files.list({
        q: `name contains '${escapedQuery}' and trashed = false`,
        fields: "files(id,name,mimeType,webViewLink,parents)",
        pageSize: 200,
        spaces: "drive",
      });

      const allFiles = searchResp.data.files || [];

      const buildPath = async (fileParents: string[] | undefined): Promise<string> => {
        if (!fileParents || fileParents.length === 0) return "";
        const parts: string[] = [];
        let currentId = fileParents[0];
        let depth = 0;
        while (currentId && depth < 10) {
          if (currentId === rootId) {
            parts.unshift("Plexus Ancillary Platform");
            break;
          }
          try {
            const parentResp = await drive.files.get({ fileId: currentId, fields: "id,name,parents" });
            parts.unshift(parentResp.data.name || "");
            currentId = parentResp.data.parents?.[0] || "";
          } catch {
            break;
          }
          depth++;
        }
        return parts.join(" / ");
      };

      const results: { id: string; name: string; mimeType: string; isFolder: boolean; webViewLink: string | null; path: string }[] = [];

      for (const file of allFiles) {
        const fileParents = file.parents || [];
        const pathStr = await buildPath(fileParents);
        if (!pathStr.startsWith("Plexus Ancillary Platform")) continue;

        results.push({
          id: file.id!,
          name: file.name!,
          mimeType: file.mimeType!,
          isFolder: file.mimeType === "application/vnd.google-apps.folder",
          webViewLink: file.webViewLink || null,
          path: pathStr,
        });
      }

      res.json({ results });
    } catch (error: any) {
      console.error("Plexus Drive search error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/plexus-drive/move", async (req, res) => {
    try {
      if (!await requireDriveConnected(res)) return;
      const { fileId, destinationFolderId } = req.body;
      if (!fileId || !destinationFolderId) {
        return res.status(400).json({ error: "fileId and destinationFolderId are required" });
      }

      const { getUncachableGoogleDriveClient } = await import("./googleDrive");
      const rootId = await getPlexusRootId();
      const drive = await getUncachableGoogleDriveClient();

      const [fileInScope, destInScope] = await Promise.all([
        isDescendantOfRoot(drive, fileId, rootId),
        isDescendantOfRoot(drive, destinationFolderId, rootId),
      ]);

      if (!fileInScope) {
        return res.status(403).json({ error: "Source file is outside the Plexus Ancillary Platform tree" });
      }
      if (!destInScope) {
        return res.status(403).json({ error: "Destination folder is outside the Plexus Ancillary Platform tree" });
      }

      const fileResp = await drive.files.get({ fileId, fields: "parents" });
      const currentParents = (fileResp.data.parents || []).join(",");

      await drive.files.update({
        fileId,
        addParents: destinationFolderId,
        removeParents: currentParents,
        fields: "id,parents",
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Plexus Drive move error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/plexus-drive/folder-tree", async (req, res) => {
    try {
      if (!await requireDriveConnected(res)) return;
      const { getUncachableGoogleDriveClient } = await import("./googleDrive");
      const rootId = await getPlexusRootId();
      const drive = await getUncachableGoogleDriveClient();

      const buildTree = async (folderId: string, depth: number): Promise<any[]> => {
        if (depth > 4) return [];
        const listResp = await drive.files.list({
          q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: "files(id,name)",
          orderBy: "name",
          pageSize: 100,
          spaces: "drive",
        });
        const folders = listResp.data.files || [];
        const result = [];
        for (const folder of folders) {
          const children = await buildTree(folder.id!, depth + 1);
          result.push({ id: folder.id!, name: folder.name!, children });
        }
        return result;
      };

      const children = await buildTree(rootId, 0);
      res.json({ id: rootId, name: "Plexus Ancillary Platform", children });
    } catch (error: any) {
      console.error("Plexus Drive folder-tree error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Qualification Mode Settings ───────────────────────────────────────────
  const VALID_QUAL_MODES = ["permissive", "standard", "conservative"] as const;
  const qualModeSchema = z.object({
    facility: z.enum(VALID_FACILITIES),
    mode: z.enum(VALID_QUAL_MODES),
  });

  app.get("/api/settings/qualification-modes", async (_req, res) => {
    try {
      const { getSetting } = await import("./dbSettings");
      const results: Record<string, string> = {};
      for (const facility of VALID_FACILITIES) {
        const key = facilityToSettingKey(facility);
        const val = await getSetting(key);
        results[facility] = val ?? "permissive";
      }
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/settings/qualification-modes", async (req, res) => {
    try {
      const parsed = qualModeSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const { facility, mode } = parsed.data;
      const { setSetting } = await import("./dbSettings");
      const key = facilityToSettingKey(facility);
      await setSetting(key, mode);
      res.json({ facility, mode });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/patients/:patientId/refresh-notes", async (req, res) => {
    try {
      const patientId = parseInt(req.params.patientId, 10);
      if (isNaN(patientId)) return res.status(400).json({ error: "Invalid patientId" });

      const patient = await storage.getPatientScreening(patientId);
      if (!patient) return res.status(404).json({ error: "Patient not found" });

      const batch = await storage.getScreeningBatch(patient.batchId);
      if (!batch) return res.status(404).json({ error: "Batch not found" });

      const { autoGeneratePatientNotesServer } = await import("./services/noteGenerationServer");

      const docs = await autoGeneratePatientNotesServer(patient, batch.scheduleDate, batch.facility, batch.clinicianName);

      if (docs.length === 0) {
        return res.json({ notes: [] });
      }

      await storage.deleteGeneratedNotesByPatient(patientId);

      const records = docs.map((doc) =>
        saveGeneratedNoteSchema.parse({
          patientId: patient.id,
          batchId: batch.id,
          facility: batch.facility ?? null,
          scheduleDate: batch.scheduleDate ?? null,
          patientName: patient.name,
          service: doc.service,
          docKind: doc.kind,
          title: doc.title,
          sections: doc.sections,
        })
      );

      const saved = await storage.saveGeneratedNotes(records);
      res.json({ notes: saved });
    } catch (error: any) {
      console.error("[refresh-notes] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  const generateJustificationSchema = z.object({
    patient: z.object({
      patientName: z.string(),
      dateOfBirth: z.string().optional(),
    }),
    service: z.enum(["VitalWave", "Ultrasound", "BrainWave", "PGx"]),
    selectedConditions: z.array(z.string()),
    notes: z.array(z.string()),
    icd10Codes: z.array(z.string()).optional(),
    cptCodes: z.array(z.string()).optional(),
  });

  app.post("/api/generate-justification", async (req, res) => {
    try {
      const parsed = generateJustificationSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });

      const { generateOpenAIJustificationPrompt } = await import("../shared/plexus");
      const { openai, withRetry } = await import("./services/aiClient");

      const prompt = generateOpenAIJustificationPrompt({
        patient: parsed.data.patient,
        service: parsed.data.service,
        selectedConditions: parsed.data.selectedConditions,
        notes: parsed.data.notes,
        icd10Codes: parsed.data.icd10Codes,
        cptCodes: parsed.data.cptCodes,
      });

      const response = await withRetry(
        () =>
          openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              {
                role: "system",
                content: "You are a CMS-certified medical scribe producing audit-ready clinical documentation. Output only the narrative text with no headings, bullet points, or preamble.",
              },
              { role: "user", content: prompt },
            ],
            temperature: 0.3,
            max_completion_tokens: 1200,
          }),
        3,
        "generateJustification"
      );

      const justification = response.choices[0]?.message?.content?.trim() || "";
      res.json({ justification });
    } catch (error: any) {
      console.error("[generate-justification] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai-select-conditions", async (req, res) => {
    try {
      const schema = z.object({
        patientId: z.number().int(),
        service: z.enum(["VitalWave", "Ultrasound", "BrainWave", "PGx"]),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });

      const { patientId, service } = parsed.data;
      const patient = await storage.getPatientScreening(patientId);
      if (!patient) return res.status(404).json({ error: "Patient not found" });

      const { VITALWAVE_CONFIG, ULTRASOUND_CONFIG, BRAINWAVE_MAPPING } = await import("../shared/plexus");
      const { openai, withRetry } = await import("./services/aiClient");

      let availableConditions: string[] = [];

      if (service === "VitalWave") {
        Object.values(VITALWAVE_CONFIG).forEach((group) => {
          group.conditions.forEach((c) => availableConditions.push(c.name));
        });
      } else if (service === "BrainWave") {
        availableConditions = Object.keys(BRAINWAVE_MAPPING);
      } else if (service === "Ultrasound") {
        Object.values(ULTRASOUND_CONFIG).forEach((cfg) => {
          cfg.conditions.forEach((c) => { if (c.name !== "Other") availableConditions.push(c.name); });
        });
        availableConditions = [...new Set(availableConditions)];
      } else {
        return res.json({ conditions: [] });
      }

      const clinicalData = [
        patient.diagnoses ? `Diagnoses: ${patient.diagnoses}` : null,
        patient.history ? `History/PMH: ${patient.history}` : null,
        patient.medications ? `Medications: ${patient.medications}` : null,
      ].filter(Boolean).join("\n");

      if (!clinicalData.trim()) {
        return res.json({ conditions: [] });
      }

      const prompt = `You are a clinical decision support tool. Given patient clinical data, select which conditions from the provided list apply to this patient. Be liberal — include any condition that has a reasonable clinical connection. Return ONLY a valid JSON array of condition names, exactly as spelled from the list. No explanation, no markdown.

Patient clinical data:
${clinicalData}

Available conditions for ${service}:
${availableConditions.map((c) => `- "${c}"`).join("\n")}

Return format: ["Condition Name 1", "Condition Name 2", ...]`;

      const response = await withRetry(
        () =>
          openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              { role: "system", content: "You are a clinical decision support tool. Return only valid JSON arrays." },
              { role: "user", content: prompt },
            ],
            temperature: 0.1,
            max_completion_tokens: 500,
          }),
        3,
        "aiSelectConditions"
      );

      const raw = response.choices[0]?.message?.content?.trim() || "[]";
      let selected: string[] = [];
      try {
        const cleaned = raw.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          selected = parsed.filter((c: unknown) => typeof c === "string" && availableConditions.includes(c));
        }
      } catch {
        console.warn("[ai-select-conditions] Failed to parse AI response:", raw);
      }

      res.json({ conditions: selected });
    } catch (error: any) {
      console.error("[ai-select-conditions] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
