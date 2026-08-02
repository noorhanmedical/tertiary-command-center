/**
 * Phase 2I — PCS (Patient Care Specialist) canonical read model.
 *
 * Patient-centric, episode-preserving, clinic-scoped, READ-ONLY, bounded. Loads a
 * keyset page of exact ancillary cases (never the whole clinic), builds each
 * case's canonical stage vector (batched), then GROUPS by exact canonical patient
 * identity (globalPlexusPatientId + patientClinicMembershipId) while keeping every
 * ancillaryCaseId a distinct child episode. No demographic identity fallback.
 */

import { db } from "../../db";
import { and, eq, gt, inArray, asc } from "drizzle-orm";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { globalPlexusPatients, patientClinicMemberships } from "@shared/schema/plexusIdentity";
import { featureFlags } from "../../lib/featureFlags";
import { buildStageVectors, MigrationMissingError } from "../canonicalStage/caseStageVector";
import {
  PCS_CANONICAL_VIEW_VERSION, PCS_DEFAULT_LIMIT, PCS_MAX_LIMIT,
  type PcsCanonicalView, type PcsPatientGroup,
} from "@shared/pcsCanonicalView";
import { loadCaseFilters, decodeCursor, encodeCursor, type CanonicalViewFilters } from "../canonicalStage/viewQuery";

export { MigrationMissingError };

export type PcsViewInput = { clinicId: number; cursor?: string | null; limit?: number; filters?: CanonicalViewFilters };

export async function getPcsCanonicalView(input: PcsViewInput): Promise<PcsCanonicalView> {
  const generatedAt = new Date().toISOString();
  const limit = clampLimit(input.limit);
  const base: Omit<PcsCanonicalView, "availability" | "warnings" | "rows" | "pageInfo"> = {
    disabled: false, generatedAt, dataVersion: PCS_CANONICAL_VIEW_VERSION, clinicScoped: true,
  };
  // Section gate: without Phase 2B there are no canonical ancillary cases.
  if (!featureFlags.ancillaryCaseWrite) {
    return { ...base, availability: "upstream_flag_off", warnings: ["ancillary_case_flag_off"], rows: [], pageInfo: { limit, nextCursor: null, returned: 0 } };
  }
  const filters = loadCaseFilters(input.filters);
  const afterId = decodeCursor(input.cursor);
  // Keyset page of exact clinic cases, deterministically ordered by id.
  const conds = [eq(patientAncillaryCases.clinicId, input.clinicId)];
  if (afterId != null) conds.push(gt(patientAncillaryCases.id, afterId));
  if (filters.serviceType) conds.push(eq(patientAncillaryCases.serviceType, filters.serviceType));
  if (filters.lifecycleStatus) conds.push(eq(patientAncillaryCases.lifecycleStatus, filters.lifecycleStatus));
  if (filters.adminReviewStatus) conds.push(eq(patientAncillaryCases.adminReviewStatus, filters.adminReviewStatus));

  const page = await db.select().from(patientAncillaryCases).where(and(...conds)).orderBy(asc(patientAncillaryCases.id)).limit(limit + 1);
  // Deterministic ascending keyset order (defense-in-depth over the SQL ORDER BY).
  const casesAll = page.filter((c) => c.clinicId === input.clinicId).sort((a, b) => a.id - b.id);
  const hasMore = casesAll.length > limit;
  const cases = casesAll.slice(0, limit);
  const nextCursor = hasMore && cases.length ? encodeCursor(cases[cases.length - 1].id) : null;

  const vectors = await buildStageVectors({ clinicId: input.clinicId, cases });

  // Authorized display only (never identity): resolve display_name/dob/clinic_mrn
  // in one batched read each, exact-clinic-scoped.
  const gppIds = [...new Set(cases.map((c) => c.globalPlexusPatientId).filter((x): x is number => x != null))];
  const pcmIds = [...new Set(cases.map((c) => c.patientClinicMembershipId).filter((x): x is number => x != null))];
  const gppRows = gppIds.length ? await db.select().from(globalPlexusPatients).where(inArray(globalPlexusPatients.id, gppIds)).limit(PCS_MAX_LIMIT * 2) : [];
  const pcmRows = pcmIds.length ? await db.select().from(patientClinicMemberships).where(and(eq(patientClinicMemberships.clinicId, input.clinicId), inArray(patientClinicMemberships.id, pcmIds))).limit(PCS_MAX_LIMIT * 2) : [];
  const gppById = new Map(gppRows.map((r) => [r.id, r]));
  const pcmById = new Map(pcmRows.filter((r) => r.clinicId === input.clinicId).map((r) => [r.id, r]));

  // Group episodes under exact identity (gpp|pcm). Cases with incomplete identity
  // are grouped under a truthful "identity unavailable" bucket, never by demographics.
  const groups = new Map<string, PcsPatientGroup>();
  const order: string[] = [];
  for (const v of vectors) {
    const c = cases.find((x) => x.id === v.ancillaryCaseId)!;
    const gpp = c.globalPlexusPatientId ?? null;
    const pcm = c.patientClinicMembershipId ?? null;
    const key = gpp != null && pcm != null ? `${gpp}|${pcm}` : `unresolved|${v.ancillaryCaseId}`;
    let g = groups.get(key);
    if (!g) {
      const gppRow = gpp != null ? gppById.get(gpp) : undefined;
      const pcmRow = pcm != null ? pcmById.get(pcm) : undefined;
      g = {
        globalPlexusPatientId: gpp, patientClinicMembershipId: pcm,
        patientDisplay: gppRow?.displayName ?? null, patientDob: gppRow?.dob ?? null, clinicMrn: pcmRow?.clinicMrn ?? null,
        identityAvailable: gpp != null && pcm != null && (gppRow != null || pcmRow != null),
        identityWarnings: (gpp == null || pcm == null) ? ["identity_incomplete"] : (gppRow == null && pcmRow == null ? ["identity_display_unavailable"] : []),
        episodes: [],
      };
      // Mirror display onto the episode identity (authorized display only).
      groups.set(key, g); order.push(key);
    }
    v.identity.patientDisplay = g.patientDisplay; v.identity.patientDob = g.patientDob; v.identity.clinicMrn = g.clinicMrn;
    g.episodes.push(v);
  }
  const rows = order.map((k) => groups.get(k)!).sort(groupSort);

  return { ...base, availability: "available", warnings: [], rows, pageInfo: { limit, nextCursor, returned: cases.length } };
}

function clampLimit(n?: number): number {
  if (!Number.isFinite(n) || n == null) return PCS_DEFAULT_LIMIT;
  return Math.max(1, Math.min(PCS_MAX_LIMIT, Math.floor(n)));
}
// Deterministic group order: by identity ids (nulls last), then first episode id.
function groupSort(a: PcsPatientGroup, b: PcsPatientGroup): number {
  const ag = a.globalPlexusPatientId ?? Number.MAX_SAFE_INTEGER, bg = b.globalPlexusPatientId ?? Number.MAX_SAFE_INTEGER;
  if (ag !== bg) return ag - bg;
  const am = a.patientClinicMembershipId ?? Number.MAX_SAFE_INTEGER, bm = b.patientClinicMembershipId ?? Number.MAX_SAFE_INTEGER;
  if (am !== bm) return am - bm;
  return (a.episodes[0]?.ancillaryCaseId ?? 0) - (b.episodes[0]?.ancillaryCaseId ?? 0);
}
