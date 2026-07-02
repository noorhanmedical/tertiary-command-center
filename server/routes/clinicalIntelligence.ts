// Clinical Intelligence & Governance API — server-backed knowledge layer.
//
// Replaces the localStorage prototype store (plexusIq.clinicalIntelligence.v1)
// so learning items, governance rules (+ version history), evidence
// decisions, and audit entries are shared across devices and team members.
//
// The `by` / `createdBy` / `decidedBy` actor strings are passed by the UI
// (e.g. "Admin", "Physician", "Compliance") to preserve the governance
// role semantics of the prototype; they fall back to the session username.

import type { Express } from "express";
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
} from "../repositories/clinicalIntelligence.repo";

export function registerClinicalIntelligenceRoutes(app: Express) {
  app.get("/api/clinical-intelligence", async (_req, res) => {
    try {
      res.json(await getCiState());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/clinical-intelligence/learning-items", async (req, res) => {
    const parsed = ciCreateLearningItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    try {
      const item = await addLearningItem({
        ...parsed.data,
        createdBy: parsed.data.createdBy || req.session.username || "Unknown",
      });
      res.status(201).json(item);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/clinical-intelligence/learning-items/:id", async (req, res) => {
    const parsed = ciUpdateLearningItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    try {
      const item = await updateLearningItem(req.params.id, parsed.data.by, parsed.data.patch);
      if (!item) return res.status(404).json({ error: "Learning item not found" });
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/clinical-intelligence/learning-items/:id/status", async (req, res) => {
    const parsed = ciLearningStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    try {
      const item = await setLearningStatus(req.params.id, parsed.data.by, parsed.data.status);
      if (!item) return res.status(404).json({ error: "Learning item not found" });
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/clinical-intelligence/learning-items/:id/convert", async (req, res) => {
    const parsed = ciConvertLearningSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    try {
      const rule = await convertLearningToRule(req.params.id, parsed.data.by, parsed.data.overrides ?? {});
      if (!rule) return res.status(404).json({ error: "Learning item not found" });
      res.status(201).json(rule);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/clinical-intelligence/rules", async (req, res) => {
    const parsed = ciCreateRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    try {
      const rule = await addRule({
        ...parsed.data,
        createdBy: parsed.data.createdBy || req.session.username || "Unknown",
      });
      res.status(201).json(rule);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/clinical-intelligence/rules/:id", async (req, res) => {
    const parsed = ciUpdateRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    try {
      const rule = await updateRule(
        req.params.id,
        parsed.data.by,
        parsed.data.patch,
        parsed.data.changeSummary ?? "Rule updated",
      );
      if (!rule) return res.status(404).json({ error: "Rule not found" });
      res.json(rule);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/clinical-intelligence/evidence", async (req, res) => {
    const parsed = ciRecordEvidenceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    try {
      const record = await recordEvidence(parsed.data);
      res.status(201).json(record);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/clinical-intelligence/evidence/:id/used-in-rule", async (req, res) => {
    const parsed = ciMarkEvidenceUsedSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    try {
      await markEvidenceUsedInRule(req.params.id, parsed.data.ruleId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // One-time migration of a browser's legacy localStorage store. Insert-only
  // (onConflictDoNothing by id) so repeated calls or multiple browsers can
  // never duplicate or overwrite server rows; browser-local seeded rules are
  // skipped because the server seeds its own set.
  app.post("/api/clinical-intelligence/import", async (req, res) => {
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
