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
// Phase 1 convergence: assignNewlyEligiblePatient disabled — canonical
// assignment flows through Engagement Center distributionService.
// import { assignNewlyEligiblePatient } from "../services/callListEngine";
import {
  commitPatient,
  recallPatient,
  ensureCanonicalSpineForScreening,
} from "../services/patientCommitService";

export function registerPatientRoutes(
  app: Express,
) {

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
      if (data.reasoning !== undefined) updates.reasoning = data.reasoning;
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

      if (Object.keys(updates).length === 0) {
        const current = await storage.getPatientScreening(id);
        if (!current) return res.status(404).json({ error: "Patient not found" });
        return res.json(current);
      }

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
  //
  // Delegated to server/services/plexusIq/adminReviewEvidenceService.ts.
  // Response shape, status codes, and error messages preserved byte-for-byte;
  // see docs/architecture/backend-route-parity-inventory.md §1.1.
  app.get("/api/patient-screenings/:id/admin-review/evidence", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { getAdminReviewEvidence } = await import(
        "../services/plexusIq/adminReviewEvidenceService"
      );
      const outcome = await getAdminReviewEvidence(id);
      if (!outcome.ok) {
        if (outcome.error.kind === "invalid_id") {
          return res.status(400).json({ error: "Invalid patient id" });
        }
        return res.status(404).json({ error: "Patient not found" });
      }
      res.json({ ok: true, patientId: outcome.patientId, ...outcome.result });
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
  //
  // Delegated to server/services/plexusIq/adminReviewSupplementalRegenerateService.ts.
  // This route writes the supplemental adminReview:<ancillary> key only — it
  // does NOT touch canonical reasoning[testName]. Response shape, status codes,
  // error messages, and mode-based merge are preserved byte-for-byte; see
  // docs/architecture/backend-route-parity-inventory.md §1.2.
  app.post("/api/patient-screenings/:id/admin-review/regenerate", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { regenerateAdminReviewSupplemental } = await import(
        "../services/plexusIq/adminReviewSupplementalRegenerateService"
      );
      const outcome = await regenerateAdminReviewSupplemental(id, req.body);
      if (!outcome.ok) {
        if (outcome.error.kind === "invalid_id") {
          return res.status(400).json({ error: "Invalid patient id" });
        }
        return res.status(404).json({ error: "Patient not found" });
      }
      res.json({
        ok: true,
        patient: outcome.patient,
        ancillaryId: outcome.ancillaryId,
        clinicianReasoning: outcome.clinicianReasoning,
        patientExplanation: outcome.patientExplanation,
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
  //
  // Delegated to server/services/plexusIq/adminReviewRegenerateAllService.ts.
  // Response shape, status codes, error messages, reasoning merge order,
  // canonical reasoning[testName] writes, all-three adminReview:<a>
  // supplemental writes, and external AI call semantics are preserved
  // byte-for-byte; see docs/architecture/backend-route-parity-inventory.md §1.3.
  app.post("/api/patient-screenings/:id/admin-review/regenerate-all", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { regenerateAdminReviewAll } = await import(
        "../services/plexusIq/adminReviewRegenerateAllService"
      );
      const outcome = await regenerateAdminReviewAll(id, req.body);
      if (!outcome.ok) {
        if (outcome.error.kind === "invalid_id") {
          return res.status(400).json({ error: "Invalid patient id" });
        }
        return res.status(404).json({ error: "Patient not found" });
      }
      res.json({ ok: true, patient: outcome.patient });
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
  //
  // Delegated to server/services/plexusIq/adminReviewRegenerateAncillaryService.ts.
  // Response shape, status codes, error messages, reasoning merge order,
  // supplemental metadata write, and external AI call semantics are preserved
  // byte-for-byte; see docs/architecture/backend-route-parity-inventory.md §1.4.
  app.post(
    "/api/patient-screenings/:id/admin-review/regenerate-ancillary",
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const { regenerateAdminReviewAncillary } = await import(
          "../services/plexusIq/adminReviewRegenerateAncillaryService"
        );
        const outcome = await regenerateAdminReviewAncillary(id, req.body);
        if (!outcome.ok) {
          if (outcome.error.kind === "invalid_id") {
            return res.status(400).json({ error: "Invalid patient id" });
          }
          if (outcome.error.kind === "invalid_ancillary_id") {
            return res.status(400).json({
              error: "ancillaryId must be one of brainwave / vitalwave / ultrasound",
            });
          }
          return res.status(404).json({ error: "Patient not found" });
        }
        res.json({
          ok: true,
          patient: outcome.patient,
          ancillaryId: outcome.ancillaryId,
        });
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
  //
  // Delegated to server/services/plexusIq/adminReviewIcdSearchService.ts for the
  // validation + AI-call path. The PHI-safe catch block is INTENTIONALLY kept
  // in the route so the structured error log emits the exact same fields it
  // has always emitted (patientId, queryLength, hasAIIntegrationsKey,
  // hasOpenAIKey, hasBaseUrl, message). See
  // docs/architecture/backend-route-parity-inventory.md §1.8.
  app.post(
    "/api/patient-screenings/:id/admin-review/icd-search",
    async (req, res) => {
      const id = parseInt(req.params.id);
      try {
        const { adminReviewIcdSearch } = await import(
          "../services/plexusIq/adminReviewIcdSearchService"
        );
        const outcome = await adminReviewIcdSearch(id, req.body);
        if (!outcome.ok) {
          if (outcome.error.kind === "invalid_id") {
            return res.status(400).json({
              ok: false,
              error: "OpenAI universal ICD search failed",
              detail: "Invalid patient id",
            });
          }
          return res.status(404).json({
            ok: false,
            error: "OpenAI universal ICD search failed",
            detail: "Patient not found",
          });
        }
        res.json({ ok: true, results: outcome.results });
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
  //
  // Delegated to server/services/plexusIq/adminReviewRegenerateTestService.ts.
  // Response shape, validation order (id-NaN → testName required → ancillaryId
  // enum → patient lookup → testName in qualifyingTests), status codes, error
  // messages (including the exact `testName "<n>" is not in patient.qualifyingTests`
  // format), reasoning merge, supplemental adminReview:test:<n> metadata, and
  // external AI call semantics are preserved byte-for-byte; see
  // docs/architecture/backend-route-parity-inventory.md §1.5.
  app.post(
    "/api/patient-screenings/:id/admin-review/regenerate-test",
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const { regenerateAdminReviewTest } = await import(
          "../services/plexusIq/adminReviewRegenerateTestService"
        );
        const outcome = await regenerateAdminReviewTest(id, req.body);
        if (!outcome.ok) {
          if (outcome.error.kind === "invalid_id") {
            return res.status(400).json({ error: "Invalid patient id" });
          }
          if (outcome.error.kind === "missing_test_name") {
            return res.status(400).json({ error: "testName is required" });
          }
          if (outcome.error.kind === "invalid_ancillary_id") {
            return res.status(400).json({
              error: "ancillaryId must be one of brainwave / vitalwave / ultrasound",
            });
          }
          if (outcome.error.kind === "not_found") {
            return res.status(404).json({ error: "Patient not found" });
          }
          // test_not_in_qualifying
          return res.status(400).json({
            error: `testName "${outcome.error.testName}" is not in patient.qualifyingTests`,
          });
        }
        res.json({
          ok: true,
          patient: outcome.patient,
          testName: outcome.testName,
          ancillaryId: outcome.ancillaryId,
        });
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
  //
  // Delegated to server/services/plexusIq/adminReviewRemoveService.ts.
  // Validation order, status codes, error messages (including the exact
  // `testName "<n>" is not in patient.qualifyingTests` format), and the
  // canonical-reasoning preservation invariant are preserved byte-for-byte;
  // see docs/architecture/backend-route-parity-inventory.md §1.6.
  app.post(
    "/api/patient-screenings/:id/admin-review/remove-test",
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const { removeAdminReviewTest } = await import(
          "../services/plexusIq/adminReviewRemoveService"
        );
        const outcome = await removeAdminReviewTest(id, req.body);
        if (!outcome.ok) {
          if (outcome.error.kind === "invalid_id") {
            return res.status(400).json({ error: "Invalid patient id" });
          }
          if (outcome.error.kind === "missing_test_name") {
            return res.status(400).json({ error: "testName is required" });
          }
          if (outcome.error.kind === "not_found") {
            return res.status(404).json({ error: "Patient not found" });
          }
          // test_not_in_qualifying
          return res.status(400).json({
            error: `testName "${outcome.error.testName}" is not in patient.qualifyingTests`,
          });
        }
        res.json({
          ok: true,
          patient: outcome.patient,
          removedTestName: outcome.removedTestName,
        });
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
  //
  // Delegated to server/services/plexusIq/adminReviewRemoveService.ts.
  // Validation order, status codes, error messages, response envelope,
  // and the canonical-reasoning preservation invariant are preserved
  // byte-for-byte; see docs/architecture/backend-route-parity-inventory.md §1.7.
  app.post(
    "/api/patient-screenings/:id/admin-review/remove-ancillary",
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const { removeAdminReviewAncillary } = await import(
          "../services/plexusIq/adminReviewRemoveService"
        );
        const outcome = await removeAdminReviewAncillary(id, req.body);
        if (!outcome.ok) {
          if (outcome.error.kind === "invalid_id") {
            return res.status(400).json({ error: "Invalid patient id" });
          }
          if (outcome.error.kind === "invalid_ancillary_id") {
            return res.status(400).json({
              error: "ancillaryId must be one of brainwave / vitalwave / ultrasound",
            });
          }
          return res.status(404).json({ error: "Patient not found" });
        }
        res.json({
          ok: true,
          patient: outcome.patient,
          ancillaryId: outcome.ancillaryId,
          removedTests: outcome.removedTests,
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

  // Add a manually-selected ancillary to a patient by hand. Appends the
  // canonical qualifying-test name to patient.qualifyingTests (deduped) and
  // stamps admin-added provenance in the supplemental `adminReview:*`
  // metadata keys. Canonical reasoning is created in an HONEST blank state
  // (operator-selected factors only; AI narrative left empty so the UI/PDF
  // render "not generated yet" rather than fabricated text).
  //
  // Delegated to server/services/plexusIq/adminReviewAddService.ts. Mirrors
  // the validation order / status codes of remove-ancillary.
  app.post(
    "/api/patient-screenings/:id/admin-review/add-ancillary",
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const { addAdminReviewAncillary } = await import(
          "../services/plexusIq/adminReviewAddService"
        );
        const outcome = await addAdminReviewAncillary(id, req.body);
        if (!outcome.ok) {
          if (outcome.error.kind === "invalid_id") {
            return res.status(400).json({ error: "Invalid patient id" });
          }
          if (outcome.error.kind === "invalid_ancillary_id") {
            return res.status(400).json({
              error: "ancillaryId must be one of brainwave / vitalwave / ultrasound",
            });
          }
          return res.status(404).json({ error: "Patient not found" });
        }
        if (!outcome.qualified) {
          return res.json({
            ok: true,
            qualified: false,
            ancillaryId: outcome.ancillaryId,
            requestedTestName: outcome.requestedTestName,
            state: outcome.state,
            candidates: outcome.candidates,
          });
        }
        res.json({
          ok: true,
          qualified: true,
          patient: outcome.patient,
          ancillaryId: outcome.ancillaryId,
          testName: outcome.testName,
          addedTests: outcome.addedTests,
          alreadyPresent: outcome.alreadyPresent,
          narrativeGenerated: outcome.narrativeGenerated,
        });
      } catch (error: any) {
        console.error(
          "[admin-review/add-ancillary] error:",
          error?.message ?? error,
        );
        res.status(500).json({
          error: error?.message ?? "Failed to add ancillary",
        });
      }
    },
  );

  // Sets the admin approval state on a patient_screenings row.
  // Backs the Admin Review modal on Plexus IQ patient cards.
  // Journey-event append is best-effort; if patient_journey_events /
  // patient_execution_cases aren't deployed yet the audit row is
  // dropped silently and the primary column update still succeeds.
  //
  // Admin Review approval triggers scheduler routing — on "approved"
  // we also invoke commitPatient(auto: true) so the canonical
  // execution-case spine fires (createOrUpdateExecutionCaseFromScreening
  // → autoAssignSchedulerForExecutionCase → outreach_schedulers
  // lookup by facility). The auto path skips the manual contact-info
  // gate; admins are the qualifier and contact gaps surface later
  // via the engagement assignment board.
  //
  // SOURCE MARKER: Admin Review approval triggers scheduler routing
  // SOURCE MARKER: Scheduler settings lookup
  // SOURCE MARKER: Engagement assignment creation/update
  // SOURCE MARKER: Engagement Center source of truth
  // SOURCE MARKER: Scheduler assignment runtime
  //
  // PHASE-1 ADMIN-REVIEW COMMIT FAN-OUT (Slice 1.3 audit):
  //   REQUIRED writes (must succeed together):
  //     1. patient_screenings.adminApprovalStatus + audit columns
  //     2. commitPatient(id, userId, { auto: true }) on approve+Draft
  //        → execution case create-or-update
  //        → engagement assignment via Scheduler Settings
  //   OPTIONAL writes (logged on failure, not blocking):
  //     3. patientJourneyEvents insert "admin_approval_updated"
  //     4. logAudit (fire-and-forget)
  //     5. invalidatePatientDatabase (cache only)
  //
  //   No-silent-failure contract: on commitPatient failure, the
  //   response includes commitFailed: true + commitError: string so the
  //   client and the audit trail can distinguish "no commit was
  //   attempted" from "commit attempted and failed". Wrapping
  //   1 + 2 + 3 in a single DB transaction is deferred to Phase 2 —
  //   commitPatient is a multi-write service that needs its own
  //   tx-safety audit before being placed inside a transaction.
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
        const userRole: string | null = (req.session as { role?: string }).role ?? null;
        const isApproved = status === "approved";

        // Phase 2C compatibility bridge — hardened.
        //
        // When FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW is ON, this route
        // MUST NOT directly write the screening-level status as the
        // canonical truth. It:
        //   • 403 on cross-clinic mismatch
        //   • 403 on authorization denied (bubbled from the recorder)
        //   • 503 on missing migration
        //   • 409 NO_ACTIVE_ANCILLARY_CASES when there are no active
        //     cases to review (screening column stays a projection —
        //     we do not create fake state)
        //   • 202 partial-deferred when Engagement reconciliation
        //     deferred (deferred_no_list) — the review event was
        //     recorded but the queue visibility awaits a list
        // When FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW is ON, the legacy
        // screening-level route must NOT be an independent competing
        // truth. Every applicable ancillary case receives a per-service
        // review event (append-only history + reviewer authorization +
        // evidence snapshot + Engagement reconciliation) BEFORE the
        // legacy column is written. The legacy column then reflects the
        // canonical screening projection.
        //
        // Authorization is enforced through the recorder (currently
        // always denies for lack of the Plexus-internal role) — so
        // when the flag is ON, unauthorized callers get a 403 here
        // instead of a silent legacy bypass.
        const { featureFlags: ff } = await import("../lib/featureFlags");
        if (ff.serviceSpecificAdminReview) {
          const acRepo = await import("../repositories/ancillaryCases.repo");
          const { recordAncillaryCaseAdminReview } = await import(
            "../services/adminReview/recordAdminReview"
          );
          const isActiveCase = (c: { lifecycleStatus?: string | null }) =>
            c.lifecycleStatus === "new" ||
            c.lifecycleStatus === "active" ||
            c.lifecycleStatus === "on_hold";
          let activeCases = (await acRepo.listAncillaryCasesForScreening(id)).filter(
            isActiveCase,
          );

          // Self-heal the chicken-and-egg deadlock. A screening that was
          // never committed (e.g. a fresh Draft patient at a facility whose
          // patients were never backfilled) has NO ancillary cases yet — and
          // the ONLY thing that creates them is the commit pipeline
          // (identity resolve → execution case → ancillary cases). Previously
          // this returned 409 and dead-ended, so approval could never advance
          // such a patient into Engagement. Instead, resolve Plexus identity
          // and commit the patient here, then re-read. Ancillary-case
          // creation requires the global identity links, so resolve those
          // first (mirrors the scheduling orchestrators' pattern).
          if (activeCases.length === 0) {
            // Ancillary-case creation requires the screening's clinic tenancy.
            // Some facilities' screenings were never backfilled with a
            // clinic_id (e.g. Life Medical Center rows carry facility name but
            // clinic_id IS NULL), which makes identity resolution skip
            // ("no_clinic") and blocks ancillary-case creation. Resolve the
            // clinic from the facility NAME and persist it first so the whole
            // commit → identity → ancillary-case chain can run.
            let clinicIdForIdentity = patient.clinicId ?? null;
            if (clinicIdForIdentity == null && patient.facility) {
              try {
                const { createFacilityResolver } = await import(
                  "../services/facilityResolver"
                );
                const { resolve } = await createFacilityResolver();
                clinicIdForIdentity = resolve(patient.facility)?.clinicId ?? null;
                if (clinicIdForIdentity != null) {
                  await storage.updatePatientScreening(id, {
                    clinicId: clinicIdForIdentity,
                  });
                }
              } catch (resolveErr) {
                console.error(
                  "[admin-approval] clinic resolve from facility failed:",
                  resolveErr instanceof Error ? resolveErr.message : resolveErr,
                );
              }
            }
            try {
              const { reconcilePlexusIdentityForScreening } = await import(
                "../services/plexusIdentity/reconciliation"
              );
              await reconcilePlexusIdentityForScreening(id, clinicIdForIdentity);
            } catch (identErr) {
              console.error(
                "[admin-approval] identity reconcile before commit failed:",
                identErr instanceof Error ? identErr.message : identErr,
              );
            }
            try {
              // Create/update the execution case AND sync ancillary cases from
              // the screening's qualifying tests. We call this directly (rather
              // than commitPatient) because commitPatient no-ops once the
              // patient is already committed and would skip the ancillary
              // sync — but a screening can be committed yet still lack
              // ancillary cases (identity was only just resolved above). This
              // path is idempotent and re-reads the now-linked screening.
              const freshForCommit = await storage.getPatientScreening(id);
              if (freshForCommit) {
                const { createOrUpdateExecutionCaseFromScreening } = await import(
                  "../repositories/executionCase.repo"
                );
                await createOrUpdateExecutionCaseFromScreening(
                  freshForCommit as never,
                  userId,
                );
              }
              // Also ensure the legacy commit runs for a genuinely Draft
              // patient so scheduler routing / spine fire as before.
              await commitPatient(id, userId, { auto: true });
            } catch (commitErr) {
              console.error(
                "[admin-approval] commit before review failed:",
                commitErr instanceof Error ? commitErr.message : commitErr,
              );
            }
            activeCases = (await acRepo.listAncillaryCasesForScreening(id)).filter(
              isActiveCase,
            );
          }

          if (activeCases.length === 0) {
            // Still nothing after attempting identity + commit. This is a
            // genuine "no reviewable services" state (e.g. no qualifying
            // tests, or identity could not be resolved). Surface it honestly
            // rather than writing the screening column as fake canonical truth.
            return res.status(409).json({
              error: "No active ancillary cases for this screening — review is service-specific",
              code: "NO_ACTIVE_ANCILLARY_CASES",
            });
          }
          const perServiceResults: Array<{
            ancillaryCaseId: number;
            serviceType: string;
            engagementStatus: string;
            retryPending: boolean;
            errorCode?: string;
          }> = [];
          for (const ac of activeCases) {
            try {
              const outcome = await recordAncillaryCaseAdminReview({
                ancillaryCaseId: ac.id,
                clinicId: ac.clinicId,
                newStatus: status,
                effectiveClinicalDate: null,
                rationale: note,
                actor: { userId, role: userRole },
                source: "manual",
              });
              if (outcome.status === "cross_clinic_denied") {
                return res.status(403).json({
                  error: "cross-clinic review refused",
                  code: "CROSS_CLINIC_DENIED",
                });
              }
              if (outcome.status === "case_not_found") {
                // Skip — an active case that vanished between the read
                // and the review is a race, not a failure of intent.
                continue;
              }
              if (outcome.status === "recorded") {
                perServiceResults.push({
                  ancillaryCaseId: outcome.ancillaryCaseId,
                  serviceType: outcome.serviceType,
                  engagementStatus: outcome.engagementOutcome,
                  retryPending: outcome.retryPending,
                  errorCode: outcome.engagementErrorCode,
                });
              }
            } catch (e) {
              const err = e as { code?: string; status?: number; message?: string };
              if (err.code === "ADMIN_REVIEW_ACCESS_DENIED") {
                return res.status(403).json({
                  error: "Admin Review access denied",
                  code: err.code,
                });
              }
              if (
                err.code === "ADMIN_REVIEW_MIGRATION_MISSING" ||
                err.code === "ENGAGEMENT_MIGRATION_MISSING"
              ) {
                return res.status(503).json({
                  error: "Admin Review configuration unavailable",
                  code: err.code,
                });
              }
              throw e;
            }
          }
          // The recorder refreshed the screening projection for each
          // active case. Legacy consumers still expect the note +
          // timestamps to reflect the caller's action:
          await storage.updatePatientScreening(id, {
            adminApprovalNote: note,
            adminApprovedAt: isApproved ? new Date() : null,
            adminApprovedByUserId: isApproved ? userId : null,
          });
          const anyDeferred = perServiceResults.some(
            (r) => r.engagementStatus === "deferred_no_list" || r.retryPending,
          );
          const anyFailed = perServiceResults.some((r) => r.engagementStatus === "failed");
          if (anyFailed) {
            // A reconciler failure means the review event was recorded
            // (we made it here) but Engagement synchronization threw
            // and a durable retry exists. Surface as 503 so operators
            // see the degradation. Persistent recorded-review + retry
            // work stay in the DB.
            return res.status(503).json({
              error: "Engagement reconciliation failed for one or more services",
              code: "ENGAGEMENT_RECONCILIATION_FAILED",
              services: perServiceResults,
            });
          }
          if (anyDeferred) {
            // Partial success — every review event recorded, but at
            // least one service has deferred Engagement visibility
            // pending a source list. Explicitly 202.
            const updatedRefetched = await storage.getPatientScreening(id);
            return res.status(202).json({
              status: "deferred",
              patient: updatedRefetched,
              services: perServiceResults,
            });
          }
        }

        const updated = ff.serviceSpecificAdminReview
          ? await storage.getPatientScreening(id)
          : await storage.updatePatientScreening(id, {
              adminApprovalStatus: status,
              adminApprovedAt: isApproved ? new Date() : null,
              adminApprovedByUserId: isApproved ? userId : null,
              adminApprovalNote: note,
            });
        if (!updated) {
          return res.status(404).json({ error: "Patient not found" });
        }

        // Approval → engagement routing. Reads Scheduler Settings
        // (canonical source = outreach_schedulers table, managed by
        // admins via Settings → Scheduler Team) to surface the
        // target scheduler explicitly, then calls the canonical
        // commit/scheduler-auto-assign pipeline. Idempotent.
        //
        // SOURCE MARKER: Admin Review approval reads Scheduler Settings
        // SOURCE MARKER: Scheduler Settings drive Engagement assignment
        // SOURCE MARKER: Scheduler settings lookup
        // SOURCE MARKER: Engagement assignment creation/update
        // SOURCE MARKER: Engagement Center source of truth
        // SOURCE MARKER: Scheduler assignment runtime
        // SOURCE MARKER: Scheduler settings fallback is Unassigned Engagement Queue
        let routedToEngagement = false;
        let routedSchedulerName: string | null = null;
        let routedSchedulerSettingsSource:
          | "outreach-schedulers-table"
          | "missing" = "missing";
        let routedByScheduledSettings = false;
        // Slice 1.3: explicit commit-failure surface. When commitPatient
        // throws on an approve+Draft path, the client must be able to
        // tell that the commit was *attempted and failed* (vs not
        // attempted because no commit was needed).
        let commitFailed = false;
        let commitError: string | null = null;
        if (isApproved) {
          // Record which facility→scheduler mapping *exists* (for the audit
          // trail / debugging) but do NOT treat its mere existence as a real
          // assignment. A facility having a default scheduler does not mean
          // this patient was routed to that person — only an actual auto-assign
          // (or batch-level Smart Scheduler Assignment) counts. Naming the
          // facility default here is what caused the toast to falsely claim
          // "Routed to scheduler: X" while the patient sat unassigned.
          const { lookupSchedulerFromSettings } = await import(
            "../services/schedulerSettings"
          );
          const settingsLookup = await lookupSchedulerFromSettings(
            patient.facility ?? null,
          );
          routedSchedulerSettingsSource = settingsLookup.source;
          if (updated.commitStatus === "Draft") {
            try {
              const result = await commitPatient(id, userId, { auto: true });
              if (result.ok) {
                routedToEngagement = true;
                // Only surface a scheduler name when the commit confirms an
                // actual assignment. Otherwise the patient landed in the
                // unassigned engagement queue.
                if (result.data.autoAssigned && result.data.schedulerName) {
                  routedSchedulerName = result.data.schedulerName;
                  routedByScheduledSettings =
                    settingsLookup.scheduler != null &&
                    settingsLookup.scheduler.name === result.data.schedulerName;
                }
              } else {
                // commitPatient returned a structured failure; surface
                // it without throwing. CommitError is a discriminated
                // union; render to a stable string for the audit /
                // client surface.
                commitFailed = true;
                const errObj = (result as { error?: { code?: string; missing?: string[] } }).error;
                if (errObj?.code === "validation") {
                  commitError = `validation: ${(errObj.missing ?? []).join(", ") || "missing fields"}`;
                } else if (errObj?.code) {
                  commitError = errObj.code;
                } else {
                  commitError = "commitPatient returned ok: false";
                }
              }
            } catch (commitErr) {
              commitFailed = true;
              commitError =
                commitErr instanceof Error
                  ? commitErr.message
                  : String(commitErr);
              console.error(
                "[admin-approval] commit/scheduler routing failed:",
                commitError,
              );
            }
          } else {
            // Already committed: still treat as routed so the chip /
            // engagement-assignment query refresh fires on the client.
            routedToEngagement = true;
          }
          if (routedSchedulerSettingsSource === "missing") {
            // SOURCE MARKER: Scheduler settings source missing; using current scheduler runtime fallback
          }
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
              summary: commitFailed
                ? `Admin approval set to ${status} — engagement routing FAILED: ${commitError}`
                : `Admin approval set to ${status}`,
              metadata: {
                status,
                note,
                routedToEngagement,
                routedSchedulerName,
                routedSchedulerSettingsSource,
                routedByScheduledSettings,
                // Slice 1.3: include commit-failure flags so the
                // audit trail preserves the failure even when the
                // client refresh might miss it.
                commitFailed,
                commitError,
              },
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
          routedToEngagement,
          routedSchedulerName,
          commitFailed,
          commitError,
        });
        invalidatePatientDatabase();
        const fresh = routedToEngagement ? await storage.getPatientScreening(id) : updated;
        res.json({
          ok: true,
          patient: fresh ?? updated,
          routedToEngagement,
          routedSchedulerName,
          routedSchedulerSettingsSource,
          routedByScheduledSettings,
          // Slice 1.3: no-silent-failure surface. The client uses
          // these to show "approved but engagement routing failed —
          // retry from the Engagement Center" instead of a misleading
          // success state.
          commitFailed,
          commitError,
        });
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
      // Phase 2C — capture the commit result so we can propagate
      // engagementSend to the caller via the shared response mapper.
      let commitResultData: Awaited<ReturnType<typeof commitPatient>> extends { ok: true; data: infer D } ? D : never | null = null as never;
      try {
        const result = await commitPatient(id, req.session.userId ?? null, { auto: true });
        if (result.ok) {
          finalPatient = result.data.patient;
          schedulerName = result.data.schedulerName;
          commitResultData = result.data as never;
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
        // Phase 1 convergence: legacy callListEngine assignment disabled.
        // Assignment now flows through Engagement Center → distributionService
        // → patient_execution_cases.assignedTeamMemberId. The scheduler_assignments
        // table is no longer the live ownership source.
        // const today = new Date().toISOString().slice(0, 10);
        // assignNewlyEligiblePatient(storage, finalPatient, finalPatient.facility, today)
        //   .catch((err) => console.warn("[patients] assignNewlyEligiblePatient failed:", err?.message));
      }

      // Phase 2C — if the commit successfully returned commitResultData
      // AND its engagementSend is deferred or failed, route through the
      // shared response mapper (200/202/503). Otherwise preserve the
      // existing analyze payload shape exactly.
      const analyzeExtra = { ...(finalPatient as object), autoCommittedSchedulerName: schedulerName };
      if (commitResultData) {
        const sendStatus = (commitResultData as { engagementSend?: { status?: string } }).engagementSend?.status;
        if (sendStatus === "deferred" || sendStatus === "failed") {
          const { respondWithCommitOutcome } = await import(
            "./helpers/respondWithCommitOutcome"
          );
          return respondWithCommitOutcome(res, commitResultData as never, { extra: analyzeExtra });
        }
      }
      res.json(analyzeExtra);
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
          // Phase 1 convergence: legacy callListEngine assignment disabled.
          // Assignment now flows through Engagement Center → distributionService.
          // const today = new Date().toISOString().slice(0, 10);
          // assignNewlyEligiblePatient(storage, committedPatient, committedPatient.facility, today)
          //   .catch((err) => console.warn("[patients] assignNewlyEligiblePatient after manual commit failed:", err?.message));
        }
      } catch (assignErr) {
        console.warn("[patients] manual commit live assignment hook failed:", assignErr);
      }

      // Phase 2C — shared commit-outcome response mapper. Translates
      // engagementSend.status into HTTP 200 / 202 / 503 uniformly with
      // every other route that calls commitPatient(). Preserves the
      // existing patient payload shape via `extra`.
      const { respondWithCommitOutcome } = await import(
        "./helpers/respondWithCommitOutcome"
      );
      return respondWithCommitOutcome(res, result.data, {
        extra: {
          ...result.data.patient,
          schedulerName: result.data.schedulerName,
        },
      });
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
