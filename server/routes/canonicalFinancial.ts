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
import { createOrReuseCanonicalClaimDraft, transitionCanonicalClaim, createCanonicalClaimCorrection } from "../services/canonicalFinancial/claimCommands";
import { createOrReuseCanonicalInvoiceDraft, transitionCanonicalInvoice, createCanonicalInvoiceCorrection } from "../services/canonicalFinancial/invoiceCommands";
import { recordCanonicalPayment, allocateCanonicalPayment, refundCanonicalPayment, reverseCanonicalPayment } from "../services/canonicalFinancial/paymentCommands";
import type { CanonicalClaimStatus } from "@shared/schema/canonicalClaims";
import type { CanonicalInvoiceStatus } from "@shared/schema/canonicalInvoices";

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
      const q = req.query as Record<string, unknown>;
      const cur = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : null);
      const view = await getCanonicalFinancialView({ clinicId, claimsCursor: cur("claimsCursor"), invoicesCursor: cur("invoicesCursor"), paymentsCursor: cur("paymentsCursor"), limit: parseLimit(req.query.limit) });
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
      // EXACT case-scoped queries (never a clinic-wide 500-row in-memory scan).
      const readiness = (await db.select().from(canonicalBillingReadinessChecks).where(and(eq(canonicalBillingReadinessChecks.clinicId, clinicId), eq(canonicalBillingReadinessChecks.ancillaryCaseId, ancillaryCaseId), isNull(canonicalBillingReadinessChecks.supersededAt))).limit(200)).filter((r) => r.clinicId === clinicId && r.ancillaryCaseId === ancillaryCaseId);
      const docs = (await db.select().from(canonicalBillingDocumentRequests).where(and(eq(canonicalBillingDocumentRequests.clinicId, clinicId), eq(canonicalBillingDocumentRequests.ancillaryCaseId, ancillaryCaseId), isNull(canonicalBillingDocumentRequests.supersededAt))).limit(200)).filter((r) => r.clinicId === clinicId && r.ancillaryCaseId === ancillaryCaseId);
      const result = evaluateClaimReadiness({ clinicId, ancillaryCaseId, serviceType: c.serviceType }, readiness, docs);
      // Never expose evidence bytes / note text — only ids + blocker codes.
      return res.json({ ancillaryCaseId, serviceType: c.serviceType, claimReady: result.claimReady, status: result.status, blockers: result.blockers.map((b) => ({ code: b.code })), warnings: result.warnings, integrity: result.integrity });
    } catch (e) {
      if (migration(res, e)) return;
      return res.status(500).json({ error: "Failed to evaluate claim readiness" });
    }
  });

  // ── Command routes (authorized WRITE lifecycle) ─────────────────────────────
  // Biller/admin + clinic scope; actor + clinic from the session ONLY (never body/
  // query). Idempotency key REQUIRED. Typed 400/403/404/409/503; flag OFF → 404
  // disabled BEFORE any schema access; migration missing → 503. No external
  // financial operation is executed by any of these.
  const CODE_BY_STATUS: Record<string, number> = {
    created: 201, recorded: 201, allocated: 201, transitioned: 200, refunded: 201, reversed: 201, reused: 200,
    skipped_flag_off: 404, not_found: 404, target_not_found: 404,
    invalid_transition: 409, conflict: 409, already_reversed: 409, exceeds_original: 409, payment_status_derived: 409, allocation_rejected: 409, line_items_invalid: 409, idempotency_conflict: 409, parent_allocation_invalid: 409,
    submission_source_required: 400, submission_provenance_required: 400, transmission_unavailable: 400, invalid_amount: 400, invalid_source: 400, recipient_invalid: 400, identity_incomplete: 400, identity_invalid: 400, case_service_mismatch: 400, unsupported_currency: 400, claim_not_invoiceable: 400, amount_source_missing: 400, evidence_conflict: 409, target_not_payable: 409, delivery_event_required: 400, delivery_source_required: 400,
    migration_missing: 503, persistence_failed: 500,
  };
  const send = (res: Response, r: { status: string } & Record<string, unknown>) => res.status(CODE_BY_STATUS[r.status] ?? 500).json(r);
  const idem = (req: Request, res: Response): string | null => {
    const k = (req.body as { idempotencyKey?: unknown })?.idempotencyKey;
    if (typeof k !== "string" || k.trim().length === 0) { res.status(400).json({ error: "idempotencyKey required", code: "idempotency_required" }); return null; }
    return k;
  };
  // Wraps a command handler with auth + clinic scope + actor-from-session + idempotency.
  function command(handler: (ctx: { clinicId: number; actorUserId: string; actorRole: string; idempotencyKey: string; req: Request }) => Promise<{ status: string } & Record<string, unknown>>) {
    return async (req: Request, res: Response) => {
      const clinicId = requireClinicScope(req, res); if (clinicId == null) return;
      const key = idem(req, res); if (key == null) return;
      try { return send(res, await handler({ clinicId, actorUserId: req.session!.userId as string, actorRole: String(req.session!.role), idempotencyKey: key, req })); }
      catch (e) { if (migration(res, e)) return; return res.status(500).json({ error: "Command failed" }); }
    };
  }
  const intParam = (v: unknown): number => Number.parseInt(String(v), 10);

  app.post("/api/ancillary-cases/:id/canonical-claim", requireBillerOrAdmin, command(async (c) =>
    createOrReuseCanonicalClaimDraft({ clinicId: c.clinicId, ancillaryCaseId: intParam(c.req.params.id), actorUserId: c.actorUserId, actorRole: c.actorRole, idempotencyKey: c.idempotencyKey })));
  app.post("/api/canonical-claims/:id/transition", requireBillerOrAdmin, command(async (c) =>
    transitionCanonicalClaim({ clinicId: c.clinicId, claimId: intParam(c.req.params.id), transition: (c.req.body?.transition) as CanonicalClaimStatus, reason: c.req.body?.reason ?? null, sourceType: c.req.body?.sourceType ?? null, sourceReference: c.req.body?.sourceReference ?? null, actorUserId: c.actorUserId, actorRole: c.actorRole, idempotencyKey: c.idempotencyKey })));
  app.post("/api/canonical-claims/:id/correction", requireBillerOrAdmin, command(async (c) =>
    createCanonicalClaimCorrection({ clinicId: c.clinicId, priorClaimId: intParam(c.req.params.id), reason: c.req.body?.reason ?? null, actorUserId: c.actorUserId, actorRole: c.actorRole, idempotencyKey: c.idempotencyKey })));

  app.post("/api/canonical-claims/:id/canonical-invoice", requireBillerOrAdmin, command(async (c) =>
    createOrReuseCanonicalInvoiceDraft({ clinicId: c.clinicId, claimId: intParam(c.req.params.id), invoiceType: String(c.req.body?.invoiceType ?? ""), recipientType: String(c.req.body?.recipientType ?? ""), recipientId: String(c.req.body?.recipientId ?? ""), actorUserId: c.actorUserId, actorRole: c.actorRole, idempotencyKey: c.idempotencyKey })));
  app.post("/api/canonical-invoices/:id/transition", requireBillerOrAdmin, command(async (c) =>
    transitionCanonicalInvoice({ clinicId: c.clinicId, invoiceId: intParam(c.req.params.id), transition: (c.req.body?.transition) as CanonicalInvoiceStatus, deliveryEventReference: c.req.body?.deliveryEventReference ?? null, reason: c.req.body?.reason ?? null, sourceType: c.req.body?.sourceType ?? null, sourceReference: c.req.body?.sourceReference ?? null, actorUserId: c.actorUserId, actorRole: c.actorRole, idempotencyKey: c.idempotencyKey })));
  app.post("/api/canonical-invoices/:id/correction", requireBillerOrAdmin, command(async (c) =>
    createCanonicalInvoiceCorrection({ clinicId: c.clinicId, priorInvoiceId: intParam(c.req.params.id), reason: c.req.body?.reason ?? null, actorUserId: c.actorUserId, actorRole: c.actorRole, idempotencyKey: c.idempotencyKey })));

  app.post("/api/canonical-payments", requireBillerOrAdmin, command(async (c) =>
    recordCanonicalPayment({ clinicId: c.clinicId, ancillaryCaseId: c.req.body?.ancillaryCaseId ?? null, serviceType: c.req.body?.serviceType ?? null, paymentType: String(c.req.body?.paymentType ?? ""), currency: String(c.req.body?.currency ?? ""), amount: String(c.req.body?.amount ?? ""), externalTransactionId: c.req.body?.externalTransactionId ?? null, actorUserId: c.actorUserId, actorRole: c.actorRole, sourceSystem: "payment_route", idempotencyKey: c.idempotencyKey })));
  app.post("/api/canonical-payments/:id/allocations", requireBillerOrAdmin, command(async (c) =>
    allocateCanonicalPayment({ clinicId: c.clinicId, paymentId: intParam(c.req.params.id), targetType: (c.req.body?.targetType) as "claim" | "invoice", targetId: intParam(c.req.body?.targetId), amount: String(c.req.body?.amount ?? ""), isOverpayment: c.req.body?.isOverpayment === true, reason: c.req.body?.reason ?? null, actorUserId: c.actorUserId, actorRole: c.actorRole, idempotencyKey: c.idempotencyKey })));
  app.post("/api/canonical-payments/:id/refund", requireBillerOrAdmin, command(async (c) =>
    refundCanonicalPayment({ clinicId: c.clinicId, paymentId: intParam(c.req.params.id), allocationId: intParam(c.req.body?.allocationId), amount: String(c.req.body?.amount ?? ""), reason: c.req.body?.reason ?? null, actorUserId: c.actorUserId, actorRole: c.actorRole, idempotencyKey: c.idempotencyKey })));
  app.post("/api/canonical-payments/:id/reverse", requireBillerOrAdmin, command(async (c) =>
    reverseCanonicalPayment({ clinicId: c.clinicId, paymentId: intParam(c.req.params.id), allocationId: intParam(c.req.body?.allocationId), amount: String(c.req.body?.amount ?? ""), reason: c.req.body?.reason ?? null, actorUserId: c.actorUserId, actorRole: c.actorRole, idempotencyKey: c.idempotencyKey })));
}
