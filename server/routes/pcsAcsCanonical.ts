// Phase 2I — clinic-scoped canonical PCS/ACS view APIs (READ-ONLY).
//
// Two independent, flag-gated GET endpoints. Each fails CLOSED:
//   • unauthenticated → 401
//   • missing/unknown/disallowed role → 403 (PCS: admin|liaison; ACS: admin|technician —
//     the surfaces' distinct authorized roles are preserved, never unified)
//   • missing server-context clinic scope → 403 (never body/query supplied)
// Flag OFF → explicit disabled contract BEFORE any canonical read. A missing
// canonical migration → truthful 503 (code ANCILLARY_DOCUMENT_MIGRATION_MISSING).
// No writes, no document bytes, no clinic/actor from the request payload.

import type { Express, Request, Response, NextFunction } from "express";
import { featureFlags } from "../lib/featureFlags";
import { disabledPcsCanonicalView } from "@shared/pcsCanonicalView";
import { disabledAcsCanonicalView } from "@shared/acsCanonicalView";
import { getPcsCanonicalView } from "../services/pcs/pcsCanonicalView";
import { getAcsCanonicalView } from "../services/acs/acsCanonicalView";

const MIGRATION_MISSING_CODE = "ANCILLARY_DOCUMENT_MIGRATION_MISSING";
const MIGRATION_MISSING = new Set(["42P01", "42703", MIGRATION_MISSING_CODE]);

const PCS_ROLES = new Set(["admin", "liaison"]);
const ACS_ROLES = new Set(["admin", "technician"]);

function requireRoles(allowed: Set<string>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.session?.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
    const role = req.session.role;
    if (typeof role !== "string" || !allowed.has(role)) { res.status(403).json({ error: "Forbidden — insufficient role" }); return; }
    next();
  };
}
function requireClinicScope(req: Request, res: Response): number | null {
  const clinicId = (req as { clinicId?: number | null }).clinicId ?? null;
  if (clinicId == null) { res.status(403).json({ error: "Clinic scope required" }); return null; }
  return clinicId;
}
function parseLimit(v: unknown): number | undefined {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : undefined;
}
function filtersFrom(q: Request["query"]) {
  return {
    serviceType: typeof q.serviceType === "string" ? q.serviceType : null,
    lifecycleStatus: typeof q.lifecycleStatus === "string" ? q.lifecycleStatus : null,
    adminReviewStatus: typeof q.adminReviewStatus === "string" ? q.adminReviewStatus : null,
  };
}
function migration(res: Response, e: unknown): boolean {
  if (MIGRATION_MISSING.has((e as { code?: string })?.code ?? "")) {
    res.status(503).json({ error: "Canonical view unavailable", code: MIGRATION_MISSING_CODE });
    return true;
  }
  return false;
}

export function registerPcsAcsCanonicalRoutes(app: Express): void {
  app.get("/api/pcs/canonical-view", requireRoles(PCS_ROLES), async (req, res) => {
    if (!featureFlags.pcsCanonicalView) return res.json(disabledPcsCanonicalView(new Date().toISOString(), 25));
    const clinicId = requireClinicScope(req, res);
    if (clinicId == null) return;
    try {
      const q = req.query;
      const view = await getPcsCanonicalView({
        clinicId,
        cursor: typeof q.cursor === "string" ? q.cursor : null,
        limit: parseLimit(q.limit),
        filters: filtersFrom(q),
        unresolvedCursor: typeof q.unresolvedCursor === "string" ? q.unresolvedCursor : null,
        episodeMembershipId: typeof q.episodeMembershipId === "string" && Number.isFinite(parseInt(q.episodeMembershipId, 10)) ? parseInt(q.episodeMembershipId, 10) : null,
        episodeCursor: typeof q.episodeCursor === "string" ? q.episodeCursor : null,
      });
      return res.json(view);
    } catch (e) {
      if (migration(res, e)) return;
      return res.status(500).json({ error: "Failed to load PCS canonical view" });
    }
  });

  app.get("/api/acs/canonical-view", requireRoles(ACS_ROLES), async (req, res) => {
    if (!featureFlags.acsCanonicalView) return res.json(disabledAcsCanonicalView(new Date().toISOString(), 25));
    const clinicId = requireClinicScope(req, res);
    if (clinicId == null) return;
    try {
      const view = await getAcsCanonicalView({ clinicId, cursor: typeof req.query.cursor === "string" ? req.query.cursor : null, limit: parseLimit(req.query.limit), filters: filtersFrom(req.query) });
      return res.json(view);
    } catch (e) {
      if (migration(res, e)) return;
      return res.status(500).json({ error: "Failed to load ACS canonical view" });
    }
  });
}
