// Phase 2J — canonical financial read model (claims / invoices / payments).
// READ-ONLY, clinic-scoped in SQL AND re-filtered in memory, bounded keyset
// pagination, batched (no per-row N+1). Each section is gated by its own runtime
// flag (upstream_flag_off when OFF, zero reads). A missing canonical table (pg
// 42P01/42703) throws MigrationMissingError → the route answers 503. An ordinary
// per-section read failure is `unavailable` (never a zero / empty-as-success).
// Duplicate current rows per case → integrity conflict (never first/newest).

import { db } from "../../db";
import { and, eq, gt, isNull, inArray, asc } from "drizzle-orm";
import { canonicalClaims } from "@shared/schema/canonicalClaims";
import { canonicalInvoices } from "@shared/schema/canonicalInvoices";
import { canonicalPayments } from "@shared/schema/canonicalPayments";
import { canonicalPaymentAllocations } from "@shared/schema/canonicalPaymentAllocations";
import {
  canonicalClaimsRuntimeEnabled, canonicalInvoicesRuntimeEnabled, canonicalPaymentsRuntimeEnabled,
} from "../../lib/featureFlags";
import { deriveBalance } from "./balance";
import { toCents } from "@shared/money";
import {
  CANONICAL_FINANCIAL_VIEW_VERSION, FINANCIAL_DEFAULT_LIMIT, FINANCIAL_MAX_LIMIT,
  type CanonicalFinancialView, type FinancialSection, type FinancialAvailability,
  type CanonicalClaimRow, type CanonicalInvoiceRow, type CanonicalPaymentRow, type CodeCount,
} from "@shared/canonicalFinancialView";

const MIGRATION_CODE = "ANCILLARY_DOCUMENT_MIGRATION_MISSING";
const MIGRATION_CODES = new Set(["42P01", "42703", MIGRATION_CODE]);
const SCAN = 2000;

export class MigrationMissingError extends Error {
  readonly code = MIGRATION_CODE;
  constructor(cause?: unknown) { super("Canonical migration not applied"); this.name = "MigrationMissingError"; (this as { cause?: unknown }).cause = cause; }
}
function isMigration(e: unknown): boolean { return e instanceof MigrationMissingError || MIGRATION_CODES.has((e as { code?: string })?.code ?? ""); }
function sectionFailure<T>(e: unknown, unavailable: () => T): T { if (isMigration(e)) throw new MigrationMissingError(e); return unavailable(); }
const iso = (v: unknown): string | null => (v ? new Date(v as unknown as Date).toISOString() : null);
function tally(list: { code: string }[]): CodeCount[] {
  const m = new Map<string, number>();
  for (const b of list) if (b && typeof b.code === "string") m.set(b.code, (m.get(b.code) ?? 0) + 1);
  return [...m.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => (b.count - a.count) || a.code.localeCompare(b.code));
}
function clamp(n?: number): number { return !Number.isFinite(n) || n == null ? FINANCIAL_DEFAULT_LIMIT : Math.max(1, Math.min(FINANCIAL_MAX_LIMIT, Math.floor(n))); }
function decode(c?: string | null): number | null { if (typeof c !== "string" || !c) return null; try { const n = Number.parseInt(Buffer.from(c, "base64url").toString("utf8"), 10); return Number.isSafeInteger(n) && n >= 0 ? n : null; } catch { return null; } }
function encode(id: number): string { return Buffer.from(String(id), "utf8").toString("base64url"); }

// Independent cursors per section — one numeric cursor is NEVER shared across the
// three unrelated id spaces (that would skip records in the others).
export type FinancialViewInput = { clinicId: number; claimsCursor?: string | null; invoicesCursor?: string | null; paymentsCursor?: string | null; limit?: number };

export async function getCanonicalFinancialView(input: FinancialViewInput): Promise<CanonicalFinancialView> {
  const generatedAt = new Date().toISOString();
  const [claims, invoices, payments] = await Promise.all([
    buildClaims(input.clinicId, input.claimsCursor, input.limit),
    buildInvoices(input.clinicId, input.invoicesCursor, input.limit),
    buildPayments(input.clinicId, input.paymentsCursor, input.limit),
  ]);
  return { disabled: false, generatedAt, dataVersion: CANONICAL_FINANCIAL_VIEW_VERSION, clinicScoped: true, claims, invoices, payments };
}

// ─── Claims ──────────────────────────────────────────────────────────────────
async function buildClaims(clinicId: number, cursor: string | null | undefined, limitIn: number | undefined): Promise<FinancialSection<CanonicalClaimRow>> {
  const input = { clinicId };
  const limit = clamp(limitIn), after = decode(cursor);
  const shell = (availability: FinancialAvailability, warnings: string[] = []): FinancialSection<CanonicalClaimRow> => ({ availability, warnings, rows: [], pageInfo: { limit, nextCursor: null, returned: 0 } });
  if (!canonicalClaimsRuntimeEnabled()) return shell("upstream_flag_off", ["canonical_claims_flag_off"]);
  try {
    const conds = [eq(canonicalClaims.clinicId, input.clinicId), isNull(canonicalClaims.supersededAt)];
    if (after != null) conds.push(gt(canonicalClaims.id, after));
    const raw = await db.select().from(canonicalClaims).where(and(...conds)).orderBy(asc(canonicalClaims.id)).limit(limit + 1);
    const all = raw.filter((r) => r.clinicId === input.clinicId && r.supersededAt == null && (after == null || r.id > after)).sort((a, b) => a.id - b.id);
    // Duplicate current claim per case → integrity conflict (never first/newest).
    const perCase = new Map<number, number>();
    for (const r of all) if (r.ancillaryCaseId != null && !["voided", "superseded"].includes(r.canonicalStatus)) perCase.set(r.ancillaryCaseId, (perCase.get(r.ancillaryCaseId) ?? 0) + 1);
    const page = all.slice(0, limit);
    const nextCursor = all.length > limit && page.length ? encode(page[page.length - 1].id) : null;
    const rows: CanonicalClaimRow[] = page.map((r) => ({
      claimId: r.id, ancillaryCaseId: r.ancillaryCaseId ?? -1, serviceType: r.serviceType, patientDisplay: null,
      status: r.canonicalStatus, claimReady: r.canonicalStatus === "ready", attemptNumber: r.attemptNumber,
      supersedesClaimId: r.supersedesClaimId ?? null, billingDocumentId: r.billingDocumentId ?? null,
      billingReadinessCheckId: r.billingReadinessCheckId ?? null, evidenceFingerprint: r.evidenceFingerprint ?? null,
      currency: r.currency, chargeAmount: typeof r.chargeAmount === "string" ? r.chargeAmount : null,
      submissionBlockers: tally(((r.claimSubmissionBlockers as { code: string }[] | null) ?? [])),
      warnings: r.ancillaryCaseId != null && (perCase.get(r.ancillaryCaseId) ?? 0) > 1 ? ["duplicate_current_evidence"] : [],
      submittedAt: iso(r.submittedAt), submissionSource: r.submissionSource ?? null,
      integrity: r.ancillaryCaseId != null && (perCase.get(r.ancillaryCaseId) ?? 0) > 1 ? "conflicting" : "resolved",
      evaluatedAt: iso(r.updatedAt),
    }));
    return { availability: "available", warnings: raw.length >= SCAN ? ["counts_truncated"] : [], rows, pageInfo: { limit, nextCursor, returned: page.length } };
  } catch (e) { return sectionFailure(e, () => shell("unavailable", ["claims_read_failed"])); }
}

// ─── Invoices (balance DERIVED from the COMPLETE allocation set) ─────────────
async function buildInvoices(clinicId: number, cursor: string | null | undefined, limitIn: number | undefined): Promise<FinancialSection<CanonicalInvoiceRow>> {
  const input = { clinicId };
  const limit = clamp(limitIn), after = decode(cursor);
  const shell = (availability: FinancialAvailability, warnings: string[] = []): FinancialSection<CanonicalInvoiceRow> => ({ availability, warnings, rows: [], pageInfo: { limit, nextCursor: null, returned: 0 } });
  if (!canonicalInvoicesRuntimeEnabled()) return shell("upstream_flag_off", ["canonical_invoices_flag_off"]);
  try {
    const conds = [eq(canonicalInvoices.clinicId, input.clinicId), isNull(canonicalInvoices.supersededAt)];
    if (after != null) conds.push(gt(canonicalInvoices.id, after));
    const raw = await db.select().from(canonicalInvoices).where(and(...conds)).orderBy(asc(canonicalInvoices.id)).limit(limit + 1);
    const all = raw.filter((r) => r.clinicId === input.clinicId && r.supersededAt == null && (after == null || r.id > after)).sort((a, b) => a.id - b.id);
    const page = all.slice(0, limit);
    const nextCursor = all.length > limit && page.length ? encode(page[page.length - 1].id) : null;
    // Balance derives from the COMPLETE allocation set for this bounded invoice
    // page (batched — one query, no per-invoice N+1). If the read could be
    // truncated (hits the cap), the affected balances are marked CONFLICTING rather
    // than presented as a falsely resolved partial total.
    const invoiceIds = page.map((r) => r.id);
    const allocRaw = canonicalPaymentsRuntimeEnabled() && invoiceIds.length
      ? (await db.select().from(canonicalPaymentAllocations).where(and(eq(canonicalPaymentAllocations.clinicId, input.clinicId), eq(canonicalPaymentAllocations.targetType, "invoice"), inArray(canonicalPaymentAllocations.targetId, invoiceIds))).limit(SCAN + 1)).filter((a) => a.clinicId === input.clinicId && a.targetType === "invoice" && invoiceIds.includes(a.targetId))
      : [];
    const truncated = allocRaw.length > SCAN;   // completeness could not be proven
    const allocByInvoice = new Map<number, typeof allocRaw>();
    for (const a of allocRaw) { const arr = allocByInvoice.get(a.targetId) ?? []; arr.push(a); allocByInvoice.set(a.targetId, arr); }
    const rows: CanonicalInvoiceRow[] = page.map((r) => {
      let originalCents = 0; let amountOk = true;
      try { originalCents = r.totalAmount != null ? toCents(r.totalAmount) : 0; } catch { amountOk = false; }
      // Synthesize the ledger from applied allocations (paid = sum of allocations).
      const synth = (allocByInvoice.get(r.id) ?? []).map((a) => ({ currency: a.currency, amount: a.amount, eventType: "payment", status: "posted", claimId: null, invoiceId: r.id } as never));
      const derived = deriveBalance({ currency: r.currency, originalAmountCents: amountOk ? originalCents : 0, ledger: synth });
      const conflict = !amountOk || truncated || derived.integrity === "conflicting";
      const balance = conflict
        ? { ...derived, integrity: "conflicting" as const, warnings: [...derived.warnings, ...(amountOk ? [] : ["invoice_amount_invalid"]), ...(truncated ? ["balance_ledger_truncated"] : [])] }
        : derived;
      return {
        invoiceId: r.id, ancillaryCaseId: r.ancillaryCaseId ?? -1, serviceType: r.serviceType, patientDisplay: null,
        invoiceType: r.invoiceType, recipientType: r.recipientType ?? null, status: r.canonicalStatus, invoiceNumber: r.invoiceNumber ?? null,
        claimId: r.claimId ?? null, currency: r.currency, totalAmount: typeof r.totalAmount === "string" ? r.totalAmount : null,
        balance, issuedAt: iso(r.issuedAt), deliveredAt: iso(r.deliveredAt),
        warnings: amountOk ? [] : ["invoice_amount_invalid"], integrity: conflict ? "conflicting" : "resolved",
      };
    });
    return { availability: "available", warnings: truncated ? ["balance_ledger_truncated"] : [], rows, pageInfo: { limit, nextCursor, returned: page.length } };
  } catch (e) { return sectionFailure(e, () => shell("unavailable", ["invoices_read_failed"])); }
}

// ─── Payments (ledger events) ────────────────────────────────────────────────
async function buildPayments(clinicId: number, cursor: string | null | undefined, limitIn: number | undefined): Promise<FinancialSection<CanonicalPaymentRow>> {
  const input = { clinicId };
  const limit = clamp(limitIn), after = decode(cursor);
  const shell = (availability: FinancialAvailability, warnings: string[] = []): FinancialSection<CanonicalPaymentRow> => ({ availability, warnings, rows: [], pageInfo: { limit, nextCursor: null, returned: 0 } });
  if (!canonicalPaymentsRuntimeEnabled()) return shell("upstream_flag_off", ["canonical_payments_flag_off"]);
  try {
    const conds = [eq(canonicalPayments.clinicId, input.clinicId)];
    if (after != null) conds.push(gt(canonicalPayments.id, after));
    const raw = await db.select().from(canonicalPayments).where(and(...conds)).orderBy(asc(canonicalPayments.id)).limit(limit + 1);
    const all = raw.filter((r) => r.clinicId === input.clinicId && (after == null || r.id > after)).sort((a, b) => a.id - b.id);
    const page = all.slice(0, limit);
    const nextCursor = all.length > limit && page.length ? encode(page[page.length - 1].id) : null;
    const rows: CanonicalPaymentRow[] = page.map((r) => ({
      paymentId: r.id, ancillaryCaseId: r.ancillaryCaseId ?? null, claimId: r.claimId ?? null, invoiceId: r.invoiceId ?? null,
      eventType: r.eventType, paymentType: r.paymentType, status: r.status, currency: r.currency, amount: r.amount,
      externalTransactionId: r.externalTransactionId ?? null, reversesPaymentId: r.reversesPaymentId ?? null,
      postedAt: iso(r.postedAt), warnings: [],
    }));
    return { availability: "available", warnings: [], rows, pageInfo: { limit, nextCursor, returned: page.length } };
  } catch (e) { return sectionFailure(e, () => shell("unavailable", ["payments_read_failed"])); }
}
