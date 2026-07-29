// Phase 2G — clinic-scoped canonical billing readiness + Billing Document APIs.
//
// Rules enforced here:
//   • clinicId comes ONLY from req.clinicId (never query/body); actor identity +
//     role come ONLY from req.session (never body).
//   • Another clinic's case reads as not-found (no detail disclosure).
//   • Feature OFF → explicit disabled contract, ZERO migration-0055 reads.
//   • Flag ON + migration missing → controlled 503 (never legacy fallback).
//   • No claim submission, no external delivery, no UI redesign. Bounded reads.

import type { Express, Request, Response } from "express";
import { and, eq, isNull, desc } from "drizzle-orm";
import { db } from "../db";
import { canonicalBillingReadinessChecks as billingReadinessChecks } from "@shared/schema/billingReadiness";
import { canonicalBillingDocumentRequests as billingDocumentRequests } from "@shared/schema/billingDocuments";
import { billingReadinessRuntimeEnabled, billingDocumentRuntimeEnabled } from "../lib/featureFlags";
import { getAncillaryCaseById } from "../repositories/ancillaryCases.repo";
import { evaluateCanonicalBillingReadiness } from "../services/billingLifecycle/billingReadinessEvaluator";
import { ensureCanonicalBillingDocumentForAncillaryCase } from "../services/billingLifecycle/billingLifecycleOrchestration";

const MIGRATION_MISSING = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);

function requireClinicScope(req: Request, res: Response): number | null {
  const clinicId = (req as { clinicId?: number | null }).clinicId ?? null;
  if (clinicId == null) { res.status(403).json({ error: "Clinic scope required" }); return null; }
  return clinicId;
}
function sessionActor(req: Request): { userId: string; role: string } | null {
  const s = (req as { session?: { userId?: string; role?: string } }).session ?? {};
  if (!s.userId || !s.role) return null;
  return { userId: s.userId, role: s.role };
}
function parseIntOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}
function is503(e: unknown): boolean { return MIGRATION_MISSING.has((e as { code?: string })?.code ?? ""); }

/** Tenant gate: resolve the case for the clinic, else 404 (no disclosure). */
async function ownedCase(clinicId: number, ancillaryCaseId: number) {
  const acase = await getAncillaryCaseById(ancillaryCaseId);
  return acase && acase.clinicId === clinicId ? acase : null;
}

export function registerCanonicalBillingRoutes(app: Express): void {
  // ─── GET current canonical billing readiness ──────────────────────
  app.get("/api/ancillary-cases/:ancillaryCaseId/billing-readiness", async (req, res) => {
    if (!billingReadinessRuntimeEnabled()) return res.json({ disabled: true, readiness: null });
    const clinicId = requireClinicScope(req, res); if (clinicId == null) return;
    const ancillaryCaseId = parseIntOrNull(req.params.ancillaryCaseId);
    if (ancillaryCaseId == null) return res.status(400).json({ error: "Invalid ancillaryCaseId" });
    try {
      if (!(await ownedCase(clinicId, ancillaryCaseId))) return res.status(404).json({ error: "Not Found" });
      const [row] = await db.select().from(billingReadinessChecks).where(and(
        eq(billingReadinessChecks.clinicId, clinicId), eq(billingReadinessChecks.ancillaryCaseId, ancillaryCaseId), isNull(billingReadinessChecks.supersededAt),
      )).orderBy(desc(billingReadinessChecks.evaluatedAt)).limit(1);
      return res.json({ disabled: false, readiness: row ? projectReadiness(row) : null });
    } catch (e) {
      if (is503(e)) return res.status(503).json({ error: "Billing readiness unavailable", code: "ANCILLARY_DOCUMENT_MIGRATION_MISSING" });
      return res.status(500).json({ error: "Failed to load billing readiness" });
    }
  });

  // ─── GET current canonical Billing Document ───────────────────────
  app.get("/api/ancillary-cases/:ancillaryCaseId/billing-document", async (req, res) => {
    if (!billingDocumentRuntimeEnabled()) return res.json({ disabled: true, billingDocument: null });
    const clinicId = requireClinicScope(req, res); if (clinicId == null) return;
    const ancillaryCaseId = parseIntOrNull(req.params.ancillaryCaseId);
    if (ancillaryCaseId == null) return res.status(400).json({ error: "Invalid ancillaryCaseId" });
    try {
      if (!(await ownedCase(clinicId, ancillaryCaseId))) return res.status(404).json({ error: "Not Found" });
      const [row] = await db.select().from(billingDocumentRequests).where(and(
        eq(billingDocumentRequests.clinicId, clinicId), eq(billingDocumentRequests.ancillaryCaseId, ancillaryCaseId), isNull(billingDocumentRequests.supersededAt),
      )).orderBy(desc(billingDocumentRequests.createdAt)).limit(1);
      return res.json({ disabled: false, billingDocument: row ? projectDocument(row) : null });
    } catch (e) {
      if (is503(e)) return res.status(503).json({ error: "Billing document unavailable", code: "ANCILLARY_DOCUMENT_MIGRATION_MISSING" });
      return res.status(500).json({ error: "Failed to load billing document" });
    }
  });

  // ─── POST evaluate canonical billing readiness ────────────────────
  app.post("/api/ancillary-cases/:ancillaryCaseId/billing-readiness/evaluate", async (req, res) => {
    if (!billingReadinessRuntimeEnabled()) return res.status(409).json({ error: "Canonical billing readiness disabled" });
    const clinicId = requireClinicScope(req, res); if (clinicId == null) return;
    const actor = sessionActor(req);
    if (!actor) return res.status(401).json({ error: "Not authenticated" });
    if (!["admin", "biller"].includes(actor.role)) return res.status(403).json({ error: "Forbidden" });
    const ancillaryCaseId = parseIntOrNull(req.params.ancillaryCaseId);
    if (ancillaryCaseId == null) return res.status(400).json({ error: "Invalid ancillaryCaseId" });
    try {
      if (!(await ownedCase(clinicId, ancillaryCaseId))) return res.status(404).json({ error: "Not Found" });
      const override = parseOverride((req.body as { override?: unknown })?.override);
      const r = await evaluateCanonicalBillingReadiness({ clinicId, ancillaryCaseId, actor, source: "billing_readiness_api", override });
      if (r.status === "migration_missing") return res.status(503).json({ error: "Billing readiness unavailable", code: "ANCILLARY_DOCUMENT_MIGRATION_MISSING" });
      return res.json({ status: r.status, readinessCheckId: r.readinessCheckId, billingReady: r.billingReady, claimSubmissionReady: r.claimSubmissionReady, billingBlockers: r.billingBlockers, claimBlockers: r.claimBlockers, warnings: r.warnings });
    } catch (e) {
      if (is503(e)) return res.status(503).json({ error: "Billing readiness unavailable", code: "ANCILLARY_DOCUMENT_MIGRATION_MISSING" });
      return res.status(500).json({ error: "Failed to evaluate billing readiness" });
    }
  });

  // ─── POST generate canonical Billing Document ─────────────────────
  app.post("/api/ancillary-cases/:ancillaryCaseId/billing-document/generate", async (req, res) => {
    if (!billingDocumentRuntimeEnabled()) return res.status(409).json({ error: "Canonical Billing Document disabled" });
    const clinicId = requireClinicScope(req, res); if (clinicId == null) return;
    const actor = sessionActor(req);
    if (!actor) return res.status(401).json({ error: "Not authenticated" });
    if (!["admin", "biller"].includes(actor.role)) return res.status(403).json({ error: "Forbidden" });
    const ancillaryCaseId = parseIntOrNull(req.params.ancillaryCaseId);
    if (ancillaryCaseId == null) return res.status(400).json({ error: "Invalid ancillaryCaseId" });
    try {
      if (!(await ownedCase(clinicId, ancillaryCaseId))) return res.status(404).json({ error: "Not Found" });
      const override = parseOverride((req.body as { override?: unknown })?.override);
      const r = await ensureCanonicalBillingDocumentForAncillaryCase({ clinicId, ancillaryCaseId, actor, source: "billing_document_api", override });
      if (r.status === "migration_missing") return res.status(503).json({ error: "Billing document unavailable", code: "ANCILLARY_DOCUMENT_MIGRATION_MISSING" });
      return res.json({ status: r.status, readinessCheckId: r.readinessCheckId, billingDocumentId: r.billingDocumentId, generatorOutcome: r.generatorOutcome, warnings: r.warnings });
    } catch (e) {
      if (is503(e)) return res.status(503).json({ error: "Billing document unavailable", code: "ANCILLARY_DOCUMENT_MIGRATION_MISSING" });
      return res.status(500).json({ error: "Failed to generate billing document" });
    }
  });
}

/** Server-side override parsing — reason + explicit codes only; NEVER an actor
 *  or clinic from the body. */
function parseOverride(raw: unknown): { reason: string; requirementCodes: string[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { reason?: unknown; requirementCodes?: unknown };
  const reason = typeof o.reason === "string" ? o.reason.trim() : "";
  const codes = Array.isArray(o.requirementCodes) ? o.requirementCodes.filter((c): c is string => typeof c === "string") : [];
  if (!reason || codes.length === 0) return null;
  return { reason, requirementCodes: codes };
}

function projectReadiness(row: typeof billingReadinessChecks.$inferSelect) {
  return {
    id: row.id, ancillaryCaseId: row.ancillaryCaseId, serviceType: row.serviceType,
    canonicalStatus: row.canonicalStatus, billingBlockers: row.billingBlockers, claimBlockers: row.claimBlockers,
    warnings: row.warnings, appliedOverrides: row.appliedOverrides, evidenceFingerprint: row.evidenceFingerprint,
    evaluatedAt: row.evaluatedAt,
  };
}
function projectDocument(row: typeof billingDocumentRequests.$inferSelect) {
  return {
    id: row.id, ancillaryCaseId: row.ancillaryCaseId, serviceType: row.serviceType, canonicalStatus: row.canonicalStatus,
    generatedByAi: row.generatedByAi, claimBlockers: row.claimBlockers, warnings: row.warnings,
    evidenceFingerprint: row.evidenceFingerprint, generatedAt: row.generatedAt, generatedBody: row.generatedBody,
  };
}
