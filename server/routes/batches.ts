import type { Express } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { storage } from "../storage";
import { db } from "../db";
import { patientScreenings, screeningBatches } from "@shared/schema";
import { eq } from "drizzle-orm";
import { batchProcess } from "../replit_integrations/batch";
import {
  createBatchSchema,
  addPatientSchema,
  importTextSchema,
  extractDateFromPrevTests,
  getQualificationMode,
} from "./helpers";
import {
  parseWithAI,
  parseExcelFile,
  csvToText,
} from "../services/ingest";
import {
  screenSinglePatientWithAI,
  extractPdfPatients,
  extractImagePatients,
} from "../services/screening";
import { logAudit } from "../services/auditService";
import {
  findSchedulerForBatch,
  createAssignmentTask,
} from "../services/schedulerAssignmentService";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export function registerBatchRoutes(app: Express) {
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
      void logAudit(req, "create", "batch", batch.id, { name: batch.name, facility: batch.facility });

      const assignment = await findSchedulerForBatch(
        parsed.data.facility || null,
        parsed.data.scheduleDate || null,
      );

      if (!assignment.requiresManualAssignment) {
        if (assignment.scheduler) {
          await storage.updateScreeningBatch(batch.id, { assignedSchedulerId: assignment.scheduler.id });
          await createAssignmentTask(batch.id, batch.name, assignment.scheduler.id);
          return res.json({
            ...batch,
            assignedSchedulerId: assignment.scheduler.id,
            assignedScheduler: assignment.scheduler,
            requiresManualAssignment: false,
          });
        } else {
          await createAssignmentTask(batch.id, batch.name, null);
          return res.json({
            ...batch,
            assignedSchedulerId: null,
            requiresManualAssignment: false,
          });
        }
      }

      return res.json({
        ...batch,
        requiresManualAssignment: assignment.requiresManualAssignment,
        availableSchedulers: assignment.availableSchedulers,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/batches/:id/assign-scheduler", async (req, res) => {
    try {
      const batchId = parseInt(req.params.id);
      const batch = await storage.getScreeningBatch(batchId);
      if (!batch) return res.status(404).json({ error: "Batch not found" });

      const { schedulerId } = req.body;
      const schedulerIdNum = schedulerId != null ? parseInt(String(schedulerId)) : null;

      const allSchedulers = await storage.getOutreachSchedulers();
      const assignedScheduler = schedulerIdNum != null
        ? allSchedulers.find((s) => s.id === schedulerIdNum) ?? null
        : null;

      if (schedulerIdNum != null && !assignedScheduler) {
        return res.status(404).json({ error: "Scheduler not found" });
      }

      if (schedulerIdNum != null && assignedScheduler && batch.facility && assignedScheduler.facility !== batch.facility) {
        return res.status(400).json({ error: "Scheduler facility does not match batch facility" });
      }

      const updated = await storage.updateScreeningBatch(batchId, {
        assignedSchedulerId: schedulerIdNum,
      });

      const task = await createAssignmentTask(batchId, batch.name, schedulerIdNum);

      if (task) {
        void storage.writeEvent({
          taskId: task.id,
          projectId: null,
          userId: req.session.userId ?? null,
          eventType: "scheduler_assigned",
          payload: { batchId, schedulerName: assignedScheduler?.name ?? "Unassigned" },
        });
      }

      void logAudit(req, "update", "batch", batchId, { assignedSchedulerId: schedulerIdNum });

      return res.json({ ...updated, assignedScheduler });
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

      void logAudit(req, "create", "patient", patient.id, { name: patient.name, batchId });
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
      let assignedScheduler = null;
      if (batch.assignedSchedulerId) {
        const schedulers = await storage.getOutreachSchedulers();
        assignedScheduler = schedulers.find((s) => s.id === batch.assignedSchedulerId) ?? null;
      }
      res.json({ ...batch, patients, assignedScheduler });
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
      void logAudit(req, "delete", "batch", id, null);
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
}
