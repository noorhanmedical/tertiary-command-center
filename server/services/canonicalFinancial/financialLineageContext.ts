// Phase 2J — shared BATCHED lineage-context loader for the claim/invoice validators.
//
// The read model and the case stage vector both need the SAME exact canonical
// context to revalidate a persisted claim/invoice (case + identity + Billing
// Document + readiness + parent version). This module batch-loads that context
// (one query per relation via inArray, clinic-scoped in SQL and re-filtered in
// memory, bounded by SCAN) and assembles the per-entity context objects the
// validators consume — never a per-row N+1.

import { db } from "../../db";
import { and, eq, inArray } from "drizzle-orm";
import { canonicalClaims } from "@shared/schema/canonicalClaims";
import { canonicalInvoices } from "@shared/schema/canonicalInvoices";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { globalPlexusPatients, patientClinicMemberships } from "@shared/schema/plexusIdentity";
import { canonicalBillingReadinessChecks } from "@shared/schema/billingReadiness";
import { canonicalBillingDocumentRequests } from "@shared/schema/billingDocuments";
import type { ClaimLineageCtx, InvoiceLineageCtx } from "./lineageValidators";

const SCAN = 2000;
const uniq = (xs: (number | null | undefined)[]): number[] => [...new Set(xs.filter((x): x is number => x != null))];

type EvidenceRow = {
  clinicId: number | null; ancillaryCaseId: number | null; serviceType: string; supersededAt: unknown;
  evidenceFingerprint: string | null; procedureEventId: number | null;
  orderNoteDocumentReferenceId: number | null; reportDocumentReferenceId: number | null; procedureNoteDocumentReferenceId: number | null;
  globalPlexusPatientId: number | null; patientClinicMembershipId: number | null;
};
function projectEvidence(r: EvidenceRow) {
  return {
    clinicId: r.clinicId ?? null, ancillaryCaseId: r.ancillaryCaseId ?? null, serviceType: r.serviceType, supersededAt: r.supersededAt,
    evidenceFingerprint: r.evidenceFingerprint ?? null, procedureEventId: r.procedureEventId ?? null,
    orderNoteDocumentReferenceId: r.orderNoteDocumentReferenceId ?? null, reportDocumentReferenceId: r.reportDocumentReferenceId ?? null, procedureNoteDocumentReferenceId: r.procedureNoteDocumentReferenceId ?? null,
    globalPlexusPatientId: r.globalPlexusPatientId ?? null, patientClinicMembershipId: r.patientClinicMembershipId ?? null,
  };
}

export type ClaimRef = {
  id: number; ancillaryCaseId: number | null; patientClinicMembershipId: number | null; globalPlexusPatientId: number | null;
  billingReadinessCheckId: number | null; billingDocumentId: number | null; supersedesClaimId: number | null;
};
export type ClaimCtxMaps = {
  caseById: Map<number, { clinicId: number; serviceType: string }>;
  memById: Map<number, { clinicId: number; membershipStatus: string; globalPlexusPatientId: number | null }>;
  gpById: Map<number, { identityStatus: string; mergedIntoPatientId: number | null }>;
  rdById: Map<number, EvidenceRow>;
  bdById: Map<number, EvidenceRow & { billingReadinessCheckId: number | null }>;
  parentById: Map<number, { clinicId: number; ancillaryCaseId: number | null; serviceType: string; attemptNumber: number | null }>;
};

/** Assemble one claim's full lineage context from already-loaded maps (pure). */
export function buildClaimLineageContext(claim: ClaimRef, maps: ClaimCtxMaps): ClaimLineageCtx {
  const bd = claim.billingDocumentId != null ? maps.bdById.get(claim.billingDocumentId) : undefined;
  const rd = claim.billingReadinessCheckId != null ? maps.rdById.get(claim.billingReadinessCheckId) : undefined;
  const parent = claim.supersedesClaimId != null ? maps.parentById.get(claim.supersedesClaimId) : undefined;
  return {
    case: (claim.ancillaryCaseId != null ? maps.caseById.get(claim.ancillaryCaseId) : null) ?? null,
    membership: (claim.patientClinicMembershipId != null ? maps.memById.get(claim.patientClinicMembershipId) : null) ?? null,
    globalPatient: (claim.globalPlexusPatientId != null ? maps.gpById.get(claim.globalPlexusPatientId) : null) ?? null,
    readiness: rd ? projectEvidence(rd) : null,
    billingDocument: bd ? { ...projectEvidence(bd), billingReadinessCheckId: bd.billingReadinessCheckId ?? null } : null,
    parentClaim: parent ?? null,
  };
}

export async function loadClaimLineageContexts(clinicId: number, claims: ClaimRef[]): Promise<Map<number, ClaimLineageCtx>> {
  const caseIds = uniq(claims.map((c) => c.ancillaryCaseId));
  const memIds = uniq(claims.map((c) => c.patientClinicMembershipId));
  const gpIds = uniq(claims.map((c) => c.globalPlexusPatientId));
  const rdIds = uniq(claims.map((c) => c.billingReadinessCheckId));
  const bdIds = uniq(claims.map((c) => c.billingDocumentId));
  const parentIds = uniq(claims.map((c) => c.supersedesClaimId));
  const [cases, mems, gps, rds, bds, parents] = await Promise.all([
    caseIds.length ? db.select().from(patientAncillaryCases).where(and(eq(patientAncillaryCases.clinicId, clinicId), inArray(patientAncillaryCases.id, caseIds))).limit(SCAN) : Promise.resolve([]),
    memIds.length ? db.select().from(patientClinicMemberships).where(and(eq(patientClinicMemberships.clinicId, clinicId), inArray(patientClinicMemberships.id, memIds))).limit(SCAN) : Promise.resolve([]),
    gpIds.length ? db.select().from(globalPlexusPatients).where(inArray(globalPlexusPatients.id, gpIds)).limit(SCAN) : Promise.resolve([]),
    rdIds.length ? db.select().from(canonicalBillingReadinessChecks).where(and(eq(canonicalBillingReadinessChecks.clinicId, clinicId), inArray(canonicalBillingReadinessChecks.id, rdIds))).limit(SCAN) : Promise.resolve([]),
    bdIds.length ? db.select().from(canonicalBillingDocumentRequests).where(and(eq(canonicalBillingDocumentRequests.clinicId, clinicId), inArray(canonicalBillingDocumentRequests.id, bdIds))).limit(SCAN) : Promise.resolve([]),
    parentIds.length ? db.select().from(canonicalClaims).where(and(eq(canonicalClaims.clinicId, clinicId), inArray(canonicalClaims.id, parentIds))).limit(SCAN) : Promise.resolve([]),
  ]);
  const maps: ClaimCtxMaps = {
    caseById: new Map((cases as { id: number; clinicId: number; serviceType: string }[]).filter((x) => x.clinicId === clinicId).map((x) => [x.id, x])),
    memById: new Map((mems as { id: number; clinicId: number; membershipStatus: string; globalPlexusPatientId: number | null }[]).filter((x) => x.clinicId === clinicId).map((x) => [x.id, x])),
    gpById: new Map((gps as { id: number; identityStatus: string; mergedIntoPatientId: number | null }[]).map((x) => [x.id, x])),
    rdById: new Map((rds as (EvidenceRow & { id: number })[]).filter((x) => (x.clinicId ?? null) === clinicId).map((x) => [x.id, x])),
    bdById: new Map((bds as (EvidenceRow & { id: number; billingReadinessCheckId: number | null })[]).filter((x) => (x.clinicId ?? null) === clinicId).map((x) => [x.id, x])),
    parentById: new Map((parents as { id: number; clinicId: number; ancillaryCaseId: number | null; serviceType: string; attemptNumber: number | null }[]).filter((x) => x.clinicId === clinicId).map((x) => [x.id, x])),
  };
  const out = new Map<number, ClaimLineageCtx>();
  for (const c of claims) out.set(c.id, buildClaimLineageContext(c, maps));
  return out;
}

export type InvoiceRef = { id: number; claimId: number | null; supersedesInvoiceId: number | null };
export type InvoiceCtxMaps = {
  claimById: Map<number, { clinicId: number; ancillaryCaseId: number | null; serviceType: string; billingDocumentId: number | null; billingReadinessCheckId: number | null; evidenceFingerprint: string | null; currency: string; lineItems: unknown }>;
  parentById: Map<number, { clinicId: number; ancillaryCaseId: number | null; serviceType: string; claimId: number | null }>;
};

/** Assemble one invoice's full lineage context from already-loaded maps (pure). */
export function buildInvoiceLineageContext(inv: InvoiceRef, maps: InvoiceCtxMaps): InvoiceLineageCtx {
  const claim = inv.claimId != null ? maps.claimById.get(inv.claimId) : undefined;
  const parent = inv.supersedesInvoiceId != null ? maps.parentById.get(inv.supersedesInvoiceId) : undefined;
  return { claim: claim ?? null, parentInvoice: parent ?? null };
}

export async function loadInvoiceLineageContexts(clinicId: number, invoices: InvoiceRef[]): Promise<Map<number, InvoiceLineageCtx>> {
  const claimIds = uniq(invoices.map((i) => i.claimId));
  const parentIds = uniq(invoices.map((i) => i.supersedesInvoiceId));
  const [claims, parents] = await Promise.all([
    claimIds.length ? db.select().from(canonicalClaims).where(and(eq(canonicalClaims.clinicId, clinicId), inArray(canonicalClaims.id, claimIds))).limit(SCAN) : Promise.resolve([]),
    parentIds.length ? db.select().from(canonicalInvoices).where(and(eq(canonicalInvoices.clinicId, clinicId), inArray(canonicalInvoices.id, parentIds))).limit(SCAN) : Promise.resolve([]),
  ]);
  const maps: InvoiceCtxMaps = {
    claimById: new Map((claims as { id: number; clinicId: number; ancillaryCaseId: number | null; serviceType: string; billingDocumentId: number | null; billingReadinessCheckId: number | null; evidenceFingerprint: string | null; currency: string; lineItems: unknown }[]).filter((x) => x.clinicId === clinicId).map((x) => [x.id, x])),
    parentById: new Map((parents as { id: number; clinicId: number; ancillaryCaseId: number | null; serviceType: string; claimId: number | null }[]).filter((x) => x.clinicId === clinicId).map((x) => [x.id, x])),
  };
  const out = new Map<number, InvoiceLineageCtx>();
  for (const i of invoices) out.set(i.id, buildInvoiceLineageContext(i, maps));
  return out;
}
