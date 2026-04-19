import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db, pool } from "./db";
import { patientScreenings, billingRecords, screeningBatches } from "@shared/schema";
import { eq } from "drizzle-orm";
import multer from "multer";
import * as XLSX from "xlsx";
import { z } from "zod";
import { batchProcess } from "./replit_integrations/batch";
import {
  VALID_FACILITIES,
  extractDateFromPrevTests,
  facilityToSettingKey,
  getQualificationMode,
  createBatchSchema,
  addTestHistorySchema,
  addPatientSchema,
  updatePatientSchema,
  importTextSchema,
  saveGeneratedNoteSchema,
} from "./routes/helpers";
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
  enrichFromReferenceDb,
  parseReferenceImportWithAI,
  analyzeTestWithAI,
  extractPdfPatients,
  extractImagePatients,
} from "./services/screening";
import type { InsertBillingRecord } from "../shared/schema";
import { insertOutreachSchedulerSchema } from "../shared/schema";
import { registerTestHistoryRoutes } from "./routes/testHistory";
import { registerPatientReferenceRoutes } from "./routes/patientReferences";
import { registerGeneratedNotesRoutes } from "./routes/generatedNotes";
import { buildOutreachDashboard } from "./services/outreachService";
import { buildScheduleDashboard } from "./services/scheduleDashboardService";
import { getPlatformSettingsSnapshot } from "./services/platformSettingsService";
import {
  backgroundSyncPatients,
  backgroundSyncBilling,
} from "./services/syncService";
import { registerGoogleRoutes } from "./routes/google";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });



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
          await storage.updatePatientScreening(p.id, { status: "draft", qualifyingTests: [] });
        }
        console.warn(`[startup] Reset interrupted batch #${batch.id} → draft (${processingPatients.length} patients reset)`);
        resetCount++;
      }
    }
    if (resetCount > 0) {
      console.log(`[startup] Reset ${resetCount} interrupted batch(es) to draft status`);
    }
  } catch (startupErr: any) {
    console.error("[startup] Failed to reset stuck batches:", startupErr.message);
  }

  // ─── Fail any analysis_jobs still marked "running" from the previous process ─
  try {
    await storage.failRunningAnalysisJobs("Server restarted mid-analysis");
  } catch (jobErr: any) {
    console.error("[startup] Failed to fail interrupted analysis jobs:", jobErr.message);
  }

  // ─── Purge analysis_jobs older than 7 days ─────────────────────────────────
  try {
    await storage.purgeOldAnalysisJobs(7);
  } catch (purgeErr: any) {
    console.error("[startup] Failed to purge old analysis jobs:", purgeErr.message);
  }

  // ─── Auth endpoints (exempt from session requirement) ─────────────────────
  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }
    const user = await storage.validateUserPassword(username, password);
    if (!user) {
      return res.status(401).json({ message: "Invalid username or password" });
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    return res.json({ id: user.id, username: user.username });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    return res.json({ id: req.session.userId, username: req.session.username });
  });

  // ─── /api/healthz — pool telemetry (exempt from auth, mirrors /healthz) ───
  app.get("/api/healthz", async (_req, res) => {
    try {
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`SELECT 1`);
      res.json({
        status: "ok",
        db: {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        },
      });
    } catch {
      res.status(503).json({ status: "error", db: false });
    }
  });

  const requireAuth = (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    return next();
  };

  app.use("/api", requireAuth);

  // Register Google / Drive / Document routes (protected by requireAuth above)
  registerGoogleRoutes(app);

  registerTestHistoryRoutes(app, { backgroundSyncPatients });
  registerPatientReferenceRoutes(app, { backgroundSyncPatients });
  registerGeneratedNotesRoutes(app);

  // ─── First-boot seed: create admin/admin if no users exist ────────────────
  try {
    const count = await storage.getUserCount();
    if (count === 0) {
      await storage.createUser({ username: "admin", password: "admin" });
      console.warn("[auth] ⚠ No users found. Created default admin/admin account — CHANGE THIS PASSWORD IMMEDIATELY");
    }
  } catch (seedErr: any) {
    console.error("[auth] Failed to seed default admin account:", seedErr.message);
  }

  // ─── Health check (exempt from auth) ──────────────────────────────────────
  app.get("/healthz", async (_req, res) => {
    try {
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`SELECT 1`);
      res.json({
        status: "ok",
        db: {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        },
      });
    } catch {
      res.status(503).json({ status: "error", db: false });
    }
  });

  // ─── User management (admin-only) ─────────────────────────────────────────
  app.post("/api/users", async (req, res) => {
    if (req.session.username !== "admin") {
      return res.status(403).json({ message: "Forbidden — only the admin account can create users" });
    }
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }
    const existing = await storage.getUserByUsername(username);
    if (existing) {
      return res.status(409).json({ message: "Username already exists" });
    }
    const user = await storage.createUser({ username, password });
    return res.status(201).json({ id: user.id, username: user.username });
  });

  app.post("/api/auth/change-password", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "currentPassword and newPassword are required" });
    }
    const user = await storage.validateUserPassword(req.session.username!, currentPassword);
    if (!user) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }
    await storage.updateUserPassword(req.session.userId, newPassword);
    return res.json({ ok: true });
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
      const {
        name, time, age, gender, dob, phoneNumber,
        insurance, diagnoses, history, medications,
        previousTests, previousTestsDate, noPreviousTests,
        patientType, notes,
      } = parsed.data;

      const patient = await storage.createPatientScreening({
        batchId,
        name: name.trim(),
        time: time || null,
        age: age ? parseInt(String(age)) : null,
        gender: gender || null,
        dob: dob || null,
        phoneNumber: phoneNumber || null,
        insurance: insurance || null,
        facility: batch.facility || null,
        diagnoses: diagnoses || null,
        history: history || null,
        medications: medications || null,
        previousTests: previousTests || null,
        previousTestsDate: previousTestsDate || extractDateFromPrevTests(previousTests) || null,
        noPreviousTests: noPreviousTests ?? false,
        notes: notes || null,
        qualifyingTests: [],
        reasoning: {},
        status: "draft",
        appointmentStatus: "pending",
        patientType: patientType || (time ? "visit" : "outreach"),
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
          const pdfParseFn: any = (pdfParseModule as any).default ?? (pdfParseModule as any);
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

      const patientRows = allPatients.map((p) => ({
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
        noPreviousTests: p.noPreviousTests ?? false,
        notes: p.notes || null,
        qualifyingTests: [] as string[],
        reasoning: {} as Record<string, unknown>,
        status: "draft" as const,
        appointmentStatus: "pending" as const,
        patientType: (p.time ? "visit" : "outreach") as "visit" | "outreach",
      }));

      const created = patientRows.length > 0
        ? await db.transaction(async (tx) => tx.insert(patientScreenings).values(patientRows).returning())
        : [];

      await storage.updateScreeningBatch(batchId, {
        patientCount: (await storage.getPatientScreeningsByBatch(batchId)).length,
      });

      const createdIds = new Set(created.map((p) => p.id));
      const enrichedPatients = created.filter((p) => createdIds.has(p.id));

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

      const patientRows2 = patients.map((p) => ({
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
        noPreviousTests: p.noPreviousTests ?? false,
        notes: null as string | null,
        qualifyingTests: [] as string[],
        reasoning: {} as Record<string, unknown>,
        status: "draft" as const,
        appointmentStatus: "pending" as const,
        patientType: (p.time ? "visit" : "outreach") as "visit" | "outreach",
      }));

      const created2 = patientRows2.length > 0
        ? await db.transaction(async (tx) => tx.insert(patientScreenings).values(patientRows2).returning())
        : [];

      await storage.updateScreeningBatch(batchId, {
        patientCount: (await storage.getPatientScreeningsByBatch(batchId)).length,
      });

      res.json({ imported: created2.length, patients: created2 });
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
      if (data.noPreviousTests !== undefined) updates.noPreviousTests = data.noPreviousTests;
      if (data.notes !== undefined) updates.notes = data.notes || null;
      if (data.qualifyingTests !== undefined) updates.qualifyingTests = data.qualifyingTests;
      if (data.appointmentStatus !== undefined) updates.appointmentStatus = data.appointmentStatus || "pending";
      if (data.patientType !== undefined) updates.patientType = data.patientType || "visit";

      const patient = await storage.updatePatientScreening(id, updates);
      if (!patient) return res.status(404).json({ error: "Patient not found" });

      const wasAlreadyCompleted = previousPatient?.appointmentStatus?.toLowerCase() === "completed";
      if (data.appointmentStatus && data.appointmentStatus.toLowerCase() === "completed" && !wasAlreadyCompleted) {
        try {
          const qualTests: string[] = (data.selectedCompletedTests && data.selectedCompletedTests.length > 0)
            ? data.selectedCompletedTests
            : (patient.qualifyingTests || []);
          if (qualTests.length > 0) {
            const batch = await storage.getScreeningBatch(patient.batchId);
            const _d = new Date();
            const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;
            const dos = batch?.scheduleDate || today;
            const insuranceType = normalizeInsuranceType(patient.insurance || "");
            const clinic = batch?.facility || "NWPG";
            const records = qualTests.map((testName: string) => ({
              patientName: patient.name,
              testName,
              dateOfService: dos,
              insuranceType,
              clinic,
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

      const updated = await storage.updatePatientScreening(id, {
        qualifyingTests: qualTests,
        reasoning: match?.reasoning || {},
        cooldownTests: [],
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

      await db.transaction(async (tx) => {
        if (batch.status === "processing" || batch.status === "error") {
          await tx.update(screeningBatches).set({ status: "draft" }).where(eq(screeningBatches.id, batchId));
          const processingPatients = patients.filter((p) => p.status === "processing");
          for (const p of processingPatients) {
            await tx.update(patientScreenings).set({ status: "draft", qualifyingTests: [], reasoning: {} }).where(eq(patientScreenings.id, p.id));
          }
        }
        await tx.update(screeningBatches).set({ status: "processing" }).where(eq(screeningBatches.id, batchId));
      });

      const job = await storage.createAnalysisJob({
        batchId,
        status: "running",
        totalPatients: patients.length,
        completedPatients: 0,
      });

      res.json({ success: true, patientCount: patients.length, jobId: job.id, async: true });

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
          await storage.incrementAnalysisJobProgress(job.id).catch(() => {});
        },
        { concurrency: 5, retries: 3 }
      );

      await db.transaction(async (tx) => {
        await tx.update(screeningBatches).set({ status: "completed", patientCount: patients.length }).where(eq(screeningBatches.id, batchId));
      });
      await storage.updateAnalysisJob(job.id, { status: "completed", completedAt: new Date() });
    } catch (error: unknown) {
      console.error("Analysis error:", error);
      try {
        await db.transaction(async (tx) => {
          await tx.update(screeningBatches).set({ status: "error" }).where(eq(screeningBatches.id, batchId));
        });
      } catch (resetErr: unknown) {
        console.error("Failed to set batch status to error after analysis failure:", resetErr);
      }
      try {
        const failedJob = await storage.getLatestAnalysisJobByBatch(batchId);
        if (failedJob && failedJob.status === "running") {
          const errMsg = error instanceof Error ? error.message : "Unknown analysis error";
          await storage.updateAnalysisJob(failedJob.id, { status: "failed", errorMessage: errMsg, completedAt: new Date() });
        }
      } catch (jobErr: unknown) {
        console.error("Failed to mark analysis job as failed:", jobErr);
      }
    }
  });

  // ─── Analysis job status polling ───────────────────────────────────────────
  app.get("/api/batches/:id/analysis-status", async (req, res) => {
    try {
      const batchId = parseInt(req.params.id);
      const job = await storage.getLatestAnalysisJobByBatch(batchId);
      if (!job) {
        return res.json({
          status: "not_started",
          totalPatients: 0,
          completedPatients: 0,
          progress: "0/0",
          errorMessage: null,
        });
      }
      return res.json({
        id: job.id,
        batchId: job.batchId,
        status: job.status,
        totalPatients: job.totalPatients,
        completedPatients: job.completedPatients,
        progress: `${job.completedPatients}/${job.totalPatients}`,
        errorMessage: job.errorMessage ?? null,
        startedAt: job.startedAt,
        completedAt: job.completedAt ?? null,
      });
    } catch (error: any) {
      console.error("analysis-status error:", error.message);
      res.status(500).json({ error: "Failed to fetch analysis status" });
    }
  });

  // ─── Archive / Screening batches ───────────────────────────────────────────
  app.get("/api/archive", async (_req, res) => {
    try {
      const batches = await storage.getAllScreeningBatches();
      const result = await Promise.all(
        batches.map(async (batch) => {
          const patients = await storage.getPatientScreeningsByBatch(batch.id);
          return { ...batch, patients };
        })
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/outreach/dashboard", async (_req, res) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const dashboard = await buildOutreachDashboard(storage, today);
      res.json(dashboard);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message || "Failed to build outreach dashboard" });
    }
  });

  app.get("/api/outreach/schedulers", async (_req, res) => {
    try {
      const schedulers = await storage.getOutreachSchedulers();
      res.json(schedulers);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/outreach/schedulers", async (req, res) => {
    try {
      const parsed = insertOutreachSchedulerSchema.extend({
        facility: insertOutreachSchedulerSchema.shape.facility.refine(
          (f) => (VALID_FACILITIES as readonly string[]).includes(f),
          { message: "facility must be one of the three valid clinics" },
        ),
      }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const scheduler = await storage.createOutreachScheduler(parsed.data);
      res.status(201).json(scheduler);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/outreach/schedulers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const patchSchema = insertOutreachSchedulerSchema.partial().extend({
        facility: insertOutreachSchedulerSchema.shape.facility.refine(
          (f) => (VALID_FACILITIES as readonly string[]).includes(f),
          { message: "facility must be one of the three valid clinics" },
        ).optional(),
      });
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "No fields provided to update" });
      const updated = await storage.updateOutreachScheduler(id, parsed.data);
      if (!updated) return res.status(404).json({ error: "Scheduler not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/outreach/schedulers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const deleted = await storage.deleteOutreachScheduler(id);
      if (!deleted) return res.status(404).json({ error: "Scheduler not found" });
      res.json({ success: true, deleted });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });


  app.get("/api/settings/platform", async (_req, res) => {
    try {
      res.json(getPlatformSettingsSnapshot());
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load platform settings" });
    }
  });

  app.get("/api/schedule/dashboard", async (req, res) => {
    try {
      const weekStart =
        typeof req.query.weekStart === "string" && req.query.weekStart.trim().length > 0
          ? req.query.weekStart.trim()
          : undefined;
      const payload = await buildScheduleDashboard(storage, weekStart);
      res.json(payload);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load schedule dashboard" });
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

  const updateBillingRecordSchema = z.object({
    dateOfService: z.string().nullable().optional(),
    patientName: z.string().min(1).optional(),
    service: z.string().nullable().optional(),
    facility: z.string().nullable().optional(),
    dob: z.string().nullable().optional(),
    mrn: z.string().nullable().optional(),
    clinician: z.string().nullable().optional(),
    insuranceInfo: z.string().nullable().optional(),
    documentationStatus: z.string().nullable().optional(),
    billingStatus: z.string().nullable().optional(),
    response: z.string().nullable().optional(),
    paidStatus: z.string().nullable().optional(),
    balanceRemaining: z.string().nullable().optional(),
    dateSubmitted: z.string().nullable().optional(),
    followUpDate: z.string().nullable().optional(),
    paidAmount: z.string().nullable().optional(),
    insurancePaidAmount: z.string().nullable().optional(),
    secondaryPaidAmount: z.string().nullable().optional(),
    totalCharges: z.string().nullable().optional(),
    allowedAmount: z.string().nullable().optional(),
    patientResponsibility: z.string().nullable().optional(),
    adjustmentAmount: z.string().nullable().optional(),
    lastBillerUpdate: z.string().nullable().optional(),
    nextAction: z.string().nullable().optional(),
    billingNotes: z.string().nullable().optional(),
  });

  const createBillingRecordSchema = z.object({
    patientId: z.number().int().nullable().optional(),
    batchId: z.number().int().nullable().optional(),
    service: z.string().min(1),
    facility: z.string().nullable().optional(),
    dateOfService: z.string().nullable().optional(),
    patientName: z.string().min(1),
    dob: z.string().nullable().optional(),
    mrn: z.string().nullable().optional(),
    clinician: z.string().nullable().optional(),
    insuranceInfo: z.string().nullable().optional(),
  });

  app.post("/api/billing-records", async (req, res) => {
    try {
      const parsed = createBillingRecordSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const { patientId, batchId, service, facility, patientName, dob, mrn, clinician, insuranceInfo } = parsed.data;
      let { dateOfService } = parsed.data;

      // Canonical date rule: derive dateOfService from batch.scheduleDate when batchId is
      // present and the caller did not supply a date.
      if (!dateOfService && batchId != null) {
        const batch = await storage.getScreeningBatch(batchId);
        if (batch?.scheduleDate) {
          dateOfService = batch.scheduleDate;
        }
      }

      const record = await storage.createBillingRecord({
        patientId: patientId ?? null,
        batchId: batchId ?? null,
        service,
        facility: facility ?? null,
        dateOfService: dateOfService ?? null,
        patientName,
        dob: dob ?? null,
        mrn: mrn ?? null,
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

  app.post("/api/billing-records/import-from-sheet", async (_req, res) => {
    try {
      const { readSheetData } = await import("./integrations/googleSheets");
      const { getSetting } = await import("./dbSettings");

      // New 20-column layout matching "Plexus Billing Tracker":
      // 0:DOS, 1:Test, 2:Patient, 3:DOB, 4:MRN, 5:Clinician, 6:Insurance Info,
      // 7-11: computed doc cols (skip), 12:Primary Paid Amount, 13:Insurance Paid Amount,
      // 14:Secondary Paid Amount, 15:Patient Responsibility Amount, 16:Claim Status,
      // 17:Last Biller Update, 18:Next Action, 19:Billing Notes
      const COL_MAP: Record<number, keyof import("../shared/schema").InsertBillingRecord> = {
        0: "dateOfService",
        1: "service",
        2: "patientName",
        3: "dob",
        4: "mrn",
        5: "clinician",
        6: "insuranceInfo",
        // 7-11 are computed doc status columns — skip
        12: "paidAmount",
        13: "insurancePaidAmount",
        14: "secondaryPaidAmount",
        15: "patientResponsibility",
        16: "billingStatus",
        17: "lastBillerUpdate",
        18: "nextAction",
        19: "billingNotes",
      };

      const spreadsheetId = (await getSetting("BILLING_SPREADSHEET_ID")) ||
        (await getSetting("GOOGLE_SHEETS_BILLING_ID")) ||
        process.env.GOOGLE_SHEETS_BILLING_ID || null;

      if (!spreadsheetId) {
        return res.json({ success: true, created: 0, updated: 0, skipped: 0, total: 0, message: "No billing spreadsheet configured." });
      }

      let rows: string[][];
      try {
        rows = await readSheetData(spreadsheetId, "Billing Records");
      } catch (e) {
        return res.status(500).json({ error: `Could not read billing sheet: ${(e as Error).message}` });
      }

      if (rows.length < 2) {
        return res.json({ success: true, created: 0, updated: 0, skipped: 0, total: 0, message: "Sheet has no data rows." });
      }

      const existingRecords = await storage.getAllBillingRecords();
      const seenKeys = new Set<string>(
        existingRecords.map((r) =>
          `${r.patientName.toLowerCase()}|${r.dateOfService ?? ""}|${r.service}`
        )
      );
      let created = 0;
      let updated = 0;
      let skipped = 0;

      type BillingCreateOp = import("../shared/schema").InsertBillingRecord;
      type BillingUpdateOp = { id: number; updates: Partial<import("../shared/schema").InsertBillingRecord> };
      const createOps: BillingCreateOp[] = [];
      const updateOps: BillingUpdateOp[] = [];

      const dataRows = rows.slice(1);

      for (const row of dataRows) {
        const patientName = row[2]?.trim() || "";
        const service = row[1]?.trim() || "";
        if (!patientName || !service) { skipped++; continue; }

        const dateOfService = row[0]?.trim() || null;
        const rowKey = `${patientName.toLowerCase()}|${dateOfService ?? ""}|${service}`;

        const existing = existingRecords.find((r) =>
          r.patientName.toLowerCase() === patientName.toLowerCase() &&
          (r.dateOfService ?? "") === (dateOfService ?? "") &&
          r.service === service
        );

        const updates: Partial<import("../shared/schema").InsertBillingRecord> = {};
        for (const [colStr, field] of Object.entries(COL_MAP)) {
          const val = row[parseInt(colStr)]?.trim() || null;
          (updates as Record<string, string | null>)[field as string] = val;
        }

        if (existing) {
          updateOps.push({ id: existing.id, updates });
          updated++;
        } else if (!seenKeys.has(rowKey)) {
          seenKeys.add(rowKey);
          createOps.push({
            patientId: null,
            batchId: null,
            patientName,
            service,
            dateOfService: updates.dateOfService ?? null,
            dob: updates.dob ?? null,
            mrn: updates.mrn ?? null,
            clinician: updates.clinician ?? null,
            insuranceInfo: updates.insuranceInfo ?? null,
            billingStatus: updates.billingStatus ?? null,
            paidAmount: updates.paidAmount ?? null,
            insurancePaidAmount: updates.insurancePaidAmount ?? null,
            secondaryPaidAmount: updates.secondaryPaidAmount ?? null,
            patientResponsibility: updates.patientResponsibility ?? null,
            lastBillerUpdate: updates.lastBillerUpdate ?? null,
            nextAction: updates.nextAction ?? null,
            billingNotes: updates.billingNotes ?? null,
          });
          created++;
        } else {
          skipped++;
        }
      }

      if (createOps.length > 0 || updateOps.length > 0) {
        await db.transaction(async (tx) => {
          if (createOps.length > 0) {
            await tx.insert(billingRecords).values(createOps);
          }
          for (const { id, updates } of updateOps) {
            await tx.update(billingRecords).set(updates).where(eq(billingRecords.id, id));
          }
        });
      }

      res.json({ success: true, created, updated, skipped, total: created + updated });
    } catch (error: any) {
      console.error("Import from sheet error:", error);
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

      const docs = await autoGeneratePatientNotesServer({ ...patient, reasoning: (patient.reasoning ?? null) as Record<string, unknown> | null }, batch.scheduleDate, batch.facility, batch.clinicianName);

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
        qualifyingTests: z.array(z.string()).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });

      const { patientId, service, qualifyingTests: clientQualifyingTests } = parsed.data;
      const patient = await storage.getPatientScreening(patientId);
      if (!patient) return res.status(404).json({ error: "Patient not found" });

      const { VITALWAVE_CONFIG, ULTRASOUND_CONFIG, BRAINWAVE_MAPPING } = await import("../shared/plexus");
      const { openai, withRetry } = await import("./services/aiClient");

      const qualifyingTests: string[] = clientQualifyingTests || (patient.qualifyingTests as string[]) || [];
      const reasoning = (patient.reasoning || {}) as Record<string, { clinician_understanding?: string; qualifying_factors?: string[] } | string>;

      let availableConditions: string[] = [];

      if (service === "VitalWave") {
        Object.values(VITALWAVE_CONFIG).forEach((group) => {
          group.conditions.forEach((c) => availableConditions.push(c.name));
        });
      } else if (service === "BrainWave") {
        availableConditions = Object.keys(BRAINWAVE_MAPPING);
      } else if (service === "Ultrasound") {
        const TEST_TO_US_TYPE: Record<string, string> = {
          "Bilateral Carotid Duplex": "Carotid Duplex",
          "Echocardiogram TTE": "Echocardiogram TTE",
          "Renal Artery Doppler": "Renal Artery Duplex",
          "Lower Extremity Arterial Doppler": "Lower Extremity Arterial",
          "Lower Extremity Venous Duplex": "Lower Extremity Venous",
          "Abdominal Aortic Aneurysm Duplex": "Abdominal Aorta",
          "Stress Echocardiogram": "Stress Echocardiogram",
          "Upper Extremity Arterial Doppler": "Upper Extremity Arterial",
          "Upper Extremity Venous Duplex": "Upper Extremity Venous",
        };
        const selectedUsTypes = new Set<string>();
        qualifyingTests.forEach((t) => {
          const mapped = TEST_TO_US_TYPE[t];
          if (mapped && ULTRASOUND_CONFIG[mapped]) { selectedUsTypes.add(mapped); return; }
          Object.keys(ULTRASOUND_CONFIG).forEach((type) => {
            if (t.toLowerCase().includes(type.toLowerCase()) || type.toLowerCase().includes(t.toLowerCase())) {
              selectedUsTypes.add(type);
            }
          });
        });
        const typesToUse = selectedUsTypes.size > 0 ? Array.from(selectedUsTypes) : Object.keys(ULTRASOUND_CONFIG);
        typesToUse.forEach((type) => {
          const cfg = ULTRASOUND_CONFIG[type];
          if (cfg) cfg.conditions.forEach((c) => { if (c.name !== "Other") availableConditions.push(c.name); });
        });
        availableConditions = Array.from(new Set(availableConditions));
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

      const reasoningContext: string[] = [];
      qualifyingTests.forEach((t) => {
        const r = reasoning[t];
        if (r && typeof r === "object") {
          if (r.clinician_understanding) reasoningContext.push(`${t}: ${r.clinician_understanding}`);
          else if (r.qualifying_factors?.length) reasoningContext.push(`${t} factors: ${r.qualifying_factors.join(", ")}`);
        }
      });

      const prompt = `You are a clinical decision support tool. Given patient clinical data, select which conditions from the provided list apply to this patient. Be liberal — include any condition that has a reasonable clinical connection. Return ONLY a valid JSON array of condition names, exactly as spelled from the list. No explanation, no markdown.

Patient clinical data:
${clinicalData}${reasoningContext.length > 0 ? `\n\nAI qualifying context:\n${reasoningContext.join("\n")}` : ""}

Qualifying tests: ${qualifyingTests.join(", ") || "None"}

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

  app.post("/api/parse-patient-paste", async (req, res) => {
    try {
      const schema = z.object({ text: z.string().min(1).max(10000) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });

      const { openai, withRetry } = await import("./services/aiClient");

      const prompt = `You are a clinical data extractor for a medical office. Your job is to pull as much patient information as possible from raw pasted text — EHR notes, schedule entries, demographics, problem lists, visit notes, insurance cards, or any mix. Be GENEROUS and AGGRESSIVE in extraction: if clinical data is present in any form, include it.

Extract all available fields and return ONLY a valid JSON object. Omit a field only if that information is completely absent from the text.

Fields to extract:
{
  "name": "Patient name in LAST, FIRST format (all caps preferred). Look for any name-like pattern.",
  "dob": "Date of birth as YYYY-MM-DD or MM/DD/YYYY. Look for DOB:, born, birth date, or date patterns near 'DOB'.",
  "phone": "Phone number as a string. Look for phone, cell, mobile, tel, contact number.",
  "insurance": "Insurance payer or plan name. Look for insurance, payer, carrier, plan, coverage, MCO, HMO, PPO.",
  "diagnoses": "Comma-separated list of ACTIVE medical conditions and diagnoses ONLY — disease names, ICD descriptions, problem list items, Assessment/Plan conditions. Examples: HTN, DM2, HLD, CAD, CKD, peripheral artery disease, chest pain, shortness of breath. CRITICAL: Do NOT include medication names, drug names, dosages, test names, imaging study names, or previous test results here — those go in medications or previousTests.",
  "history": "Summary of past medical history. Include PMH:, past history, prior conditions, previous illnesses, past surgeries, prior hospitalizations, family history if notable. Examples: MI 2019, CABG 2020, stroke 2021, appendectomy.",
  "medications": "Comma-separated list of ALL medications mentioned. Include Rx:, medications:, meds:, current meds, drug names with or without dosage. Examples: Metformin 1000mg, Lisinopril 10mg, Atorvastatin, aspirin 81mg.",
  "previousTests": "Comma-separated list of prior diagnostic tests or imaging with dates if available. Scan the ENTIRE note — look for prior studies, past imaging, previous EKGs, prior echos, dopplers, ABIs, stress tests, ultrasounds, BrainWave, VitalWave, Carotid Duplex, Echocardiogram, Renal Artery Doppler, LE Arterial Doppler, LE Venous Duplex, Abdominal Aorta — even if mentioned inline without a label. Example entries: 'COMPLETED ✅ - BrainWave on 04/01/2026', 'Echo TTE 01/2024', 'Carotid Duplex 06/2023'. If you find any of these anywhere in the text, put them here.",
  "previousTestsDate": "Date of the most recent previous test in YYYY-MM-DD format."
}

Critical rules:
- FIELD BOUNDARIES are strict: diagnoses = medical conditions only; medications = drugs only; previousTests = prior studies/imaging only. Never mix them.
- For "diagnoses": include everything from problem lists, assessment sections, chief complaint, HPI, BUT strip out any drug names or test/imaging references — those belong elsewhere.
- For "previousTests": be AGGRESSIVE — search the full note for any mention of a previously performed test or imaging study, labeled or not.
- For "medications": include every drug name you see, with or without dose.
- For "history": include PMH, surgical history, relevant family history.
- Omit a field ONLY if that information is truly not present anywhere in the text.
- For "name": use LAST, FIRST all-caps if possible.
- Return ONLY the JSON object, no explanation, no markdown, no code fences.

Raw text:
${parsed.data.text}`;

      const response = await withRetry(
        () => openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are an aggressive clinical data extractor for a medical office. Extract every piece of patient information from the text. Output only valid JSON, no explanation." },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
          max_completion_tokens: 1200,
        }),
        2,
        "parsePatientPaste"
      );

      const raw = response.choices[0]?.message?.content?.trim() || "{}";
      let result: Record<string, string> = {};
      try {
        const cleaned = raw.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
        const obj = JSON.parse(cleaned);
        const allowedKeys = ["name", "dob", "phone", "insurance", "diagnoses", "history", "medications", "previousTests", "previousTestsDate"];
        allowedKeys.forEach((k) => {
          if (obj[k] && typeof obj[k] === "string" && obj[k].trim()) {
            result[k] = obj[k].trim();
          }
        });
      } catch {
        console.warn("[parse-patient-paste] Failed to parse AI response:", raw);
      }

      res.json({ fields: result });
    } catch (error: any) {
      console.error("[parse-patient-paste] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Appointments ──────────────────────────────────────────────────────────
  app.get("/api/appointments", async (req, res) => {
    try {
      const { facility, date, testType, status, upcoming } = req.query as Record<string, string>;
      if (upcoming === "true") {
        const parsedLimit = parseInt(req.query.limit as string);
        const limitParam = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
        const appts = await storage.getUpcomingAppointments(limitParam);
        return res.json(appts);
      }
      const appts = await storage.getAppointments({ facility, date, testType, status });
      res.json(appts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/appointments", async (req, res) => {
    try {
      const schema = z.object({
        patientScreeningId: z.number().int().nullable().optional(),
        patientName: z.string().min(1),
        facility: z.enum(VALID_FACILITIES),
        scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        scheduledTime: z.string().regex(/^\d{2}:\d{2}$/),
        testType: z.string().min(1),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });

      const { patientScreeningId, patientName, facility, scheduledDate, scheduledTime, testType } = parsed.data;

      // Canonical date guard: when patientScreeningId is provided, validate scheduledDate
      // matches the patient's batch.scheduleDate (the single source of truth).
      if (patientScreeningId != null) {
        const patient = await storage.getPatientScreening(patientScreeningId);
        if (patient) {
          const batch = await storage.getScreeningBatch(patient.batchId);
          if (batch?.scheduleDate && batch.scheduleDate !== scheduledDate) {
            console.warn(
              `[appointments] canonical date mismatch: patient ${patientScreeningId} batch scheduleDate=${batch.scheduleDate} but scheduledDate=${scheduledDate}. Allowing with warning.`
            );
          }
        }
      }

      // Duplicate slot check: same facility+date+time+testType must not already be scheduled
      const existing = await storage.getAppointments({ facility, date: scheduledDate, testType, status: "scheduled" });
      const duplicate = existing.find((a) => a.scheduledTime === scheduledTime);
      if (duplicate) {
        return res.status(409).json({ error: "That time slot is already booked." });
      }

      const appt = await storage.createAppointment({
        patientScreeningId: patientScreeningId ?? null,
        patientName,
        facility,
        scheduledDate,
        scheduledTime,
        testType,
        status: "scheduled",
      });
      res.json(appt);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/appointments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const schema = z.object({ status: z.enum(["scheduled", "cancelled"]) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });

      if (parsed.data.status === "cancelled") {
        const appt = await storage.cancelAppointment(id);
        if (!appt) return res.status(404).json({ error: "Appointment not found" });
        return res.json(appt);
      }
      res.status(400).json({ error: "Only cancellation is supported via PATCH" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/appointments/patient/:patientId", async (req, res) => {
    try {
      const patientId = parseInt(req.params.patientId);
      const appts = await storage.getAppointmentsByPatient(patientId);
      res.json(appts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
