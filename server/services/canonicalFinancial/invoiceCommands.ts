// Phase 2J — canonical INVOICE command service (transactional, idempotent).
//
// An invoice is DERIVED from an exact canonical claim (its clinic/case/service +
// Billing Document / readiness / fingerprint + exact charge/line items). Create one
// active draft per claim, transition along the explicit machine, and correct via a
// NEW version (issued history is never rewritten). The invoice number is assigned at
// issue from the row's serial id (concurrency-safe, unique per clinic). `delivered`
// requires an exact delivery event; `paid`/`partially_paid` are DERIVED from the
// payment ledger and can never be set by a manual status-only transition. No real
// invoice is ever delivered here.

import { db } from "../../db";
import { and, eq, isNull } from "drizzle-orm";
import { canonicalInvoices, type CanonicalInvoiceStatus } from "@shared/schema/canonicalInvoices";
import { CANONICAL_INVOICE_TYPES, CANONICAL_INVOICE_RECIPIENT_TYPES } from "@shared/schema/canonicalInvoices";
import { canonicalClaims } from "@shared/schema/canonicalClaims";
import { canonicalInvoicesRuntimeEnabled } from "../../lib/featureFlags";
import { canTransitionInvoice, invoiceDeliveredRequiresEvent } from "./stateMachines";
import { reconcileLines, toCents, type MoneyLine } from "@shared/money";
import { isFinancialMigration, writeTransition, idempotentReplay, commandFingerprint, nonEmpty, type DbLike } from "./commandSupport";

const INVOICE_WORKING = new Set<CanonicalInvoiceStatus>(["draft", "approved"]);
const CLAIM_INVOICEABLE = new Set(["ready", "draft", "queued", "submitted", "accepted", "partially_paid", "paid"]);
const PAYMENT_DERIVED = new Set<CanonicalInvoiceStatus>(["paid", "partially_paid"]);
// Delivered requires an EXACT approved delivery source — never an arbitrary string.
const DELIVERY_SOURCES = new Set(["imported_delivery_acknowledgment", "approved_delivery_adapter_event", "authorized_manual_attestation"]);
const INVOICE_TYPES = new Set<string>(CANONICAL_INVOICE_TYPES);
const RECIPIENT_TYPES = new Set<string>(CANONICAL_INVOICE_RECIPIENT_TYPES);
const UNIQUE_VIOLATION = "23505";
const isUnique = (e: unknown): boolean => (e as { code?: string })?.code === UNIQUE_VIOLATION;

export type InvoiceCommandResult =
  | { status: "skipped_flag_off" }
  | { status: "created"; invoiceId: number }
  | { status: "reused"; invoiceId: number }
  | { status: "not_found" }
  | { status: "claim_not_invoiceable" }
  | { status: "amount_source_missing" }
  | { status: "recipient_invalid" }
  | { status: "line_items_invalid"; code: string }
  | { status: "invalid_transition"; from: string; to: string }
  | { status: "delivery_event_required" }
  | { status: "delivery_source_required" }
  | { status: "payment_status_derived" }
  | { status: "transitioned"; invoiceId: number; from: string; to: string }
  | { status: "conflict" }
  | { status: "idempotency_conflict" }
  | { status: "migration_missing" }
  | { status: "persistence_failed" };

async function loadClaim(clinicId: number, claimId: number) {
  const rows = await db.select().from(canonicalClaims).where(and(eq(canonicalClaims.clinicId, clinicId), eq(canonicalClaims.id, claimId))).limit(2);
  return rows.find((r) => r.id === claimId && r.clinicId === clinicId) ?? null;
}
type InvoiceRow = typeof canonicalInvoices.$inferSelect;
type Pick<R> = { kind: "missing" } | { kind: "one"; row: R } | { kind: "conflict" };
/** The ONE active working invoice per claim — never rows[0]. */
async function activeInvoiceForClaim(clinicId: number, claimId: number): Promise<Pick<InvoiceRow>> {
  const rows = (await db.select().from(canonicalInvoices).where(and(eq(canonicalInvoices.clinicId, clinicId), eq(canonicalInvoices.claimId, claimId), isNull(canonicalInvoices.supersededAt))).limit(50))
    .filter((r) => r.clinicId === clinicId && r.claimId === claimId && r.supersededAt == null && INVOICE_WORKING.has(r.canonicalStatus as CanonicalInvoiceStatus));
  if (rows.length === 0) return { kind: "missing" };
  if (rows.length > 1) return { kind: "conflict" };
  return { kind: "one", row: rows[0] };
}
/** Exact-equality invoice reuse: claim + evidence version + type + recipient + total
 *  + line items must all match — otherwise the draft is stale (conflict, not reuse). */
function invoiceReuseMatches(row: InvoiceRow, claim: typeof canonicalClaims.$inferSelect, input: CreateInvoiceInput, lines: MoneyLine[]): boolean {
  return (row.claimId ?? null) === input.claimId
    && row.evidenceFingerprint === claim.evidenceFingerprint
    && row.invoiceType === input.invoiceType && (row.recipientType ?? null) === input.recipientType && (row.recipientId ?? null) === input.recipientId
    && (row.totalAmount ?? null) === (claim.chargeAmount ?? null)
    && JSON.stringify(row.lineItems ?? []) === JSON.stringify(lines);
}

export type CreateInvoiceInput = { clinicId: number; claimId: number; invoiceType: string; recipientType: string; recipientId: string; actorUserId: string; actorRole: string; idempotencyKey?: string | null };

export async function createOrReuseCanonicalInvoiceDraft(input: CreateInvoiceInput): Promise<InvoiceCommandResult> {
  if (!canonicalInvoicesRuntimeEnabled()) return { status: "skipped_flag_off" };
  try {
    const fp = commandFingerprint({ action: "create_invoice", clinicId: input.clinicId, claimId: input.claimId, invoiceType: input.invoiceType, recipientType: input.recipientType, recipientId: input.recipientId });
    const replay = await idempotentReplay(db as unknown as DbLike, "invoice", input.clinicId, input.idempotencyKey, fp);
    if (replay.kind === "conflict") return { status: "idempotency_conflict" };
    if (replay.kind === "replay") return { status: "reused", invoiceId: replay.entityId };
    const claim = await loadClaim(input.clinicId, input.claimId);
    if (!claim) return { status: "not_found" };
    if (!CLAIM_INVOICEABLE.has(claim.canonicalStatus) || claim.supersededAt != null) return { status: "claim_not_invoiceable" };
    // Exact authorized amount from the claim (never invented).
    if (!nonEmpty(claim.chargeAmount as string | null) || !nonEmpty(claim.amountSource)) return { status: "amount_source_missing" };
    if (!INVOICE_TYPES.has(input.invoiceType) || !RECIPIENT_TYPES.has(input.recipientType) || !nonEmpty(input.recipientId)) return { status: "recipient_invalid" };
    // Deterministic line items copied from the claim, reconciled to the total.
    const lines = (Array.isArray(claim.lineItems) ? claim.lineItems : []) as MoneyLine[];
    const rec = reconcileLines(lines);
    if (!rec.ok) return { status: "line_items_invalid", code: rec.code };
    let totalCents: number; try { totalCents = toCents(claim.chargeAmount as string); } catch { return { status: "amount_source_missing" }; }
    if (totalCents !== rec.totalCents) return { status: "line_items_invalid", code: "invoice_total_line_mismatch" };

    // The ONE active working invoice for the claim (never rows[0]); a stale draft
    // (any facet differs) is a conflict, never silent reuse.
    const existing = await activeInvoiceForClaim(input.clinicId, input.claimId);
    if (existing.kind === "conflict") return { status: "conflict" };
    if (existing.kind === "one") return invoiceReuseMatches(existing.row, claim, input, lines) ? { status: "reused", invoiceId: existing.row.id } : { status: "conflict" };
    try {
      const created = await (db as unknown as DbLike).transaction(async (tx) => {
        const [row] = await tx.insert(canonicalInvoices).values({
          clinicId: input.clinicId, ancillaryCaseId: claim.ancillaryCaseId, serviceType: claim.serviceType,
          claimId: input.claimId, billingDocumentId: claim.billingDocumentId, billingReadinessCheckId: claim.billingReadinessCheckId, evidenceFingerprint: claim.evidenceFingerprint,
          globalPlexusPatientId: claim.globalPlexusPatientId, patientClinicMembershipId: claim.patientClinicMembershipId,
          invoiceType: input.invoiceType, recipientType: input.recipientType, recipientId: input.recipientId,
          canonicalStatus: "draft", currency: claim.currency, totalAmount: claim.chargeAmount, lineItems: lines as never, amountSource: claim.amountSource,
          idempotencyKey: input.idempotencyKey ?? null, actorUserId: input.actorUserId, sourceSystem: "invoice_command",
        }).returning();
        await writeTransition(tx, { entityType: "invoice", entityId: row.id as number, clinicId: input.clinicId, ancillaryCaseId: claim.ancillaryCaseId, serviceType: claim.serviceType, fromStatus: null, toStatus: "draft", actorUserId: input.actorUserId, actorRole: input.actorRole, reason: "invoice_draft_created", sourceType: "invoice_command", sourceReference: String(input.claimId), idempotencyKey: input.idempotencyKey ?? null, commandFingerprint: fp });
        return row;
      });
      return { status: "created", invoiceId: created.id as number };
    } catch (e) {
      if (isUnique(e)) { const again = await activeInvoiceForClaim(input.clinicId, input.claimId); if (again.kind === "one") return invoiceReuseMatches(again.row, claim, input, lines) ? { status: "reused", invoiceId: again.row.id } : { status: "conflict" }; if (again.kind === "conflict") return { status: "conflict" }; }
      throw e;
    }
  } catch (e) { if (isFinancialMigration(e)) return { status: "migration_missing" }; return { status: "persistence_failed" }; }
}

export type InvoiceTransitionInput = { clinicId: number; invoiceId: number; transition: CanonicalInvoiceStatus; deliveryEventReference?: string | null; reason?: string | null; sourceType?: string | null; sourceReference?: string | null; actorUserId: string; actorRole: string; idempotencyKey?: string | null };

export async function transitionCanonicalInvoice(input: InvoiceTransitionInput): Promise<InvoiceCommandResult> {
  if (!canonicalInvoicesRuntimeEnabled()) return { status: "skipped_flag_off" };
  try {
    const fp = commandFingerprint({ action: "transition_invoice", clinicId: input.clinicId, invoiceId: input.invoiceId, transition: input.transition, deliveryEventReference: input.deliveryEventReference, sourceType: input.sourceType, sourceReference: input.sourceReference, reason: input.reason });
    const replay = await idempotentReplay(db as unknown as DbLike, "invoice", input.clinicId, input.idempotencyKey, fp);
    if (replay.kind === "conflict") return { status: "idempotency_conflict" };
    if (replay.kind === "replay") return { status: "transitioned", invoiceId: input.invoiceId, from: "", to: input.transition };
    const rows = await db.select().from(canonicalInvoices).where(and(eq(canonicalInvoices.clinicId, input.clinicId), eq(canonicalInvoices.id, input.invoiceId))).limit(2);
    const inv = rows.find((r) => r.id === input.invoiceId && r.clinicId === input.clinicId);
    if (!inv) return { status: "not_found" };
    const from = inv.canonicalStatus as CanonicalInvoiceStatus, to = input.transition;
    // paid / partially_paid derive ONLY from allocations, never a manual transition.
    if (PAYMENT_DERIVED.has(to)) return { status: "payment_status_derived" };
    if (!canTransitionInvoice(from, to)) return { status: "invalid_transition", from, to };
    // Delivered requires an EXACT approved delivery source (never an arbitrary string);
    // manual attestation additionally requires a reason + source reference + actor.
    if (to === "delivered") {
      if (!invoiceDeliveredRequiresEvent(to, input.deliveryEventReference)) return { status: "delivery_event_required" };
      if (!DELIVERY_SOURCES.has(input.sourceType ?? "")) return { status: "delivery_source_required" };
      if (input.sourceType === "authorized_manual_attestation" && (!nonEmpty(input.reason) || !nonEmpty(input.sourceReference))) return { status: "delivery_source_required" };
    }

    const set: Record<string, unknown> = { canonicalStatus: to, updatedAt: new Date() };
    if (to === "issued") { set.issuedAt = new Date(); if (!nonEmpty(inv.invoiceNumber)) set.invoiceNumber = `INV-${input.clinicId}-${input.invoiceId}`; }
    if (to === "delivered") { set.deliveredAt = new Date(); set.deliveryEventReference = input.deliveryEventReference; }
    const done = await (db as unknown as DbLike).transaction(async (tx) => {
      const claimed = await tx.update(canonicalInvoices).set(set)
        .where(and(eq(canonicalInvoices.id, input.invoiceId), eq(canonicalInvoices.clinicId, input.clinicId), eq(canonicalInvoices.canonicalStatus, from), isNull(canonicalInvoices.supersededAt))).returning();
      if ((claimed as unknown[]).length !== 1) return null;
      await writeTransition(tx, { entityType: "invoice", entityId: input.invoiceId, clinicId: input.clinicId, ancillaryCaseId: inv.ancillaryCaseId, serviceType: inv.serviceType, fromStatus: from, toStatus: to, actorUserId: input.actorUserId, actorRole: input.actorRole, reason: input.reason ?? null, sourceType: input.sourceType ?? "invoice_command", sourceReference: input.sourceReference ?? (to === "delivered" ? input.deliveryEventReference ?? null : null), idempotencyKey: input.idempotencyKey ?? null, commandFingerprint: fp });
      return true;
    });
    if (!done) return { status: "conflict" };
    return { status: "transitioned", invoiceId: input.invoiceId, from, to };
  } catch (e) { if (isUnique(e)) return { status: "conflict" }; if (isFinancialMigration(e)) return { status: "migration_missing" }; return { status: "persistence_failed" }; }
}

export type InvoiceCorrectionInput = { clinicId: number; priorInvoiceId: number; actorUserId: string; actorRole: string; reason?: string | null; idempotencyKey?: string | null };

export async function createCanonicalInvoiceCorrection(input: InvoiceCorrectionInput): Promise<InvoiceCommandResult> {
  if (!canonicalInvoicesRuntimeEnabled()) return { status: "skipped_flag_off" };
  try {
    const fp = commandFingerprint({ action: "correct_invoice", clinicId: input.clinicId, priorInvoiceId: input.priorInvoiceId, reason: input.reason });
    const replay = await idempotentReplay(db as unknown as DbLike, "invoice", input.clinicId, input.idempotencyKey, fp);
    if (replay.kind === "conflict") return { status: "idempotency_conflict" };
    if (replay.kind === "replay") return { status: "reused", invoiceId: replay.entityId };
    const rows = await db.select().from(canonicalInvoices).where(and(eq(canonicalInvoices.clinicId, input.clinicId), eq(canonicalInvoices.id, input.priorInvoiceId))).limit(2);
    const prior = rows.find((r) => r.id === input.priorInvoiceId && r.clinicId === input.clinicId);
    if (!prior) return { status: "not_found" };
    const priorWorking = INVOICE_WORKING.has(prior.canonicalStatus as CanonicalInvoiceStatus);
    try {
      const created = await (db as unknown as DbLike).transaction(async (tx) => {
        if (priorWorking) {
          const sup = await tx.update(canonicalInvoices).set({ canonicalStatus: "superseded", supersededAt: new Date(), updatedAt: new Date() })
            .where(and(eq(canonicalInvoices.id, prior.id), eq(canonicalInvoices.clinicId, input.clinicId), eq(canonicalInvoices.canonicalStatus, prior.canonicalStatus), isNull(canonicalInvoices.supersededAt))).returning();
          if ((sup as unknown[]).length !== 1) return null;
        }
        // A new version — the issued/delivered prior stays as immutable history.
        const [row] = await tx.insert(canonicalInvoices).values({
          clinicId: input.clinicId, ancillaryCaseId: prior.ancillaryCaseId, serviceType: prior.serviceType, claimId: prior.claimId,
          billingDocumentId: prior.billingDocumentId, billingReadinessCheckId: prior.billingReadinessCheckId, evidenceFingerprint: prior.evidenceFingerprint,
          globalPlexusPatientId: prior.globalPlexusPatientId, patientClinicMembershipId: prior.patientClinicMembershipId,
          invoiceType: prior.invoiceType, recipientType: prior.recipientType, recipientId: prior.recipientId,
          canonicalStatus: "draft", currency: prior.currency, totalAmount: prior.totalAmount, lineItems: prior.lineItems as never, amountSource: prior.amountSource,
          supersedesInvoiceId: prior.id, idempotencyKey: input.idempotencyKey ?? null, actorUserId: input.actorUserId, sourceSystem: "invoice_correction",
        }).returning();
        await writeTransition(tx, { entityType: "invoice", entityId: row.id as number, clinicId: input.clinicId, ancillaryCaseId: prior.ancillaryCaseId, serviceType: prior.serviceType, fromStatus: null, toStatus: "draft", actorUserId: input.actorUserId, actorRole: input.actorRole, reason: input.reason ?? "invoice_correction_created", sourceType: "invoice_correction", sourceReference: String(prior.id), idempotencyKey: input.idempotencyKey ?? null, commandFingerprint: fp });
        return row;
      });
      if (!created) return { status: "conflict" };
      return { status: "created", invoiceId: created.id as number };
    } catch (e) { if (isUnique(e)) return { status: "conflict" }; throw e; }
  } catch (e) { if (isFinancialMigration(e)) return { status: "migration_missing" }; return { status: "persistence_failed" }; }
}
