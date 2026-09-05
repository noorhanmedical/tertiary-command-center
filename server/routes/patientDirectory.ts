// Patient EHR API routes (Batch C).
//
// Registration is gated on USE_PATIENT_DIRECTORY_ACTIVATION. When the
// flag is OFF (default), the route file is imported but no endpoints
// are attached — so production behavior is unchanged until Ali flips
// the flag and applies migrations 0027-0029.
//
// Every handler is wrapped in try/catch and never lets a missing
// 0027/0028/0029 column crash a request — the underlying service +
// storage deps are defensive.

import type { Express } from "express";
import { isPatientDirectoryActivationEnabled } from "../services/patientDirectory/patientDirectoryActivationFlag";
import {
  addPriorTest,
  buildDuplicateFacts,
  clearCooldown,
  clearDoNotContact,
  createPatientDirectoryProfile,
  searchPatientDirectory,
  setCooldown,
  setDoNotContact,
  updatePatientDirectoryProfile,
  writePatientDirectoryEvent,
  type PatientDirectoryEventKind,
} from "../services/patientDirectory/patientDirectoryWriter";
import {
  getPatientDirectorySnapshot,
} from "../services/patientDirectory/patientDirectoryService";
import { createPatientDirectoryStorageDeps } from "../services/patientDirectory/patientDirectoryStorageDeps";
import { startBatchAnalysis } from "../services/batchAnalysisRunner";
import {
  classifyImportRows,
  detectSourceFields,
  extractCsvHeaders,
  isMinimalFieldImport,
  parseCsv,
  parseTxt,
  type ParsedImportRow,
} from "../../client/src/lib/patientDirectoryImport";
import { findFuzzyNameMatches } from "../../shared/patientIdentity";
import { storage } from "../storage";
import {
  resolveAndLinkPlexusIdentityForScreening,
  recordScreeningIdentityLinkFailure,
} from "../services/plexusIdentity/screeningIntegration";
import {
  createImportBatch,
  deleteImportBatch,
  getImportBatchMeta,
  getImportBatchPendingPayload,
  listImportBatches,
  setBatchPendingPayload,
  syncImportBatchPatientCount,
  type ImportKind,
  type PendingImportPayload,
} from "../services/patientDirectory/importSessions";
import { errorPhiSafe } from "../lib/phiSafeLogger";

export function registerPatientDirectoryRoutes(app: Express): void {
  if (!isPatientDirectoryActivationEnabled()) {
    // Default: no endpoints registered. The route file stays importable
    // so the registration site doesn't fail; flipping the flag enables
    // every handler below on the next process restart.
    return;
  }
  const deps = createPatientDirectoryStorageDeps();

  // ── search ───────────────────────────────────────────────────────────
  app.get("/api/patient-directory/search", async (req, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
      const rows = await searchPatientDirectory(q, limit);
      res.json({ rows });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "search failed" });
    }
  });

  // ── import sessions (Recent Imports) ─────────────────────────────────
  // NOTE: must be registered BEFORE the `/:patientId` param route so
  // "import-batches" is not swallowed by the param matcher.
  app.get("/api/patient-directory/import-batches", async (req, res) => {
    try {
      const isAdmin = (req.session?.role ?? "clinician") === "admin";
      const batches = await listImportBatches(30);
      // Only admins (the reviewers) get the parked payload contents; other
      // roles still see the `pending` flag for the "Waiting for approval"
      // badge but not the sensitive row/match details.
      const shaped = isAdmin
        ? batches
        : batches.map((b) => ({ ...b, pendingPayload: null }));
      res.json({ batches: shaped });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "import batches failed" });
    }
  });

  app.delete("/api/patient-directory/import-batches/:id", async (req, res) => {
    try {
      if ((req.session?.role ?? "clinician") !== "admin") {
        return res.status(403).json({ error: "Forbidden — admin access required", code: "ADMIN_ONLY" });
      }
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "batch id required" });
      const actor = req.session?.userId ?? null;
      const { affected } = await deleteImportBatch(id, actor);
      res.json({ ok: true, affected });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "delete import batch failed" });
    }
  });

  // ── snapshot ─────────────────────────────────────────────────────────
  app.get("/api/patient-directory/:patientId", async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.patientId), 10);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "patientId required" });
      const snap = await getPatientDirectorySnapshot(id, deps);
      if (!snap) return res.status(404).json({ error: "Not found" });
      res.json(snap);
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "snapshot failed" });
    }
  });

  // ── audit ────────────────────────────────────────────────────────────
  app.get("/api/patient-directory/:patientId/audit", async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.patientId), 10);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "patientId required" });
      const events = await deps.loadEvents(id);
      res.json({ events });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "audit failed" });
    }
  });

  // ── prior tests ──────────────────────────────────────────────────────
  app.get("/api/patient-directory/:patientId/prior-tests", async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.patientId), 10);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "patientId required" });
      const tests = await deps.loadPriorTests(id);
      res.json({ tests });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "prior tests failed" });
    }
  });

  // ── contact restrictions ─────────────────────────────────────────────
  app.get("/api/patient-directory/:patientId/contact-restrictions", async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.patientId), 10);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "patientId required" });
      const snap = await getPatientDirectorySnapshot(id, deps);
      if (!snap) return res.status(404).json({ error: "Not found" });
      res.json({
        doNotContact: snap.flags.doNotContact,
        doNotContactReason: snap.flags.doNotContactReason,
        cooldown: snap.cooldown,
      });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "restrictions failed" });
    }
  });

  // ── create / update profile ──────────────────────────────────────────
  app.post("/api/patient-directory", async (req, res) => {
    try {
      const actor = req.session?.userId ?? null;
      const body = req.body ?? {};
      if (!body.name || !body.dob || !body.batchId) {
        return res.status(400).json({ error: "name, dob, batchId required" });
      }
      const result = await createPatientDirectoryProfile({ ...body, actorUserId: actor });

      // Phase 2A — shared identity orchestration. No-op with
      // FEATURE_PLEXUS_IDENTITY_WRITE=OFF. Awaited so schema-
      // configuration failures surface here instead of being lost to
      // a fire-and-forget promise. On failure a durable retry-ledger
      // row is written so the reconciliation service can pick it up.
      try {
        const reqClinicId = (req as { clinicId?: number | null }).clinicId ?? null;
        await resolveAndLinkPlexusIdentityForScreening({
          screeningId: result.patientScreeningId,
          clinicId: reqClinicId,
          sourceSystem: "patient_directory_manual_create",
          clinicMrn: (body.mrn as string | null | undefined) ?? null,
          demographics: {
            displayName: body.name as string,
            dob: body.dob as string,
            phone: (body.phoneNumber as string | null | undefined) ?? null,
            email: (body.email as string | null | undefined) ?? null,
          },
        });
      } catch (e) {
        const errorCode = (e as { code?: string })?.code;
        errorPhiSafe("plexus_identity_integration_failed", {
          route: "POST /api/patient-directory",
          screeningId: result.patientScreeningId,
          code: errorCode,
          error: (e as Error)?.message ?? String(e),
        });
        await recordScreeningIdentityLinkFailure({
          screeningId: result.patientScreeningId,
          clinicId: (req as { clinicId?: number | null }).clinicId ?? null,
          sourceSystem: "patient_directory_manual_create",
          errorCode,
        });
      }

      res.status(201).json(result);
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "create failed" });
    }
  });

  app.patch("/api/patient-directory/:patientId", async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.patientId), 10);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "patientId required" });
      const actor = req.session?.userId ?? null;
      await updatePatientDirectoryProfile(id, req.body ?? {}, actor);
      res.json({ ok: true });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "update failed" });
    }
  });

  // ── import preview / confirm ─────────────────────────────────────────
  app.post("/api/patient-directory/import-preview", async (req, res) => {
    try {
      const body = req.body ?? {};
      const format = String(body.format ?? "csv").toLowerCase();
      const text = String(body.text ?? "");
      const parsed = format === "txt" ? parseTxt(text) : parseCsv(text);
      const sourceFields = format === "txt"
        ? ["name", "dob", "phoneNumber", "facility", "mrn"]
        : detectSourceFields(extractCsvHeaders(text));
      const minimal = isMinimalFieldImport(parsed);

      if (minimal) {
        // Minimal ("service") import: only a name column plus optional
        // service extras. Key-based classification can't run — fuzzy
        // name-match each row against existing profiles instead.
        const existing = await storage.getAllPatientScreenings();
        const rows = parsed.map((row: ParsedImportRow) => {
          const name = (row.identity.name ?? "").trim();
          const candidates = name
            ? findFuzzyNameMatches(name, existing, (p) => (p as { name?: string }).name)
            : [];
          const matchCandidates = candidates.map((c) => {
            const p = c.row as { id: number; name: string; dob?: string | null; facility?: string | null };
            return {
              patientScreeningId: p.id,
              name: p.name,
              dob: p.dob ?? null,
              facility: p.facility ?? null,
              score: Math.round(c.score * 100) / 100,
            };
          });
          const classifications = name.length === 0
            ? ["missing_required_fields"]
            : matchCandidates.length > 0 ? ["matched_existing"] : ["new"];
          return {
            rowIndex: row.rowIndex,
            identity: row.identity,
            extras: row.extras ?? {},
            classifications,
            missingFields: name.length === 0 ? ["name"] : [],
            matchedExistingId: matchCandidates[0]?.patientScreeningId ?? null,
            matchCandidates,
            selected: name.length > 0,
          };
        });
        return res.json({ rows, sourceFields, minimal: true });
      }

      const facts = body.facts ?? { existing: [], dnc: [], cooldown: [], priorTests: [], sentToEngagement: [] };
      const rows = classifyImportRows(parsed, facts).map((r, i) => ({
        ...r,
        extras: parsed[i]?.extras ?? {},
      }));
      res.json({ rows, sourceFields, minimal: false });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "import preview failed" });
    }
  });

  app.post("/api/patient-directory/import-confirm", async (req, res) => {
    try {
      const body = req.body ?? {};
      const actor = req.session?.userId ?? null;
      const role = req.session?.role ?? "clinician";
      const isAdmin = role === "admin";

      const selected: Array<{
        rowIndex?: number;
        identity: Record<string, string | null | undefined>;
        extras?: { dateOfService?: string; procedure?: string };
        clinical?: Record<string, string | undefined>;
        patientType?: "visit" | "outreach";
      }> = body.selected ?? [];
      const approvedMatches: Array<{
        importRowIndex: number;
        existingPatientId: number;
        dateOfService?: string | null;
        procedure?: string | null;
        name?: string | null;
      }> = body.approvedMatches ?? [];
      const sourceFields: string[] = Array.isArray(body.sourceFields) ? body.sourceFields.map(String) : [];
      const requestedKind: ImportKind = body.importKind === "service" ? "service" : "full";
      const submitForApproval = body.submitForApproval === true;

      // Authoritative import kind: for an existing batch the DB-stamped
      // import_kind and pending state govern — NEVER the client-supplied
      // importKind (a non-admin could relabel a pending service batch as
      // "full" to bypass admin approval).
      let batchId: number = Number(body.batchId) || 0;
      let importKind: ImportKind = requestedKind;
      let batchHasPending = false;
      if (batchId > 0) {
        const meta = await getImportBatchMeta(batchId);
        if (!meta.exists) {
          return res.status(404).json({ error: "Batch not found", code: "BATCH_NOT_FOUND" });
        }
        importKind = meta.importKind ?? requestedKind;
        batchHasPending = meta.hasPendingPayload;
      }

      // Minimal-field imports, pending-approval batches, and profile-match
      // linking require admin sign-off before anything is committed.
      // Non-admins may only park the payload for asynchronous approval.
      const needsAdmin = importKind === "service" || batchHasPending || approvedMatches.length > 0;
      if (!isAdmin && needsAdmin && !submitForApproval) {
        return res.status(403).json({
          error: "Pending admin approval — an admin must review matched profiles before commit",
          code: "IMPORT_APPROVAL_REQUIRED",
        });
      }
      // A batch parked for approval can only be moved forward by an admin,
      // even for re-submission (prevents payload tampering by other roles).
      if (!isAdmin && batchHasPending && submitForApproval) {
        return res.status(403).json({
          error: "This import is already waiting for admin approval",
          code: "IMPORT_APPROVAL_REQUIRED",
        });
      }

      const today = new Date().toISOString().slice(0, 10);
      const batchLabel = importKind === "service"
        ? `Service Import – ${Math.max(sourceFields.length, 1)} fields (${today})`
        : `Directory Import (${today})`;

      // Resolve the batch: reuse a provided one (e.g. committing a
      // pending batch) or create a fresh import-session batch. The kind
      // persisted here is what governs all follow-up authorization.
      if (batchId <= 0) {
        batchId = await createImportBatch({
          name: String(body.batchName ?? batchLabel),
          sourceFields,
          importKind,
          createdBy: actor,
        });
      }

      if (submitForApproval) {
        const username = req.session?.username ?? null;
        const payload: PendingImportPayload = {
          rows: body.previewRows ?? [],
          sourceFields,
          minimal: importKind === "service",
          submittedBy: actor,
          submittedByUsername: username,
          submittedAt: new Date().toISOString(),
        };
        await setBatchPendingPayload(batchId, payload);
        await writePatientDirectoryEvent({
          patientScreeningId: null,
          kind: "import_submitted_for_approval",
          actorUserId: actor,
          relatedEntityId: batchId,
          relatedEntityType: "screening_batch",
          payload: { batchId, rowCount: payload.rows.length, sourceFields },
        });
        return res.json({ createdIds: [], linked: [], batchId, pending: true });
      }

      const created: number[] = [];
      for (const row of selected) {
        const name = row.identity?.name ?? null;
        if (!name) continue;
        // Full imports still require DOB; service imports may create
        // name-only profiles (admin approved them explicitly).
        if (importKind !== "service" && !row.identity?.dob) continue;
        const insert: Record<string, unknown> = {
          batchId,
          name,
          dob: row.identity?.dob ?? null,
          facility: row.identity?.facility ?? null,
          phoneNumber: row.identity?.phoneNumber ?? row.identity?.phone ?? null,
          patientType: row.patientType ?? "visit",
        };
        if (row.identity?.mrn) insert.mrn = row.identity.mrn;
        
        // Carry clinical fields through to patient_screenings
        const clinical = row.clinical;
        if (clinical) {
          if (clinical.email) insert.email = clinical.email;
          if (clinical.insurance) insert.insurance = clinical.insurance;
          if (clinical.gender) insert.gender = clinical.gender;
          if (clinical.age) insert.age = parseInt(clinical.age, 10) || null;
          if (clinical.diagnoses) insert.diagnoses = clinical.diagnoses;
          if (clinical.history) insert.history = clinical.history;
          if (clinical.medications) insert.medications = clinical.medications;
          if (clinical.previousTests) insert.previousTests = clinical.previousTests;
          if (clinical.previousTestsDate) insert.previousTestsDate = clinical.previousTestsDate;
          if (clinical.notes) insert.notes = clinical.notes;
        }
        let patientScreeningId: number;
        if (importKind === "service") {
          const createdRow = await storage.createPatientScreening(insert as never);
          patientScreeningId = (createdRow as unknown as { id: number }).id;
          await writePatientDirectoryEvent({
            patientScreeningId,
            kind: "patient_created",
            actorUserId: actor,
            payload: { batchId, facility: row.identity?.facility ?? null, minimalImport: true },
          });
        } else {
          const result = await createPatientDirectoryProfile({
            name,
            dob: row.identity!.dob!,
            facility: row.identity?.facility ?? null,
            mrn: row.identity?.mrn ?? null,
            phoneNumber: row.identity?.phoneNumber ?? row.identity?.phone ?? null,
            email: clinical?.email ?? null,
            insurance: clinical?.insurance ?? null,
            notes: clinical?.notes ?? null,
            batchId,
            patientType: row.patientType ?? "visit",
            actorUserId: actor,
          });
          patientScreeningId = result.patientScreeningId;
          
          // createPatientDirectoryProfile handles name, dob, facility, mrn, phone, email, insurance, notes.
          // Remaining clinical fields need a direct update:
          if (clinical) {
            const extraClinical: Record<string, unknown> = {};
            if (clinical.gender) extraClinical.gender = clinical.gender;
            if (clinical.age) extraClinical.age = parseInt(clinical.age, 10) || null;
            if (clinical.diagnoses) extraClinical.diagnoses = clinical.diagnoses;
            if (clinical.history) extraClinical.history = clinical.history;
            if (clinical.medications) extraClinical.medications = clinical.medications;
            if (clinical.previousTests) extraClinical.previousTests = clinical.previousTests;
            if (clinical.previousTestsDate) extraClinical.previousTestsDate = clinical.previousTestsDate;
            if (Object.keys(extraClinical).length > 0) {
              await storage.updatePatientScreening(patientScreeningId, extraClinical as never);
            }
          }
        }
        created.push(patientScreeningId);

        // Parse previousTests and create historical records
        const previousTests = clinical?.previousTests;
        const previousTestsDate = clinical?.previousTestsDate;
        if (previousTests && typeof previousTests === 'string') {
          // Parse previousTests: "BrainWave; VitalWave; Echo" or "BrainWave, VitalWave"
          const testNames = previousTests
            .split(/[;,]/)
            .map(t => t.trim())
            .filter(t => t.length > 0);
          
          const dateOfService = previousTestsDate || new Date().toISOString().slice(0, 10);
          
          for (const testName of testNames) {
            try {
              await addPriorTest(patientScreeningId, {
                patientName: name,
                testName,
                dateOfService,
                facility: row.identity?.facility ?? null,
                source: "csv_import",
                notes: `Imported from CSV on ${new Date().toISOString().slice(0, 10)}`,
                actorUserId: actor,
              });
            } catch (e) {
              errorPhiSafe("add_prior_test_failed", {
                testName,
                error: (e as Error)?.message ?? String(e),
              });
              // Don't fail the import if historical record creation fails
            }
          }
        }

        // Phase 2A — shared identity orchestration. No-op with
        // FEATURE_PLEXUS_IDENTITY_WRITE=OFF. When ON, this links the
        // newly created screening to a global Plexus patient + clinic
        // membership. MRN (when provided) participates as the deterministic
        // definitive-match signal within the same clinic scope.
        try {
          const reqClinicId = (req as { clinicId?: number | null }).clinicId ?? null;
          await resolveAndLinkPlexusIdentityForScreening({
            screeningId: patientScreeningId,
            clinicId: reqClinicId,
            sourceSystem: "patient_directory_import_confirm",
            clinicMrn: (row.identity?.mrn as string | null | undefined) ?? null,
            demographics: {
              displayName: name,
              dob: (row.identity?.dob as string | null | undefined) ?? null,
              phone: (row.identity?.phoneNumber as string | null | undefined) ??
                (row.identity?.phone as string | null | undefined) ?? null,
              email: (row.identity?.email as string | null | undefined) ?? null,
            },
          });
        } catch (e) {
          const errorCode = (e as { code?: string })?.code;
          errorPhiSafe("plexus_identity_integration_failed", {
            route: "POST /api/patient-directory/import-confirm",
            screeningId: patientScreeningId,
            code: errorCode,
            error: (e as Error)?.message ?? String(e),
          });
          await recordScreeningIdentityLinkFailure({
            screeningId: patientScreeningId,
            clinicId: (req as { clinicId?: number | null }).clinicId ?? null,
            sourceSystem: "patient_directory_import_confirm",
            errorCode,
          });
        }

        await writePatientDirectoryEvent({
          patientScreeningId,
          kind: "imported",
          actorUserId: actor,
          payload: {
            batchId,
            dateOfService: row.extras?.dateOfService ?? null,
            procedure: row.extras?.procedure ?? null,
          },
        });
      }

      // Approved matches: link the visit/procedure to the existing
      // profile instead of creating a duplicate patient row.
      const linked: Array<{ importRowIndex: number; existingPatientId: number; eventKind: string }> = [];
      for (const m of approvedMatches) {
        const existingId = Number(m.existingPatientId);
        if (!Number.isFinite(existingId) || existingId <= 0) continue;
        const eventKind = m.procedure ? "procedure_linked" : "visit_linked";
        await writePatientDirectoryEvent({
          patientScreeningId: existingId,
          kind: eventKind as never,
          actorUserId: actor,
          relatedEntityId: batchId,
          relatedEntityType: "screening_batch",
          payload: {
            batchId,
            importRowIndex: m.importRowIndex,
            importedName: m.name ?? null,
            dateOfService: m.dateOfService ?? null,
            procedure: m.procedure ?? null,
          },
        });
        linked.push({ importRowIndex: m.importRowIndex, existingPatientId: existingId, eventKind });
      }

      // Commit of a previously pending batch clears its parked payload.
      const hadPending = await getImportBatchPendingPayload(batchId);
      if (hadPending) await setBatchPendingPayload(batchId, null);
      await syncImportBatchPatientCount(batchId);

      // Auto-qualify imported patients via Plexus IQ
      // This runs the AI qualification logic on all newly imported patients
      // and sets adminApprovalStatus='pending' for qualified patients so
      // they appear in the Admin Review queue.
      let qualificationJobId: number | null = null;
      if (created.length > 0) {
        try {
          const qualifyResult = await startBatchAnalysis(batchId, actor, {});
          qualificationJobId = qualifyResult.jobId;
          
          // After qualification completes, set adminApprovalStatus='pending'
          // for patients with qualifyingTests.length > 0
          // Note: This is fire-and-forget; the background job will handle it
          void (async () => {
            try {
              // Poll for job completion (max 5 minutes)
              const maxAttempts = 60; // 60 * 5s = 5 minutes
              let attempts = 0;
              let jobCompleted = false;
              
              while (attempts < maxAttempts && !jobCompleted) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
                const job = await storage.getActiveAnalysisJobByBatch(batchId);
                if (!job || job.status === "completed" || job.status === "failed") {
                  jobCompleted = true;
                }
                attempts++;
              }
              
              // Set adminApprovalStatus='pending' for all qualified patients in this batch
              if (jobCompleted) {
                const patients = await storage.getPatientScreeningsByBatch(batchId);
                for (const p of patients) {
                  const hasQualification = Array.isArray(p.qualifyingTests) && p.qualifyingTests.length > 0;
                  if (hasQualification && !p.adminApprovalStatus) {
                    await storage.updatePatientScreening(p.id, {
                      adminApprovalStatus: "pending",
                    } as never);
                  }
                }
              }
            } catch (e) {
              errorPhiSafe("auto_qualification_post_processing_failed", {
                error: (e as Error)?.message ?? String(e),
              });
            }
          })();
        } catch (e) {
          errorPhiSafe("auto_qualification_failed", {
            error: (e as Error)?.message ?? String(e),
          });
          // Don't fail the import if qualification fails
        }
      }

      res.json({ 
        createdIds: created, 
        linked, 
        batchId, 
        pending: false,
        qualificationJobId 
      });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "import confirm failed" });
    }
  });

  // ── prior tests (write) ──────────────────────────────────────────────
  app.post("/api/patient-directory/:patientId/prior-tests", async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.patientId), 10);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "patientId required" });
      const actor = req.session?.userId ?? null;
      const body = req.body ?? {};
      if (!body.patientName || !body.testName) return res.status(400).json({ error: "patientName + testName required" });
      await addPriorTest(id, {
        patientName: body.patientName,
        testName: body.testName,
        dateOfService: body.dateOfService ?? null,
        facility: body.facility ?? null,
        source: body.source ?? null,
        notes: body.notes ?? null,
        actorUserId: actor,
      });
      res.json({ ok: true });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "prior test write failed" });
    }
  });

  // ── DNC ──────────────────────────────────────────────────────────────
  app.post("/api/patient-directory/:patientId/contact-restrictions", async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.patientId), 10);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "patientId required" });
      const actor = req.session?.userId ?? null;
      const body = req.body ?? {};
      const action = String(body.action ?? "set");
      if (action === "clear") {
        await clearDoNotContact(id, actor);
      } else {
        await setDoNotContact(id, { reason: body.reason ?? null, actorUserId: actor });
      }
      res.json({ ok: true });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "DNC update failed" });
    }
  });

  // ── cooldown ─────────────────────────────────────────────────────────
  app.post("/api/patient-directory/:patientId/cooldown", async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.patientId), 10);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "patientId required" });
      const actor = req.session?.userId ?? null;
      const body = req.body ?? {};
      const action = String(body.action ?? "set");
      if (action === "clear") {
        await clearCooldown(id, actor);
      } else {
        if (!body.endsAt) return res.status(400).json({ error: "endsAt required" });
        await setCooldown(id, { endsAt: body.endsAt, reason: body.reason ?? null, actorUserId: actor });
      }
      res.json({ ok: true });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "cooldown update failed" });
    }
  });

  // ── audit events (write) ─────────────────────────────────────────────
  app.post("/api/patient-directory/:patientId/events", async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.patientId), 10);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "patientId required" });
      const actor = req.session?.userId ?? null;
      const body = req.body ?? {};
      const kind = body.kind as PatientDirectoryEventKind;
      if (!kind) return res.status(400).json({ error: "kind required" });
      await writePatientDirectoryEvent({
        patientScreeningId: id,
        kind,
        actorUserId: actor,
        sourceModule: body.sourceModule ?? null,
        relatedEntityId: body.relatedEntityId ?? null,
        relatedEntityType: body.relatedEntityType ?? null,
        payload: body.payload ?? {},
      });
      res.json({ ok: true });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "event write failed" });
    }
  });

  // ── duplicate-warning facts ──────────────────────────────────────────
  app.post("/api/patient-directory/duplicate-warning-facts", async (req, res) => {
    try {
      const body = req.body ?? {};
      const targets = Array.isArray(body.targets) ? body.targets : [];
      const facts = await buildDuplicateFacts(targets);
      res.json(facts);
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "facts failed" });
    }
  });
}
