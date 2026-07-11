// operationalSummaryService — Phase 3 PR 3.8.
//
// Read-only aggregation across the exception engine + recommendation
// log. Returns a snapshot a human can use to gauge how much Phase 3
// signal exists and how the human-review workflow is keeping up.

import { db } from "../../db";
import { sql, eq, and, isNotNull } from "drizzle-orm";
import { exceptionSnapshots } from "@shared/schema/exceptionSnapshots";
import { exceptionReviewEvents } from "@shared/schema/exceptionReviews";
import { aiRecommendationLogs } from "@shared/schema/aiRecommendationLogs";
import { getEffectiveAiSafetyPolicy } from "./aiSafetyPolicyService";

export const OPERATIONAL_SUMMARY_VERSION = "3.8.0";

export type OperationalSummary = {
  version: string;
  generatedAt: string;
  scope: { facilityId: string | null };
  exceptions: {
    totalByStatus: Record<string, number>;
    totalByType: Record<string, number>;
    bySeverity: Record<string, number>;
    avgHoursToAcknowledge: number | null;
    avgHoursToResolve: number | null;
  };
  recommendations: {
    totalByStatus: Record<string, number>;
    totalByAction: Record<string, number>;
    totalByProvider: Record<string, number>;
    acceptanceRatePercent: number | null;
  };
  topFacilitiesByOpen: { facilityId: string | null; openCount: number }[];
  topDetectorsByOpen: { exceptionType: string; openCount: number }[];
  safety: Awaited<ReturnType<typeof getEffectiveAiSafetyPolicy>>;
};

function toRecord(rows: { key: string | null; value: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key ?? "(null)"] = r.value;
  return out;
}

export async function computeOperationalSummary(
  scope: { facilityId?: string | null } = {},
): Promise<OperationalSummary> {
  const facilityId = scope.facilityId ?? null;
  const facilityFilter = facilityId ? sql`facility_id = ${facilityId}` : sql`true`;

  // ── Exceptions ────────────────────────────────────────────────────
  const byStatus = await db.execute<{ key: string; value: string }>(sql`
    select status as key, count(*)::text as value
    from exception_snapshots
    where ${facilityFilter}
    group by 1
    order by 2 desc
  `);
  const byType = await db.execute<{ key: string; value: string }>(sql`
    select exception_type as key, count(*)::text as value
    from exception_snapshots
    where ${facilityFilter}
    group by 1
    order by 2 desc
  `);
  const bySeverity = await db.execute<{ key: string; value: string }>(sql`
    select severity as key, count(*)::text as value
    from exception_snapshots
    where ${facilityFilter}
    group by 1
    order by 2 desc
  `);

  const avgAck = await db.execute<{ avg_hours: string | null }>(sql`
    select coalesce(
      avg(extract(epoch from (acknowledged_at - detected_at)) / 3600.0)::text,
      null
    ) as avg_hours
    from exception_snapshots
    where ${facilityFilter} and acknowledged_at is not null
  `);
  const avgRes = await db.execute<{ avg_hours: string | null }>(sql`
    select coalesce(
      avg(extract(epoch from (resolved_at - detected_at)) / 3600.0)::text,
      null
    ) as avg_hours
    from exception_snapshots
    where ${facilityFilter} and resolved_at is not null and status = 'resolved'
  `);

  // ── Recommendations ───────────────────────────────────────────────
  const recByStatus = await db.execute<{ key: string; value: string }>(sql`
    select status as key, count(*)::text as value
    from ai_recommendation_logs
    group by 1
    order by 2 desc
  `);
  const recByAction = await db.execute<{ key: string; value: string }>(sql`
    select recommended_action as key, count(*)::text as value
    from ai_recommendation_logs
    group by 1
    order by 2 desc
  `);
  const recByProvider = await db.execute<{ key: string; value: string }>(sql`
    select model_provider as key, count(*)::text as value
    from ai_recommendation_logs
    group by 1
    order by 2 desc
  `);

  const acceptVsReject = await db.execute<{ accepted: string; rejected: string }>(sql`
    select
      sum(case when status = 'accepted' then 1 else 0 end)::text as accepted,
      sum(case when status = 'rejected' then 1 else 0 end)::text as rejected
    from ai_recommendation_logs
  `);
  let acceptanceRatePercent: number | null = null;
  if (acceptVsReject.rows.length > 0) {
    const a = Number(acceptVsReject.rows[0].accepted ?? 0);
    const r = Number(acceptVsReject.rows[0].rejected ?? 0);
    if (a + r > 0) acceptanceRatePercent = Number(((a / (a + r)) * 100).toFixed(1));
  }

  // ── Top breakdowns ────────────────────────────────────────────────
  const topFacilities = await db.execute<{ facility_id: string | null; open_count: string }>(sql`
    select facility_id, count(*)::text as open_count
    from exception_snapshots
    where status in ('open', 'acknowledged', 'in_review')
    group by 1
    order by 2 desc
    limit 10
  `);
  const topDetectors = await db.execute<{ exception_type: string; open_count: string }>(sql`
    select exception_type, count(*)::text as open_count
    from exception_snapshots
    where status in ('open', 'acknowledged', 'in_review') and ${facilityFilter}
    group by 1
    order by 2 desc
    limit 10
  `);

  const safety = await getEffectiveAiSafetyPolicy({ facilityId });

  return {
    version: OPERATIONAL_SUMMARY_VERSION,
    generatedAt: new Date().toISOString(),
    scope: { facilityId },
    exceptions: {
      totalByStatus: toRecord(byStatus.rows.map((r) => ({ key: r.key, value: Number(r.value) }))),
      totalByType: toRecord(byType.rows.map((r) => ({ key: r.key, value: Number(r.value) }))),
      bySeverity: toRecord(bySeverity.rows.map((r) => ({ key: r.key, value: Number(r.value) }))),
      avgHoursToAcknowledge: avgAck.rows[0]?.avg_hours != null ? Number(avgAck.rows[0].avg_hours) : null,
      avgHoursToResolve: avgRes.rows[0]?.avg_hours != null ? Number(avgRes.rows[0].avg_hours) : null,
    },
    recommendations: {
      totalByStatus: toRecord(recByStatus.rows.map((r) => ({ key: r.key, value: Number(r.value) }))),
      totalByAction: toRecord(recByAction.rows.map((r) => ({ key: r.key, value: Number(r.value) }))),
      totalByProvider: toRecord(recByProvider.rows.map((r) => ({ key: r.key, value: Number(r.value) }))),
      acceptanceRatePercent,
    },
    topFacilitiesByOpen: topFacilities.rows.map((r) => ({
      facilityId: r.facility_id, openCount: Number(r.open_count),
    })),
    topDetectorsByOpen: topDetectors.rows.map((r) => ({
      exceptionType: r.exception_type, openCount: Number(r.open_count),
    })),
    safety,
  };
}

// Silence unused-import lints — kept available for future PRs that
// want to summarise review event activity directly.
export const _unusedRefs = { exceptionSnapshots, exceptionReviewEvents, aiRecommendationLogs, eq, and, isNotNull };
