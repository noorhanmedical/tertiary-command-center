/**
 * Phase 2C — ancillary_case_admin_review_events repository.
 *
 * APPEND-ONLY. This repo exports insert + read helpers only. There is
 * intentionally NO update / delete function — reviews are immutable
 * history. Corrections create a NEW event.
 */

import { db } from "../db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  ancillaryCaseAdminReviewEvents,
  ANCILLARY_REVIEW_STATUSES,
  ANCILLARY_REVIEW_SOURCES,
  type AncillaryCaseAdminReviewEvent,
  type AncillaryReviewSource,
  type AncillaryReviewStatus,
} from "@shared/schema/adminReviewEvents";
import { featureFlags } from "../lib/featureFlags";

const PG_UNDEFINED_TABLE = "42P01";

function guardWrite(): void {
  if (!featureFlags.serviceSpecificAdminReview) {
    const err = new Error(
      "admin_review_write_disabled: enable FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW after applying migration 0051",
    ) as Error & { code?: string; status?: number };
    err.code = "ADMIN_REVIEW_WRITE_DISABLED";
    err.status = 503;
    throw err;
  }
}

async function safeRead<T>(op: () => Promise<T>, fallback: T, opName = "unknown"): Promise<T> {
  try {
    return await op();
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === PG_UNDEFINED_TABLE) {
      if (!featureFlags.serviceSpecificAdminReview) return fallback;
      const err = new Error(
        `admin_review_migration_missing: table absent while FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW is ON (op=${opName})`,
      ) as Error & { code?: string; status?: number };
      err.code = "ADMIN_REVIEW_MIGRATION_MISSING";
      err.status = 503;
      throw err;
    }
    throw e;
  }
}

/**
 * Insert an append-only review event. The server derives
 * actualReviewedAt (CURRENT_TIMESTAMP) — client cannot backdate.
 * evidenceSnapshot is required (empty {} is acceptable but the
 * service layer typically populates it from live evidence).
 */
export type AppendReviewEventInput = {
  ancillaryCaseId: number;
  serviceType: string;
  previousStatus: AncillaryReviewStatus | null;
  newStatus: AncillaryReviewStatus;
  reviewerUserId: string | null;
  reviewerRole: string | null;
  effectiveClinicalDate: string | null;
  rationale: string | null;
  evidenceSnapshot: Record<string, unknown>;
  source: AncillaryReviewSource;
};

export async function appendAdminReviewEvent(
  input: AppendReviewEventInput,
): Promise<AncillaryCaseAdminReviewEvent> {
  guardWrite();
  if (!(ANCILLARY_REVIEW_STATUSES as readonly string[]).includes(input.newStatus)) {
    throw new Error(`invalid new_status: ${input.newStatus}`);
  }
  if (
    input.previousStatus !== null &&
    !(ANCILLARY_REVIEW_STATUSES as readonly string[]).includes(input.previousStatus)
  ) {
    throw new Error(`invalid previous_status: ${input.previousStatus}`);
  }
  if (!(ANCILLARY_REVIEW_SOURCES as readonly string[]).includes(input.source)) {
    throw new Error(`invalid source: ${input.source}`);
  }
  const [row] = await db
    .insert(ancillaryCaseAdminReviewEvents)
    .values({
      ancillaryCaseId: input.ancillaryCaseId,
      serviceType: input.serviceType,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      reviewerUserId: input.reviewerUserId,
      reviewerRole: input.reviewerRole,
      effectiveClinicalDate: input.effectiveClinicalDate,
      rationale: input.rationale,
      evidenceSnapshot: input.evidenceSnapshot as unknown as never,
      source: input.source,
    })
    .returning();
  return row;
}

/** Latest event for a single ancillary case (drives the projection). */
export async function getLatestAdminReviewEvent(
  ancillaryCaseId: number,
): Promise<AncillaryCaseAdminReviewEvent | null> {
  return safeRead(
    async () => {
      const rows = await db
        .select()
        .from(ancillaryCaseAdminReviewEvents)
        .where(eq(ancillaryCaseAdminReviewEvents.ancillaryCaseId, ancillaryCaseId))
        .orderBy(desc(ancillaryCaseAdminReviewEvents.actualReviewedAt))
        .limit(1);
      return rows[0] ?? null;
    },
    null,
    "getLatestAdminReviewEvent",
  );
}

/** Full ordered history for one case — oldest first. */
export async function listAdminReviewHistory(
  ancillaryCaseId: number,
): Promise<AncillaryCaseAdminReviewEvent[]> {
  return safeRead(
    async () => {
      return db
        .select()
        .from(ancillaryCaseAdminReviewEvents)
        .where(eq(ancillaryCaseAdminReviewEvents.ancillaryCaseId, ancillaryCaseId))
        .orderBy(ancillaryCaseAdminReviewEvents.actualReviewedAt);
    },
    [] as AncillaryCaseAdminReviewEvent[],
    "listAdminReviewHistory",
  );
}

/**
 * Latest events for multiple cases in one query — used by the
 * screening compatibility projection so the caller can compute the
 * screening-level status without N round trips.
 */
export async function getLatestAdminReviewEventsForCases(
  ancillaryCaseIds: number[],
): Promise<Map<number, AncillaryCaseAdminReviewEvent>> {
  if (ancillaryCaseIds.length === 0) return new Map();
  return safeRead(
    async () => {
      // Use a subquery: for each ancillary_case_id, pick the row with
      // the max actual_reviewed_at.
      const rows = await db.execute(sql`
        SELECT DISTINCT ON (ancillary_case_id) *
        FROM ancillary_case_admin_review_events
        WHERE ancillary_case_id = ANY(${ancillaryCaseIds}::int[])
        ORDER BY ancillary_case_id, actual_reviewed_at DESC
      `);
      const map = new Map<number, AncillaryCaseAdminReviewEvent>();
      for (const raw of rows.rows as unknown as Record<string, unknown>[]) {
        const key = (raw.ancillaryCaseId ?? raw.ancillary_case_id) as number;
        if (key != null) map.set(key, raw as unknown as AncillaryCaseAdminReviewEvent);
      }
      return map;
    },
    new Map<number, AncillaryCaseAdminReviewEvent>(),
    "getLatestAdminReviewEventsForCases",
  );
}
