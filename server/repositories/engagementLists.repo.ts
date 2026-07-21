/**
 * Phase 2C — engagement_lists + engagement_list_memberships +
 * engagement_reconciliation_failures repository.
 *
 * Every write path is gated by feature flags:
 *   • engagement_lists writes → FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY
 *   • memberships / retry ledger writes → FEATURE_ENGAGEMENT_ADMIN_REVIEW_SYNC
 * Reads gracefully handle a missing migration when the corresponding
 * flag is OFF (returns null / empty). When the flag is ON but the
 * migration is missing, reads re-throw a structured error.
 */

import { db } from "../db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  engagementLists,
  engagementListMemberships,
  engagementReconciliationFailures,
  ENGAGEMENT_LIST_STATUSES,
  ENGAGEMENT_MEMBERSHIP_STATUSES,
  ENGAGEMENT_RECONCILIATION_ACTIONS,
  type EngagementList,
  type EngagementListMembership,
  type EngagementListStatus,
  type EngagementMembershipStatus,
  type EngagementReconciliationAction,
  type EngagementReconciliationFailure,
} from "@shared/schema/engagementLists";
import { featureFlags } from "../lib/featureFlags";

const PG_UNDEFINED_TABLE = "42P01";

function guardMultiListWrite(): void {
  if (!featureFlags.engagementMultiListRepository) {
    const err = new Error(
      "engagement_multi_list_write_disabled: enable FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY after applying migration 0051",
    ) as Error & { code?: string; status?: number };
    err.code = "ENGAGEMENT_MULTI_LIST_WRITE_DISABLED";
    err.status = 503;
    throw err;
  }
}

function guardSyncWrite(): void {
  if (!featureFlags.engagementAdminReviewSync) {
    const err = new Error(
      "engagement_admin_review_sync_disabled: enable FEATURE_ENGAGEMENT_ADMIN_REVIEW_SYNC after applying migration 0051",
    ) as Error & { code?: string; status?: number };
    err.code = "ENGAGEMENT_SYNC_WRITE_DISABLED";
    err.status = 503;
    throw err;
  }
}

async function safeRead<T>(
  op: () => Promise<T>,
  fallback: T,
  opName: string,
  flag: boolean,
): Promise<T> {
  try {
    return await op();
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === PG_UNDEFINED_TABLE) {
      if (!flag) return fallback;
      const err = new Error(
        `engagement_migration_missing: table absent while flag is ON (op=${opName})`,
      ) as Error & { code?: string; status?: number };
      err.code = "ENGAGEMENT_MIGRATION_MISSING";
      err.status = 503;
      throw err;
    }
    throw e;
  }
}

// ─── engagement_lists ───────────────────────────────────────────
export type UpsertEngagementListInput = {
  clinicId: number;
  sourceType: string;
  sourceId: string;
  label: string;
  facility?: string | null;
  serviceDate?: string | null;
  createdByUserId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Insert-or-fetch: the identity is (clinicId, sourceType, sourceId).
 * The migration's unique index makes the write idempotent. Returns
 * the existing row on conflict instead of a duplicate. Never
 * overwrites the existing label / metadata (Repository ordering
 * depends on the immutable sentToEngagementAt).
 */
export async function upsertEngagementList(
  input: UpsertEngagementListInput,
): Promise<EngagementList> {
  guardMultiListWrite();
  const existing = await db
    .select()
    .from(engagementLists)
    .where(
      and(
        eq(engagementLists.clinicId, input.clinicId),
        eq(engagementLists.sourceType, input.sourceType),
        eq(engagementLists.sourceId, input.sourceId),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db
    .insert(engagementLists)
    .values({
      clinicId: input.clinicId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      label: input.label,
      facility: input.facility ?? null,
      serviceDate: input.serviceDate ?? null,
      createdByUserId: input.createdByUserId ?? null,
      metadata: (input.metadata ?? {}) as unknown as never,
    })
    .returning();
  return row;
}

/** Repository listing: Most-Recently-Sent first, then id DESC as tiebreaker. */
export async function listEngagementListsForRepository(args: {
  clinicId: number;
  limit?: number;
}): Promise<EngagementList[]> {
  const limit = Math.min(Math.max(1, args.limit ?? 50), 200);
  return safeRead(
    async () =>
      db
        .select()
        .from(engagementLists)
        .where(
          and(
            eq(engagementLists.clinicId, args.clinicId),
            eq(engagementLists.status, "active"),
          ),
        )
        .orderBy(desc(engagementLists.sentToEngagementAt), desc(engagementLists.id))
        .limit(limit),
    [] as EngagementList[],
    "listEngagementListsForRepository",
    featureFlags.engagementMultiListRepository,
  );
}

/** Top-N Most Recently Sent — spans all service dates + facilities. */
export async function listMostRecentlySentEngagementLists(args: {
  clinicId: number;
  limit?: number;
}): Promise<EngagementList[]> {
  const limit = Math.min(Math.max(1, args.limit ?? 10), 50);
  return safeRead(
    async () =>
      db
        .select()
        .from(engagementLists)
        .where(
          and(
            eq(engagementLists.clinicId, args.clinicId),
            eq(engagementLists.status, "active"),
          ),
        )
        .orderBy(desc(engagementLists.sentToEngagementAt), desc(engagementLists.id))
        .limit(limit),
    [] as EngagementList[],
    "listMostRecentlySentEngagementLists",
    featureFlags.engagementRecentLists || featureFlags.engagementMultiListRepository,
  );
}

// ─── engagement_list_memberships ─────────────────────────────────
export type UpsertMembershipInput = {
  engagementListId: number;
  ancillaryCaseId?: number | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  serviceType: string;
};

/**
 * Idempotent: if an active membership already exists for
 * (list, ancillary_case, service_type) — or the screening fallback —
 * return it unchanged. Otherwise insert.
 */
export async function upsertActiveMembership(
  input: UpsertMembershipInput,
): Promise<EngagementListMembership> {
  guardSyncWrite();
  const conds = [
    eq(engagementListMemberships.engagementListId, input.engagementListId),
    eq(engagementListMemberships.serviceType, input.serviceType),
    eq(engagementListMemberships.status, "active"),
  ];
  if (input.ancillaryCaseId != null) {
    conds.push(eq(engagementListMemberships.ancillaryCaseId, input.ancillaryCaseId));
  } else if (input.patientScreeningId != null) {
    conds.push(eq(engagementListMemberships.patientScreeningId, input.patientScreeningId));
    conds.push(isNull(engagementListMemberships.ancillaryCaseId));
  }
  const existing = await db
    .select()
    .from(engagementListMemberships)
    .where(and(...conds))
    .limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db
    .insert(engagementListMemberships)
    .values({
      engagementListId: input.engagementListId,
      ancillaryCaseId: input.ancillaryCaseId ?? null,
      patientScreeningId: input.patientScreeningId ?? null,
      executionCaseId: input.executionCaseId ?? null,
      serviceType: input.serviceType,
    })
    .returning();
  return row;
}

/**
 * Remove a membership (soft — sets status=removed + timestamp).
 * Every active membership sharing (ancillary_case_id, service_type)
 * across OTHER lists is untouched — an operational work item may be
 * supported by any remaining active membership.
 */
export async function removeMembership(args: {
  engagementListId: number;
  ancillaryCaseId?: number | null;
  patientScreeningId?: number | null;
  serviceType: string;
  reason: string;
}): Promise<EngagementListMembership | null> {
  guardSyncWrite();
  const conds = [
    eq(engagementListMemberships.engagementListId, args.engagementListId),
    eq(engagementListMemberships.serviceType, args.serviceType),
    eq(engagementListMemberships.status, "active"),
  ];
  if (args.ancillaryCaseId != null) {
    conds.push(eq(engagementListMemberships.ancillaryCaseId, args.ancillaryCaseId));
  } else if (args.patientScreeningId != null) {
    conds.push(eq(engagementListMemberships.patientScreeningId, args.patientScreeningId));
    conds.push(isNull(engagementListMemberships.ancillaryCaseId));
  }
  const [row] = await db
    .update(engagementListMemberships)
    .set({
      status: "removed",
      removedAt: sql`CURRENT_TIMESTAMP`,
      removalReason: args.reason,
    })
    .where(and(...conds))
    .returning();
  return row ?? null;
}

export async function listActiveMembershipsForAncillaryCase(
  ancillaryCaseId: number,
): Promise<EngagementListMembership[]> {
  return safeRead(
    async () =>
      db
        .select()
        .from(engagementListMemberships)
        .where(
          and(
            eq(engagementListMemberships.ancillaryCaseId, ancillaryCaseId),
            eq(engagementListMemberships.status, "active"),
          ),
        ),
    [] as EngagementListMembership[],
    "listActiveMembershipsForAncillaryCase",
    featureFlags.engagementAdminReviewSync,
  );
}

export async function listActiveMembershipsForList(
  engagementListId: number,
): Promise<EngagementListMembership[]> {
  return safeRead(
    async () =>
      db
        .select()
        .from(engagementListMemberships)
        .where(
          and(
            eq(engagementListMemberships.engagementListId, engagementListId),
            eq(engagementListMemberships.status, "active"),
          ),
        )
        .orderBy(engagementListMemberships.addedAt),
    [] as EngagementListMembership[],
    "listActiveMembershipsForList",
    featureFlags.engagementMultiListRepository,
  );
}

// ─── engagement_reconciliation_failures (durable retry ledger) ──
export type RecordEngagementFailureInput = {
  clinicId: number;
  patientScreeningId?: number | null;
  ancillaryCaseId?: number | null;
  serviceType?: string | null;
  sourceListId?: number | null;
  requestedAction: EngagementReconciliationAction;
  previousAdminReviewStatus?: string | null;
  newAdminReviewStatus?: string | null;
  sourceSystem?: string | null;
  errorCode?: string | null;
};

export async function recordEngagementReconciliationFailure(
  input: RecordEngagementFailureInput,
): Promise<EngagementReconciliationFailure> {
  const dedupeConds = [
    eq(engagementReconciliationFailures.requestedAction, input.requestedAction),
    isNull(engagementReconciliationFailures.resolvedAt),
  ];
  if (input.serviceType != null) {
    dedupeConds.push(eq(engagementReconciliationFailures.serviceType, input.serviceType));
  }
  if (input.ancillaryCaseId != null) {
    dedupeConds.push(eq(engagementReconciliationFailures.ancillaryCaseId, input.ancillaryCaseId));
  } else if (input.patientScreeningId != null) {
    dedupeConds.push(
      eq(engagementReconciliationFailures.patientScreeningId, input.patientScreeningId),
    );
    dedupeConds.push(isNull(engagementReconciliationFailures.ancillaryCaseId));
  }

  const existing = await db
    .select()
    .from(engagementReconciliationFailures)
    .where(and(...dedupeConds))
    .limit(1);

  if (existing[0]) {
    const [updated] = await db
      .update(engagementReconciliationFailures)
      .set({
        attemptCount: (existing[0].attemptCount ?? 0) + 1,
        lastAttemptedAt: sql`CURRENT_TIMESTAMP`,
        errorCode: input.errorCode ?? existing[0].errorCode,
        sourceSystem: input.sourceSystem ?? existing[0].sourceSystem,
        newAdminReviewStatus:
          input.newAdminReviewStatus ?? existing[0].newAdminReviewStatus,
        previousAdminReviewStatus:
          input.previousAdminReviewStatus ?? existing[0].previousAdminReviewStatus,
      })
      .where(eq(engagementReconciliationFailures.id, existing[0].id))
      .returning();
    return updated;
  }
  const [inserted] = await db
    .insert(engagementReconciliationFailures)
    .values({
      clinicId: input.clinicId,
      patientScreeningId: input.patientScreeningId ?? null,
      ancillaryCaseId: input.ancillaryCaseId ?? null,
      serviceType: input.serviceType ?? null,
      sourceListId: input.sourceListId ?? null,
      requestedAction: input.requestedAction,
      previousAdminReviewStatus: input.previousAdminReviewStatus ?? null,
      newAdminReviewStatus: input.newAdminReviewStatus ?? null,
      sourceSystem: input.sourceSystem ?? null,
      errorCode: input.errorCode ?? null,
      attemptCount: 1,
    })
    .returning();
  return inserted;
}

export async function resolveEngagementReconciliationFailure(args: {
  ancillaryCaseId?: number | null;
  patientScreeningId?: number | null;
  serviceType?: string | null;
  requestedAction?: EngagementReconciliationAction;
}): Promise<void> {
  const conds = [isNull(engagementReconciliationFailures.resolvedAt)];
  if (args.ancillaryCaseId != null) {
    conds.push(eq(engagementReconciliationFailures.ancillaryCaseId, args.ancillaryCaseId));
  } else if (args.patientScreeningId != null) {
    conds.push(
      eq(engagementReconciliationFailures.patientScreeningId, args.patientScreeningId),
    );
  }
  if (args.serviceType != null) {
    conds.push(eq(engagementReconciliationFailures.serviceType, args.serviceType));
  }
  if (args.requestedAction) {
    conds.push(eq(engagementReconciliationFailures.requestedAction, args.requestedAction));
  }
  await db
    .update(engagementReconciliationFailures)
    .set({ resolvedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(...conds));
}

export async function listUnresolvedEngagementReconciliations(args?: {
  clinicId?: number;
  limit?: number;
}): Promise<EngagementReconciliationFailure[]> {
  const limit = Math.min(Math.max(1, args?.limit ?? 100), 500);
  return safeRead(
    async () => {
      const conds = [isNull(engagementReconciliationFailures.resolvedAt)];
      if (args?.clinicId != null) {
        conds.push(eq(engagementReconciliationFailures.clinicId, args.clinicId));
      }
      return db
        .select()
        .from(engagementReconciliationFailures)
        .where(and(...conds))
        .orderBy(engagementReconciliationFailures.firstFailedAt)
        .limit(limit);
    },
    [] as EngagementReconciliationFailure[],
    "listUnresolvedEngagementReconciliations",
    featureFlags.engagementAdminReviewSync,
  );
}
