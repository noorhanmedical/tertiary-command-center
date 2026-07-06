// Clinical Intelligence & Governance API — server-backed knowledge layer.
//
// Replaces the localStorage prototype store (plexusIq.clinicalIntelligence.v1)
// so learning items, governance rules (+ version history), evidence
// decisions, and audit entries are shared across devices and team members.
//
// RBAC is enforced server-side (mirroring
// client/src/lib/clinicalIntelligence/permissions.ts):
//   - All governance mutations require admin or clinician role.
//   - Approving (activating) a rule out of pending_physician_review requires
//     the clinician role; out of pending_compliance_review requires admin.
//     That check runs inside the repo's FOR UPDATE transaction so it is
//     race-free against concurrent status changes.
//   - The audit/version-history actor is always the session user's username;
//     client-supplied `by` / `createdBy` / `decidedBy` values are ignored.
// Reads stay open to all authenticated users (schedulers/billers are
// read-only consumers of the governance surfaces).

import type { Express, RequestHandler } from "express";
import {
  ciCreateLearningItemSchema,
  ciUpdateLearningItemSchema,
  ciLearningStatusSchema,
  ciCreateRuleSchema,
  ciUpdateRuleSchema,
  ciConvertLearningSchema,
  ciRecordEvidenceSchema,
  ciMarkEvidenceUsedSchema,
  ciImportSchema,
} from "@shared/schema/clinicalIntelligence";
import {
  getCiState,
  addLearningItem,
  updateLearningItem,
  setLearningStatus,
  addRule,
  updateRule,
  convertLearningToRule,
  recordEvidence,
  markEvidenceUsedInRule,
  importCiState,
  CiForbiddenError,
} from "../repositories/clinicalIntelligence.repo";

type RequireRole = (...roles: string[]) => RequestHandler;

export function registerClinicalIntelligenceRoutes(app: Express, requireRole: RequireRole) {
  // Governance mutations are limited to admins and clinicians. Schedulers
  // and billers see everything read-only via the GET endpoint.
  const manageGovernance = requireRole("admin", "clinician");

  /** Tamper-proof actor: always the logged-in session user. */
  const sessionActor = (req: { session: { username?: string } }): string =>
    req.session.username || "Unknown";

  app.get("/api/clinical-intelligence", async (_req, res) => {
    try {
      res.json(await getCiState());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/clinical-intelligence/learning-items", manageGovernance, async (req, res) => {
    const parsed = ciCreateLearningItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    try {
      const item = await addLearningItem({
        ...parsed.data,
        createdBy: sessionActor(req),
      });
      res.status(201).json(item);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/clinical-intelligence/learning-items/:id", manageGovernance, async (req, res) => {
    const parsed = ciUpdateLearningItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    try {
      const item = await updateLearningItem(String(req.params.id), sessionActor(req), parsed.data.patch);
      if (!item) return res.status(404).json({ error: "Learning item not found" });
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post(
    "/api/clinical-intelligence/learning-items/:id/status",
    manageGovernance,
    async (req, res) => {
      const parsed = ciLearningStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      try {
        const item = await setLearningStatus(String(req.params.id), sessionActor(req), parsed.data.status);
        if (!item) return res.status(404).json({ error: "Learning item not found" });
        res.json(item);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.post(
    "/api/clinical-intelligence/learning-items/:id/convert",
    manageGovernance,
    async (req, res) => {
      const parsed = ciConvertLearningSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      try {
        const rule = await convertLearningToRule(
          String(req.params.id),
          sessionActor(req),
          parsed.data.overrides ?? {},
        );
        if (!rule) return res.status(404).json({ error: "Learning item not found" });
        res.status(201).json(rule);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.post("/api/clinical-intelligence/rules", manageGovernance, async (req, res) => {
    const parsed = ciCreateRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    try {
      const rule = await addRule({
        ...parsed.data,
        createdBy: sessionActor(req),
      });
      res.status(201).json(rule);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/clinical-intelligence/rules/:id", manageGovernance, async (req, res) => {
    const parsed = ciUpdateRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    try {
      const rule = await updateRule(
        String(req.params.id),
        sessionActor(req),
        parsed.data.patch,
        parsed.data.changeSummary ?? "Rule updated",
        req.session.role ?? "clinician",
      );
      if (!rule) return res.status(404).json({ error: "Rule not found" });
      res.json(rule);
    } catch (error: any) {
      if (error instanceof CiForbiddenError) {
        return res.status(403).json({ error: error.message, code: "CI_FORBIDDEN" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/clinical-intelligence/evidence", manageGovernance, async (req, res) => {
    const parsed = ciRecordEvidenceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    try {
      const record = await recordEvidence({
        ...parsed.data,
        decidedBy: sessionActor(req),
      });
      res.status(201).json(record);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post(
    "/api/clinical-intelligence/evidence/:id/used-in-rule",
    manageGovernance,
    async (req, res) => {
      const parsed = ciMarkEvidenceUsedSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      try {
        await markEvidenceUsedInRule(String(req.params.id), parsed.data.ruleId);
        res.json({ ok: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  // One-time migration of a browser's legacy localStorage store. Insert-only
  // (onConflictDoNothing by id) so repeated calls or multiple browsers can
  // never duplicate or overwrite server rows; browser-local seeded rules are
  // skipped because the server seeds its own set. Gated to governance
  // managers — importing arbitrary rules (including active ones) is a
  // governance action.
  app.post("/api/clinical-intelligence/import", manageGovernance, async (req, res) => {
    const parsed = ciImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    try {
      const imported = await importCiState(parsed.data);
      res.json({ ok: true, imported });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
