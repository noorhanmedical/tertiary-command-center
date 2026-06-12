// Patient Directory API routes (Batch C).
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
import {
  classifyImportRows,
  parseCsv,
  parseTxt,
} from "../../client/src/lib/patientDirectoryImport";

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
      const facts = body.facts ?? { existing: [], dnc: [], cooldown: [], priorTests: [], sentToEngagement: [] };
      const rows = classifyImportRows(parsed, facts);
      res.json({ rows });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "import preview failed" });
    }
  });

  app.post("/api/patient-directory/import-confirm", async (req, res) => {
    try {
      const body = req.body ?? {};
      const batchId: number = body.batchId;
      const selected: Array<{ identity: Record<string, string | null>; patientType?: "visit" | "outreach" }> = body.selected ?? [];
      if (!batchId) return res.status(400).json({ error: "batchId required" });
      const actor = req.session?.userId ?? null;
      const created: number[] = [];
      for (const row of selected) {
        if (!row.identity?.name || !row.identity?.dob) continue;
        const result = await createPatientDirectoryProfile({
          name: row.identity.name,
          dob: row.identity.dob,
          facility: row.identity.facility ?? null,
          mrn: row.identity.mrn ?? null,
          phoneNumber: row.identity.phoneNumber ?? row.identity.phone ?? null,
          batchId,
          patientType: row.patientType ?? "visit",
          actorUserId: actor,
        });
        created.push(result.patientScreeningId);
        await writePatientDirectoryEvent({
          patientScreeningId: result.patientScreeningId,
          kind: "imported",
          actorUserId: actor,
          payload: { batchId },
        });
      }
      res.json({ createdIds: created });
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
