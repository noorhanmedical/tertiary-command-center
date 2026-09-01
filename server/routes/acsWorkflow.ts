// /api/acs-workflow/:executionCaseId — Phase 2 PR 2.5
//
// Returns the ACS workflow snapshot for a case. Read-only.

import type { Express } from "express";
import { getAcsWorkflowSnapshot } from "../services/ancillary/acsWorkflowRuntime";
import { requirePortalRole } from "./portal";

export function registerAcsWorkflowRoutes(app: Express) {
  app.get("/api/acs-workflow/:executionCaseId", requirePortalRole, async (req, res) => {
    try {
      const rawId = req.params.executionCaseId as string;
      const id = parseInt(rawId, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid executionCaseId" });
      const snap = await getAcsWorkflowSnapshot(id);
      if (!snap) return res.status(404).json({ error: "Execution case not found" });
      return res.json(snap);
    } catch (error: any) {
      const code = (error as { code?: string })?.code;
      if (code === "42P01" || code === "42703" || code === "CANONICAL_APPOINTMENT_MIGRATION_MISSING") {
        return res.status(503).json({
          error: "canonical appointment schema unavailable — apply migration 0052",
          code: "CANONICAL_APPOINTMENT_MIGRATION_MISSING",
        });
      }
      return res.status(500).json({ error: error.message });
    }
  });
}
