/**
 * Phase 2C — Send to Engagement writer.
 *
 * One entry point for every "Send to Engagement" action. Creates or
 * reuses exactly one engagement_lists row, adds a membership for each
 * approved ancillary case/service, stamps sent_to_engagement_at on
 * both the list and (idempotently) the execution case, records
 * durable retry on failure.
 *
 * Behavior contract:
 *
 *   FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY = OFF:
 *     Returns { status: "skipped_flag_off" } — existing behavior
 *     preserved. Zero engagement_lists writes.
 *
 *   ON:
 *     1. Determine immutable source identity (clinicId, sourceType,
 *        sourceId). Never derived from facility/date/filename alone.
 *     2. Upsert engagement_lists row (repo enforces UNIQUE(clinic,
 *        source_type, source_id) — repeat sends return the existing
 *        row, not a duplicate).
 *     3. Set sentToEngagementAt to the ACTUAL send-action moment,
 *        preserving serviceDate separately.
 *     4. For each approved ancillary case/service in the send:
 *        - upsert active membership (repo dedups on partial-unique)
 *        - stamp sent_to_engagement_at on the execution case if it
 *          has never been set
 *        - emit engagement_list_membership_added event.
 *     5. Emit engagement_list_created event on first-time creation.
 *     6. On any failure: record durable retry (refresh_memberships)
 *        + rethrow. Never fire-and-forget.
 */

import { db } from "../../db";
import { eq, sql, and, isNull } from "drizzle-orm";
import { patientExecutionCases, patientJourneyEvents } from "@shared/schema/executionCase";
import {
  ENGAGEMENT_JOURNEY_EVENT_TYPES,
  engagementLists,
} from "@shared/schema/engagementLists";
import { featureFlags } from "../../lib/featureFlags";
import {
  upsertActiveMembership,
  upsertEngagementList,
  recordEngagementReconciliationFailure,
} from "../../repositories/engagementLists.repo";

const AUDIT_SENTINEL_NAME = "[send_to_engagement_audit]";

export type SendToEngagementInput = {
  clinicId: number;
  /** Immutable source-domain type (e.g. "batch", "import", "analysis_run"). */
  sourceType: string;
  /** Immutable source-domain id (batch id, import session id, etc.). */
  sourceId: string;
  /**
   * Explicit idempotency key. When omitted → default bucket (repeat
   * sends are collapsed). Distinct values → independent immutable sends.
   * Callers that legitimately re-send the same source (e.g. after a
   * Draft reset + re-analysis) MUST provide a distinct key.
   */
  sendIdempotencyKey?: string;
  /** Human-friendly professional list label — never "Run 1"/"Analysis Run". */
  label: string;
  facility?: string | null;
  serviceDate?: string | null;
  actor: { userId: string | null };
  /** The approved services + execution/screening/ancillary linkage. */
  items: Array<{
    ancillaryCaseId?: number | null;
    patientScreeningId?: number | null;
    executionCaseId?: number | null;
    serviceType: string;
  }>;
  /** Actual timestamp of the send action. Defaults to CURRENT_TIMESTAMP. */
  sentAt?: Date;
};

export type SendToEngagementResult =
  | { status: "skipped_flag_off" }
  | {
      status: "sent";
      engagementListId: number;
      isNewList: boolean;
      membershipsCreated: number;
      membershipsReused: number;
    };

async function appendListJourneyEvent(args: {
  eventType: string;
  actorUserId: string | null;
  patientScreeningId: number | null;
  clinicId: number;
  engagementListId: number;
  serviceType?: string;
  ancillaryCaseId?: number | null;
  metadata?: Record<string, unknown>;
  summary: string;
  source: string;
}): Promise<void> {
  try {
    await db.insert(patientJourneyEvents).values({
      patientName: AUDIT_SENTINEL_NAME,
      patientDob: null,
      patientScreeningId: args.patientScreeningId,
      executionCaseId: null,
      eventType: args.eventType,
      eventSource: args.source,
      actorUserId: args.actorUserId,
      summary: args.summary,
      metadata: {
        engagement_list_id: args.engagementListId,
        clinic_id: args.clinicId,
        service_type: args.serviceType ?? null,
        ancillary_case_id: args.ancillaryCaseId ?? null,
        actor_user_id: args.actorUserId,
        ...(args.metadata ?? {}),
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "warn",
      source: "send_to_engagement",
      kind: "journey_event_write_failed",
      eventType: args.eventType,
      code: (e as { code?: string })?.code,
      message: (e as Error)?.message ?? String(e),
    }));
  }
}

export async function sendToEngagement(
  input: SendToEngagementInput,
): Promise<SendToEngagementResult> {
  if (!featureFlags.engagementMultiListRepository) {
    return { status: "skipped_flag_off" };
  }

  const sentAt = input.sentAt ?? new Date();

  // (2) Upsert list — identity now includes sendIdempotencyKey so
  // independent re-sends of the same source create distinct rows.
  const { list, isNew: isNewList } = await upsertEngagementList({
    clinicId: input.clinicId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sendIdempotencyKey: input.sendIdempotencyKey ?? "",
    label: input.label,
    facility: input.facility ?? null,
    serviceDate: input.serviceDate ?? null,
    createdByUserId: input.actor.userId,
  });

  // (3) sentToEngagementAt — set at INSERT only (default CURRENT_TIMESTAMP).
  // Repeat idempotent calls never overwrite the immutable send time.
  if (isNewList) {
    await appendListJourneyEvent({
      eventType: ENGAGEMENT_JOURNEY_EVENT_TYPES.listCreated,
      actorUserId: input.actor.userId,
      patientScreeningId: null,
      clinicId: input.clinicId,
      engagementListId: list.id,
      metadata: {
        source_type: input.sourceType,
        source_id: input.sourceId,
        facility: input.facility ?? null,
        service_date: input.serviceDate ?? null,
        sent_to_engagement_at: sentAt.toISOString(),
      },
      summary: `Engagement list created (${list.label})`,
      source: "send_to_engagement",
    });
  }

  let membershipsCreated = 0;
  let membershipsReused = 0;

  // (4) Memberships — one per approved ancillary case/service.
  for (const item of input.items) {
    try {
      const m = await upsertActiveMembership({
        engagementListId: list.id,
        ancillaryCaseId: item.ancillaryCaseId ?? null,
        patientScreeningId: item.patientScreeningId ?? null,
        executionCaseId: item.executionCaseId ?? null,
        serviceType: item.serviceType,
      });
      // upsertActiveMembership returns existing when active — count
      // by comparing addedAt to sentAt.
      const isFresh = Math.abs(m.addedAt.getTime() - Date.now()) < 5000;
      if (isFresh) {
        membershipsCreated++;
        await appendListJourneyEvent({
          eventType: ENGAGEMENT_JOURNEY_EVENT_TYPES.membershipAdded,
          actorUserId: input.actor.userId,
          patientScreeningId: item.patientScreeningId ?? null,
          clinicId: input.clinicId,
          engagementListId: list.id,
          serviceType: item.serviceType,
          ancillaryCaseId: item.ancillaryCaseId ?? null,
          metadata: { membership_id: m.id },
          summary: `Engagement list membership added (${item.serviceType})`,
          source: "send_to_engagement",
        });
      } else {
        membershipsReused++;
      }

      // Stamp sentToEngagementAt on the execution case (idempotent —
      // only when NULL).
      if (item.executionCaseId != null) {
        await db
          .update(patientExecutionCases)
          .set({ sentToEngagementAt: sql`COALESCE(${patientExecutionCases.sentToEngagementAt}, ${sentAt})` })
          .where(
            and(
              eq(patientExecutionCases.id, item.executionCaseId),
              isNull(patientExecutionCases.sentToEngagementAt),
            ),
          );
      }
    } catch (e) {
      // Record durable retry per-item + rethrow — the caller decides
      // whether the whole send should be aborted.
      try {
        await recordEngagementReconciliationFailure({
          clinicId: input.clinicId,
          patientScreeningId: item.patientScreeningId ?? null,
          ancillaryCaseId: item.ancillaryCaseId ?? null,
          serviceType: item.serviceType,
          sourceListId: list.id,
          requestedAction: "refresh_memberships",
          sourceSystem: "send_to_engagement",
          errorCode: (e as { code?: string })?.code ?? "unknown",
        });
      } catch { /* nothing further */ }
      throw e;
    }
  }

  return {
    status: "sent",
    engagementListId: list.id,
    isNewList,
    membershipsCreated,
    membershipsReused,
  };
}
