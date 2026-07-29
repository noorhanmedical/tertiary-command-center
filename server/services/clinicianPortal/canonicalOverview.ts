/**
 * Phase 2H — canonical, clinic-scoped, READ-ONLY Clinician Portal overview.
 *
 * One centralized read model over the Phase 2A–2G canonical spine. NO writes, NO
 * retry records, NO document bytes, NO revenue/claim/payment fields, NO global
 * Plexus identity ids. Every query is exact-clinic-scoped, bounded, and
 * deterministically ordered; one ancillary case is one episode (never merged by
 * patient/service). Each of the three sections is independently gated by its OWN
 * upstream runtime flag and try/caught, so a disabled/failed section is reported
 * TRUTHFULLY (unavailable / upstream_flag_off / migration_missing) — NEVER as a
 * silent zero.
 */

import { db } from "../../db";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { canonicalBillingReadinessChecks } from "@shared/schema/billingReadiness";
import { canonicalBillingDocumentRequests } from "@shared/schema/billingDocuments";
import { ancillaryDocumentReferences } from "@shared/schema/ancillaryDocuments";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { patientAncillaryCases, ANCILLARY_ACTIVE_LIFECYCLE_STATUSES } from "@shared/schema/ancillaryCases";
import { featureFlags, billingReadinessRuntimeEnabled } from "../../lib/featureFlags";
import {
  CLINICIAN_PORTAL_OVERVIEW_VERSION, CLINICIAN_PORTAL_OVERVIEW_ROW_LIMIT,
  type ClinicianPortalCanonicalOverview, type FinanceOverview, type OrdersNotesOverview,
  type EngagementOverview, type CodeCount, type SectionAvailability,
} from "@shared/clinicianPortalOverview";

const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);
const SCAN_LIMIT = 2000;               // bounded aggregation scan (per section)
const ROW_LIMIT = CLINICIAN_PORTAL_OVERVIEW_ROW_LIMIT;

function isMigration(e: unknown): boolean { return MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? ""); }
function tally(list: { code: string }[]): CodeCount[] {
  const m = new Map<string, number>();
  for (const b of list) m.set(b.code, (m.get(b.code) ?? 0) + 1);
  return [...m.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => (b.count - a.count) || a.code.localeCompare(b.code));
}

export type OverviewInput = { clinicId: number };

export async function getClinicianPortalCanonicalOverview(input: OverviewInput): Promise<ClinicianPortalCanonicalOverview> {
  const generatedAt = new Date().toISOString();
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
      const ev = r.evaluatedAt ? new Date(r.evaluatedAt as unknown as Date).toISOString() : null;
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
        evaluatedAt: r.evaluatedAt ? new Date(r.evaluatedAt as unknown as Date).toISOString() : null,
      }));
    const warnings = current.length >= SCAN_LIMIT ? ["counts_truncated"] : [];
    return { availability: "available", warnings, counts, billingBlockersByCode: tally(billingBlockers), claimBlockersByCode: tally(claimBlockers), lastEvaluatedAt, rows };
  } catch (e) {
    return shell(isMigration(e) ? "migration_missing" : "unavailable", [isMigration(e) ? "migration_missing" : "finance_read_failed"]);
  }
}

// ─── Orders & Notes — Unified Ancillary Documents spine ──────────────────────
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
    const counts = { ...empty };
    const kindByCase = new Map<number, Set<string>>();
    const currentRefs = refs.filter((r) => r.clinicId === clinicId && r.supersededAt == null && ["order_note", "procedure_note", "report"].includes(r.documentKind));
    for (const r of currentRefs) {
      if (r.documentKind === "order_note") counts.currentOrderNotes++;
      else if (r.documentKind === "procedure_note") { counts.currentProcedureNotes++; if (r.documentStatus === "pending_signature") counts.pendingSignatures++; }
      else if (r.documentKind === "report") counts.currentReports++;
      const s = kindByCase.get(r.ancillaryCaseId) ?? new Set<string>(); s.add(r.documentKind); kindByCase.set(r.ancillaryCaseId, s);
    }
    // missing required evidence: a procedure_note present but no current report.
    for (const s of kindByCase.values()) if (s.has("procedure_note") && !s.has("report")) counts.missingEvidence++;
    // Returned-for-correction + generated note counts come from the exact note rows.
    const notes = await db.select().from(procedureNotes).where(and(
      eq(procedureNotes.clinicId, clinicId), isNull(procedureNotes.supersededAt),
    )).limit(SCAN_LIMIT);
    for (const n of notes) {
      if (n.clinicId !== clinicId || n.supersededAt != null) continue;
      if (n.noteType === "post_procedure_note") {
        if (n.signatureStatus === "returned_for_correction") counts.returnedForCorrection++;
        if (n.generationStatus === "generated" || n.generationStatus === "approved") counts.generatedNotes++;
      }
    }
    const rows = currentRefs
      .slice().sort((a, b) => (a.ancillaryCaseId - b.ancillaryCaseId) || a.documentKind.localeCompare(b.documentKind) || (a.id - b.id))
      .slice(0, ROW_LIMIT)
      .map((r) => ({
        ancillaryCaseId: r.ancillaryCaseId, serviceType: r.serviceType, patientDisplay: null,
        documentKind: r.documentKind as "order_note" | "procedure_note" | "report",
        documentStatus: r.documentStatus,
        signedAt: r.signedAt ? new Date(r.signedAt as unknown as Date).toISOString() : null,
        effectiveClinicalDate: r.effectiveClinicalDate ? new Date(r.effectiveClinicalDate as unknown as Date).toISOString() : null,
        actualCreatedAt: r.actualCreatedAt ? new Date(r.actualCreatedAt as unknown as Date).toISOString() : null,
      }));
    const warnings = refs.length >= SCAN_LIMIT ? ["counts_truncated"] : [];
    return { availability: "available", warnings, counts, rows };
  } catch (e) {
    return shell(isMigration(e) ? "migration_missing" : "unavailable", [isMigration(e) ? "migration_missing" : "orders_notes_read_failed"]);
  }
}

// ─── Engagement — service-specific ancillary case + Admin Review ─────────────
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
      .map((c) => ({
        ancillaryCaseId: c.id, serviceType: c.serviceType, patientDisplay: null,
        adminReviewStatus: c.adminReviewStatus ?? null, lifecycleStatus: c.lifecycleStatus ?? null,
        // Engagement-list membership + last-sent are not canonically resolvable
        // here without an unbounded join — reported truthfully as null (never inferred).
        engagementListName: null, lastSentAt: null,
      }));
    const warnings = casesRaw.length >= SCAN_LIMIT ? ["counts_truncated"] : [];
    return { availability: "available", warnings, counts, rows };
  } catch (e) {
    return shell(isMigration(e) ? "migration_missing" : "unavailable", [isMigration(e) ? "migration_missing" : "engagement_read_failed"]);
  }
}
