/**
 * Phase 2I — shared canonical STAGE-VECTOR builder for PCS/ACS.
 *
 * Given a bounded, already-clinic-scoped set of ancillary cases, this builds one
 * 10-stage canonical lifecycle vector per case using BATCHED, exact-source reads
 * (never per-row / N+1). Every stage is validated against the EXACT case
 * (clinicId + ancillaryCaseId + serviceType) and its exact source (episode
 * ownership + exhaustive reference/source status agreement, mirroring Phase 2H).
 *
 * TRUTH RULES:
 *  • Exact service — a wrong-service source contributes no status/sourceId/at,
 *    only a PHI-free warning, and never advances currentStage (§4).
 *  • No silent tie-break — a stage that should have exactly one current row and
 *    has MORE than one qualifying current row is an integrity `conflict`
 *    (duplicate_current_evidence): status/sourceId null, available=false. First/
 *    last/highest-id/newest are NEVER used unless an explicit canonical lineage
 *    field proves the one current successor (§5).
 *  • Availability semantics — `availability` is whether the stage query is usable;
 *    `available` is TRUE only when exactly one exact current source was proven
 *    (§6). A successful query with no source is availability=available,
 *    available=false, status=null.
 *  • Billing Document is bound to the current readiness by id + evidence
 *    fingerprint (§13).
 *
 * READ-ONLY. No writes/retry rows/document bytes/note text/claims/invoice/payment.
 * A missing canonical table (pg 42P01/42703) throws MigrationMissingError → 503;
 * an ordinary per-stage read failure marks THAT stage `unavailable` (never zero).
 */

import { db } from "../../db";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { canonicalBillingReadinessChecks } from "@shared/schema/billingReadiness";
import { canonicalBillingDocumentRequests } from "@shared/schema/billingDocuments";
import { canonicalClaims } from "@shared/schema/canonicalClaims";
import { canonicalInvoices } from "@shared/schema/canonicalInvoices";
import { canonicalPayments } from "@shared/schema/canonicalPayments";
import { canonicalPaymentAllocations } from "@shared/schema/canonicalPaymentAllocations";
import { toCents, sumCents } from "@shared/money";
import {
  ancillaryDocumentReferences,
  ORDER_NOTE_SOURCE_TABLE, PROCEDURE_NOTE_SOURCE_TABLE, REPORT_SOURCE_TABLE,
} from "@shared/schema/ancillaryDocuments";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import { procedureEvents } from "@shared/schema/procedureEvents";
import { globalScheduleEvents } from "@shared/schema/globalSchedule";
import { engagementLists, engagementListMemberships } from "@shared/schema/engagementLists";
import { ancillaryCaseAdminReviewEvents } from "@shared/schema/adminReviewEvents";
import type { PatientAncillaryCase } from "@shared/schema/ancillaryCases";
import {
  featureFlags, billingReadinessRuntimeEnabled, billingDocumentRuntimeEnabled,
  procedureNoteRuntimeEnabled,
  canonicalClaimsRuntimeEnabled, canonicalInvoicesRuntimeEnabled, canonicalPaymentsRuntimeEnabled,
} from "../../lib/featureFlags";
import {
  CANONICAL_STAGE_ORDER, type CaseStageVector, type StageStatus, type StageAvailability,
  type EngagementMembershipRow, type CodeCount, type CanonicalStageKey,
} from "@shared/canonicalStageVector";

const MIGRATION_MISSING_CODE = "ANCILLARY_DOCUMENT_MIGRATION_MISSING";
const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", MIGRATION_MISSING_CODE]);
const SCAN_LIMIT = 5000; // bounded across the (already bounded) case page

const NOTE_UNSIGNED_CURRENT = new Set(["needs_signature", "ready_to_sign", "returned_for_correction"]);
const REPORT_CURRENT = new Set(["uploaded", "generated", "approved", "completed"]);

export class MigrationMissingError extends Error {
  readonly code = MIGRATION_MISSING_CODE;
  constructor(cause?: unknown) { super("Canonical migration not applied"); this.name = "MigrationMissingError"; (this as { cause?: unknown }).cause = cause; }
}
function isMigration(e: unknown): boolean {
  return e instanceof MigrationMissingError || MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "");
}
function iso(v: unknown): string | null { return v ? new Date(v as unknown as Date).toISOString() : null; }

async function loadOrNull<T>(fn: () => Promise<T>): Promise<{ ok: true; rows: T } | { ok: false }> {
  try { return { ok: true, rows: await fn() }; }
  catch (e) { if (isMigration(e)) throw new MigrationMissingError(e); return { ok: false }; }
}

/** Build a stage. `available` is TRUE only when a single exact current source was
 *  proven (default: availability available AND a non-null status), per §6. The
 *  normalized `integrity` field (resolved/missing/conflicting) is derived so
 *  deriveCurrentStage never keys on warning strings (§4). */
const stage = (o: Partial<StageStatus> & { availability: StageAvailability }): StageStatus => {
  const availability = o.availability;
  const status = o.status ?? null;
  const available = o.available ?? (availability === "available" && status != null);
  const integrity: StageStatus["integrity"] = o.integrity ?? (
    availability === "available" ? (available ? "resolved" : "missing")
    : availability === "upstream_flag_off" ? "missing"
    : "conflicting" // unavailable / migration_missing
  );
  return { status, availability, available, integrity, sourceId: o.sourceId ?? null, at: o.at ?? null, warnings: o.warnings ?? [] };
};
const upstreamOff = (code: string): StageStatus => stage({ availability: "upstream_flag_off", warnings: [code] });
const unavailable = (code: string): StageStatus => stage({ availability: "unavailable", warnings: [code] });
const conflictStage = (code = "duplicate_current_evidence"): StageStatus => stage({ availability: "available", status: null, available: false, integrity: "conflicting", warnings: [code] });

function tally(list: { code: string }[]): CodeCount[] {
  const m = new Map<string, number>();
  for (const b of list) m.set(b.code, (m.get(b.code) ?? 0) + 1);
  return [...m.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => (b.count - a.count) || a.code.localeCompare(b.code));
}

/** Exactly-one-current selection — NEVER a first/last/newest tie-break. */
type Pick<R> = { kind: "missing" } | { kind: "one"; row: R } | { kind: "conflict" };
function pickSingle<R>(rows: R[]): Pick<R> {
  if (rows.length === 0) return { kind: "missing" };
  if (rows.length === 1) return { kind: "one", row: rows[0] };
  return { kind: "conflict" };
}

export type StageVectorInput = { clinicId: number; cases: PatientAncillaryCase[] };

export async function buildStageVectors(input: StageVectorInput): Promise<CaseStageVector[]> {
  const { clinicId, cases } = input;
  const caseIds = [...new Set(cases.map((c) => c.id))];
  if (caseIds.length === 0) return [];
  const flags = featureFlags;

  // ── Admin Review events (Phase 2C) ──
  const adminGate = flags.serviceSpecificAdminReview;
  const adminLoad = adminGate ? await loadOrNull(() => db.select().from(ancillaryCaseAdminReviewEvents).where(inArray(ancillaryCaseAdminReviewEvents.ancillaryCaseId, caseIds)).limit(SCAN_LIMIT)) : null;
  const adminByCase = groupArray(adminLoad, (e) => e.ancillaryCaseId, caseIds);

  // ── Engagement memberships + lists (Phase 2C) ──
  const engagementGate = flags.engagementAdminReviewSync || flags.engagementMultiListRepository || flags.engagementRecentLists;
  const membersLoad = engagementGate ? await loadOrNull(() => db.select().from(engagementListMemberships).where(and(inArray(engagementListMemberships.ancillaryCaseId, caseIds), eq(engagementListMemberships.status, "active"))).limit(SCAN_LIMIT)) : null;
  const activeMembers = membersLoad?.ok ? membersLoad.rows.filter((m) => m.status === "active" && m.ancillaryCaseId != null && caseIds.includes(m.ancillaryCaseId)) : [];
  const listIds = [...new Set(activeMembers.map((m) => m.engagementListId))];
  const listsLoad = engagementGate && listIds.length ? await loadOrNull(() => db.select().from(engagementLists).where(and(eq(engagementLists.clinicId, clinicId), inArray(engagementLists.id, listIds))).limit(SCAN_LIMIT)) : { ok: true as const, rows: [] as typeof engagementLists.$inferSelect[] };
  const listById = new Map<number, typeof engagementLists.$inferSelect>();
  if (listsLoad.ok) for (const l of listsLoad.rows) if (l.clinicId === clinicId) listById.set(l.id, l);
  const membershipsByCase = groupMemberships(activeMembers, listById, cases);

  // ── Canonical appointment (Phase 2D) ──
  const apptGate = flags.canonicalAppointment;
  const apptLoad = apptGate ? await loadOrNull(() => db.select().from(globalScheduleEvents).where(and(eq(globalScheduleEvents.clinicId, clinicId), inArray(globalScheduleEvents.ancillaryCaseId, caseIds), inArray(globalScheduleEvents.eventType, ["ancillary_appointment", "same_day_add"]))).limit(SCAN_LIMIT)) : null;
  const apptByCase = groupArray(apptLoad, (e) => e.ancillaryCaseId, caseIds, (e) => e.clinicId === clinicId);

  // ── Unified document references (Phase 2E) ──
  const docsGate = flags.unifiedAncillaryDocuments;
  const refsLoad = docsGate ? await loadOrNull(() => db.select().from(ancillaryDocumentReferences).where(and(eq(ancillaryDocumentReferences.clinicId, clinicId), isNull(ancillaryDocumentReferences.supersededAt), inArray(ancillaryDocumentReferences.ancillaryCaseId, caseIds), inArray(ancillaryDocumentReferences.documentKind, ["order_note", "procedure_note", "report"]))).limit(SCAN_LIMIT)) : null;
  const refs = refsLoad?.ok ? refsLoad.rows.filter((r) => r.clinicId === clinicId && r.supersededAt == null) : [];
  const noteSourceIds = [...new Set(refs.filter((r) => (r.documentKind === "order_note" || r.documentKind === "procedure_note") && r.sourceTable === PROCEDURE_NOTE_SOURCE_TABLE && r.sourceId != null).map((r) => r.sourceId as number))];
  const reportSourceIds = [...new Set(refs.filter((r) => r.documentKind === "report" && r.sourceTable === REPORT_SOURCE_TABLE && r.sourceId != null).map((r) => r.sourceId as number))];
  const noteRowsLoad = docsGate && noteSourceIds.length ? await loadOrNull(() => db.select().from(procedureNotes).where(and(eq(procedureNotes.clinicId, clinicId), inArray(procedureNotes.id, noteSourceIds))).limit(SCAN_LIMIT)) : { ok: true as const, rows: [] as typeof procedureNotes.$inferSelect[] };
  const cdrRowsLoad = docsGate && reportSourceIds.length ? await loadOrNull(() => db.select().from(caseDocumentReadiness).where(and(eq(caseDocumentReadiness.clinicId, clinicId), inArray(caseDocumentReadiness.id, reportSourceIds))).limit(SCAN_LIMIT)) : { ok: true as const, rows: [] as typeof caseDocumentReadiness.$inferSelect[] };
  const noteById = new Map<number, typeof procedureNotes.$inferSelect>();
  if (noteRowsLoad.ok) for (const n of noteRowsLoad.rows) if (n.clinicId === clinicId) noteById.set(n.id, n);
  const cdrById = new Map<number, typeof caseDocumentReadiness.$inferSelect>();
  if (cdrRowsLoad.ok) for (const c of cdrRowsLoad.rows) if (c.clinicId === clinicId) cdrById.set(c.id, c);
  const refsByCaseKind = groupRefsByCaseKind(refs);

  // ── Procedure lifecycle (Phase 2F) ──
  const procGate = flags.canonicalProcedureLifecycle;
  const procLoad = procGate ? await loadOrNull(() => db.select().from(procedureEvents).where(and(eq(procedureEvents.clinicId, clinicId), inArray(procedureEvents.ancillaryCaseId, caseIds))).limit(SCAN_LIMIT)) : null;
  const procByCase = groupArray(procLoad, (p) => p.ancillaryCaseId, caseIds, (p) => p.clinicId === clinicId);

  // ── Billing readiness / Billing Document (Phase 2G), current non-superseded ──
  const readinessGate = billingReadinessRuntimeEnabled();
  const readinessLoad = readinessGate ? await loadOrNull(() => db.select().from(canonicalBillingReadinessChecks).where(and(eq(canonicalBillingReadinessChecks.clinicId, clinicId), isNull(canonicalBillingReadinessChecks.supersededAt), inArray(canonicalBillingReadinessChecks.ancillaryCaseId, caseIds))).limit(SCAN_LIMIT)) : null;
  const readinessByCase = groupArray(readinessLoad, (r) => r.ancillaryCaseId, caseIds, (r) => r.clinicId === clinicId && r.supersededAt == null);
  const docGate = billingDocumentRuntimeEnabled();
  const billingDocLoad = docGate ? await loadOrNull(() => db.select().from(canonicalBillingDocumentRequests).where(and(eq(canonicalBillingDocumentRequests.clinicId, clinicId), isNull(canonicalBillingDocumentRequests.supersededAt), inArray(canonicalBillingDocumentRequests.ancillaryCaseId, caseIds))).limit(SCAN_LIMIT)) : null;
  const billingDocByCase = groupArray(billingDocLoad, (d) => d.ancillaryCaseId, caseIds, (d) => d.clinicId === clinicId && d.supersededAt == null);

  // ── Canonical claim / invoice / payment (Phase 2J), current non-superseded ──
  const claimGate = canonicalClaimsRuntimeEnabled();
  const claimLoad = claimGate ? await loadOrNull(() => db.select().from(canonicalClaims).where(and(eq(canonicalClaims.clinicId, clinicId), isNull(canonicalClaims.supersededAt), inArray(canonicalClaims.ancillaryCaseId, caseIds))).limit(SCAN_LIMIT)) : null;
  const claimByCase = groupArray(claimLoad, (r) => r.ancillaryCaseId, caseIds, (r) => r.clinicId === clinicId && r.supersededAt == null);
  const invoiceGate = canonicalInvoicesRuntimeEnabled();
  const invoiceLoad = invoiceGate ? await loadOrNull(() => db.select().from(canonicalInvoices).where(and(eq(canonicalInvoices.clinicId, clinicId), isNull(canonicalInvoices.supersededAt), inArray(canonicalInvoices.ancillaryCaseId, caseIds))).limit(SCAN_LIMIT)) : null;
  const invoiceByCase = groupArray(invoiceLoad, (r) => r.ancillaryCaseId, caseIds, (r) => r.clinicId === clinicId && r.supersededAt == null);
  const paymentGate = canonicalPaymentsRuntimeEnabled();
  const paymentLoad = paymentGate ? await loadOrNull(() => db.select().from(canonicalPayments).where(and(eq(canonicalPayments.clinicId, clinicId), inArray(canonicalPayments.ancillaryCaseId, caseIds))).limit(SCAN_LIMIT)) : null;
  const paymentByCase = groupArray(paymentLoad, (r) => r.ancillaryCaseId, caseIds, (r) => r.clinicId === clinicId);
  const allocLoad = paymentGate ? await loadOrNull(() => db.select().from(canonicalPaymentAllocations).where(and(eq(canonicalPaymentAllocations.clinicId, clinicId), inArray(canonicalPaymentAllocations.ancillaryCaseId, caseIds))).limit(SCAN_LIMIT)) : null;
  const allocByCase = groupArray(allocLoad, (r) => r.ancillaryCaseId, caseIds, (r) => r.clinicId === clinicId);

  const ctx: Ctx = {
    clinicId, adminGate, adminByCase, adminOk: adminLoad?.ok ?? true,
    engagementGate, membershipsByCase,
    apptGate, apptOk: apptLoad?.ok ?? true, apptByCase,
    docsGate, refsOk: refsLoad?.ok ?? true, refsByCaseKind, noteById, cdrById,
    procGate, procOk: procLoad?.ok ?? true, procByCase,
    readinessGate, readinessOk: readinessLoad?.ok ?? true, readinessByCase,
    docGate, docOk: billingDocLoad?.ok ?? true, billingDocByCase,
    claimGate, claimOk: claimLoad?.ok ?? true, claimByCase,
    invoiceGate, invoiceOk: invoiceLoad?.ok ?? true, invoiceByCase,
    paymentGate, paymentOk: (paymentLoad?.ok ?? true) && (allocLoad?.ok ?? true), paymentByCase, allocByCase,
  };
  return cases.map((c) => buildOne(c, ctx));
}

// ─── per-case assembly ───────────────────────────────────────────────────────
type Ctx = {
  clinicId: number;
  adminGate: boolean; adminOk: boolean; adminByCase: Map<number, typeof ancillaryCaseAdminReviewEvents.$inferSelect[]>;
  engagementGate: boolean; membershipsByCase: Map<number, EngagementMembershipRow[]>;
  apptGate: boolean; apptOk: boolean; apptByCase: Map<number, typeof globalScheduleEvents.$inferSelect[]>;
  docsGate: boolean; refsOk: boolean; refsByCaseKind: Map<string, typeof ancillaryDocumentReferences.$inferSelect[]>;
  noteById: Map<number, typeof procedureNotes.$inferSelect>; cdrById: Map<number, typeof caseDocumentReadiness.$inferSelect>;
  procGate: boolean; procOk: boolean; procByCase: Map<number, typeof procedureEvents.$inferSelect[]>;
  readinessGate: boolean; readinessOk: boolean; readinessByCase: Map<number, typeof canonicalBillingReadinessChecks.$inferSelect[]>;
  docGate: boolean; docOk: boolean; billingDocByCase: Map<number, typeof canonicalBillingDocumentRequests.$inferSelect[]>;
  claimGate: boolean; claimOk: boolean; claimByCase: Map<number, typeof canonicalClaims.$inferSelect[]>;
  invoiceGate: boolean; invoiceOk: boolean; invoiceByCase: Map<number, typeof canonicalInvoices.$inferSelect[]>;
  paymentGate: boolean; paymentOk: boolean; paymentByCase: Map<number, typeof canonicalPayments.$inferSelect[]>;
  allocByCase: Map<number, typeof canonicalPaymentAllocations.$inferSelect[]>;
};

function buildOne(c: PatientAncillaryCase, ctx: Ctx): CaseStageVector {
  const svc = c.serviceType;

  // ── Admin Review — FAILS CLOSED against the exact event stream (§4). The event
  // stream OFF → the source system is not enabled (upstream_flag_off). ON: exactly
  // one latest service-matching event that AGREES with the projection → resolved;
  // a read failure → unavailable; tied conflicting latest → conflict; a latest
  // event that disagrees with the projection → conflict; no event → missing (the
  // case projection is derived from events, never independent, so it alone cannot
  // resolve the stage). currentStage never advances past a conflicting Admin Review.
  const adminReview = (() => {
    if (!ctx.adminGate) return upstreamOff("admin_review_event_flag_off");
    if (!ctx.adminOk) return stage({ availability: "unavailable", integrity: "conflicting", warnings: ["admin_review_event_read_failed"] });
    const all = ctx.adminByCase.get(c.id) ?? [];
    const wrongSvc = all.some((e) => e.serviceType !== svc);
    const svcEvents = all.filter((e) => e.serviceType === svc);
    if (svcEvents.length === 0) return stage({ status: null, availability: "available", available: false, integrity: "missing", warnings: wrongSvc ? ["admin_review_wrong_service_event"] : ["admin_review_event_missing"] });
    let maxAt = -Infinity; for (const e of svcEvents) { const ts = new Date(e.actualReviewedAt as unknown as Date).getTime(); if (ts > maxAt) maxAt = ts; }
    const latest = svcEvents.filter((e) => new Date(e.actualReviewedAt as unknown as Date).getTime() === maxAt);
    const statuses = new Set(latest.map((e) => e.newStatus));
    if (latest.length > 1 && statuses.size > 1) return stage({ status: null, availability: "available", available: false, integrity: "conflicting", warnings: ["admin_review_event_conflict"] });
    if (latest[0].newStatus !== c.adminReviewStatus) return stage({ status: null, availability: "available", available: false, integrity: "conflicting", warnings: ["admin_review_event_projection_mismatch"] });
    return stage({ status: c.adminReviewStatus ?? null, availability: "available", available: c.adminReviewStatus != null, at: iso(latest[0].actualReviewedAt) });
  })();

  // ── Engagement ──
  const mships = ctx.membershipsByCase.get(c.id) ?? [];
  const lastSentAt = mships.reduce<string | null>((acc, m) => (m.sentToEngagementAt && (acc == null || m.sentToEngagementAt > acc) ? m.sentToEngagementAt : acc), null);
  const engagement = !ctx.engagementGate
    ? { ...upstreamOff("engagement_flag_off"), memberships: [] as EngagementMembershipRow[], lastSentAt: null }
    : { ...stage({ status: mships.length ? "member" : null, availability: "available", available: mships.length > 0, at: lastSentAt }), memberships: mships, lastSentAt };

  // ── Appointment — the current canonical appointment is the exact lineage LEAF.
  // Terminal outcomes (cancelled/no_show/blocked/pending_sync) are preserved as-is
  // (never turned into "missing"); a terminal leaf halts progression truthfully.
  // >1 independent current leaf → conflict (no first/newest/most-advanced pick). ──
  const appointment = resolveSourceStage(ctx.apptGate, ctx.apptOk, "canonical_appointment_flag_off", "appointment_read_failed", () => {
    const all = ctx.apptByCase.get(c.id) ?? [];
    const wrongSvc = all.some((e) => e.serviceType !== svc);
    const validated = all.filter((e) => e.serviceType === svc);
    // A predecessor is any event referenced as another validated event's parent.
    const supersededIds = new Set(validated.map((e) => e.parentEventId).filter((x): x is number => x != null));
    const leaves = validated.filter((e) => !supersededIds.has(e.id));
    return { pick: pickSingle(leaves), toStage: (e: typeof leaves[number]) => stage({ status: e.status, availability: "available", available: true, sourceId: e.id, at: iso(e.startsAt) }), wrongSvc, wrongCode: "appointment_wrong_service" };
  });

  // ── Order Note (exact-source validated + single current) ──
  const orderNote = resolveRefStage(ctx, c, svc, "order_note", "unified_documents_flag_off", "order_note_read_failed");
  // ── Report ──
  const report = resolveReportStage(ctx, c, svc);
  // ── Procedure ──
  const procedure = resolveSourceStage(ctx.procGate, ctx.procOk, "procedure_lifecycle_flag_off", "procedure_read_failed", () => {
    const all = ctx.procByCase.get(c.id) ?? [];
    const wrongSvc = all.some((e) => e.serviceType !== svc);
    const qualifying = all.filter((e) => e.serviceType === svc);
    return { pick: pickSingle(qualifying), toStage: (p: typeof qualifying[number]) => stage({ status: p.procedureStatus, availability: "available", sourceId: p.id, at: iso(p.completedAt) }), wrongSvc, wrongCode: "procedure_wrong_service" };
  });

  // ── Procedure Note + Signature (full runtime) ──
  const pnRuntime = procedureNoteRuntimeEnabled();
  const procedureNote = !pnRuntime ? upstreamOff("procedure_note_flag_off") : resolveRefStage(ctx, c, svc, "procedure_note", "procedure_note_flag_off", "procedure_note_read_failed");
  const signature = !pnRuntime ? upstreamOff("procedure_note_flag_off") : resolveSignatureStage(ctx, c, svc);

  // ── Billing readiness (single current, exact service) ──
  const readinessPick = resolveReadinessPick(ctx, c, svc);
  const billingReadiness = readinessPick.stage;

  // ── Billing Document (single current, exact service, bound to readiness id +
  // evidence fingerprint) ──
  const billingDocument = resolveBillingDocStage(ctx, c, svc, readinessPick.row);

  // ── Phase 2J financial stages (single current per case+service; conflict on >1;
  // upstream_flag_off when the 2J flag is OFF → non-blocking, non-rendered). ──
  const claim = resolveSourceStage(ctx.claimGate, ctx.claimOk, "canonical_claims_flag_off", "claim_read_failed", () => {
    const all = ctx.claimByCase.get(c.id) ?? [];
    const wrongSvc = all.some((r) => r.serviceType !== svc);
    const qualifying = all.filter((r) => r.serviceType === svc && !["voided", "superseded"].includes(r.canonicalStatus));
    return { pick: pickSingle(qualifying), toStage: (r: typeof qualifying[number]) => stage({ status: r.canonicalStatus, availability: "available", sourceId: r.id, at: iso(r.submittedAt ?? r.updatedAt), available: r.canonicalStatus != null }), wrongSvc, wrongCode: "claim_wrong_service" };
  });
  const invoice = resolveSourceStage(ctx.invoiceGate, ctx.invoiceOk, "canonical_invoices_flag_off", "invoice_read_failed", () => {
    const all = ctx.invoiceByCase.get(c.id) ?? [];
    const wrongSvc = all.some((r) => r.serviceType !== svc);
    const qualifying = all.filter((r) => r.serviceType === svc && !["voided", "superseded"].includes(r.canonicalStatus));
    return { pick: pickSingle(qualifying), toStage: (r: typeof qualifying[number]) => stage({ status: r.canonicalStatus, availability: "available", sourceId: r.id, at: iso(r.issuedAt), available: r.canonicalStatus != null }), wrongSvc, wrongCode: "invoice_wrong_service" };
  });
  // Payment stage — DERIVED from the reconciled ledger + allocations against the
  // case's current claim/invoice total (PHI-free: no amounts exposed, only a status).
  // A posted payment event alone NEVER completes the stage; only a reconciled zero
  // outstanding with valid allocations reaches `paid`. Refund/reversal reopen it.
  const payment = (() => {
    if (!ctx.paymentGate) return upstreamOff("canonical_payments_flag_off");
    if (!ctx.paymentOk) return unavailable("payment_read_failed");
    // Already case-scoped by allocByCase/paymentByCase; a null serviceType (an
    // untagged receipt) is still this case's money and must not be dropped.
    const events = (ctx.paymentByCase.get(c.id) ?? []).filter((r) => r.serviceType === svc || r.serviceType == null);
    const allocs = (ctx.allocByCase.get(c.id) ?? []).filter((r) => r.serviceType === svc || r.serviceType == null);
    const postedPayments = events.filter((r) => r.eventType === "payment" && r.status === "posted");
    // Exact target total: prefer a single current invoice, else the single current claim.
    const invoices = (ctx.invoiceByCase.get(c.id) ?? []).filter((r) => r.serviceType === svc && !["voided", "superseded"].includes(r.canonicalStatus));
    const claims = (ctx.claimByCase.get(c.id) ?? []).filter((r) => r.serviceType === svc && !["voided", "superseded"].includes(r.canonicalStatus));
    const totalStr = invoices.length === 1 ? (invoices[0].totalAmount as string | null) : claims.length === 1 ? (claims[0].chargeAmount as string | null) : null;
    if (postedPayments.length === 0 && allocs.length === 0) return stage({ status: null, availability: "available", available: false });
    let appliedC = 0, refundedC = 0, totalC: number | null = null, bad = false;
    try {
      // Effective net applied = Σ apply − Σ (refund + reversal) allocation rows.
      appliedC = sumCents(allocs.filter((a) => a.eventType === "apply").map((a) => toCents(a.amount)));
      refundedC = sumCents(allocs.filter((a) => a.eventType === "refund" || a.eventType === "reversal").map((a) => toCents(a.amount)));
      totalC = totalStr != null ? toCents(totalStr) : null;
    } catch { bad = true; }
    if (bad) return conflictStage("payment_amount_conflict");
    const netApplied = appliedC - refundedC;
    // Fully negated → refunded/reversed (reopened); never completes.
    if (appliedC > 0 && netApplied <= 0) return stage({ status: refundedC >= appliedC ? "reversed" : "refunded", availability: "available", available: false });
    if (netApplied <= 0) return stage({ status: "unapplied", availability: "available", available: false });
    if (totalC == null) return conflictStage("payment_target_unresolved");
    // Overpayment takes precedence over the partial-refund label when a residual net
    // still exceeds the target total.
    if (netApplied > totalC) return stage({ status: "overpaid", availability: "available", available: false });
    // A partial negation with a residual applied balance below the total is partially_refunded.
    if (refundedC > 0) return stage({ status: "partially_refunded", availability: "available", available: false });
    if (netApplied === totalC) return stage({ status: "paid", availability: "available", available: true });
    return stage({ status: "partially_paid", availability: "available", available: false });
  })();

  const stages: Record<CanonicalStageKey, StageStatus> = { adminReview, engagement, appointment, orderNote, procedure, report, procedureNote, signature, billingReadiness, billingDocument, claim, invoice, payment };
  const { currentStage, currentStageIntegrity } = deriveCurrentStage(stages);

  return {
    ancillaryCaseId: c.id, serviceType: svc, lifecycleStatus: c.lifecycleStatus ?? null,
    adminReviewStatus: c.adminReviewStatus ?? null,
    identity: {
      globalPlexusPatientId: c.globalPlexusPatientId ?? null, patientClinicMembershipId: c.patientClinicMembershipId ?? null,
      patientDisplay: null, patientDob: null, clinicMrn: null,
      available: c.globalPlexusPatientId != null && c.patientClinicMembershipId != null,
      warnings: (c.globalPlexusPatientId == null || c.patientClinicMembershipId == null) ? ["identity_incomplete"] : [],
    },
    adminReview, engagement, appointment, orderNote, procedure, report, procedureNote, signature, billingReadiness, billingDocument,
    claim, invoice, payment,
    currentStage, currentStageIntegrity,
  };
}

// ─── generic single-current source stage ─────────────────────────────────────
function resolveSourceStage<R>(
  gate: boolean, ok: boolean, offCode: string, failCode: string,
  compute: () => { pick: Pick<R>; toStage: (r: R) => StageStatus; wrongSvc: boolean; wrongCode: string },
): StageStatus {
  if (!gate) return upstreamOff(offCode);
  if (!ok) return unavailable(failCode);
  const { pick, toStage, wrongSvc, wrongCode } = compute();
  if (pick.kind === "conflict") return conflictStage();
  if (pick.kind === "one") return toStage(pick.row);
  // missing — surface a wrong-service warning when a wrong-service candidate exists.
  return stage({ status: null, availability: "available", warnings: wrongSvc ? [wrongCode] : [] });
}

function resolveRefStage(ctx: Ctx, c: PatientAncillaryCase, svc: string, kind: "order_note" | "procedure_note", offCode: string, failCode: string): StageStatus {
  if (!ctx.docsGate && kind === "order_note") return upstreamOff(offCode);
  if (!ctx.refsOk) return unavailable(failCode);
  const all = ctx.refsByCaseKind.get(`${c.id}|${kind}`) ?? [];
  const wrongSvc = all.some((r) => r.serviceType !== svc);
  const svcRefs = all.filter((r) => r.serviceType === svc);
  const pick = pickSingle(svcRefs);
  if (pick.kind === "conflict") return conflictStage();
  if (pick.kind === "missing") return stage({ status: null, availability: "available", warnings: wrongSvc ? [`${kind}_wrong_service`] : [] });
  const ref = pick.row;
  const note = ref.sourceId != null ? ctx.noteById.get(ref.sourceId) : undefined;
  const reason = validateNote(ref, note, kind === "order_note" ? "order_note" : "post_procedure_note", svc);
  if (reason) return stage({ status: null, availability: "available", warnings: [reason] });
  return stage({ status: ref.documentStatus, availability: "available", sourceId: ref.sourceId, at: iso(ref.signedAt) });
}
function resolveReportStage(ctx: Ctx, c: PatientAncillaryCase, svc: string): StageStatus {
  if (!ctx.docsGate) return upstreamOff("unified_documents_flag_off");
  if (!ctx.refsOk) return unavailable("report_read_failed");
  const all = ctx.refsByCaseKind.get(`${c.id}|report`) ?? [];
  const wrongSvc = all.some((r) => r.serviceType !== svc);
  const svcRefs = all.filter((r) => r.serviceType === svc);
  const pick = pickSingle(svcRefs);
  if (pick.kind === "conflict") return conflictStage();
  if (pick.kind === "missing") return stage({ status: null, availability: "available", warnings: wrongSvc ? ["report_wrong_service"] : [] });
  const ref = pick.row;
  const cdr = ref.sourceId != null ? ctx.cdrById.get(ref.sourceId) : undefined;
  const reason = validateReport(ref, cdr, svc);
  if (reason) return stage({ status: null, availability: "available", warnings: [reason] });
  return stage({ status: ref.documentStatus, availability: "available", sourceId: ref.sourceId, at: iso(ref.actualCreatedAt) });
}
function resolveSignatureStage(ctx: Ctx, c: PatientAncillaryCase, svc: string): StageStatus {
  if (!ctx.refsOk) return unavailable("signature_read_failed");
  const all = ctx.refsByCaseKind.get(`${c.id}|procedure_note`) ?? [];
  const svcRefs = all.filter((r) => r.serviceType === svc);
  const pick = pickSingle(svcRefs);
  if (pick.kind === "conflict") return conflictStage();
  if (pick.kind === "missing") return stage({ status: null, availability: "available" });
  const ref = pick.row;
  const note = ref.sourceId != null ? ctx.noteById.get(ref.sourceId) : undefined;
  const reason = validateNote(ref, note, "post_procedure_note", svc);
  if (reason) return stage({ status: null, availability: "available", warnings: [reason] });
  return stage({ status: note!.signatureStatus ?? null, availability: "available", sourceId: ref.sourceId, at: iso(note!.signedAt), available: note!.signatureStatus != null });
}
function resolveReadinessPick(ctx: Ctx, c: PatientAncillaryCase, svc: string): { stage: CaseStageVector["billingReadiness"]; row: typeof canonicalBillingReadinessChecks.$inferSelect | null } {
  const empty = { billingBlockers: [] as CodeCount[], claimBlockers: [] as CodeCount[] };
  if (!ctx.readinessGate) return { stage: { ...upstreamOff("billing_readiness_flag_off"), ...empty }, row: null };
  if (!ctx.readinessOk) return { stage: { ...unavailable("billing_readiness_read_failed"), ...empty }, row: null };
  const all = ctx.readinessByCase.get(c.id) ?? [];
  const wrongSvc = all.some((r) => r.serviceType !== svc);
  const svcRows = all.filter((r) => r.serviceType === svc);
  const pick = pickSingle(svcRows);
  if (pick.kind === "conflict") return { stage: { ...conflictStage(), ...empty }, row: null };
  if (pick.kind === "missing") return { stage: { ...stage({ status: null, availability: "available", warnings: wrongSvc ? ["billing_readiness_wrong_service"] : [] }), ...empty }, row: null };
  const r = pick.row;
  return { stage: { ...stage({ status: r.canonicalStatus ?? null, availability: "available", sourceId: r.id, at: iso(r.evaluatedAt), available: r.canonicalStatus != null }), billingBlockers: tally(((r.billingBlockers as { code: string }[] | null) ?? [])), claimBlockers: tally(((r.claimBlockers as { code: string }[] | null) ?? [])) }, row: r };
}
function resolveBillingDocStage(ctx: Ctx, c: PatientAncillaryCase, svc: string, readiness: typeof canonicalBillingReadinessChecks.$inferSelect | null): StageStatus {
  if (!ctx.docGate) return upstreamOff("billing_document_flag_off");
  if (!ctx.docOk) return unavailable("billing_document_read_failed");
  const all = ctx.billingDocByCase.get(c.id) ?? [];
  const wrongSvc = all.some((d) => d.serviceType !== svc);
  const svcDocs = all.filter((d) => d.serviceType === svc);
  const pick = pickSingle(svcDocs);
  if (pick.kind === "conflict") return conflictStage();
  if (pick.kind === "missing") return stage({ status: null, availability: "available", warnings: wrongSvc ? ["billing_document_wrong_service"] : [] });
  const d = pick.row;
  // (§6) the current Billing Document must be bound to the CURRENT readiness by id
  // AND a NON-NULL evidence fingerprint — NULL is never accepted as version proof.
  if (!readiness) return stage({ status: null, availability: "available", warnings: ["billing_document_readiness_unresolved"] });
  if (d.billingReadinessCheckId !== readiness.id) return stage({ status: null, availability: "available", warnings: ["billing_document_wrong_readiness"] });
  const rfp = nonEmpty(readiness.evidenceFingerprint), dfp = nonEmpty(d.evidenceFingerprint);
  if (rfp == null || dfp == null) return stage({ status: null, availability: "available", warnings: ["billing_document_fingerprint_unresolved"] });
  if (rfp !== dfp) return stage({ status: null, availability: "available", warnings: ["billing_document_stale_fingerprint"] });
  // Persisted exact document-reference IDs must agree SYMMETRICALLY — normalize
  // both sides to null and require exact equality whenever EITHER side is non-null
  // (a document may never introduce an evidence reference absent from the readiness).
  for (const k of ["orderNoteDocumentReferenceId", "reportDocumentReferenceId", "procedureNoteDocumentReferenceId"] as const) {
    const rr = (readiness[k] as number | null) ?? null, dd = (d[k] as number | null) ?? null;
    if (rr !== dd) return stage({ status: null, availability: "available", warnings: ["billing_document_reference_mismatch"] });
  }
  return stage({ status: d.canonicalStatus ?? null, availability: "available", sourceId: d.id, at: iso(d.generatedAt), available: d.canonicalStatus != null });
}
function nonEmpty(v: unknown): string | null { return typeof v === "string" && v.trim().length > 0 ? v : null; }

// ─── deterministic currentStage ──────────────────────────────────────────────
function isComplete(key: CanonicalStageKey, s: StageStatus): boolean {
  const st = s.status;
  switch (key) {
    case "adminReview": return st === "approved";
    case "engagement": return st === "member";
    case "appointment": return st === "scheduled" || st === "completed";
    case "orderNote": return st === "signed";
    case "procedure": return st === "complete";
    case "report": return st != null;
    case "procedureNote": return st != null && st !== "pending_signature";
    case "signature": return st === "signed";
    case "billingReadiness": return st === "ready_to_generate" || st === "billing_document_generated";
    case "billingDocument": return st === "generated" || st === "approved";
    // Phase 2J financial stages — complete only at their exact terminal states.
    case "claim": return st === "paid" || st === "accepted";
    case "invoice": return st === "paid";
    // Payment completes ONLY at a reconciled zero-outstanding (paid) — never from a
    // mere posted event, a partial payment, an unapplied receipt, or after a refund.
    case "payment": return st === "paid";
    default: return false;
  }
}
function isTerminalHalt(key: CanonicalStageKey, s: StageStatus): boolean {
  return key === "procedure" && (s.status === "cancelled" || s.status === "no_show" || s.status === "unable_to_complete");
}
function deriveCurrentStage(stages: Record<CanonicalStageKey, StageStatus>): { currentStage: CanonicalStageKey | null; currentStageIntegrity: "resolved" | "unresolved" | "conflicting" } {
  for (const key of CANONICAL_STAGE_ORDER) {
    const s = stages[key];
    if (s.availability === "upstream_flag_off") continue;                 // not tracked → not blocking
    // ANY explicit integrity conflict (duplicate current evidence, admin-review
    // conflict/mismatch, or a failed read) prevents a false current stage (§4).
    if (s.integrity === "conflicting") return { currentStage: null, currentStageIntegrity: "conflicting" };
    if (isTerminalHalt(key, s)) return { currentStage: key, currentStageIntegrity: "resolved" };
    if (!isComplete(key, s)) return { currentStage: key, currentStageIntegrity: "resolved" };
  }
  return { currentStage: null, currentStageIntegrity: "resolved" };
}

// ─── grouping helpers ────────────────────────────────────────────────────────
function groupArray<R>(load: { ok: boolean; rows?: R[] } | null, caseOf: (r: R) => number | null, caseIds: number[], keep?: (r: R) => boolean): Map<number, R[]> {
  const m = new Map<number, R[]>();
  if (!load || !load.ok || !load.rows) return m;
  for (const r of load.rows) {
    if (keep && !keep(r)) continue;
    const cid = caseOf(r); if (cid == null || !caseIds.includes(cid)) continue;
    const arr = m.get(cid) ?? []; arr.push(r); m.set(cid, arr);
  }
  return m;
}
function groupRefsByCaseKind(refs: typeof ancillaryDocumentReferences.$inferSelect[]): Map<string, typeof ancillaryDocumentReferences.$inferSelect[]> {
  const m = new Map<string, typeof ancillaryDocumentReferences.$inferSelect[]>();
  for (const r of refs) { const k = `${r.ancillaryCaseId}|${r.documentKind}`; const arr = m.get(k) ?? []; arr.push(r); m.set(k, arr); }
  return m;
}
function groupMemberships(active: typeof engagementListMemberships.$inferSelect[], listById: Map<number, typeof engagementLists.$inferSelect>, cases: PatientAncillaryCase[]): Map<number, EngagementMembershipRow[]> {
  const svcByCase = new Map<number, string>();
  for (const c of cases) svcByCase.set(c.id, c.serviceType);
  const m = new Map<number, EngagementMembershipRow[]>();
  for (const mem of active) {
    const list = listById.get(mem.engagementListId);
    if (!list) continue;
    const svc = svcByCase.get(mem.ancillaryCaseId as number);
    if (svc != null && mem.serviceType !== svc) continue;
    const row: EngagementMembershipRow = { engagementMembershipId: mem.id, engagementListId: list.id, engagementListDisplayName: list.label ?? null, engagementListSourceType: list.sourceType ?? null, engagementListSourceId: list.sourceId ?? null, serviceType: mem.serviceType ?? null, sentToEngagementAt: iso(list.sentToEngagementAt) };
    const arr = m.get(mem.ancillaryCaseId as number) ?? []; arr.push(row); m.set(mem.ancillaryCaseId as number, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => (a.engagementListId - b.engagementListId) || (a.engagementMembershipId - b.engagementMembershipId));
  return m;
}

// ─── exact-source validators (mirror Phase 2H rules) + exact case service ────
function validateNote(r: typeof ancillaryDocumentReferences.$inferSelect, note: typeof procedureNotes.$inferSelect | undefined, expected: "order_note" | "post_procedure_note", caseService: string): string {
  const p = expected === "order_note" ? "order_note" : "procedure_note";
  if (r.serviceType !== caseService) return `${p}_wrong_service`;
  if (r.sourceTable !== (expected === "order_note" ? ORDER_NOTE_SOURCE_TABLE : PROCEDURE_NOTE_SOURCE_TABLE)) return `${p}_wrong_source_table`;
  if (r.ancillaryCaseId == null) return `${p}_missing_case`;
  if (r.serviceType == null) return `${p}_missing_service`;
  if (r.sourceId == null || !note) return `${p}_source_missing`;
  if (note.noteType !== expected) return `${p}_wrong_note_type`;
  if (note.clinicId !== r.clinicId) return `${p}_cross_clinic_source`;
  if (note.ancillaryCaseId !== r.ancillaryCaseId) return `${p}_cross_case_source`;
  if (note.serviceType !== r.serviceType || note.serviceType !== caseService) return `${p}_wrong_service_source`;
  if (note.supersededAt != null) return `${p}_superseded_source`;
  if (note.generationStatus === "voided") return `${p}_voided_source`;
  if (r.documentStatus === "signed") {
    if (note.signatureStatus !== "signed") return `${p}_signed_ref_unsigned_source`;
    if (note.signedAt == null || r.signedAt == null) return `${p}_signed_at_disagreement`;
  } else if (r.documentStatus === "pending_signature") {
    if (note.signatureStatus === "signed") return `${p}_pending_ref_signed_source`;
    if (!NOTE_UNSIGNED_CURRENT.has(note.signatureStatus ?? "")) return `${p}_pending_ref_unsupported_source_status`;
  } else return `${p}_unsupported_ref_status`;
  return "";
}
function validateReport(r: typeof ancillaryDocumentReferences.$inferSelect, cdr: typeof caseDocumentReadiness.$inferSelect | undefined, caseService: string): string {
  if (r.serviceType !== caseService) return "report_wrong_service";
  if (r.sourceTable !== REPORT_SOURCE_TABLE) return "report_wrong_source_table";
  if (r.ancillaryCaseId == null) return "report_missing_case";
  if (r.serviceType == null) return "report_missing_service";
  if (r.sourceId == null || !cdr) return "report_source_missing";
  if (cdr.documentType !== "report") return "report_wrong_document_type";
  if (cdr.clinicId !== r.clinicId) return "report_cross_clinic_source";
  if (cdr.serviceType !== r.serviceType || cdr.serviceType !== caseService) return "report_wrong_service_source";
  if (r.executionCaseId != null) { if (cdr.executionCaseId == null) return "report_source_missing_execution_case"; if (cdr.executionCaseId !== r.executionCaseId) return "report_execution_case_conflict"; }
  if (r.patientScreeningId != null) { if (cdr.patientScreeningId == null) return "report_source_missing_screening"; if (cdr.patientScreeningId !== r.patientScreeningId) return "report_screening_conflict"; }
  const execProven = r.executionCaseId != null && cdr.executionCaseId === r.executionCaseId;
  const screeningProven = r.patientScreeningId != null && cdr.patientScreeningId === r.patientScreeningId;
  if (!execProven && !screeningProven) return "report_episode_unresolved";
  if (!REPORT_CURRENT.has(r.documentStatus)) return "report_unsupported_ref_status";
  if (!REPORT_CURRENT.has(cdr.documentStatus)) return "report_status_not_current";
  if (r.documentStatus !== cdr.documentStatus) return "report_status_disagreement";
  return "";
}
