import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import * as XLSX from "xlsx";
import { z } from "zod";
import { batchProcess } from "./replit_integrations/batch";
import {
  parseWithAI,
  excelToText,
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
          allPatients.push(...await parseWithAI(excelToText(file.buffer)));
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
        });
      } catch (aiErr: any) {
        console.error(`AI screening failed for patient ${patient.name}:`, aiErr.message);
        await storage.updatePatientScreening(id, { status: "error" });
        return res.status(500).json({ error: "AI analysis failed after retries" });
      }

      const qualTests = match?.qualifyingTests || [];

      let cooldownData: any = null;
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

      if (patientsForCooldown.length > 0) {
        try {
          const visitDate = batch?.scheduleDate || undefined;
          const cooldownResults = await checkCooldownsForPatients(patientsForCooldown, visitDate);
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
  ];

  const updateBillingRecordSchema = z.object({
    dateOfService: z.string().nullable().optional(),
    patientName: z.string().nullable().optional(),
    clinician: z.string().nullable().optional(),
    facility: z.string().nullable().optional(),
    report: z.string().nullable().optional(),
    insuranceInfo: z.string().nullable().optional(),
    historicalProblemList: z.string().nullable().optional(),
    comments: z.string().nullable().optional(),
    billing: z.string().nullable().optional(),
    nextAncillaries: z.string().nullable().optional(),
    billingComments: z.string().nullable().optional(),
    paid: z.boolean().nullable().optional(),
    ptResponsibility: z.string().nullable().optional(),
    billingComments2: z.string().nullable().optional(),
    nextgenAppt: z.string().nullable().optional(),
    billed: z.boolean().nullable().optional(),
    drImranComments: z.string().nullable().optional(),
    response: z.string().nullable().optional(),
    nwpgInvoiceSent: z.boolean().nullable().optional(),
    paidFinal: z.boolean().nullable().optional(),
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

      for (const { patient, batch } of allScreenedPatients) {
        const tests: string[] = patient.qualifyingTests || [];
        const services: string[] = [];
        if (tests.includes("BrainWave")) services.push("BrainWave");
        if (tests.includes("VitalWave")) services.push("VitalWave");
        if (tests.some((t: string) => ULTRASOUND_TESTS.includes(t))) services.push("Ultrasound");

        for (const service of services) {
          const existing = await storage.getBillingRecordByPatientAndService(patient.id, service);
          if (!existing) {
            await storage.createBillingRecord({
              patientId: patient.id,
              batchId: batch.id,
              service,
              facility: batch.facility || null,
              dateOfService: batch.scheduleDate || null,
              patientName: patient.name,
              clinician: batch.clinicianName || null,
            });
          }
        }
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
  });

  app.post("/api/billing-records", async (req, res) => {
    try {
      const parsed = createBillingRecordSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const { patientId, batchId, service, facility, dateOfService, patientName, clinician } = parsed.data;
      const record = await storage.createBillingRecord({
        patientId: patientId ?? null,
        batchId: batchId ?? null,
        service,
        facility: facility ?? null,
        dateOfService: dateOfService ?? null,
        patientName,
        clinician: clinician ?? null,
      });
      res.status(201).json(record);
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
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/billing-records/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteBillingRecord(id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
