/**
 * Phase 2I — PCS (Patient Care Specialist) canonical read model.
 *
 * PATIENT-CENTRIC pagination (§7): pages EXACT active clinic memberships by a
 * stable membership-id cursor, resolves each patient THROUGH the verified
 * membership (§3), then batch-loads that patient's bounded ancillary-case
 * episodes — so one patient's episodes are NEVER split across pages. Every
 * ancillaryCaseId stays a distinct child episode (repeated same-service episodes
 * never merged). Identity-unresolved cases go to a separate bounded exact-case
 * bucket, never grouped by demographics. READ-ONLY, clinic-scoped, bounded.
 */

import { db } from "../../db";
import { and, eq, gt, inArray, asc, isNull } from "drizzle-orm";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { globalPlexusPatients, patientClinicMemberships } from "@shared/schema/plexusIdentity";
import type { PatientAncillaryCase } from "@shared/schema/ancillaryCases";
import { featureFlags } from "../../lib/featureFlags";
import { buildStageVectors, MigrationMissingError } from "../canonicalStage/caseStageVector";
import { verifyCaseIdentity } from "./pcsIdentity";
import {
  PCS_CANONICAL_VIEW_VERSION, PCS_DEFAULT_LIMIT, PCS_MAX_LIMIT,
  type PcsCanonicalView, type PcsPatientGroup,
} from "@shared/pcsCanonicalView";
import { loadCaseFilters, decodeCursor, encodeCursor, type CanonicalViewFilters } from "../canonicalStage/viewQuery";

export { MigrationMissingError };

// Hard bound on episodes materialized per page (across all returned patients +
// the unresolved bucket) so a single request can never load an unbounded set.
const PCS_MAX_EPISODES_PER_PAGE = 500;
// Bounded identity-unresolved bucket (null-membership cases), surfaced on the
// first page only so it appears once.
const PCS_UNRESOLVED_BUCKET_LIMIT = 100;

export type PcsViewInput = { clinicId: number; cursor?: string | null; limit?: number; filters?: CanonicalViewFilters };

export async function getPcsCanonicalView(input: PcsViewInput): Promise<PcsCanonicalView> {
  const generatedAt = new Date().toISOString();
  const limit = clampLimit(input.limit);
  const base: Omit<PcsCanonicalView, "availability" | "warnings" | "rows" | "pageInfo"> = {
    disabled: false, generatedAt, dataVersion: PCS_CANONICAL_VIEW_VERSION, clinicScoped: true,
  };
  if (!featureFlags.ancillaryCaseWrite) {
    return { ...base, availability: "upstream_flag_off", warnings: ["ancillary_case_flag_off"], rows: [], pageInfo: { limit, nextCursor: null, returned: 0 } };
  }
  const filters = loadCaseFilters(input.filters);
  const afterId = decodeCursor(input.cursor);

  // 1) Page EXACT active clinic memberships (the patient axis), by membership id.
  const memConds = [eq(patientClinicMemberships.clinicId, input.clinicId), eq(patientClinicMemberships.membershipStatus, "active")];
  if (afterId != null) memConds.push(gt(patientClinicMemberships.id, afterId));
  const memPageRaw = await db.select().from(patientClinicMemberships).where(and(...memConds)).orderBy(asc(patientClinicMemberships.id)).limit(limit + 1);
  const memPage = memPageRaw.filter((m) => m.clinicId === input.clinicId && m.membershipStatus === "active").sort((a, b) => a.id - b.id);
  const hasMore = memPage.length > limit;
  const members = memPage.slice(0, limit);
  const nextCursor = hasMore && members.length ? encodeCursor(members[members.length - 1].id) : null;
  const memberById = new Map(members.map((m) => [m.id, m]));
  const memberIds = members.map((m) => m.id);

  // 2) Resolve the global patient THROUGH each verified membership.
  const gppIds = [...new Set(members.map((m) => m.globalPlexusPatientId).filter((x): x is number => x != null))];
  const gppRows = gppIds.length ? await db.select().from(globalPlexusPatients).where(inArray(globalPlexusPatients.id, gppIds)).limit(PCS_MAX_LIMIT * 2) : [];
  const gppById = new Map(gppRows.map((r) => [r.id, r]));

  // 3) Batch-load bounded ancillary-case episodes for the paged memberships.
  const warnings: string[] = [];
  const caseConds = [eq(patientAncillaryCases.clinicId, input.clinicId)];
  if (memberIds.length) caseConds.push(inArray(patientAncillaryCases.patientClinicMembershipId, memberIds));
  applyCaseFilters(caseConds, filters);
  const memberCasesRaw = memberIds.length
    ? await db.select().from(patientAncillaryCases).where(and(...caseConds)).orderBy(asc(patientAncillaryCases.id)).limit(PCS_MAX_EPISODES_PER_PAGE + 1)
    : [];
  let cases = memberCasesRaw.filter((c) => c.clinicId === input.clinicId && c.patientClinicMembershipId != null && memberIds.includes(c.patientClinicMembershipId)).sort((a, b) => a.id - b.id);
  if (cases.length > PCS_MAX_EPISODES_PER_PAGE) { cases = cases.slice(0, PCS_MAX_EPISODES_PER_PAGE); warnings.push("episodes_truncated"); }

  // 4) Identity-unresolved bucket (cases with NO clinic membership) — first page
  //    only, bounded; each kept as its OWN group by ancillaryCaseId (no merge).
  let unresolvedCases: PatientAncillaryCase[] = [];
  if (afterId == null) {
    const uConds = [eq(patientAncillaryCases.clinicId, input.clinicId), isNull(patientAncillaryCases.patientClinicMembershipId)];
    applyCaseFilters(uConds, filters);
    const uRaw = await db.select().from(patientAncillaryCases).where(and(...uConds)).orderBy(asc(patientAncillaryCases.id)).limit(PCS_UNRESOLVED_BUCKET_LIMIT + 1);
    unresolvedCases = uRaw.filter((c) => c.clinicId === input.clinicId && c.patientClinicMembershipId == null).sort((a, b) => a.id - b.id);
    if (unresolvedCases.length > PCS_UNRESOLVED_BUCKET_LIMIT) { unresolvedCases = unresolvedCases.slice(0, PCS_UNRESOLVED_BUCKET_LIMIT); warnings.push("unresolved_identity_truncated"); }
  }

  const allCases = [...cases, ...unresolvedCases];
  const vectors = await buildStageVectors({ clinicId: input.clinicId, cases: allCases });
  const vectorByCase = new Map(vectors.map((v) => [v.ancillaryCaseId, v]));

  // 5) Group by VERIFIED identity; unresolved cases stay separate by case id.
  const groups = new Map<string, PcsPatientGroup>();
  const order: string[] = [];
  for (const c of allCases) {
    const membership = c.patientClinicMembershipId != null ? memberById.get(c.patientClinicMembershipId) : undefined;
    const globalPatient = membership?.globalPlexusPatientId != null ? gppById.get(membership.globalPlexusPatientId) : undefined;
    const idres = verifyCaseIdentity({ clinicId: input.clinicId, caseGlobalPatientId: c.globalPlexusPatientId ?? null, caseMembershipId: c.patientClinicMembershipId ?? null, membership, globalPatient });
    const key = idres.resolved && idres.groupKey ? idres.groupKey : `unresolved|${c.id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        globalPlexusPatientId: idres.resolved ? (c.globalPlexusPatientId ?? null) : null,
        patientClinicMembershipId: idres.resolved ? (c.patientClinicMembershipId ?? null) : null,
        patientDisplay: idres.patientDisplay, patientDob: idres.patientDob, clinicMrn: idres.clinicMrn,
        identityAvailable: idres.resolved, identityWarnings: idres.warnings, episodes: [],
      };
      groups.set(key, g); order.push(key);
    }
    const v = vectorByCase.get(c.id);
    if (v) {
      v.identity.patientDisplay = idres.patientDisplay; v.identity.patientDob = idres.patientDob; v.identity.clinicMrn = idres.clinicMrn;
      v.identity.available = idres.resolved; v.identity.warnings = idres.resolved ? [] : idres.warnings;
      g.episodes.push(v);
    }
  }
  const rows = order.map((k) => groups.get(k)!).sort(groupSort);

  return { ...base, availability: "available", warnings, rows, pageInfo: { limit, nextCursor, returned: members.length } };
}

function applyCaseFilters(conds: unknown[], filters: Required<CanonicalViewFilters>): void {
  if (filters.serviceType) (conds as ReturnType<typeof eq>[]).push(eq(patientAncillaryCases.serviceType, filters.serviceType));
  if (filters.lifecycleStatus) (conds as ReturnType<typeof eq>[]).push(eq(patientAncillaryCases.lifecycleStatus, filters.lifecycleStatus));
  if (filters.adminReviewStatus) (conds as ReturnType<typeof eq>[]).push(eq(patientAncillaryCases.adminReviewStatus, filters.adminReviewStatus));
}
function clampLimit(n?: number): number {
  if (!Number.isFinite(n) || n == null) return PCS_DEFAULT_LIMIT;
  return Math.max(1, Math.min(PCS_MAX_LIMIT, Math.floor(n)));
}
function groupSort(a: PcsPatientGroup, b: PcsPatientGroup): number {
  const ag = a.globalPlexusPatientId ?? Number.MAX_SAFE_INTEGER, bg = b.globalPlexusPatientId ?? Number.MAX_SAFE_INTEGER;
  if (ag !== bg) return ag - bg;
  const am = a.patientClinicMembershipId ?? Number.MAX_SAFE_INTEGER, bm = b.patientClinicMembershipId ?? Number.MAX_SAFE_INTEGER;
  if (am !== bm) return am - bm;
  return (a.episodes[0]?.ancillaryCaseId ?? 0) - (b.episodes[0]?.ancillaryCaseId ?? 0);
}
