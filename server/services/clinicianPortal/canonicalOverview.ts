/**
 * Phase 2H — canonical, clinic-scoped, READ-ONLY Clinician Portal overview.
 *
 * One centralized read model over the Phase 2A–2G canonical spine. NO writes, NO
 * retry records, NO document bytes, NO revenue/claim/payment fields, NO global
 * Plexus identity ids. Every query is exact-clinic-scoped, bounded, and
 * deterministically ordered; one ancillary case is one episode (never merged by
 * patient/service).
 *
 * Truthful availability (§6): a MISSING canonical migration is NOT a section
 * state — it throws a typed `MigrationMissingError` that propagates to the route
 * so the WHOLE endpoint answers HTTP 503 (code=ANCILLARY_DOCUMENT_MIGRATION_
 * MISSING). An ordinary (non-migration) read failure stays a section-level
 * `unavailable` (NEVER a silent zero). A section whose OWN upstream runtime flag
 * is OFF is `upstream_flag_off`.
 *
 * Exact-source truth (§3): every current Unified Document reference is validated
 * against its EXACT underlying source (batched IN reads, never per-row) before it
 * may contribute to any count or row. A reference whose source is missing,
 * cross-clinic, cross-case, wrong-service, wrong-kind, superseded, or status-
 * conflicting is dropped and surfaced as a PHI-free integrity warning — never
 * counted as current truth.
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
import { patientAncillaryCases, ANCILLARY_ACTIVE_LIFECYCLE_STATUSES } from "@shared/schema/ancillaryCases";
import { engagementLists, engagementListMemberships } from "@shared/schema/engagementLists";
import { featureFlags, billingReadinessRuntimeEnabled } from "../../lib/featureFlags";
import {
  CLINICIAN_PORTAL_OVERVIEW_VERSION, CLINICIAN_PORTAL_OVERVIEW_ROW_LIMIT,
  type ClinicianPortalCanonicalOverview, type FinanceOverview, type OrdersNotesOverview,
  type EngagementOverview, type EngagementMembershipRow, type CodeCount, type SectionAvailability,
} from "@shared/clinicianPortalOverview";

const MIGRATION_MISSING_CODE = "ANCILLARY_DOCUMENT_MIGRATION_MISSING";
const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", MIGRATION_MISSING_CODE]);
const SCAN_LIMIT = 2000;               // bounded aggregation scan (per section)
const ROW_LIMIT = CLINICIAN_PORTAL_OVERVIEW_ROW_LIMIT;

/** Typed migration-missing signal (§6). A required canonical table/column does
 *  not exist ⇒ the endpoint must answer 503, never a section-level state. */
export class MigrationMissingError extends Error {
  readonly code = MIGRATION_MISSING_CODE;
  constructor(cause?: unknown) {
    super("Canonical migration not applied");
    this.name = "MigrationMissingError";
    (this as { cause?: unknown }).cause = cause;
  }
}
function isMigration(e: unknown): boolean {
  return e instanceof MigrationMissingError || MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "");
}
/** Convert a caught error: migration ⇒ throw the typed signal (endpoint 503);
 *  otherwise return the ordinary section-unavailable shell (never a zero). */
function sectionFailure<T>(e: unknown, unavailable: () => T): T {
  if (isMigration(e)) throw new MigrationMissingError(e);
  return unavailable();
}

function tally(list: { code: string }[]): CodeCount[] {
  const m = new Map<string, number>();
  for (const b of list) m.set(b.code, (m.get(b.code) ?? 0) + 1);
  return [...m.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => (b.count - a.count) || a.code.localeCompare(b.code));
}
/** Accumulate PHI-free integrity warnings by code and emit as bounded strings. */
function integrityWarnings(counts: Map<string, number>): string[] {
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([code, n]) => `${code}(${n})`);
}
function iso(v: unknown): string | null {
  return v ? new Date(v as unknown as Date).toISOString() : null;
}

export type OverviewInput = { clinicId: number };

export async function getClinicianPortalCanonicalOverview(input: OverviewInput): Promise<ClinicianPortalCanonicalOverview> {
  const generatedAt = new Date().toISOString();
  // A MigrationMissingError from ANY section rejects here and propagates to the
  // route → 503. Ordinary section failures are already contained as `unavailable`.
  const [finance, ordersNotes, engagement] = await Promise.all([
    buildFinance(input.clinicId),
    buildOrdersNotes(input.clinicId),
    buildEngagement(input.clinicId),
  ]);
  return { disabled: false, generatedAt, dataVersion: CLINICIAN_PORTAL_OVERVIEW_VERSION, clinicScoped: true, finance, ordersNotes, engagement };
}

// ─── Finance — operational billing readiness ONLY ────────────────────────────
async function buildFinance(clinicId: number): Promise<FinanceOverview> {
  const empty = { evaluated: 0, readyToGenerate: 0, missingRequirements: 0, billingDocumentPending: 0, billingDocumentGenerated: 0, claimBlockedOnly: 0, supersededOrInvalidated: 0 };
  const shell = (availability: SectionAvailability, warnings: string[] = []): FinanceOverview => ({ availability, warnings, counts: { ...empty }, billingBlockersByCode: [], claimBlockersByCode: [], lastEvaluatedAt: null, rows: [] });
  if (!billingReadinessRuntimeEnabled()) return shell("upstream_flag_off", ["canonical_billing_flags_off"]);
  try {
    // Current (non-superseded) canonical readiness per exact case.
    const readiness = await db.select().from(canonicalBillingReadinessChecks).where(and(
      eq(canonicalBillingReadinessChecks.clinicId, clinicId),
      isNull(canonicalBillingReadinessChecks.supersededAt),
    )).limit(SCAN_LIMIT);
    // Exact clinic + current (non-superseded) + canonical — enforced in SQL AND
    // in memory (defense-in-depth; superseded snapshots are never current).
    const current = readiness.filter((r) => r.clinicId === clinicId && r.supersededAt == null && r.ancillaryCaseId != null && r.canonicalStatus != null);
    // Current (non-superseded) active canonical Billing Documents per exact case.
    const docs = await db.select().from(canonicalBillingDocumentRequests).where(and(
      eq(canonicalBillingDocumentRequests.clinicId, clinicId),
      isNull(canonicalBillingDocumentRequests.supersededAt),
    )).limit(SCAN_LIMIT);
    const docByCase = new Map<number, string>();
    for (const d of docs) {
      if (d.clinicId !== clinicId || d.supersededAt != null) continue;
      if (d.ancillaryCaseId == null || d.canonicalStatus == null) continue;
      if (["pending", "generating", "generated", "approved"].includes(d.canonicalStatus)) docByCase.set(d.ancillaryCaseId, d.canonicalStatus);
    }
    const counts = { ...empty };
    const billingBlockers: { code: string }[] = [];
    const claimBlockers: { code: string }[] = [];
    let lastEvaluatedAt: string | null = null;
    for (const r of current) {
      counts.evaluated++;
      const bb = (r.billingBlockers as { code: string }[] | null) ?? [];
      const cb = (r.claimBlockers as { code: string }[] | null) ?? [];
      billingBlockers.push(...bb); claimBlockers.push(...cb);
      if (r.canonicalStatus === "ready_to_generate") { counts.readyToGenerate++; if (cb.length > 0) counts.claimBlockedOnly++; }
      else if (r.canonicalStatus === "missing_requirements") counts.missingRequirements++;
      else if (r.canonicalStatus === "superseded" || r.canonicalStatus === "invalidated") counts.supersededOrInvalidated++;
      const ev = iso(r.evaluatedAt);
      if (ev && (lastEvaluatedAt == null || ev > lastEvaluatedAt)) lastEvaluatedAt = ev;
    }
    for (const status of docByCase.values()) {
      if (status === "pending" || status === "generating") counts.billingDocumentPending++;
      else if (status === "generated" || status === "approved") counts.billingDocumentGenerated++;
    }
    const rows = current
      .slice().sort((a, b) => (a.ancillaryCaseId! - b.ancillaryCaseId!))
      .slice(0, ROW_LIMIT)
      .map((r) => ({
        ancillaryCaseId: r.ancillaryCaseId!, serviceType: r.serviceType, patientDisplay: null,
        readinessStatus: r.canonicalStatus, billingDocumentStatus: docByCase.get(r.ancillaryCaseId!) ?? null,
        billingBlockerCount: ((r.billingBlockers as unknown[] | null) ?? []).length,
        claimBlockerCount: ((r.claimBlockers as unknown[] | null) ?? []).length,
        evaluatedAt: iso(r.evaluatedAt),
      }));
    const warnings = current.length >= SCAN_LIMIT ? ["counts_truncated"] : [];
    return { availability: "available", warnings, counts, billingBlockersByCode: tally(billingBlockers), claimBlockersByCode: tally(claimBlockers), lastEvaluatedAt, rows };
  } catch (e) {
    return sectionFailure(e, () => shell("unavailable", ["finance_read_failed"]));
  }
}

// ─── Orders & Notes — Unified Ancillary Documents spine (EXACT-source) ────────
async function buildOrdersNotes(clinicId: number): Promise<OrdersNotesOverview> {
  const empty = { currentOrderNotes: 0, currentProcedureNotes: 0, currentReports: 0, pendingSignatures: 0, returnedForCorrection: 0, generatedNotes: 0, missingEvidence: 0 };
  const shell = (availability: SectionAvailability, warnings: string[] = []): OrdersNotesOverview => ({ availability, warnings, counts: { ...empty }, rows: [] });
  if (!featureFlags.unifiedAncillaryDocuments) return shell("upstream_flag_off", ["unified_documents_flag_off"]);
  try {
    const refs = await db.select().from(ancillaryDocumentReferences).where(and(
      eq(ancillaryDocumentReferences.clinicId, clinicId),
      isNull(ancillaryDocumentReferences.supersededAt),
      inArray(ancillaryDocumentReferences.documentKind, ["order_note", "procedure_note", "report"]),
    )).limit(SCAN_LIMIT);
    const currentRefs = refs.filter((r) => r.clinicId === clinicId && r.supersededAt == null && ["order_note", "procedure_note", "report"].includes(r.documentKind));

    // Batched exact-source loads (never one query per row).
    const noteSourceIds = [...new Set(currentRefs
      .filter((r) => (r.documentKind === "order_note" || r.documentKind === "procedure_note") && r.sourceTable === PROCEDURE_NOTE_SOURCE_TABLE && r.sourceId != null)
      .map((r) => r.sourceId as number))];
    const reportSourceIds = [...new Set(currentRefs
      .filter((r) => r.documentKind === "report" && r.sourceTable === REPORT_SOURCE_TABLE && r.sourceId != null)
      .map((r) => r.sourceId as number))];

    const noteRows = noteSourceIds.length
      ? await db.select().from(procedureNotes).where(and(eq(procedureNotes.clinicId, clinicId), inArray(procedureNotes.id, noteSourceIds))).limit(SCAN_LIMIT)
      : [];
    const cdrRows = reportSourceIds.length
      ? await db.select().from(caseDocumentReadiness).where(and(eq(caseDocumentReadiness.clinicId, clinicId), inArray(caseDocumentReadiness.id, reportSourceIds))).limit(SCAN_LIMIT)
      : [];
    const noteById = new Map<number, typeof noteRows[number]>();
    for (const n of noteRows) if (n.clinicId === clinicId) noteById.set(n.id, n);
    const cdrById = new Map<number, typeof cdrRows[number]>();
    for (const c of cdrRows) if (c.clinicId === clinicId) cdrById.set(c.id, c);

    const counts = { ...empty };
    const warnCounts = new Map<string, number>();
    const warn = (code: string) => warnCounts.set(code, (warnCounts.get(code) ?? 0) + 1);
    const kindByCase = new Map<number, Set<string>>();
    const validRefs: typeof currentRefs = [];

    for (const r of currentRefs) {
      if (r.documentKind === "order_note") {
        const reason = validateNoteRef(r, noteById.get(r.sourceId as number), "order_note");
        if (reason) { warn(reason); continue; }
        counts.currentOrderNotes++;
        if (r.documentStatus === "pending_signature") counts.pendingSignatures++;
      } else if (r.documentKind === "procedure_note") {
        const note = noteById.get(r.sourceId as number);
        const reason = validateNoteRef(r, note, "post_procedure_note");
        if (reason) { warn(reason); continue; }
        counts.currentProcedureNotes++;
        if (r.documentStatus === "pending_signature") counts.pendingSignatures++;
        // Returned-for-correction + generated counts come from the EXACT
        // referenced note only (§3.17/18) — never an independent note scan.
        if (note!.signatureStatus === "returned_for_correction") counts.returnedForCorrection++;
        if (note!.generationStatus === "generated" || note!.generationStatus === "approved") counts.generatedNotes++;
      } else {
        const reason = validateReportRef(r, cdrById.get(r.sourceId as number));
        if (reason) { warn(reason); continue; }
        counts.currentReports++;
      }
      validRefs.push(r);
      const s = kindByCase.get(r.ancillaryCaseId) ?? new Set<string>(); s.add(r.documentKind); kindByCase.set(r.ancillaryCaseId, s);
    }
    // Missing required evidence: a validated procedure_note present but no
    // validated current report for the SAME exact case.
    for (const s of kindByCase.values()) if (s.has("procedure_note") && !s.has("report")) counts.missingEvidence++;

    const rows = validRefs
      .slice().sort((a, b) => (a.ancillaryCaseId - b.ancillaryCaseId) || a.documentKind.localeCompare(b.documentKind) || (a.id - b.id))
      .slice(0, ROW_LIMIT)
      .map((r) => ({
        ancillaryCaseId: r.ancillaryCaseId, serviceType: r.serviceType, patientDisplay: null,
        documentKind: r.documentKind as "order_note" | "procedure_note" | "report",
        documentStatus: r.documentStatus,
        signedAt: iso(r.signedAt),
        effectiveClinicalDate: iso(r.effectiveClinicalDate),
        actualCreatedAt: iso(r.actualCreatedAt),
      }));
    const warnings = [
      ...(refs.length >= SCAN_LIMIT ? ["counts_truncated"] : []),
      ...integrityWarnings(warnCounts),
    ];
    return { availability: "available", warnings, counts, rows };
  } catch (e) {
    return sectionFailure(e, () => shell("unavailable", ["orders_notes_read_failed"]));
  }
}

/** Validate an order_note / procedure_note reference against its EXACT
 *  procedure_notes source. Returns "" when valid, else a PHI-free reason code. */
function validateNoteRef(
  r: { clinicId: number; ancillaryCaseId: number | null; serviceType: string | null; sourceTable: string; sourceId: number | null; documentStatus: string },
  note: { clinicId: number | null; ancillaryCaseId: number | null; serviceType: string | null; noteType: string | null; signatureStatus: string | null; signedAt: unknown; supersededAt: unknown } | undefined,
  expectedNoteType: "order_note" | "post_procedure_note",
): string {
  const prefix = expectedNoteType === "order_note" ? "order_note" : "procedure_note";
  if (r.sourceTable !== (expectedNoteType === "order_note" ? ORDER_NOTE_SOURCE_TABLE : PROCEDURE_NOTE_SOURCE_TABLE)) return `${prefix}_wrong_source_table`;
  if (r.ancillaryCaseId == null) return `${prefix}_missing_case`;
  if (r.serviceType == null) return `${prefix}_missing_service`;
  if (r.sourceId == null || !note) return `${prefix}_source_missing`;
  if (note.noteType !== expectedNoteType) return `${prefix}_wrong_note_type`;
  if (note.clinicId !== r.clinicId) return `${prefix}_cross_clinic_source`;
  if (note.ancillaryCaseId !== r.ancillaryCaseId) return `${prefix}_cross_case_source`;
  if (note.serviceType !== r.serviceType) return `${prefix}_wrong_service_source`;
  if (note.supersededAt != null) return `${prefix}_superseded_source`;
  // Status agreement between the reference and its exact source.
  if (r.documentStatus === "signed") {
    if (note.signatureStatus !== "signed" || note.signedAt == null) return `${prefix}_signed_ref_unsigned_source`;
  } else if (r.documentStatus === "pending_signature") {
    if (note.signatureStatus === "signed") return `${prefix}_pending_ref_signed_source`;
  }
  return "";
}

/** Validate a report reference against its EXACT case_document_readiness source. */
function validateReportRef(
  r: { clinicId: number; ancillaryCaseId: number | null; serviceType: string | null; executionCaseId: number | null; sourceTable: string; sourceId: number | null },
  cdr: { clinicId: number | null; serviceType: string; documentType: string; documentStatus: string; executionCaseId: number | null } | undefined,
): string {
  if (r.sourceTable !== REPORT_SOURCE_TABLE) return "report_wrong_source_table";
  if (r.ancillaryCaseId == null) return "report_missing_case";
  if (r.serviceType == null) return "report_missing_service";
  if (r.sourceId == null || !cdr) return "report_source_missing";
  if (cdr.documentType !== "report") return "report_wrong_document_type";
  if (cdr.clinicId !== r.clinicId) return "report_cross_clinic_source";
  if (cdr.serviceType !== r.serviceType) return "report_wrong_service_source";
  // Deterministic case linkage: when the reference carries an execution case,
  // the source must name the SAME execution case (never an arbitrary match).
  if (r.executionCaseId != null && cdr.executionCaseId !== r.executionCaseId) return "report_cross_case_source";
  // Only a genuinely present report satisfies evidence (missing/blocked/pending do not).
  if (!["uploaded", "generated", "approved", "completed"].includes(cdr.documentStatus)) return "report_status_not_current";
  return "";
}

// ─── Engagement — ancillary case + Admin Review + Engagement lists ───────────
async function buildEngagement(clinicId: number): Promise<EngagementOverview> {
  const empty = { activeCases: 0, approved: 0, needsInformation: 0, pending: 0, rejected: 0 };
  const shell = (availability: SectionAvailability, warnings: string[] = []): EngagementOverview => ({ availability, warnings, counts: { ...empty }, rows: [] });
  if (!featureFlags.ancillaryCaseWrite) return shell("upstream_flag_off", ["ancillary_case_flag_off"]);
  try {
    const casesRaw = await db.select().from(patientAncillaryCases).where(and(
      eq(patientAncillaryCases.clinicId, clinicId),
      inArray(patientAncillaryCases.lifecycleStatus, ANCILLARY_ACTIVE_LIFECYCLE_STATUSES as unknown as string[]),
    )).limit(SCAN_LIMIT);
    const activeSet = new Set<string>(ANCILLARY_ACTIVE_LIFECYCLE_STATUSES as unknown as string[]);
    const cases = casesRaw.filter((c) => c.clinicId === clinicId && c.lifecycleStatus != null && activeSet.has(c.lifecycleStatus));

    // ── Batched, exact-scoped Engagement list/membership wiring (§4) ──
    // Active memberships for these exact cases only; then the lists they name,
    // filtered to THIS clinic (memberships carry no clinic — the list owns it).
    const caseIds = [...new Set(cases.map((c) => c.id))];
    const memberships = caseIds.length
      ? await db.select().from(engagementListMemberships).where(and(
          inArray(engagementListMemberships.ancillaryCaseId, caseIds),
          eq(engagementListMemberships.status, "active"),
        )).limit(SCAN_LIMIT)
      : [];
    const activeMemberships = memberships.filter((m) => m.status === "active" && m.ancillaryCaseId != null && caseIds.includes(m.ancillaryCaseId));
    const listIds = [...new Set(activeMemberships.map((m) => m.engagementListId))];
    const lists = listIds.length
      ? await db.select().from(engagementLists).where(and(
          eq(engagementLists.clinicId, clinicId),
          inArray(engagementLists.id, listIds),
        )).limit(SCAN_LIMIT)
      : [];
    const listById = new Map<number, typeof lists[number]>();
    for (const l of lists) if (l.clinicId === clinicId) listById.set(l.id, l);

    // Build distinct membership rows per case. A membership is valid ONLY when
    // its list exists in THIS clinic and its service matches the exact episode.
    const caseServiceById = new Map<number, string>();
    for (const c of cases) caseServiceById.set(c.id, c.serviceType);
    const membershipsByCase = new Map<number, EngagementMembershipRow[]>();
    for (const m of activeMemberships) {
      const list = listById.get(m.engagementListId);
      if (!list) continue;                                    // cross-clinic/missing list excluded
      const caseService = caseServiceById.get(m.ancillaryCaseId as number);
      if (caseService != null && m.serviceType !== caseService) continue; // wrong-service membership excluded
      const row: EngagementMembershipRow = {
        engagementMembershipId: m.id,
        engagementListId: list.id,
        engagementListDisplayName: list.label ?? null,
        engagementListSourceType: list.sourceType ?? null,
        engagementListSourceId: list.sourceId ?? null,
        serviceType: m.serviceType ?? null,
        sentToEngagementAt: iso(list.sentToEngagementAt),
      };
      const arr = membershipsByCase.get(m.ancillaryCaseId as number) ?? [];
      arr.push(row); membershipsByCase.set(m.ancillaryCaseId as number, arr);
    }

    const counts = { ...empty };
    for (const c of cases) {
      counts.activeCases++;
      switch (c.adminReviewStatus) {
        case "approved": counts.approved++; break;
        case "needs_information": counts.needsInformation++; break;
        case "pending": counts.pending++; break;
        case "rejected": counts.rejected++; break;
        default: break;
      }
    }
    const rows = cases
      .slice().sort((a, b) => (a.id - b.id))
      .slice(0, ROW_LIMIT)
      .map((c) => {
        // Distinct memberships preserved with stable identity; deterministically
        // ordered by list id then membership id (same-date lists stay separate).
        const mships = (membershipsByCase.get(c.id) ?? []).slice()
          .sort((a, b) => (a.engagementListId - b.engagementListId) || (a.engagementMembershipId - b.engagementMembershipId));
        // Most-recently-sent comes ONLY from persisted sentToEngagementAt (no
        // first/newest fallback); tie-break deterministically by list id.
        let recent: EngagementMembershipRow | null = null;
        for (const m of mships) {
          if (m.sentToEngagementAt == null) continue;
          if (recent == null || m.sentToEngagementAt > recent.sentToEngagementAt! ||
              (m.sentToEngagementAt === recent.sentToEngagementAt && m.engagementListId > recent.engagementListId)) {
            recent = m;
          }
        }
        return {
          ancillaryCaseId: c.id, serviceType: c.serviceType, patientDisplay: null,
          adminReviewStatus: c.adminReviewStatus ?? null, lifecycleStatus: c.lifecycleStatus ?? null,
          engagementListId: recent?.engagementListId ?? null,
          engagementListName: recent?.engagementListDisplayName ?? null,
          lastSentAt: recent?.sentToEngagementAt ?? null,
          memberships: mships,
        };
      });
    const warnings = casesRaw.length >= SCAN_LIMIT ? ["counts_truncated"] : [];
    return { availability: "available", warnings, counts, rows };
  } catch (e) {
    return sectionFailure(e, () => shell("unavailable", ["engagement_read_failed"]));
  }
}
