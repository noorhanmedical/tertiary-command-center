import type { Express } from "express";
import multer from "multer";
import { z } from "zod";
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

// Plexus IQ runtime hardening — Routes step 4: placement on Add Patient.
//
// Wire shape matches the Clinical Import surface in
// `plexusIqClinicalImport.ts` (camelCase `newRun`). Defaults are NOT
// applied at the schema level — the handler defaults to `newRun` to
// preserve today's "create a fresh batch each time" behavior. The UI
// placement dialog will start sending an explicit mode in a later block.
const batchPlacementSchema = z.object({
  mode: z.enum(["append", "newRun"]),
  targetBatchId: z.number().int().positive().optional(),
});
import { getAncillaryCategory } from "@shared/ancillaryCategory";
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
  resolveAndLinkPlexusIdentityForScreening,
  resolveAndLinkPlexusIdentityForScreeningsBulk,
  recordScreeningIdentityLinkFailure,
} from "../services/plexusIdentity/screeningIntegration";
import { invalidatePatientDatabase } from "./patientDatabase";
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

      // Plexus IQ runtime hardening — Routes step 4.
      // Placement is optional on the wire. When absent, default to
      // `newRun` so today's callers (every UI today) see no behavior
      // change. The placement is parsed in isolation so an unknown
      // shape on the existing payload doesn't trip createBatchSchema.
      const placementParsed = batchPlacementSchema.safeParse(req.body?.placement);
      if (req.body?.placement !== undefined && !placementParsed.success) {
        return res.status(400).json({
          error: placementParsed.error.errors[0]?.message || "Invalid placement",
        });
      }
      const placement: z.infer<typeof batchPlacementSchema> = placementParsed.success
        ? placementParsed.data
        : { mode: "newRun" };

      // append: reuse an existing batch. No new screening_batches row.
      // No scheduler reassignment — the existing batch keeps whatever
      // scheduler it was already assigned to.
      if (placement.mode === "append") {
        if (placement.targetBatchId == null) {
          return res.status(400).json({
            error: "placement.targetBatchId is required when placement.mode is 'append'",
          });
        }
        const target = await storage.getScreeningBatch(placement.targetBatchId);
        if (!target) {
          return res.status(400).json({
            error: `targetBatchId ${placement.targetBatchId} not found`,
          });
        }
        if (target.facility !== parsed.data.facility) {
          return res.status(400).json({
            error: `targetBatchId ${placement.targetBatchId} belongs to facility "${target.facility ?? ""}", expected "${parsed.data.facility}"`,
          });
        }
        const expectedDate = parsed.data.scheduleDate ?? null;
        if ((target.scheduleDate ?? null) !== expectedDate) {
          return res.status(400).json({
            error: `targetBatchId ${placement.targetBatchId} has scheduleDate "${target.scheduleDate ?? ""}", expected "${expectedDate ?? ""}"`,
          });
        }
        void logAudit(req, "append", "batch", target.id, {
          name: target.name,
          facility: target.facility,
          via: "placement.append",
        });
        return res.json({
          ...target,
          // Surface that this was an append, not a create, so the
          // client UI can distinguish ("added to existing run") from
          // a fresh run. Existing fields stay where callers expect.
          placement: { mode: "append", targetBatchId: target.id },
          created: false,
          requiresManualAssignment: false,
        });
      }

      // newRun: create a fresh batch. If siblings already exist for
      // the same facility/scheduleDate AND the caller did not pass an
      // explicit name, append `(Run N)` so the new run is
      // distinguishable in lists. Today's callers don't pass a name
      // either, so this only kicks in when there's already a sibling.
      let name = parsed.data.name ?? "";
      if (!name) {
        const existing = await storage.getAllScreeningBatches();
        const siblings = existing.filter(
          (b) =>
            b.facility === parsed.data.facility &&
            (b.scheduleDate ?? null) === (parsed.data.scheduleDate ?? null),
        );
        if (siblings.length > 0 && parsed.data.scheduleDate) {
          name = `${parsed.data.facility} - ${parsed.data.scheduleDate} (Run ${siblings.length + 1})`;
        } else {
          name = `Batch - ${new Date().toLocaleDateString()}`;
        }
      }

      // Clinician attribution (Plexus IQ). Validate the free-text contract:
      // when clinicianSource is "free_text" a non-blank clinicianName is
      // required; when "facility_clinician" a clinicianId is required. Absent
      // clinician context is fine (legacy / not recorded).
      const clinicianSource = parsed.data.clinicianSource ?? null;
      const clinicianNameTrimmed = parsed.data.clinicianName?.trim() || null;
      if (clinicianSource === "free_text" && !clinicianNameTrimmed) {
        return res.status(400).json({ error: "clinicianName is required when clinicianSource is 'free_text'" });
      }
      if (clinicianSource === "facility_clinician" && parsed.data.clinicianId == null) {
        return res.status(400).json({ error: "clinicianId is required when clinicianSource is 'facility_clinician'" });
      }

      const batch = await storage.createScreeningBatch({
        name,
        patientCount: 0,
        status: "draft",
        facility: parsed.data.facility || null,
        scheduleDate: parsed.data.scheduleDate || null,
        clinicianId: clinicianSource === "facility_clinician" ? (parsed.data.clinicianId ?? null) : null,
        clinicianName: clinicianNameTrimmed,
        clinicianSource,
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
        patientType, notes, qualifyingTests, reasoning,
      } = parsed.data;

      // When the caller supplies pre-computed qualification (e.g. the portal
      // quick-qualify "Add to schedule" flow), persist those tests + reasoning
      // and land the patient as already-completed so the result isn't wiped.
      const hasPrecomputedQualification = Array.isArray(qualifyingTests);

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
        qualifyingTests: hasPrecomputedQualification ? qualifyingTests : [],
        reasoning: (reasoning as Record<string, unknown>) || {},
        status: hasPrecomputedQualification ? "completed" : "draft",
        appointmentStatus: "pending",
        patientType: patientType || (time ? "visit" : "outreach"),
      });

      await storage.updateScreeningBatch(batchId, {
        patientCount: (await storage.getPatientScreeningsByBatch(batchId)).length,
      });

      // Phase 2A — shared identity orchestration. No-op when
      // FEATURE_PLEXUS_IDENTITY_WRITE is OFF (default). Awaited so any
      // schema-configuration failure surfaces here rather than being
      // dropped by a fire-and-forget promise. On failure we record a
      // durable retry-ledger row so the failure survives process
      // restarts and can be picked up by the reconciliation service.
      try {
        await resolveAndLinkPlexusIdentityForScreening({
          screeningId: patient.id,
          clinicId: patient.clinicId ?? req.clinicId ?? null,
          sourceSystem: "batch_add_patient",
          demographics: {
            displayName: patient.name,
            dob: patient.dob,
            phone: patient.phoneNumber,
            email: patient.email ?? null,
          },
        });
      } catch (e) {
        const errorCode = (e as { code?: string })?.code;
        console.error(JSON.stringify({
          level: "error",
          source: "plexus_identity_integration",
          route: "POST /api/batches/:id/patients",
          screeningId: patient.id,
          code: errorCode,
          message: (e as Error)?.message ?? String(e),
        }));
        await recordScreeningIdentityLinkFailure({
          screeningId: patient.id,
          clinicId: patient.clinicId ?? req.clinicId ?? null,
          sourceSystem: "batch_add_patient",
          errorCode,
        });
      }

      void logAudit(req, "create", "patient", patient.id, { name: patient.name, batchId });
      invalidatePatientDatabase();
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

      // Phase 2A — bulk identity orchestration. Bulk helper short-
      // circuits when FEATURE_PLEXUS_IDENTITY_WRITE is OFF, so this
      // adds zero latency to the current import path.
      const identityBulk = await resolveAndLinkPlexusIdentityForScreeningsBulk(
        created.map((p) => ({
          screeningId: p.id,
          clinicId: p.clinicId ?? req.clinicId ?? null,
          sourceSystem: "batch_import_file",
          demographics: {
            displayName: p.name,
            dob: p.dob,
            phone: p.phoneNumber,
            email: p.email ?? null,
          },
        })),
      );
      for (const err of identityBulk.errors) {
        console.error(JSON.stringify({
          level: "error",
          source: "plexus_identity_integration",
          route: "POST /api/batches/:id/import-file",
          screeningId: err.screeningId,
          code: err.code,
          message: err.message,
        }));
        await recordScreeningIdentityLinkFailure({
          screeningId: err.screeningId,
          clinicId: (created.find((p) => p.id === err.screeningId)?.clinicId ?? null),
          sourceSystem: "batch_import_file",
          errorCode: err.code,
        });
      }

      invalidatePatientDatabase();
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

      // Phase 2A — bulk identity orchestration (see import-file above).
      const identityBulk2 = await resolveAndLinkPlexusIdentityForScreeningsBulk(
        created2.map((p) => ({
          screeningId: p.id,
          clinicId: p.clinicId ?? req.clinicId ?? null,
          sourceSystem: "batch_import_text",
          demographics: {
            displayName: p.name,
            dob: p.dob,
            phone: p.phoneNumber,
            email: p.email ?? null,
          },
        })),
      );
      for (const err of identityBulk2.errors) {
        console.error(JSON.stringify({
          level: "error",
          source: "plexus_identity_integration",
          route: "POST /api/batches/:id/import-text",
          screeningId: err.screeningId,
          code: err.code,
          message: err.message,
        }));
        await recordScreeningIdentityLinkFailure({
          screeningId: err.screeningId,
          clinicId: (created2.find((p) => p.id === err.screeningId)?.clinicId ?? null),
          sourceSystem: "batch_import_text",
          errorCode: err.code,
        });
      }

      invalidatePatientDatabase();
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
            // Patients remain in Draft after AI analysis. They only move to
            // Ready (and into the engagement queue) when an admin explicitly
            // approves them via the Admin Review flow.
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
      invalidatePatientDatabase();
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

  // Aggregated summary used by Plexus IQ's calendar. Returns one row per
  // batch with a precomputed patientCount and the unique set of ancillary
  // categories represented across that batch's qualifyingTests. Two DB
  // round-trips total (batches + all patient_screenings) instead of the
  // N+1 the client used to do via useQueries on each batch detail.
  app.get("/api/screening-batches/calendar-summary", async (_req, res) => {
    try {
      const [batches, allPatients] = await Promise.all([
        storage.getAllScreeningBatches(),
        storage.getAllPatientScreenings(),
      ]);

      type Acc = { count: number; cats: Set<string>; byCategory: Record<string, number> };
      const perBatch = new Map<number, Acc>();
      for (const p of allPatients) {
        let bucket = perBatch.get(p.batchId);
        if (!bucket) {
          bucket = { count: 0, cats: new Set<string>(), byCategory: { brainwave: 0, vitalwave: 0, ultrasound: 0 } };
          perBatch.set(p.batchId, bucket);
        }
        bucket.count += 1;
        const patientCats = new Set<string>();
        for (const t of p.qualifyingTests || []) {
          const cat = getAncillaryCategory(t);
          if (cat !== "other") {
            bucket.cats.add(cat);
            patientCats.add(cat);
          }
        }
        // Per-patient unique category counts so a patient with two BrainWave
        // tests still counts as 1 BrainWave patient on the dashboard.
        for (const cat of patientCats) {
          bucket.byCategory[cat] = (bucket.byCategory[cat] ?? 0) + 1;
        }
      }

      const summary = batches.map((b) => {
        const acc = perBatch.get(b.id);
        return {
          id: b.id,
          name: b.name,
          facility: b.facility,
          scheduleDate: b.scheduleDate,
          status: b.status,
          patientCount: acc?.count ?? 0,
          categories: acc ? Array.from(acc.cats) : [],
          byCategory: acc?.byCategory ?? { brainwave: 0, vitalwave: 0, ultrasound: 0 },
        };
      });
      res.json(summary);
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
      const { clinicianName, clinicianId, clinicianSource, facility, scheduleDate } = req.body;
      const batchUpdates: Partial<{
        clinicianName: string | null;
        clinicianId: number | null;
        clinicianSource: string | null;
        facility: string | null;
        scheduleDate: string | null;
      }> = {};
      if (clinicianName !== undefined) batchUpdates.clinicianName = (typeof clinicianName === "string" ? clinicianName.trim() : clinicianName) || null;
      if (clinicianId !== undefined) batchUpdates.clinicianId = clinicianId ?? null;
      if (clinicianSource !== undefined) {
        if (clinicianSource !== null && clinicianSource !== "facility_clinician" && clinicianSource !== "free_text") {
          return res.status(400).json({ error: "clinicianSource must be facility_clinician | free_text | null" });
        }
        batchUpdates.clinicianSource = clinicianSource ?? null;
      }
      if (facility !== undefined) batchUpdates.facility = facility ?? null;
      if (scheduleDate !== undefined) {
        if (scheduleDate === null || scheduleDate === "") {
          batchUpdates.scheduleDate = null;
        } else if (typeof scheduleDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
          batchUpdates.scheduleDate = scheduleDate;
        } else {
          return res.status(400).json({ error: "scheduleDate must be YYYY-MM-DD" });
        }
      }
      const updated = await storage.updateScreeningBatch(id, batchUpdates);
      if (!updated) return res.status(404).json({ error: "Batch not found" });
      invalidatePatientDatabase();
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
      invalidatePatientDatabase();
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
