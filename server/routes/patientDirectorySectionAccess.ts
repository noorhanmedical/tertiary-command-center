// Patient EHR — per-role section access configuration.
//
// GET is readable by any authenticated user so the client runtime guard can
// resolve what the current user may see. PUT is admin-only and records an
// audit_log entry. These routes are intentionally registered OUTSIDE the
// USE_PATIENT_DIRECTORY_ACTIVATION flag gate — the section access model
// applies to the always-on Patient EHR chart in the Patient Database.

import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  getPatientDirectorySectionAccessMatrix,
  savePatientDirectorySectionAccessMatrix,
} from "../repositories/adminSettings.repo";
import {
  PATIENT_DIRECTORY_SECTIONS,
  PATIENT_DIRECTORY_ROLES,
  SECTION_ACCESS_LEVELS,
} from "@shared/patientDirectorySections";
import { logAudit } from "../services/auditService";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  return next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  if ((req.session.role ?? "") !== "admin") {
    return res.status(403).json({ error: "Forbidden — admin role required" });
  }
  return next();
}

const levelSchema = z.enum(SECTION_ACCESS_LEVELS);
const rowSchema = z.record(z.enum(PATIENT_DIRECTORY_ROLES), levelSchema);
const putBodySchema = z.object({
  matrix: z.record(z.string(), rowSchema),
});

export function registerPatientDirectorySectionAccessRoutes(app: Express): void {
  // GET — return the effective matrix + the section registry (for rendering
  // the admin table and the runtime guard).
  app.get("/api/patient-directory/section-access", requireAuth, async (_req, res) => {
    try {
      const matrix = await getPatientDirectorySectionAccessMatrix();
      res.json({ matrix, sections: PATIENT_DIRECTORY_SECTIONS });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "section-access read failed" });
    }
  });

  // PUT — admin-only. Persist the matrix and log the change.
  app.put("/api/patient-directory/section-access", requireAdmin, async (req, res) => {
    try {
      const parsed = putBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const saved = await savePatientDirectorySectionAccessMatrix(parsed.data.matrix);
      await logAudit(
        req,
        "patient_directory_section_access_update",
        "patient_directory",
        "section_access",
        { matrix: saved },
      );
      res.json({ matrix: saved, sections: PATIENT_DIRECTORY_SECTIONS });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "section-access write failed" });
    }
  });
}
