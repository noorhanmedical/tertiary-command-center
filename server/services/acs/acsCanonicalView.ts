/**
 * Phase 2I — ACS (Ancillary Care Specialist) canonical read model.
 *
 * Ancillary-case operational: ONE row per exact ancillaryCaseId (never grouped by
 * patient+service / screening+service / facility+date; repeated same-service cases
 * stay distinct). Clinic-scoped, READ-ONLY, bounded keyset pagination. Each row IS
 * the case's canonical stage vector, whose `currentStage` is deterministic or null.
 */

import { db } from "../../db";
import { and, eq, gt, asc } from "drizzle-orm";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { featureFlags } from "../../lib/featureFlags";
import { buildStageVectors, MigrationMissingError } from "../canonicalStage/caseStageVector";
import {
  ACS_CANONICAL_VIEW_VERSION, ACS_DEFAULT_LIMIT, ACS_MAX_LIMIT, type AcsCanonicalView,
} from "@shared/acsCanonicalView";
import { loadCaseFilters, decodeCursor, encodeCursor, type CanonicalViewFilters } from "../canonicalStage/viewQuery";

export { MigrationMissingError };

export type AcsViewInput = { clinicId: number; cursor?: string | null; limit?: number; filters?: CanonicalViewFilters };

export async function getAcsCanonicalView(input: AcsViewInput): Promise<AcsCanonicalView> {
  const generatedAt = new Date().toISOString();
  const limit = clampLimit(input.limit);
  const base: Omit<AcsCanonicalView, "availability" | "warnings" | "rows" | "pageInfo"> = {
    disabled: false, generatedAt, dataVersion: ACS_CANONICAL_VIEW_VERSION, clinicScoped: true,
  };
  if (!featureFlags.ancillaryCaseWrite) {
    return { ...base, availability: "upstream_flag_off", warnings: ["ancillary_case_flag_off"], rows: [], pageInfo: { limit, nextCursor: null, returned: 0 } };
  }
  const filters = loadCaseFilters(input.filters);
  const afterId = decodeCursor(input.cursor);
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

  const rows = await buildStageVectors({ clinicId: input.clinicId, cases });
  // One row per exact ancillaryCaseId, deterministically ordered by case id.
  rows.sort((a, b) => a.ancillaryCaseId - b.ancillaryCaseId);

  return { ...base, availability: "available", warnings: [], rows, pageInfo: { limit, nextCursor, returned: cases.length } };
}

function clampLimit(n?: number): number {
  if (!Number.isFinite(n) || n == null) return ACS_DEFAULT_LIMIT;
  return Math.max(1, Math.min(ACS_MAX_LIMIT, Math.floor(n)));
}
