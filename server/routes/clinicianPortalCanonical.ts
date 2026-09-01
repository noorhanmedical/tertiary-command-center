// Phase 2H — clinic-scoped canonical Clinician Portal overview API (READ-ONLY).
//
// One batched GET. Uses the SHARED Clinician Portal authorization boundary
// (clinician|admin + server-context clinic scope; missing/unknown role → 403).
// Flag OFF → explicit disabled contract returned BEFORE any canonical read.
// A missing canonical migration → truthful 503 (code=ANCILLARY_DOCUMENT_
// MIGRATION_MISSING). No writes, no retry records, no document bytes, no
// clinic/actor from body.

import type { Express } from "express";
import { featureFlags } from "../lib/featureFlags";
import { disabledClinicianPortalOverview } from "@shared/clinicianPortalOverview";
import { getClinicianPortalCanonicalOverview } from "../services/clinicianPortal/canonicalOverview";
import { requireClinicianOrAdmin, requireClinicScope } from "./clinicianPortalGuard";

const MIGRATION_MISSING_CODE = "ANCILLARY_DOCUMENT_MIGRATION_MISSING";
const MIGRATION_MISSING = new Set(["42P01", "42703", MIGRATION_MISSING_CODE]);

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
      // A required canonical migration is missing → truthful 503 (typed signal,
      // not string inspection). Never surfaced as a 200 with zero counts.
      if (MIGRATION_MISSING.has((e as { code?: string })?.code ?? "")) {
        return res.status(503).json({ error: "Clinician Portal overview unavailable", code: MIGRATION_MISSING_CODE });
      }
      // PHI-free error — never echo raw query/error payloads.
      return res.status(500).json({ error: "Failed to load canonical overview" });
    }
  });
}
