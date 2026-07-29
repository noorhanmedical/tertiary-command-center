// Phase 2H — clinic-scoped canonical Clinician Portal overview API (READ-ONLY).
//
// One batched GET. Reuses the EXISTING Clinician Portal authorization boundary
// (clinician|admin + server-context clinic scope). Flag OFF → explicit disabled
// contract returned BEFORE any canonical read. Migration missing → truthful 503.
// No writes, no retry records, no document bytes, no clinic/actor from body.

import type { Express, Request, Response, NextFunction } from "express";
import { featureFlags } from "../lib/featureFlags";
import { disabledClinicianPortalOverview } from "@shared/clinicianPortalOverview";
import { getClinicianPortalCanonicalOverview } from "../services/clinicianPortal/canonicalOverview";

const MIGRATION_MISSING = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);

function requireClinicianOrAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  const role = req.session.role ?? "clinician";
  if (role !== "clinician" && role !== "admin") return res.status(403).json({ error: "Forbidden — clinician role required" });
  return next();
}
function requireClinicScope(req: Request, res: Response): number | null {
  const clinicId = (req as { clinicId?: number | null }).clinicId ?? null;
  if (clinicId == null) { res.status(403).json({ error: "Clinic scope required" }); return null; }
  return clinicId;
}

export function registerClinicianPortalCanonicalRoutes(app: Express): void {
  app.get("/api/clinician-portal/canonical-overview", requireClinicianOrAdmin, async (req, res) => {
    // Flag OFF → explicit disabled contract, ZERO canonical reads.
    if (!featureFlags.clinicianPortalCanonicalData) {
      return res.json(disabledClinicianPortalOverview(new Date().toISOString()));
    }
    const clinicId = requireClinicScope(req, res);
    if (clinicId == null) return;
    try {
      const overview = await getClinicianPortalCanonicalOverview({ clinicId });
      return res.json(overview);
    } catch (e) {
      if (MIGRATION_MISSING.has((e as { code?: string })?.code ?? "")) {
        return res.status(503).json({ error: "Clinician Portal overview unavailable", code: "ANCILLARY_DOCUMENT_MIGRATION_MISSING" });
      }
      // PHI-free error — never echo raw query/error payloads.
      return res.status(500).json({ error: "Failed to load canonical overview" });
    }
  });
}
