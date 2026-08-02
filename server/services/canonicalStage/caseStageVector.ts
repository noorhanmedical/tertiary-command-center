/**
 * Phase 2I — shared canonical STAGE-VECTOR builder for PCS/ACS.
 *
 * Given a bounded, already-clinic-scoped set of ancillary cases, this builds one
 * 10-stage canonical lifecycle vector per case using BATCHED, exact-source reads
 * (never per-row / N+1). Every stage is exact-source validated (episode ownership
 * + exhaustive reference/source status agreement, mirroring Phase 2H) and each
 * stage is independently gated by its OWN upstream runtime flag — a disabled
 * stage is reported `upstream_flag_off` (zero reads), never a false status.
 *
 * READ-ONLY. No writes, no retry rows, no document bytes/note text, no
 * claims/invoice/payment/revenue. A missing canonical table (pg 42P01/42703)
 * throws MigrationMissingError → the route answers 503. An ordinary per-stage
 * read failure marks THAT stage `unavailable` (never a silent zero / false stage).
 */

import { db } from "../../db";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { canonicalBillingReadinessChecks } from "@shared/schema/billingReadiness";
import { canonicalBillingDocumentRequests } from "@shared/schema/billingDocuments";
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
} from "../../lib/featureFlags";
import {
  CANONICAL_STAGE_ORDER, type CaseStageVector, type StageStatus, type StageAvailability,
  type EngagementMembershipRow, type CodeCount, type CanonicalStageKey,
} from "@shared/canonicalStageVector";

const MIGRATION_MISSING_CODE = "ANCILLARY_DOCUMENT_MIGRATION_MISSING";
const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", MIGRATION_MISSING_CODE]);
const SCAN_LIMIT = 5000; // bounded across the (already bounded) case page

export class MigrationMissingError extends Error {
  readonly code = MIGRATION_MISSING_CODE;
  constructor(cause?: unknown) { super("Canonical migration not applied"); this.name = "MigrationMissingError"; (this as { cause?: unknown }).cause = cause; }
}
function isMigration(e: unknown): boolean {
  return e instanceof MigrationMissingError || MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "");
}
function iso(v: unknown): string | null { return v ? new Date(v as unknown as Date).toISOString() : null; }

/** Load a stage source; a migration error propagates (→ 503), an ordinary error
 *  resolves to null so ONLY that stage is marked `unavailable` (never zero). */
async function loadOrNull<T>(fn: () => Promise<T>): Promise<{ ok: true; rows: T } | { ok: false }> {
  try { return { ok: true, rows: await fn() }; }
  catch (e) { if (isMigration(e)) throw new MigrationMissingError(e); return { ok: false }; }
}

const stage = (o: Partial<StageStatus> & { availability: StageAvailability }): StageStatus => ({
  status: o.status ?? null, availability: o.availability, available: o.availability === "available",
  sourceId: o.sourceId ?? null, at: o.at ?? null, warnings: o.warnings ?? [],
});
const upstreamOff = (code: string): StageStatus => stage({ availability: "upstream_flag_off", warnings: [code] });
const unavailable = (code: string): StageStatus => stage({ availability: "unavailable", warnings: [code] });

function tally(list: { code: string }[]): CodeCount[] {
  const m = new Map<string, number>();
  for (const b of list) m.set(b.code, (m.get(b.code) ?? 0) + 1);
  return [...m.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => (b.count - a.count) || a.code.localeCompare(b.code));
}

export type StageVectorInput = { clinicId: number; cases: PatientAncillaryCase[] };

export async function buildStageVectors(input: StageVectorInput): Promise<CaseStageVector[]> {
  const { clinicId, cases } = input;
  const caseIds = [...new Set(cases.map((c) => c.id))];
  if (caseIds.length === 0) return [];

  // ── Batched, flag-gated, clinic-scoped source loads (one query per source) ──
  const flags = featureFlags;

  // Admin Review events (timestamp/source) — only when the write flag indicates 0051.
  const adminEventsGate = flags.serviceSpecificAdminReview;
  const adminEvents = adminEventsGate
    ? await loadOrNull(() => db.select().from(ancillaryCaseAdminReviewEvents).where(inArray(ancillaryCaseAdminReviewEvents.ancillaryCaseId, caseIds)).limit(SCAN_LIMIT))
    : null;
  const latestAdminEventByCase = new Map<number, { at: string | null; source: string | null }>();
  if (adminEvents?.ok) {
    for (const e of adminEvents.rows) {
      const at = iso(e.actualReviewedAt);
      const prev = latestAdminEventByCase.get(e.ancillaryCaseId);
      if (!prev || (at && (prev.at == null || at > prev.at))) latestAdminEventByCase.set(e.ancillaryCaseId, { at, source: e.source ?? null });
    }
  }

  // Engagement memberships + lists (Phase 2C) — gated by any 2C engagement flag.
  const engagementGate = flags.engagementAdminReviewSync || flags.engagementMultiListRepository || flags.engagementRecentLists;
  const membershipsLoad = engagementGate
    ? await loadOrNull(() => db.select().from(engagementListMemberships).where(and(inArray(engagementListMemberships.ancillaryCaseId, caseIds), eq(engagementListMemberships.status, "active"))).limit(SCAN_LIMIT))
    : null;
  const activeMemberships = membershipsLoad?.ok ? membershipsLoad.rows.filter((m) => m.status === "active" && m.ancillaryCaseId != null && caseIds.includes(m.ancillaryCaseId)) : [];
  const listIds = [...new Set(activeMemberships.map((m) => m.engagementListId))];
  const listsLoad = engagementGate && listIds.length
    ? await loadOrNull(() => db.select().from(engagementLists).where(and(eq(engagementLists.clinicId, clinicId), inArray(engagementLists.id, listIds))).limit(SCAN_LIMIT))
    : { ok: true as const, rows: [] as typeof engagementLists.$inferSelect[] };
  const listById = new Map<number, typeof engagementLists.$inferSelect>();
  if (listsLoad.ok) for (const l of listsLoad.rows) if (l.clinicId === clinicId) listById.set(l.id, l);

  // Canonical appointment (Phase 2D) — global_schedule_events canonical ancillary events.
  const apptGate = flags.canonicalAppointment;
  const apptLoad = apptGate
    ? await loadOrNull(() => db.select().from(globalScheduleEvents).where(and(eq(globalScheduleEvents.clinicId, clinicId), inArray(globalScheduleEvents.ancillaryCaseId, caseIds), inArray(globalScheduleEvents.eventType, ["ancillary_appointment", "same_day_add"]))).limit(SCAN_LIMIT))
    : null;

  // Unified document references (Phase 2E) — order_note / procedure_note / report.
  const docsGate = flags.unifiedAncillaryDocuments;
  const refsLoad = docsGate
    ? await loadOrNull(() => db.select().from(ancillaryDocumentReferences).where(and(eq(ancillaryDocumentReferences.clinicId, clinicId), isNull(ancillaryDocumentReferences.supersededAt), inArray(ancillaryDocumentReferences.ancillaryCaseId, caseIds), inArray(ancillaryDocumentReferences.documentKind, ["order_note", "procedure_note", "report"]))).limit(SCAN_LIMIT))
    : null;
  const refs = refsLoad?.ok ? refsLoad.rows.filter((r) => r.clinicId === clinicId && r.supersededAt == null) : [];
  const noteSourceIds = [...new Set(refs.filter((r) => (r.documentKind === "order_note" || r.documentKind === "procedure_note") && r.sourceTable === PROCEDURE_NOTE_SOURCE_TABLE && r.sourceId != null).map((r) => r.sourceId as number))];
  const reportSourceIds = [...new Set(refs.filter((r) => r.documentKind === "report" && r.sourceTable === REPORT_SOURCE_TABLE && r.sourceId != null).map((r) => r.sourceId as number))];
  const noteRowsLoad = docsGate && noteSourceIds.length ? await loadOrNull(() => db.select().from(procedureNotes).where(and(eq(procedureNotes.clinicId, clinicId), inArray(procedureNotes.id, noteSourceIds))).limit(SCAN_LIMIT)) : { ok: true as const, rows: [] as typeof procedureNotes.$inferSelect[] };
  const cdrRowsLoad = docsGate && reportSourceIds.length ? await loadOrNull(() => db.select().from(caseDocumentReadiness).where(and(eq(caseDocumentReadiness.clinicId, clinicId), inArray(caseDocumentReadiness.id, reportSourceIds))).limit(SCAN_LIMIT)) : { ok: true as const, rows: [] as typeof caseDocumentReadiness.$inferSelect[] };
  const noteById = new Map<number, typeof procedureNotes.$inferSelect>();
  if (noteRowsLoad.ok) for (const n of noteRowsLoad.rows) if (n.clinicId === clinicId) noteById.set(n.id, n);
  const cdrById = new Map<number, typeof caseDocumentReadiness.$inferSelect>();
  if (cdrRowsLoad.ok) for (const c of cdrRowsLoad.rows) if (c.clinicId === clinicId) cdrById.set(c.id, c);

  // Procedure lifecycle (Phase 2F) — procedure_events by exact case.
  const procGate = flags.canonicalProcedureLifecycle;
  const procLoad = procGate
    ? await loadOrNull(() => db.select().from(procedureEvents).where(and(eq(procedureEvents.clinicId, clinicId), inArray(procedureEvents.ancillaryCaseId, caseIds))).limit(SCAN_LIMIT))
    : null;

  // Billing readiness / Billing Document (Phase 2G) — current non-superseded.
  const readinessGate = billingReadinessRuntimeEnabled();
  const readinessLoad = readinessGate
    ? await loadOrNull(() => db.select().from(canonicalBillingReadinessChecks).where(and(eq(canonicalBillingReadinessChecks.clinicId, clinicId), isNull(canonicalBillingReadinessChecks.supersededAt), inArray(canonicalBillingReadinessChecks.ancillaryCaseId, caseIds))).limit(SCAN_LIMIT))
    : null;
  const docGate = billingDocumentRuntimeEnabled();
  const billingDocLoad = docGate
    ? await loadOrNull(() => db.select().from(canonicalBillingDocumentRequests).where(and(eq(canonicalBillingDocumentRequests.clinicId, clinicId), isNull(canonicalBillingDocumentRequests.supersededAt), inArray(canonicalBillingDocumentRequests.ancillaryCaseId, caseIds))).limit(SCAN_LIMIT))
    : null;

  // Per-case indexes (exact clinic + case; superseded excluded already).
  const apptByCase = groupCurrentAppointment(apptLoad, clinicId, caseIds);
  const refByCaseKind = groupRefsByCaseKind(refs);
  const procByCase = groupProcedure(procLoad, clinicId, caseIds);
  const readinessByCase = groupByCase(readinessLoad, clinicId, caseIds, (r) => r.ancillaryCaseId);
  const billingDocByCase = groupByCase(billingDocLoad, clinicId, caseIds, (r) => r.ancillaryCaseId);
  const membershipsByCase = groupMemberships(activeMemberships, listById, cases);

  return cases.map((c) => buildOne(c, {
    clinicId, adminEventsGate, latestAdminEventByCase, engagementGate, membershipsByCase,
    apptGate, apptLoad, apptByCase, docsGate, refsLoad, refByCaseKind, noteById, cdrById,
    procGate, procLoad, procByCase, readinessGate, readinessLoad, readinessByCase,
    docGate, billingDocLoad, billingDocByCase,
  }));
}

// ─── per-case assembly ───────────────────────────────────────────────────────
type Ctx = {
  clinicId: number;
  adminEventsGate: boolean; latestAdminEventByCase: Map<number, { at: string | null; source: string | null }>;
  engagementGate: boolean; membershipsByCase: Map<number, EngagementMembershipRow[]>;
  apptGate: boolean; apptLoad: { ok: boolean } | null; apptByCase: Map<number, { status: string; sourceId: number; at: string | null }>;
  docsGate: boolean; refsLoad: { ok: boolean } | null; refByCaseKind: Map<string, typeof ancillaryDocumentReferences.$inferSelect>;
  noteById: Map<number, typeof procedureNotes.$inferSelect>; cdrById: Map<number, typeof caseDocumentReadiness.$inferSelect>;
  procGate: boolean; procLoad: { ok: boolean } | null; procByCase: Map<number, { status: string; sourceId: number; at: string | null }>;
  readinessGate: boolean; readinessLoad: { ok: boolean } | null; readinessByCase: Map<number, typeof canonicalBillingReadinessChecks.$inferSelect>;
  docGate: boolean; billingDocLoad: { ok: boolean } | null; billingDocByCase: Map<number, typeof canonicalBillingDocumentRequests.$inferSelect>;
};

function buildOne(c: PatientAncillaryCase, ctx: Ctx): CaseStageVector {
  const svc = c.serviceType;

  // Admin Review — status from the case projection (always). Timestamp/source
  // from the latest event when Phase 2C is on; otherwise available with no `at`.
  const ev = ctx.latestAdminEventByCase.get(c.id);
  const adminReview = ctx.adminEventsGate
    ? stage({ status: c.adminReviewStatus ?? null, availability: "available", at: ev?.at ?? null })
    : stage({ status: c.adminReviewStatus ?? null, availability: "available" });

  // Engagement
  const mships = ctx.membershipsByCase.get(c.id) ?? [];
  const lastSentAt = mships.reduce<string | null>((acc, m) => (m.sentToEngagementAt && (acc == null || m.sentToEngagementAt > acc) ? m.sentToEngagementAt : acc), null);
  const engagement = !ctx.engagementGate
    ? { ...upstreamOff("engagement_flag_off"), memberships: [] as EngagementMembershipRow[], lastSentAt: null }
    : { ...stage({ status: mships.length ? "member" : null, availability: "available", at: lastSentAt }), memberships: mships, lastSentAt };

  // Appointment
  const appt = !ctx.apptGate ? upstreamOff("canonical_appointment_flag_off")
    : ctx.apptLoad && !ctx.apptLoad.ok ? unavailable("appointment_read_failed")
    : (() => { const a = ctx.apptByCase.get(c.id); return a ? stage({ status: a.status, availability: "available", sourceId: a.sourceId, at: a.at }) : stage({ status: null, availability: "available" }); })();

  // Order Note (exact-source validated)
  const orderNote = !ctx.docsGate ? upstreamOff("unified_documents_flag_off")
    : ctx.refsLoad && !ctx.refsLoad.ok ? unavailable("order_note_read_failed")
    : validatedNoteStage(ctx.refByCaseKind.get(`${c.id}|order_note`), ctx.noteById, c, "order_note");

  // Procedure lifecycle
  const procedure = !ctx.procGate ? upstreamOff("procedure_lifecycle_flag_off")
    : ctx.procLoad && !ctx.procLoad.ok ? unavailable("procedure_read_failed")
    : (() => { const p = ctx.procByCase.get(c.id); return p ? stage({ status: p.status, availability: "available", sourceId: p.sourceId, at: p.at }) : stage({ status: null, availability: "available" }); })();

  // Report (exact episode + status validated)
  const report = !ctx.docsGate ? upstreamOff("unified_documents_flag_off")
    : ctx.refsLoad && !ctx.refsLoad.ok ? unavailable("report_read_failed")
    : validatedReportStage(ctx.refByCaseKind.get(`${c.id}|report`), ctx.cdrById, c);

  // Procedure Note + Signature (exact-source validated; both need the full runtime)
  const pnRuntime = procedureNoteRuntimeEnabled();
  const pnRef = ctx.refByCaseKind.get(`${c.id}|procedure_note`);
  const procedureNote = !pnRuntime ? upstreamOff("procedure_note_flag_off")
    : ctx.refsLoad && !ctx.refsLoad.ok ? unavailable("procedure_note_read_failed")
    : validatedNoteStage(pnRef, ctx.noteById, c, "post_procedure_note");
  const signature = !pnRuntime ? upstreamOff("procedure_note_flag_off")
    : ctx.refsLoad && !ctx.refsLoad.ok ? unavailable("signature_read_failed")
    : signatureStageFrom(pnRef, ctx.noteById, c);

  // Billing readiness / document
  const rr = ctx.readinessByCase.get(c.id);
  const billingReadiness = !ctx.readinessGate ? { ...upstreamOff("billing_readiness_flag_off"), billingBlockers: [] as CodeCount[], claimBlockers: [] as CodeCount[] }
    : ctx.readinessLoad && !ctx.readinessLoad.ok ? { ...unavailable("billing_readiness_read_failed"), billingBlockers: [] as CodeCount[], claimBlockers: [] as CodeCount[] }
    : { ...stage({ status: rr?.canonicalStatus ?? null, availability: "available", sourceId: rr?.id ?? null, at: iso(rr?.evaluatedAt) }),
        billingBlockers: tally(((rr?.billingBlockers as { code: string }[] | null) ?? [])), claimBlockers: tally(((rr?.claimBlockers as { code: string }[] | null) ?? [])) };

  const bd = ctx.billingDocByCase.get(c.id);
  const billingDocument = !ctx.docGate ? upstreamOff("billing_document_flag_off")
    : ctx.billingDocLoad && !ctx.billingDocLoad.ok ? unavailable("billing_document_read_failed")
    : bd ? stage({ status: bd.canonicalStatus ?? null, availability: "available", sourceId: bd.id, at: iso(bd.generatedAt) }) : stage({ status: null, availability: "available" });

  const stages = { adminReview, engagement, appointment: appt, orderNote, procedure, report, procedureNote, signature, billingReadiness, billingDocument };
  const { currentStage, currentStageIntegrity } = deriveCurrentStage(stages);

  return {
    ancillaryCaseId: c.id, serviceType: svc, lifecycleStatus: c.lifecycleStatus ?? null,
    adminReviewStatus: c.adminReviewStatus ?? null,
    identity: {
      globalPlexusPatientId: c.globalPlexusPatientId ?? null,
      patientClinicMembershipId: c.patientClinicMembershipId ?? null,
      patientDisplay: null, patientDob: null, clinicMrn: null,
      available: c.globalPlexusPatientId != null && c.patientClinicMembershipId != null,
      warnings: (c.globalPlexusPatientId == null || c.patientClinicMembershipId == null) ? ["identity_incomplete"] : [],
    },
    adminReview, engagement, appointment: appt, orderNote, procedure, report, procedureNote, signature, billingReadiness, billingDocument,
    currentStage, currentStageIntegrity,
  };
}

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
    default: return false;
  }
}
/** A procedure that ended in a terminal non-complete state (cancelled/no_show/…)
 *  halts progression AT the procedure stage — never advanced past silently. */
function isTerminalHalt(key: CanonicalStageKey, s: StageStatus): boolean {
  return key === "procedure" && (s.status === "cancelled" || s.status === "no_show" || s.status === "unable_to_complete");
}
function deriveCurrentStage(stages: Record<CanonicalStageKey, StageStatus>): { currentStage: CanonicalStageKey | null; currentStageIntegrity: "resolved" | "unresolved" | "conflicting" } {
  for (const key of CANONICAL_STAGE_ORDER) {
    const s = stages[key];
    // A stage whose upstream flag is OFF is not tracked → does not block.
    if (s.availability === "upstream_flag_off") continue;
    // A failed/migration stage means we cannot trust progression → no false stage.
    if (s.availability !== "available") return { currentStage: null, currentStageIntegrity: "conflicting" };
    if (isTerminalHalt(key, s)) return { currentStage: key, currentStageIntegrity: "resolved" };
    if (!isComplete(key, s)) return { currentStage: key, currentStageIntegrity: "resolved" };
  }
  // Every tracked stage is complete.
  return { currentStage: null, currentStageIntegrity: "resolved" };
}

// ─── grouping helpers ────────────────────────────────────────────────────────
function groupByCase<R extends { supersededAt?: unknown; clinicId?: number | null }>(load: { ok: boolean; rows?: R[] } | null, clinicId: number, caseIds: number[], caseOf: (r: R) => number | null): Map<number, R> {
  const m = new Map<number, R>();
  if (!load || !load.ok || !load.rows) return m;
  for (const r of load.rows) {
    // Exact tenancy re-check in memory (defense-in-depth over the SQL clinic
    // filter) — consistent with every other stage source.
    if (r.clinicId !== clinicId) continue;
    // Superseded snapshots are never current (defense-in-depth over the SQL filter).
    if (r.supersededAt != null) continue;
    const cid = caseOf(r); if (cid != null && caseIds.includes(cid)) m.set(cid, r);
  }
  return m;
}
function groupCurrentAppointment(load: { ok: boolean; rows?: typeof globalScheduleEvents.$inferSelect[] } | null, clinicId: number, caseIds: number[]) {
  const m = new Map<number, { status: string; sourceId: number; at: string | null }>();
  if (!load || !load.ok || !load.rows) return m;
  // Prefer a current (scheduled/completed) event; else keep the most recent event
  // so a cancelled/no_show state is still shown truthfully (never fabricated).
  const rank = (s: string) => (s === "scheduled" || s === "completed") ? 2 : 1;
  const best = new Map<number, typeof globalScheduleEvents.$inferSelect>();
  for (const e of load.rows) {
    if (e.clinicId !== clinicId || e.ancillaryCaseId == null || !caseIds.includes(e.ancillaryCaseId)) continue;
    const prev = best.get(e.ancillaryCaseId);
    if (!prev || rank(e.status) > rank(prev.status) || (rank(e.status) === rank(prev.status) && e.startsAt > prev.startsAt)) best.set(e.ancillaryCaseId, e);
  }
  for (const [cid, e] of best) m.set(cid, { status: e.status, sourceId: e.id, at: iso(e.startsAt) });
  return m;
}
function groupProcedure(load: { ok: boolean; rows?: typeof procedureEvents.$inferSelect[] } | null, clinicId: number, caseIds: number[]) {
  const m = new Map<number, { status: string; sourceId: number; at: string | null }>();
  if (!load || !load.ok || !load.rows) return m;
  // Most recent procedure_events row per case (terminal states preserved as-is).
  const best = new Map<number, typeof procedureEvents.$inferSelect>();
  for (const p of load.rows) {
    if (p.clinicId !== clinicId || p.ancillaryCaseId == null || !caseIds.includes(p.ancillaryCaseId)) continue;
    const prev = best.get(p.ancillaryCaseId);
    if (!prev || (p.lastTransitionAt ?? p.updatedAt) > (prev.lastTransitionAt ?? prev.updatedAt)) best.set(p.ancillaryCaseId, p);
  }
  for (const [cid, p] of best) m.set(cid, { status: p.procedureStatus, sourceId: p.id, at: iso(p.completedAt) });
  return m;
}
function groupRefsByCaseKind(refs: typeof ancillaryDocumentReferences.$inferSelect[]) {
  // The current (non-superseded) reference per (case, kind). If more than one is
  // current, keep the newest by id (deterministic) — validation still applies.
  const m = new Map<string, typeof ancillaryDocumentReferences.$inferSelect>();
  for (const r of refs) {
    const k = `${r.ancillaryCaseId}|${r.documentKind}`;
    const prev = m.get(k);
    if (!prev || r.id > prev.id) m.set(k, r);
  }
  return m;
}
function groupMemberships(active: typeof engagementListMemberships.$inferSelect[], listById: Map<number, typeof engagementLists.$inferSelect>, cases: PatientAncillaryCase[]): Map<number, EngagementMembershipRow[]> {
  const svcByCase = new Map<number, string>();
  for (const c of cases) svcByCase.set(c.id, c.serviceType);
  const m = new Map<number, EngagementMembershipRow[]>();
  for (const mem of active) {
    const list = listById.get(mem.engagementListId);
    if (!list) continue;                                   // cross-clinic/missing list excluded
    const svc = svcByCase.get(mem.ancillaryCaseId as number);
    if (svc != null && mem.serviceType !== svc) continue;  // wrong-service membership excluded
    const row: EngagementMembershipRow = {
      engagementMembershipId: mem.id, engagementListId: list.id,
      engagementListDisplayName: list.label ?? null, engagementListSourceType: list.sourceType ?? null,
      engagementListSourceId: list.sourceId ?? null, serviceType: mem.serviceType ?? null,
      sentToEngagementAt: iso(list.sentToEngagementAt),
    };
    const arr = m.get(mem.ancillaryCaseId as number) ?? []; arr.push(row); m.set(mem.ancillaryCaseId as number, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => (a.engagementListId - b.engagementListId) || (a.engagementMembershipId - b.engagementMembershipId));
  return m;
}

// ─── exact-source validators (mirror Phase 2H rules) ─────────────────────────
const NOTE_UNSIGNED_CURRENT = new Set(["needs_signature", "ready_to_sign", "returned_for_correction"]);
const REPORT_CURRENT = new Set(["uploaded", "generated", "approved", "completed"]);

function validateNote(r: typeof ancillaryDocumentReferences.$inferSelect, note: typeof procedureNotes.$inferSelect | undefined, expected: "order_note" | "post_procedure_note"): string {
  const p = expected === "order_note" ? "order_note" : "procedure_note";
  if (r.sourceTable !== (expected === "order_note" ? ORDER_NOTE_SOURCE_TABLE : PROCEDURE_NOTE_SOURCE_TABLE)) return `${p}_wrong_source_table`;
  if (r.ancillaryCaseId == null) return `${p}_missing_case`;
  if (r.serviceType == null) return `${p}_missing_service`;
  if (r.sourceId == null || !note) return `${p}_source_missing`;
  if (note.noteType !== expected) return `${p}_wrong_note_type`;
  if (note.clinicId !== r.clinicId) return `${p}_cross_clinic_source`;
  if (note.ancillaryCaseId !== r.ancillaryCaseId) return `${p}_cross_case_source`;
  if (note.serviceType !== r.serviceType) return `${p}_wrong_service_source`;
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
function validateReport(r: typeof ancillaryDocumentReferences.$inferSelect, cdr: typeof caseDocumentReadiness.$inferSelect | undefined): string {
  if (r.sourceTable !== REPORT_SOURCE_TABLE) return "report_wrong_source_table";
  if (r.ancillaryCaseId == null) return "report_missing_case";
  if (r.serviceType == null) return "report_missing_service";
  if (r.sourceId == null || !cdr) return "report_source_missing";
  if (cdr.documentType !== "report") return "report_wrong_document_type";
  if (cdr.clinicId !== r.clinicId) return "report_cross_clinic_source";
  if (cdr.serviceType !== r.serviceType) return "report_wrong_service_source";
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
function validatedNoteStage(ref: typeof ancillaryDocumentReferences.$inferSelect | undefined, noteById: Map<number, typeof procedureNotes.$inferSelect>, c: PatientAncillaryCase, expected: "order_note" | "post_procedure_note"): StageStatus {
  if (!ref) return stage({ status: null, availability: "available" });
  const note = ref.sourceId != null ? noteById.get(ref.sourceId) : undefined;
  const reason = validateNote(ref, note, expected);
  if (reason) return stage({ status: null, availability: "available", warnings: [reason] });
  return stage({ status: ref.documentStatus, availability: "available", sourceId: ref.sourceId, at: iso(ref.signedAt) });
}
function validatedReportStage(ref: typeof ancillaryDocumentReferences.$inferSelect | undefined, cdrById: Map<number, typeof caseDocumentReadiness.$inferSelect>, c: PatientAncillaryCase): StageStatus {
  if (!ref) return stage({ status: null, availability: "available" });
  const cdr = ref.sourceId != null ? cdrById.get(ref.sourceId) : undefined;
  const reason = validateReport(ref, cdr);
  if (reason) return stage({ status: null, availability: "available", warnings: [reason] });
  return stage({ status: ref.documentStatus, availability: "available", sourceId: ref.sourceId, at: iso(ref.actualCreatedAt) });
}
function signatureStageFrom(ref: typeof ancillaryDocumentReferences.$inferSelect | undefined, noteById: Map<number, typeof procedureNotes.$inferSelect>, c: PatientAncillaryCase): StageStatus {
  if (!ref) return stage({ status: null, availability: "available" });
  const note = ref.sourceId != null ? noteById.get(ref.sourceId) : undefined;
  const reason = validateNote(ref, note, "post_procedure_note");
  if (reason) return stage({ status: null, availability: "available", warnings: [reason] });
  // Signature truth comes from the EXACT validated note source only.
  return stage({ status: note!.signatureStatus ?? null, availability: "available", sourceId: ref.sourceId, at: iso(note!.signedAt) });
}
