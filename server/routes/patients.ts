import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import {
  updatePatientSchema,
  extractDateFromPrevTests,
  getQualificationMode,
  saveGeneratedNoteSchema,
} from "./helpers";
import {
  screenSinglePatientWithAI,
  analyzeTestWithAI,
} from "../services/screening";
import { normalizeInsuranceType } from "../services/ingest";
import { logAudit } from "../services/auditService";
import { invalidatePatientDatabase } from "./patientDatabase";
import { assignNewlyEligiblePatient } from "../services/callListEngine";
import {
  commitPatient,
  recallPatient,
  ensureCanonicalSpineForScreening,
} from "../services/patientCommitService";

type BackgroundSyncPatients = () => void | Promise<void>;

export function registerPatientRoutes(
  app: Express,
  deps: { backgroundSyncPatients: BackgroundSyncPatients }
) {
  const { backgroundSyncPatients } = deps;

  // Recently soft-deleted patients within the restore window. Used by
  // the Plexus IQ Recently Deleted card. Expired rows (delete_expires_at
  // < now) are omitted by the repository.
  app.get("/api/patient-screenings/recently-deleted", async (req, res) => {
    try {
      const limit = Number.parseInt(String(req.query.limit ?? "100"), 10);
      const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
      const rows = await storage.listRecentlyDeletedPatientScreenings(safeLimit);
      res.json(rows);
    } catch (error: any) {
      console.error("recently-deleted error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to fetch recently deleted patients" });
    }
  });

  // Restore a soft-deleted patient. 404 if no such row, 410 if the
  // restore window has expired, idempotent ok if already active.
  app.post("/api/patient-screenings/:id/restore", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getPatientScreeningIncludingDeleted(id);
      if (!existing) return res.status(404).json({ error: "Patient not found" });

      if (!existing.deletedAt) {
        return res.json({ ok: true, alreadyActive: true, patient: existing });
      }
      if (existing.deleteExpiresAt && existing.deleteExpiresAt.getTime() < Date.now()) {
        return res.status(410).json({ error: "Restore window expired" });
      }

      const restored = await storage.restorePatientScreening(id);
      await storage.updateScreeningBatch(existing.batchId, {
        patientCount: (await storage.getPatientScreeningsByBatch(existing.batchId)).length,
      });
      void logAudit(req, "update", "patient", id, { name: existing.name, restored: true });
      invalidatePatientDatabase();
      res.json({ ok: true, patient: restored });
    } catch (error: any) {
      console.error("restore patient error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to restore patient" });
    }
  });

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

      void logAudit(req, "update", "patient", id, updates);
      invalidatePatientDatabase();

      // Final Schedule edits (appointment status, patient type, time, name,
      // dob, qualifying tests) can flip a committed patient between visit /
      // outreach buckets or surface a usable visit datetime for the first
      // time. Re-run the canonical spine helper so the execution case,
      // doctor_visit global_schedule_event, and scheduler auto-assignment
      // stay in sync. The helper is idempotent and self-skips Draft
      // patients ("draft_not_committed"), so it's safe to fire on every
      // committed patient PATCH.
      const SPINE_FIELDS = [
        "appointmentStatus",
        "patientType",
        "time",
        "name",
        "dob",
        "qualifyingTests",
      ] as const;
      const spineRelevant = SPINE_FIELDS.some((f) => f in (data as Record<string, unknown>));
      if (spineRelevant && patient.commitStatus !== "Draft") {
        void ensureCanonicalSpineForScreening(id, {
          actorUserId: req.session?.userId ?? null,
          auto: true,
        }).catch((err) => {
          console.error("[patients.patch] ensureCanonicalSpineForScreening failed:", err);
        });
      }

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
            invalidatePatientDatabase();
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

      void logAudit(req, "delete", "patient", id, { name: patient.name });
      invalidatePatientDatabase();
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Rule-engine extracted evidence + ICD-needed flags + per-ancillary candidates.
  // Pure deterministic — no AI calls — so it stays cheap and audit-friendly.
  app.get("/api/patient-screenings/:id/admin-review/evidence", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: "Invalid patient id" });
      }
      const patient = await storage.getPatientScreening(id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });

      const { runAdminReviewRuleEngine } = await import(
        "../services/plexusIq/adminReviewRuleEngine"
      );
      const result = runAdminReviewRuleEngine(patient);
      res.json({ ok: true, patientId: id, ...result });
    } catch (error: any) {
      console.error("[admin-review/evidence] error:", error?.message ?? error);
      res.status(500).json({
        error: error?.message ?? "Failed to build admin review evidence",
      });
    }
  });

  // Regenerate clinician / patient reasoning for a single ancillary using
  // admin-selected evidence. Stores under `reasoning["adminReview:<ancillary>"]`
  // so it round-trips through the existing patient.reasoning field shape.
  app.post("/api/patient-screenings/:id/admin-review/regenerate", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: "Invalid patient id" });
      }
      const patient = await storage.getPatientScreening(id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });

      const ancillaryId = String(req.body?.ancillaryId ?? "");
      const mode = String(req.body?.mode ?? "all");
      const assignedEvidence = Array.isArray(req.body?.assignedEvidence)
        ? req.body.assignedEvidence
        : [];
      const ancillaryNote =
        typeof req.body?.ancillaryNote === "string" ? req.body.ancillaryNote : "";

      const existingReasoning =
        patient.reasoning &&
        typeof patient.reasoning === "object" &&
        !Array.isArray(patient.reasoning)
          ? { ...(patient.reasoning as Record<string, unknown>) }
          : {};

      const key = `adminReview:${ancillaryId || "unknown"}`;
      const prior = (existingReasoning as Record<string, any>)[key] ?? {};
      const normalizedMode =
        mode === "clinician" || mode === "patient" || mode === "all" ? mode : "all";

      const { regenerateAdminReviewReasoning } = await import(
        "../services/plexusIq/adminReviewAiRegeneration"
      );

      const regenerated = await regenerateAdminReviewReasoning({
        patient,
        ancillaryId,
        mode: normalizedMode,
        assignedEvidence,
        ancillaryNote,
        previousClinicianReasoning: prior.clinicianReasoning,
        previousPatientExplanation: prior.patientExplanation,
      });

      const timestamp = new Date().toISOString();
      const nextEntry = {
        ancillaryId,
        assignedEvidence,
        ancillaryNote: regenerated.ancillaryNote || ancillaryNote,
        clinicianReasoning:
          normalizedMode === "patient"
            ? prior.clinicianReasoning ?? regenerated.clinicianReasoning
            : regenerated.clinicianReasoning,
        patientExplanation:
          normalizedMode === "clinician"
            ? prior.patientExplanation ?? regenerated.patientExplanation
            : regenerated.patientExplanation,
        regeneratedAt: timestamp,
        regeneratedMode: normalizedMode,
      };

      const nextReasoning = {
        ...existingReasoning,
        [key]: nextEntry,
      };

      const updated = await storage.updatePatientScreening(id, {
        reasoning: nextReasoning,
      });

      invalidatePatientDatabase();
      res.json({
        ok: true,
        patient: updated,
        ancillaryId,
        clinicianReasoning: nextEntry.clinicianReasoning,
        patientExplanation: nextEntry.patientExplanation,
      });
    } catch (error: any) {
      console.error("[admin-review/regenerate] error:", error?.message ?? error);
      res.status(500).json({
        error: error?.message ?? "Failed to regenerate admin review reasoning",
      });
    }
  });

  // Canonical regenerate-all: writes patient.reasoning[testName] so the
  // ancillary icon popup, QualificationReasoningDialog, PDFs, and Admin
  // Review all read from the same layer. Also stores supplemental
  // adminReview:<ancillary> metadata for the assignment audit trail.
  app.post("/api/patient-screenings/:id/admin-review/regenerate-all", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: "Invalid patient id" });
      }
      const patient = await storage.getPatientScreening(id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });

      const assignedEvidenceByAncillary = {
        brainwave: Array.isArray(req.body?.assignedEvidenceByAncillary?.brainwave)
          ? req.body.assignedEvidenceByAncillary.brainwave
          : [],
        vitalwave: Array.isArray(req.body?.assignedEvidenceByAncillary?.vitalwave)
          ? req.body.assignedEvidenceByAncillary.vitalwave
          : [],
        ultrasound: Array.isArray(req.body?.assignedEvidenceByAncillary?.ultrasound)
          ? req.body.assignedEvidenceByAncillary.ultrasound
          : [],
      };
      const ancillaryNotes = {
        brainwave:
          typeof req.body?.ancillaryNotes?.brainwave === "string"
            ? req.body.ancillaryNotes.brainwave
            : "",
        vitalwave:
          typeof req.body?.ancillaryNotes?.vitalwave === "string"
            ? req.body.ancillaryNotes.vitalwave
            : "",
        ultrasound:
          typeof req.body?.ancillaryNotes?.ultrasound === "string"
            ? req.body.ancillaryNotes.ultrasound
            : "",
      };
      const adminNote =
        typeof req.body?.adminNote === "string" ? req.body.adminNote : "";
      const icdCodes: Array<{ code: string; label: string }> = Array.isArray(req.body?.icdCodes)
        ? req.body.icdCodes
            .map((c: any) => ({
              code: String(c?.code ?? "").trim(),
              label: String(c?.label ?? "").trim(),
            }))
            .filter((c: { code: string }) => c.code.length > 0)
        : [];
      const updatedDiagnoses =
        typeof req.body?.diagnoses === "string" ? req.body.diagnoses : patient.diagnoses;
      const updatedMedications =
        typeof req.body?.medications === "string" ? req.body.medications : patient.medications;
      const updatedHistory =
        typeof req.body?.history === "string" ? req.body.history : patient.history;

      const qualifyingTests = Array.isArray(patient.qualifyingTests)
        ? patient.qualifyingTests
        : [];

      const { regenerateCanonicalReasoning } = await import(
        "../services/plexusIq/adminReviewAiRegeneration"
      );
      const { getAncillaryCategory } = await import("@shared/ancillaryCategory");

      const existingReasoningByTest: Record<string, any> = {};
      const priorReasoning =
        patient.reasoning && typeof patient.reasoning === "object" && !Array.isArray(patient.reasoning)
          ? (patient.reasoning as Record<string, any>)
          : {};
      for (const t of qualifyingTests) {
        const e = priorReasoning[t];
        if (e && typeof e === "object" && !Array.isArray(e)) existingReasoningByTest[t] = e;
      }

      // Map test -> ancillary so selected support buttons follow the right bucket.
      const selectedSupportButtonsByTest: Record<string, any[]> = {};
      for (const t of qualifyingTests) {
        const cat = getAncillaryCategory(t);
        if (cat === "brainwave" || cat === "vitalwave" || cat === "ultrasound") {
          selectedSupportButtonsByTest[t] = assignedEvidenceByAncillary[cat] ?? [];
        }
      }

      // removedFactors come from the client and may be per-test or per-ancillary.
      const removedFactorsByTest: Record<string, string[]> = {};
      const removedFromBody = req.body?.removedFactorsByTest;
      if (removedFromBody && typeof removedFromBody === "object") {
        for (const [t, arr] of Object.entries(removedFromBody)) {
          if (Array.isArray(arr)) removedFactorsByTest[t] = arr.map((s: any) => String(s));
        }
      }
      const removedByAncillary = req.body?.removedFactorsByAncillary;
      if (removedByAncillary && typeof removedByAncillary === "object") {
        for (const t of qualifyingTests) {
          const cat = getAncillaryCategory(t);
          const arr = (removedByAncillary as Record<string, unknown>)[cat];
          if (Array.isArray(arr)) {
            removedFactorsByTest[t] = [
              ...(removedFactorsByTest[t] ?? []),
              ...arr.map((s: any) => String(s)),
            ];
          }
        }
      }

      const ai = await regenerateCanonicalReasoning({
        patient: {
          ...patient,
          history: updatedHistory ?? null,
          diagnoses: updatedDiagnoses ?? null,
          medications: updatedMedications ?? null,
        } as typeof patient,
        qualifyingTests,
        assignedEvidenceByAncillary,
        ancillaryNotes,
        adminNote,
        icdCodes,
        existingReasoningByTest,
        removedFactorsByTest,
        selectedSupportButtonsByTest,
      });

      const existingReasoning =
        patient.reasoning &&
        typeof patient.reasoning === "object" &&
        !Array.isArray(patient.reasoning)
          ? { ...(patient.reasoning as Record<string, unknown>) }
          : {};

      // Merge canonical regenerated entries onto patient.reasoning[testName].
      for (const [testName, entry] of Object.entries(ai.reasoningByTest)) {
        existingReasoning[testName] = entry;
      }

      // Supplemental adminReview metadata per ancillary (audit only).
      const timestamp = new Date().toISOString();
      for (const id of ["brainwave", "vitalwave", "ultrasound"] as const) {
        existingReasoning[`adminReview:${id}`] = {
          ancillaryId: id,
          assignedEvidence: assignedEvidenceByAncillary[id],
          ancillaryNote: ancillaryNotes[id],
          regeneratedAt: timestamp,
          regeneratedMode: "all",
        };
      }

      const updatePayload: Record<string, unknown> = {
        reasoning: existingReasoning,
      };
      if (updatedDiagnoses !== patient.diagnoses) updatePayload.diagnoses = updatedDiagnoses;
      if (updatedMedications !== patient.medications) updatePayload.medications = updatedMedications;
      if (updatedHistory !== patient.history) updatePayload.history = updatedHistory;

      const updated = await storage.updatePatientScreening(id, updatePayload);

      invalidatePatientDatabase();
      res.json({ ok: true, patient: updated });
    } catch (error: any) {
      console.error("[admin-review/regenerate-all] error:", error?.message ?? error);
      res.status(500).json({
        error: error?.message ?? "Failed to regenerate canonical reasoning",
      });
    }
  });

  // Per-ancillary regenerate — only touches reasoning entries whose test
  // name maps to the requested ancillary, plus the adminReview metadata
  // for that one ancillary. Other ancillaries' canonical reasoning is
  // preserved verbatim.
  app.post(
    "/api/patient-screenings/:id/admin-review/regenerate-ancillary",
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (Number.isNaN(id)) {
          return res.status(400).json({ error: "Invalid patient id" });
        }
        const ancillaryId = String(req.body?.ancillaryId ?? "");
        if (
          ancillaryId !== "brainwave" &&
          ancillaryId !== "vitalwave" &&
          ancillaryId !== "ultrasound"
        ) {
          return res.status(400).json({
            error: "ancillaryId must be one of brainwave / vitalwave / ultrasound",
          });
        }
        const patient = await storage.getPatientScreening(id);
        if (!patient) return res.status(404).json({ error: "Patient not found" });

        const assignedEvidence = Array.isArray(req.body?.assignedEvidence)
          ? req.body.assignedEvidence
          : [];
        const ancillaryNote =
          typeof req.body?.ancillaryNote === "string" ? req.body.ancillaryNote : "";
        const adminNote =
          typeof req.body?.adminNote === "string" ? req.body.adminNote : "";
        const icdCodes: Array<{ code: string; label: string }> = Array.isArray(
          req.body?.icdCodes,
        )
          ? req.body.icdCodes
              .map((c: any) => ({
                code: String(c?.code ?? "").trim(),
                label: String(c?.label ?? "").trim(),
              }))
              .filter((c: { code: string }) => c.code.length > 0)
          : [];
        const updatedDiagnoses =
          typeof req.body?.diagnoses === "string" ? req.body.diagnoses : patient.diagnoses;
        const updatedMedications =
          typeof req.body?.medications === "string" ? req.body.medications : patient.medications;
        const updatedHistory =
          typeof req.body?.history === "string" ? req.body.history : patient.history;

        const { getAncillaryCategory } = await import("@shared/ancillaryCategory");
        const allTests = Array.isArray(patient.qualifyingTests)
          ? patient.qualifyingTests
          : [];
        const filteredTests = allTests.filter(
          (t) => getAncillaryCategory(t) === ancillaryId,
        );

        const { regenerateCanonicalReasoning } = await import(
          "../services/plexusIq/adminReviewAiRegeneration"
        );

        const priorReasoning =
          patient.reasoning && typeof patient.reasoning === "object" && !Array.isArray(patient.reasoning)
            ? (patient.reasoning as Record<string, any>)
            : {};
        const existingReasoningByTest: Record<string, any> = {};
        for (const t of filteredTests) {
          const e = priorReasoning[t];
          if (e && typeof e === "object" && !Array.isArray(e)) existingReasoningByTest[t] = e;
        }

        const selectedSupportButtonsByTest: Record<string, any[]> = {};
        for (const t of filteredTests) selectedSupportButtonsByTest[t] = assignedEvidence;

        const removedFactorsByTest: Record<string, string[]> = {};
        const removedAncillary = Array.isArray(req.body?.removedFactors) ? req.body.removedFactors : [];
        if (removedAncillary.length) {
          for (const t of filteredTests) {
            removedFactorsByTest[t] = removedAncillary.map((s: any) => String(s));
          }
        }
        const removedPerTestBody = req.body?.removedFactorsByTest;
        if (removedPerTestBody && typeof removedPerTestBody === "object") {
          for (const [t, arr] of Object.entries(removedPerTestBody)) {
            if (Array.isArray(arr)) {
              removedFactorsByTest[t] = [
                ...(removedFactorsByTest[t] ?? []),
                ...arr.map((s: any) => String(s)),
              ];
            }
          }
        }

        const ai = await regenerateCanonicalReasoning({
          patient: {
            ...patient,
            history: updatedHistory ?? null,
            diagnoses: updatedDiagnoses ?? null,
            medications: updatedMedications ?? null,
          } as typeof patient,
          qualifyingTests: filteredTests,
          assignedEvidenceByAncillary: {
            brainwave: ancillaryId === "brainwave" ? assignedEvidence : [],
            vitalwave: ancillaryId === "vitalwave" ? assignedEvidence : [],
            ultrasound: ancillaryId === "ultrasound" ? assignedEvidence : [],
          },
          ancillaryNotes: {
            brainwave: ancillaryId === "brainwave" ? ancillaryNote : "",
            vitalwave: ancillaryId === "vitalwave" ? ancillaryNote : "",
            ultrasound: ancillaryId === "ultrasound" ? ancillaryNote : "",
          },
          adminNote,
          icdCodes,
          existingReasoningByTest,
          removedFactorsByTest,
          selectedSupportButtonsByTest,
        });

        const existingReasoning =
          patient.reasoning &&
          typeof patient.reasoning === "object" &&
          !Array.isArray(patient.reasoning)
            ? { ...(patient.reasoning as Record<string, unknown>) }
            : {};

        // Merge ONLY filtered-test entries. Other tests' canonical entries
        // (including other ancillaries) are preserved verbatim.
        for (const [testName, entry] of Object.entries(ai.reasoningByTest)) {
          existingReasoning[testName] = entry;
        }

        const timestamp = new Date().toISOString();
        existingReasoning[`adminReview:${ancillaryId}`] = {
          ancillaryId,
          assignedEvidence,
          ancillaryNote,
          regeneratedAt: timestamp,
          regeneratedMode: "ancillary",
        };

        const updatePayload: Record<string, unknown> = {
          reasoning: existingReasoning,
        };
        if (updatedDiagnoses !== patient.diagnoses) updatePayload.diagnoses = updatedDiagnoses;
        if (updatedMedications !== patient.medications) updatePayload.medications = updatedMedications;
        if (updatedHistory !== patient.history) updatePayload.history = updatedHistory;

        const updated = await storage.updatePatientScreening(id, updatePayload);

        invalidatePatientDatabase();
        res.json({ ok: true, patient: updated, ancillaryId });
      } catch (error: any) {
        console.error(
          "[admin-review/regenerate-ancillary] error:",
          error?.message ?? error,
        );
        res.status(500).json({
          error: error?.message ?? "Failed to regenerate ancillary reasoning",
        });
      }
    },
  );

  // Universal OpenAI ICD-10-CM search for the Admin Review Available Buttons section.
  // Logs only non-sensitive metadata — no key, no PHI, no full query, no Hx/Dx/Rx.
  app.post(
    "/api/patient-screenings/:id/admin-review/icd-search",
    async (req, res) => {
      const id = parseInt(req.params.id);
      try {
        if (Number.isNaN(id)) {
          return res.status(400).json({
            ok: false,
            error: "OpenAI universal ICD search failed",
            detail: "Invalid patient id",
          });
        }
        const patient = await storage.getPatientScreening(id);
        if (!patient) {
          return res.status(404).json({
            ok: false,
            error: "OpenAI universal ICD search failed",
            detail: "Patient not found",
          });
        }

        const query = String(req.body?.query ?? "").trim();
        if (query.length < 2) {
          return res.json({ ok: true, results: [] });
        }

        const patientContext = {
          diagnoses:
            typeof req.body?.patientContext?.diagnoses === "string"
              ? req.body.patientContext.diagnoses
              : undefined,
          history:
            typeof req.body?.patientContext?.history === "string"
              ? req.body.patientContext.history
              : undefined,
          medications:
            typeof req.body?.patientContext?.medications === "string"
              ? req.body.patientContext.medications
              : undefined,
        };

        const { searchAdminReviewIcdCodes } = await import(
          "../services/plexusIq/adminReviewIcdSearch"
        );
        const results = await searchAdminReviewIcdCodes({
          query,
          patient,
          patientContext,
        });
        res.json({ ok: true, results });
      } catch (error: any) {
        const detail =
          error instanceof Error
            ? error.message.slice(0, 240)
            : String(error ?? "unknown").slice(0, 240);
        console.error("[admin-review/icd-search] error", {
          patientId: id,
          queryLength: String(req.body?.query ?? "").trim().length,
          hasAIIntegrationsKey: !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
          hasOpenAIKey: !!process.env.OPENAI_API_KEY,
          hasBaseUrl: !!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
          message: detail,
        });
        res.status(500).json({
          ok: false,
          error: "OpenAI universal ICD search failed",
          detail,
        });
      }
    },
  );

  // Per-test regenerate — writes canonical patient.reasoning[testName] for
  // exactly one qualifying test. Stores supplemental metadata under
  // reasoning[`adminReview:test:<testName>`]. Other tests preserved verbatim.
  app.post(
    "/api/patient-screenings/:id/admin-review/regenerate-test",
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (Number.isNaN(id)) {
          return res.status(400).json({ error: "Invalid patient id" });
        }
        const testName = String(req.body?.testName ?? "").trim();
        if (!testName) {
          return res.status(400).json({ error: "testName is required" });
        }
        const ancillaryId = String(req.body?.ancillaryId ?? "");
        if (
          ancillaryId !== "brainwave" &&
          ancillaryId !== "vitalwave" &&
          ancillaryId !== "ultrasound"
        ) {
          return res.status(400).json({
            error: "ancillaryId must be one of brainwave / vitalwave / ultrasound",
          });
        }
        const patient = await storage.getPatientScreening(id);
        if (!patient) return res.status(404).json({ error: "Patient not found" });

        const allTests = Array.isArray(patient.qualifyingTests)
          ? patient.qualifyingTests
          : [];
        if (!allTests.includes(testName)) {
          return res.status(400).json({
            error: `testName "${testName}" is not in patient.qualifyingTests`,
          });
        }

        const assignedEvidence = Array.isArray(req.body?.assignedEvidence)
          ? req.body.assignedEvidence
          : [];
        const ancillaryNote =
          typeof req.body?.ancillaryNote === "string" ? req.body.ancillaryNote : "";
        const adminNote =
          typeof req.body?.adminNote === "string" ? req.body.adminNote : "";
        const icdCodes: Array<{ code: string; label: string }> = Array.isArray(
          req.body?.icdCodes,
        )
          ? req.body.icdCodes
              .map((c: any) => ({
                code: String(c?.code ?? "").trim(),
                label: String(c?.label ?? "").trim(),
              }))
              .filter((c: { code: string }) => c.code.length > 0)
          : [];
        const updatedDiagnoses =
          typeof req.body?.diagnoses === "string" ? req.body.diagnoses : patient.diagnoses;
        const updatedMedications =
          typeof req.body?.medications === "string" ? req.body.medications : patient.medications;
        const updatedHistory =
          typeof req.body?.history === "string" ? req.body.history : patient.history;

        const { regenerateCanonicalReasoning } = await import(
          "../services/plexusIq/adminReviewAiRegeneration"
        );

        const priorReasoning =
          patient.reasoning && typeof patient.reasoning === "object" && !Array.isArray(patient.reasoning)
            ? (patient.reasoning as Record<string, any>)
            : {};
        const priorEntry = priorReasoning[testName];
        const existingReasoningByTest: Record<string, any> =
          priorEntry && typeof priorEntry === "object" && !Array.isArray(priorEntry)
            ? { [testName]: priorEntry }
            : {};
        const selectedSupportButtonsByTest: Record<string, any[]> = {
          [testName]: assignedEvidence,
        };
        const removedFactorsByTest: Record<string, string[]> = {};
        const removedArr = Array.isArray(req.body?.removedFactors) ? req.body.removedFactors : [];
        if (removedArr.length) {
          removedFactorsByTest[testName] = removedArr.map((s: any) => String(s));
        }

        const ai = await regenerateCanonicalReasoning({
          patient: {
            ...patient,
            history: updatedHistory ?? null,
            diagnoses: updatedDiagnoses ?? null,
            medications: updatedMedications ?? null,
          } as typeof patient,
          qualifyingTests: [testName],
          assignedEvidenceByAncillary: {
            brainwave: ancillaryId === "brainwave" ? assignedEvidence : [],
            vitalwave: ancillaryId === "vitalwave" ? assignedEvidence : [],
            ultrasound: ancillaryId === "ultrasound" ? assignedEvidence : [],
          },
          ancillaryNotes: {
            brainwave: ancillaryId === "brainwave" ? ancillaryNote : "",
            vitalwave: ancillaryId === "vitalwave" ? ancillaryNote : "",
            ultrasound: ancillaryId === "ultrasound" ? ancillaryNote : "",
          },
          adminNote,
          icdCodes,
          existingReasoningByTest,
          removedFactorsByTest,
          selectedSupportButtonsByTest,
        });

        const existingReasoning =
          patient.reasoning &&
          typeof patient.reasoning === "object" &&
          !Array.isArray(patient.reasoning)
            ? { ...(patient.reasoning as Record<string, unknown>) }
            : {};

        // Merge ONLY the single regenerated test's entry. Everything else preserved.
        for (const [name, entry] of Object.entries(ai.reasoningByTest)) {
          existingReasoning[name] = entry;
        }

        const timestamp = new Date().toISOString();
        existingReasoning[`adminReview:test:${testName}`] = {
          testName,
          ancillaryId,
          assignedEvidence,
          ancillaryNote,
          regeneratedAt: timestamp,
          regeneratedMode: "test",
        };

        const updatePayload: Record<string, unknown> = {
          reasoning: existingReasoning,
        };
        if (updatedDiagnoses !== patient.diagnoses) updatePayload.diagnoses = updatedDiagnoses;
        if (updatedMedications !== patient.medications) updatePayload.medications = updatedMedications;
        if (updatedHistory !== patient.history) updatePayload.history = updatedHistory;

        const updated = await storage.updatePatientScreening(id, updatePayload);

        invalidatePatientDatabase();
        res.json({ ok: true, patient: updated, testName, ancillaryId });
      } catch (error: any) {
        console.error(
          "[admin-review/regenerate-test] error:",
          error?.message ?? error,
        );
        res.status(500).json({
          error: error?.message ?? "Failed to regenerate test reasoning",
        });
      }
    },
  );

  // Remove a single qualifying test from patient.qualifyingTests and
  // clear the associated `adminReview:test:<testName>` metadata. The
  // canonical reasoning entry `patient.reasoning[testName]` is left
  // intact so historical context survives (UI display is governed by
  // qualifyingTests). Other tests are unaffected.
  app.post(
    "/api/patient-screenings/:id/admin-review/remove-test",
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (Number.isNaN(id)) {
          return res.status(400).json({ error: "Invalid patient id" });
        }
        const testName = String(req.body?.testName ?? "").trim();
        if (!testName) {
          return res.status(400).json({ error: "testName is required" });
        }
        const patient = await storage.getPatientScreening(id);
        if (!patient) return res.status(404).json({ error: "Patient not found" });

        const allTests = Array.isArray(patient.qualifyingTests)
          ? patient.qualifyingTests
          : [];
        if (!allTests.includes(testName)) {
          return res.status(400).json({
            error: `testName "${testName}" is not in patient.qualifyingTests`,
          });
        }
        const nextTests = allTests.filter((t) => t !== testName);

        const existingReasoning =
          patient.reasoning &&
          typeof patient.reasoning === "object" &&
          !Array.isArray(patient.reasoning)
            ? { ...(patient.reasoning as Record<string, unknown>) }
            : {};
        delete existingReasoning[`adminReview:test:${testName}`];

        const updated = await storage.updatePatientScreening(id, {
          qualifyingTests: nextTests,
          reasoning: existingReasoning,
        });

        invalidatePatientDatabase();
        res.json({ ok: true, patient: updated, removedTestName: testName });
      } catch (error: any) {
        console.error(
          "[admin-review/remove-test] error:",
          error?.message ?? error,
        );
        res.status(500).json({
          error: error?.message ?? "Failed to remove test",
        });
      }
    },
  );

  // Remove a whole ancillary from a patient: filter qualifyingTests by
  // `getAncillaryCategory(testName) === ancillaryId` and drop matching
  // entries. Clear the ancillary's adminReview metadata block and any
  // per-test metadata for tests that just got removed. Canonical
  // reasoning entries are left intact.
  app.post(
    "/api/patient-screenings/:id/admin-review/remove-ancillary",
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (Number.isNaN(id)) {
          return res.status(400).json({ error: "Invalid patient id" });
        }
        const ancillaryId = String(req.body?.ancillaryId ?? "");
        if (
          ancillaryId !== "brainwave" &&
          ancillaryId !== "vitalwave" &&
          ancillaryId !== "ultrasound"
        ) {
          return res.status(400).json({
            error: "ancillaryId must be one of brainwave / vitalwave / ultrasound",
          });
        }
        const patient = await storage.getPatientScreening(id);
        if (!patient) return res.status(404).json({ error: "Patient not found" });

        const { getAncillaryCategory } = await import("@shared/ancillaryCategory");
        const allTests = Array.isArray(patient.qualifyingTests)
          ? patient.qualifyingTests
          : [];
        const toRemove = new Set(
          allTests.filter((t) => getAncillaryCategory(t) === ancillaryId),
        );
        const nextTests = allTests.filter((t) => !toRemove.has(t));

        const existingReasoning =
          patient.reasoning &&
          typeof patient.reasoning === "object" &&
          !Array.isArray(patient.reasoning)
            ? { ...(patient.reasoning as Record<string, unknown>) }
            : {};
        delete existingReasoning[`adminReview:${ancillaryId}`];
        for (const t of toRemove) {
          delete existingReasoning[`adminReview:test:${t}`];
        }

        const updated = await storage.updatePatientScreening(id, {
          qualifyingTests: nextTests,
          reasoning: existingReasoning,
        });

        invalidatePatientDatabase();
        res.json({
          ok: true,
          patient: updated,
          ancillaryId,
          removedTests: Array.from(toRemove),
        });
      } catch (error: any) {
        console.error(
          "[admin-review/remove-ancillary] error:",
          error?.message ?? error,
        );
        res.status(500).json({
          error: error?.message ?? "Failed to remove ancillary",
        });
      }
    },
  );

  // Sets the admin approval state on a patient_screenings row.
  // Backs the Admin Review modal on Plexus IQ patient cards.
  // Journey-event append is best-effort; if patient_journey_events /
  // patient_execution_cases aren't deployed yet the audit row is
  // dropped silently and the primary column update still succeeds.
  app.post(
    "/api/patient-screenings/:id/admin-approval",
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (Number.isNaN(id)) {
          return res.status(400).json({ error: "Invalid patient id" });
        }
        const allowedStatuses = ["pending", "approved", "needs_info", "rejected"] as const;
        const status = String(req.body?.status ?? "");
        if (!(allowedStatuses as readonly string[]).includes(status)) {
          return res.status(400).json({
            error: "status must be one of pending / approved / needs_info / rejected",
          });
        }
        const note = typeof req.body?.note === "string" && req.body.note.trim()
          ? req.body.note.trim()
          : null;
        const patient = await storage.getPatientScreening(id);
        if (!patient) return res.status(404).json({ error: "Patient not found" });

        const userId: string | null = req.session.userId ?? null;
        const isApproved = status === "approved";
        const updated = await storage.updatePatientScreening(id, {
          adminApprovalStatus: status,
          adminApprovedAt: isApproved ? new Date() : null,
          adminApprovedByUserId: isApproved ? userId : null,
          adminApprovalNote: note,
        });
        if (!updated) {
          return res.status(404).json({ error: "Patient not found" });
        }

        try {
          const { db } = await import("../db");
          const schema = await import("@shared/schema") as Record<string, unknown>;
          const patientJourneyEvents = (schema as { patientJourneyEvents?: unknown }).patientJourneyEvents;
          const patientExecutionCases = (schema as { patientExecutionCases?: unknown }).patientExecutionCases;
          if (patientJourneyEvents && patientExecutionCases) {
            const { desc, eq } = await import("drizzle-orm");
            const [execCase] = await (db as any)
              .select()
              .from(patientExecutionCases)
              .where(eq((patientExecutionCases as any).patientScreeningId, id))
              .orderBy(desc((patientExecutionCases as any).id))
              .limit(1);
            await (db as any).insert(patientJourneyEvents).values({
              patientScreeningId: id,
              executionCaseId: execCase?.id ?? null,
              actorUserId: userId,
              patientName: patient.name,
              patientDob: patient.dob ?? null,
              eventType: "admin_approval_updated",
              eventSource: "plexus_iq_admin_review",
              summary: `Admin approval set to ${status}`,
              metadata: { status, note },
            });
          }
        } catch (auditErr) {
          console.error(
            "[admin-approval] journey event append failed:",
            auditErr instanceof Error ? auditErr.message : auditErr,
          );
        }

        void logAudit(req, "update", "patient", id, {
          adminApprovalStatus: status,
          note,
        });
        invalidatePatientDatabase();
        res.json({ ok: true, patient: updated });
      } catch (error: any) {
        console.error(
          "[admin-approval] error:",
          error?.message ?? error,
        );
        res.status(500).json({
          error: error?.message ?? "Failed to update admin approval",
        });
      }
    },
  );

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

      // Auto-commit on successful AI analysis: Draft → Ready so the
      // assigned scheduler immediately sees the patient in their call
      // list. Already-committed patients are unchanged (no downgrade).
      let finalPatient = updated;
      let schedulerName: string | null = null;
      try {
        const result = await commitPatient(id, req.session.userId ?? null, { auto: true });
        if (result.ok) {
          finalPatient = result.data.patient;
          schedulerName = result.data.schedulerName;
        }
      } catch (commitErr) {
        console.error("Auto-commit after analyze failed:", commitErr);
      }

      invalidatePatientDatabase();

      // Mid-day eligibility hook: if this patient just became call-eligible
      // (status=completed + qualifying tests), slot them into today's
      // assignment queue without waiting for the next morning rebuild.
      // Use finalPatient (post-auto-commit) so the engine sees the latest
      // state including commitStatus/committedAt.
      if (finalPatient && qualTests.length > 0 && finalPatient.facility) {
        const today = new Date().toISOString().slice(0, 10);
        assignNewlyEligiblePatient(storage, finalPatient, finalPatient.facility, today)
          .catch((err) => console.warn("[patients] assignNewlyEligiblePatient failed:", err?.message));
      }

      res.json({ ...finalPatient, autoCommittedSchedulerName: schedulerName });
    } catch (error: any) {
      console.error("Per-patient analysis error:", error);
      res.status(500).json({ error: error.message || "Analysis failed" });
    }
  });

  // Manual commit (Send to Schedulers): used when AI analysis was skipped.
  // Enforces required-field gate (name/dob/phone) so a half-filled draft
  // never lands in a scheduler's call list.
  app.post("/api/patients/:id/commit", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid patient id" });

      const result = await commitPatient(id, req.session.userId ?? null, { auto: false });
      if (!result.ok) {
        if (result.error.code === "not_found") return res.status(404).json({ error: "Patient not found" });
        if (result.error.code === "validation") {
          return res.status(400).json({
            error: `Cannot send to schedulers — missing required field${result.error.missing.length === 1 ? "" : "s"}: ${result.error.missing.join(", ")}`,
            missing: result.error.missing,
          });
        }
        return res.status(409).json({ error: "Patient already committed" });
      }

      void logAudit(req, "commit", "patient", id, { schedulerName: result.data.schedulerName });
      invalidatePatientDatabase();

      // Manual commit should hit the same live call-list path as auto-commit
      // after AI analysis, so newly committed eligible patients appear in the
      // proper queue immediately instead of waiting for a later rebuild.
      try {
        const committedPatient = result.data.patient;
        const qualifyingTests = Array.isArray(committedPatient.qualifyingTests) ? committedPatient.qualifyingTests : [];
        if (qualifyingTests.length > 0 && committedPatient.facility) {
          const today = new Date().toISOString().slice(0, 10);
          assignNewlyEligiblePatient(storage, committedPatient, committedPatient.facility, today)
            .catch((err) => console.warn("[patients] assignNewlyEligiblePatient after manual commit failed:", err?.message));
        }
      } catch (assignErr) {
        console.warn("[patients] manual commit live assignment hook failed:", assignErr);
      }

      res.json({ ...result.data.patient, schedulerName: result.data.schedulerName });
    } catch (error: any) {
      console.error("Patient commit error:", error);
      res.status(500).json({ error: error.message || "Commit failed" });
    }
  });

  // Recall a freshly-committed patient back to Draft. Only works inside the
  // recall window (5 min) and only while still Ready (not yet touched).
  app.post("/api/patients/:id/recall", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid patient id" });

      const sessionUserId = req.session.userId ?? null;
      if (!sessionUserId) return res.status(401).json({ error: "Not authenticated" });

      // Adder-only recall: only the user who pressed "Send to Schedulers"
      // (or auto-commit attribution) can pull a patient back. Admins may
      // override. This prevents drive-by recalls from other team members
      // observing the dashboard.
      const existing = await storage.getPatientScreening(id);
      if (!existing) return res.status(404).json({ error: "Patient not found" });
      const isAdmin = req.session.role === "admin";
      if (!isAdmin && existing.committedByUserId && existing.committedByUserId !== sessionUserId) {
        return res.status(403).json({ error: "Only the user who committed this patient can recall it" });
      }

      const result = await recallPatient(id);
      if (!result.ok) {
        if (result.error.code === "not_found") return res.status(404).json({ error: "Patient not found" });
        if (result.error.code === "not_committed") return res.status(400).json({ error: "Patient is still a Draft" });
        if (result.error.code === "window_elapsed") return res.status(409).json({ error: "Recall window has elapsed" });
        return res.status(409).json({ error: `Cannot recall — patient is now ${result.error.status}` });
      }

      void logAudit(req, "recall", "patient", id, null);
      invalidatePatientDatabase();
      res.json(result.data);
    } catch (error: any) {
      console.error("Patient recall error:", error);
      res.status(500).json({ error: error.message || "Recall failed" });
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

      invalidatePatientDatabase();
      res.json({ reasoning: mergedReasoning, testName, patient: updated });
    } catch (error: any) {
      console.error("Single-test analysis error:", error);
      res.status(500).json({ error: error.message || "Analysis failed" });
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

      const { autoGeneratePatientNotesServer } = await import("../services/noteGenerationServer");

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
      invalidatePatientDatabase();
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

      const { generateOpenAIJustificationPrompt } = await import("../../shared/plexus");
      const { openai, withRetry } = await import("../services/aiClient");

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

      const { VITALWAVE_CONFIG, ULTRASOUND_CONFIG, BRAINWAVE_MAPPING } = await import("../../shared/plexus");
      const { openai, withRetry } = await import("../services/aiClient");

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
        const parsedArr = JSON.parse(cleaned);
        if (Array.isArray(parsedArr)) {
          selected = parsedArr.filter((c: unknown) => typeof c === "string" && availableConditions.includes(c));
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

      const { openai, withRetry } = await import("../services/aiClient");

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
}
