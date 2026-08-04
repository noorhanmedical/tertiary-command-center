// Phase 2J — clinic-scoped canonical financial read API (READ-ONLY).
//
// Fails CLOSED: unauthenticated → 401; missing/unknown/non-{biller,admin} role →
// 403 (no fallback); missing server-context clinic scope → 403. Flag OFF (all three
// financial flags off) → explicit disabled contract BEFORE any schema access (zero
// migration-0056 reads). A missing canonical table → 503. No financial mutations
// here — writes flow through separately-authorized command routes (not added until
// an authorized source/attestation exists). No clinic/actor from body/query.
//
// Role/scope parity with the Phase 2H/2I canonical read routes: `admin` is in the
// allowlist but `clinicContext` sets an admin's `req.clinicId` to null, so an admin
// with no clinic-scoped session gets 403 here — this surface NEVER exposes a
// cross-clinic financial aggregate. Admins operate it via a clinic-scoped session
// (as with pcs/acs canonical views); billers are inherently clinic-scoped.

import type { Express, Request, Response, NextFunction } from "express";
import { featureFlags } from "../lib/featureFlags";
import { disabledCanonicalFinancialView } from "@shared/canonicalFinancialView";
import { getCanonicalFinancialView } from "../services/canonicalFinancial/financialView";
import { evaluateClaimReadiness } from "../services/canonicalFinancial/claimReadiness";
import { db } from "../db";
import { and, eq, isNull } from "drizzle-orm";
import { canonicalBillingReadinessChecks } from "@shared/schema/billingReadiness";
import { canonicalBillingDocumentRequests } from "@shared/schema/billingDocuments";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { canonicalClaimsRuntimeEnabled } from "../lib/featureFlags";

const MIGRATION_CODE = "ANCILLARY_DOCUMENT_MIGRATION_MISSING";
const MIGRATION = new Set(["42P01", "42703", MIGRATION_CODE]);
const FINANCIAL_ROLES = new Set(["biller", "admin"]);

function requireBillerOrAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const role = req.session.role;
  if (typeof role !== "string" || !FINANCIAL_ROLES.has(role)) { res.status(403).json({ error: "Forbidden — biller or admin role required" }); return; }
  next();
}
function requireClinicScope(req: Request, res: Response): number | null {
  const clinicId = (req as { clinicId?: number | null }).clinicId ?? null;
  if (clinicId == null) { res.status(403).json({ error: "Clinic scope required" }); return null; }
  return clinicId;
}
function anyFinancialFlagOn(): boolean {
  return featureFlags.canonicalClaims || featureFlags.canonicalInvoices || featureFlags.canonicalPayments;
}
function migration(res: Response, e: unknown): boolean {
  if (MIGRATION.has((e as { code?: string })?.code ?? "")) { res.status(503).json({ error: "Canonical financial view unavailable", code: MIGRATION_CODE }); return true; }
  return false;
}
function parseLimit(v: unknown): number | undefined { const n = Number.parseInt(String(v ?? ""), 10); return Number.isFinite(n) ? n : undefined; }

export function registerCanonicalFinancialRoutes(app: Express): void {
  // Combined bounded financial read model (claims + invoices + payments).
  app.get("/api/canonical-financial-view", requireBillerOrAdmin, async (req, res) => {
    if (!anyFinancialFlagOn()) return res.json(disabledCanonicalFinancialView(new Date().toISOString()));
    const clinicId = requireClinicScope(req, res);
    if (clinicId == null) return;
    try {
      const view = await getCanonicalFinancialView({ clinicId, cursor: typeof req.query.cursor === "string" ? req.query.cursor : null, limit: parseLimit(req.query.limit) });
      return res.json(view);
    } catch (e) {
      if (migration(res, e)) return;
      return res.status(500).json({ error: "Failed to load canonical financial view" });
    }
  });

  // Exact per-case claim readiness (evaluated from the current readiness + Billing
  // Document evidence version). Read-only; no claim is created here.
  app.get("/api/ancillary-cases/:id/canonical-claim-readiness", requireBillerOrAdmin, async (req, res) => {
    if (!featureFlags.canonicalClaims) return res.json({ disabled: true });
    const clinicId = requireClinicScope(req, res);
    if (clinicId == null) return;
    const ancillaryCaseId = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(ancillaryCaseId)) return res.status(400).json({ error: "Invalid ancillary case id" });
    try {
      // Ownership: the case must belong to this clinic (never a source-id-only lookup).
      const caseRows = await db.select().from(patientAncillaryCases).where(and(eq(patientAncillaryCases.clinicId, clinicId), eq(patientAncillaryCases.id, ancillaryCaseId))).limit(2);
      const c = caseRows.find((x) => x.id === ancillaryCaseId && x.clinicId === clinicId);
      if (!c) return res.status(404).json({ error: "Not found" });
      if (!canonicalClaimsRuntimeEnabled()) return res.json({ disabled: true, upstream: "flag_off" });
      const readiness = (await db.select().from(canonicalBillingReadinessChecks).where(and(eq(canonicalBillingReadinessChecks.clinicId, clinicId), isNull(canonicalBillingReadinessChecks.supersededAt))).limit(500)).filter((r) => r.clinicId === clinicId);
      const docs = (await db.select().from(canonicalBillingDocumentRequests).where(and(eq(canonicalBillingDocumentRequests.clinicId, clinicId), isNull(canonicalBillingDocumentRequests.supersededAt))).limit(500)).filter((r) => r.clinicId === clinicId);
      const result = evaluateClaimReadiness({ clinicId, ancillaryCaseId, serviceType: c.serviceType }, readiness, docs);
      // Never expose evidence bytes / note text — only ids + blocker codes.
      return res.json({ ancillaryCaseId, serviceType: c.serviceType, claimReady: result.claimReady, status: result.status, blockers: result.blockers.map((b) => ({ code: b.code })), warnings: result.warnings, integrity: result.integrity });
    } catch (e) {
      if (migration(res, e)) return;
      return res.status(500).json({ error: "Failed to evaluate claim readiness" });
    }
  });
}
