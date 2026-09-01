/**
 * Phase 2C — Engagement eligibility reconciliation.
 *
 * The single entry point for propagating Admin Review status changes
 * into Engagement. Never fire-and-forget. Never swallows failures.
 *
 * Business rules:
 *
 *   • A service is active in Engagement only while the LATEST
 *     ancillary_case.admin_review_status is 'approved'.
 *   • Non-approved statuses (pending / needs_info / rejected +
 *     cancelled / withdrawn ancillary lifecycle) are NOT active.
 *   • Approved → non-approved:
 *       - Remove ONLY that ancillary service from the active queue.
 *       - Preserve list membership records (status='removed').
 *       - Preserve calls, assignments, appointments, notes, audit
 *         history, completed operational activity.
 *       - Do NOT hard-delete anything.
 *   • Non-approved → approved:
 *       - Restore memberships that were removed by this system
 *         (removal_reason='admin_review_no_longer_approved').
 *       - Do NOT create a new execution case or duplicate work.
 *       - Emit restoration event.
 *
 * Admin Review status is authoritative over list membership.
 */

import { db } from "../../db";
import { and, eq, sql } from "drizzle-orm";
import { patientJourneyEvents } from "@shared/schema/executionCase";
import {
  engagementListMemberships,
  ENGAGEMENT_JOURNEY_EVENT_TYPES,
} from "@shared/schema/engagementLists";
import { featureFlags } from "../../lib/featureFlags";
import {
  listActiveMembershipsForAncillaryCase,
  recordEngagementReconciliationFailure,
  resolveEngagementReconciliationFailure,
} from "../../repositories/engagementLists.repo";
import type { AncillaryReviewStatus } from "@shared/schema/adminReviewEvents";

const AUDIT_SENTINEL_NAME = "[engagement_audit]";

export type ReconcileEngagementInput = {
  clinicId: number;
  patientScreeningId: number | null;
  ancillaryCaseId: number | null;
  serviceType: string;
  previousAdminReviewStatus: AncillaryReviewStatus | null;
  newAdminReviewStatus: AncillaryReviewStatus;
  changedByUserId: string | null;
  sourceListId?: number | null;
  source: string;
};

export type ReconcileEngagementResult =
  | { status: "skipped_flag_off" }
  | { status: "no_change"; ancillaryCaseId: number | null }
  | {
      status: "deactivated";
      ancillaryCaseId: number | null;
      membershipsRemoved: number;
    }
  /** First-time activation — created active memberships. */
  | {
      status: "activated";
      ancillaryCaseId: number | null;
      membershipsAdded: number;
    }
  /** Restored previously-removed-by-us memberships. */
  | {
      status: "restored";
      ancillaryCaseId: number | null;
      membershipsRestored: number;
    }
  /** Already active — nothing to do. Distinct from no_change (which is same-status). */
  | { status: "already_active"; ancillaryCaseId: number | null }
  /**
   * Deferred: approval succeeded conceptually but there is no list to
   * attach to yet. A durable retry row is recorded. The caller must
   * NOT report active visibility.
   */
  | {
      status: "deferred_no_list";
      ancillaryCaseId: number | null;
    }
  /** Explicit failure — durable retry row recorded, error rethrown by caller. */
  | { status: "failed"; ancillaryCaseId: number | null; code: string };

async function appendEngagementJourneyEvent(args: {
  eventType: string;
  input: ReconcileEngagementInput;
  metadata: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  try {
    await db.insert(patientJourneyEvents).values({
      patientName: AUDIT_SENTINEL_NAME,
      patientDob: null,
      patientScreeningId: args.input.patientScreeningId,
      executionCaseId: null,
      eventType: args.eventType,
      eventSource: args.input.source,
      actorUserId: args.input.changedByUserId,
      summary: args.summary,
      metadata: {
        ancillary_case_id: args.input.ancillaryCaseId,
        service_type: args.input.serviceType,
        clinic_id: args.input.clinicId,
        previous_admin_review_status: args.input.previousAdminReviewStatus,
        new_admin_review_status: args.input.newAdminReviewStatus,
        actor_user_id: args.input.changedByUserId,
        source_list_id: args.input.sourceListId ?? null,
        source: args.input.source,
        ...args.metadata,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "warn",
      source: "engagement_reconciliation",
      kind: "journey_event_write_failed",
      eventType: args.eventType,
      code: (e as { code?: string })?.code,
      message: (e as Error)?.message ?? String(e),
    }));
  }
}

/**
 * Idempotent. Safe to call from any status-change site.
 */
export async function reconcileEngagementEligibility(
  input: ReconcileEngagementInput,
): Promise<ReconcileEngagementResult> {
  if (!featureFlags.engagementAdminReviewSync) {
    return { status: "skipped_flag_off" };
  }

  const wasApproved = input.previousAdminReviewStatus === "approved";
  const isApproved = input.newAdminReviewStatus === "approved";

  if (wasApproved === isApproved) {
    return { status: "no_change", ancillaryCaseId: input.ancillaryCaseId };
  }

  try {
    if (wasApproved && !isApproved) {
      // Approved → non-approved: deactivate memberships for this
      // ancillary case (across every list — the operational rule is
      // "no active list = not in active queue"). Never hard delete;
      // membership rows carry removal_reason for provenance.
      let removed = 0;
      if (input.ancillaryCaseId != null) {
        const active = await listActiveMembershipsForAncillaryCase(input.ancillaryCaseId);
        for (const m of active) {
          const [row] = await db
            .update(engagementListMemberships)
            .set({
              status: "removed",
              removedAt: sql`CURRENT_TIMESTAMP`,
              removalReason: "admin_review_no_longer_approved",
            })
            .where(eq(engagementListMemberships.id, m.id))
            .returning();
          if (row) removed++;
        }
      }
      await appendEngagementJourneyEvent({
        eventType: ENGAGEMENT_JOURNEY_EVENT_TYPES.eligibilityRemoved,
        input,
        metadata: { memberships_removed: removed, reason_code: "admin_review_no_longer_approved" },
        summary: `Engagement eligibility removed (${input.serviceType})`,
      });
      // Close any matching unresolved retry rows for the opposite intent.
      await resolveEngagementReconciliationFailure({
        ancillaryCaseId: input.ancillaryCaseId ?? undefined,
        patientScreeningId: input.patientScreeningId ?? undefined,
        serviceType: input.serviceType,
        requestedAction: "activate",
      });
      return { status: "deactivated", ancillaryCaseId: input.ancillaryCaseId, membershipsRemoved: removed };
    }

    // Non-approved → approved. Five explicit outcomes (activated /
    // restored / already_active / deferred_no_list / failed).
    //   (a) any active memberships already exist  → no_change effect
    //       (nothing to restore or add). Emit eligibilityRestored so
    //       the audit trail still records the transition.
    //   (b) at least one previously-removed membership with
    //       removal_reason = 'admin_review_no_longer_approved' exists
    //       → restore each of them. This is the "restoration" case.
    //   (c) no memberships at all (or none matching the restore
    //       criteria) → first-time activation. Enumerate the source
    //       lists that reference the ancillary case (via any past
    //       membership, active or not), and CREATE an active
    //       membership for each. This addresses the missing-approved-
    //       item root cause: approval must activate even when the
    //       initial membership was never created (write failure) OR
    //       when no removed rows exist to restore.
    if (input.ancillaryCaseId == null) {
      // No ancillary case id → nothing we can attach to. Defer.
      try {
        await recordEngagementReconciliationFailure({
          clinicId: input.clinicId,
          patientScreeningId: input.patientScreeningId,
          ancillaryCaseId: null,
          serviceType: input.serviceType,
          requestedAction: "activate",
          previousAdminReviewStatus: input.previousAdminReviewStatus,
          newAdminReviewStatus: input.newAdminReviewStatus,
          sourceSystem: input.source,
          errorCode: "NO_ANCILLARY_CASE_ID",
        });
      } catch { /* migration/flag guards */ }
      await appendEngagementJourneyEvent({
        eventType: ENGAGEMENT_JOURNEY_EVENT_TYPES.reconciliationFailed,
        input,
        metadata: { deferred: true, reason_code: "NO_ANCILLARY_CASE_ID" },
        summary: `Engagement activation deferred (no ancillary case id)`,
      });
      return { status: "deferred_no_list", ancillaryCaseId: null };
    }

    const allForCase = await db
      .select()
      .from(engagementListMemberships)
      .where(eq(engagementListMemberships.ancillaryCaseId, input.ancillaryCaseId));
    const anyActive = allForCase.some((m) => m.status === "active");

    if (anyActive) {
      // Already visibly active — record no state change but still close
      // any lingering unresolved deactivate retry row.
      await resolveEngagementReconciliationFailure({
        ancillaryCaseId: input.ancillaryCaseId,
        patientScreeningId: input.patientScreeningId ?? undefined,
        serviceType: input.serviceType,
        requestedAction: "deactivate",
      });
      return { status: "already_active", ancillaryCaseId: input.ancillaryCaseId };
    }

    const removedForReview = allForCase.filter(
      (m) =>
        m.status === "removed" &&
        m.removalReason === "admin_review_no_longer_approved",
    );

    if (removedForReview.length > 0) {
      // Restoration path.
      let restored = 0;
      for (const m of removedForReview) {
        const [row] = await db
          .update(engagementListMemberships)
          .set({ status: "active", removedAt: null, removalReason: null })
          .where(eq(engagementListMemberships.id, m.id))
          .returning();
        if (row) restored++;
      }
      await appendEngagementJourneyEvent({
        eventType: ENGAGEMENT_JOURNEY_EVENT_TYPES.eligibilityRestored,
        input,
        metadata: {
          memberships_restored: restored,
          reason_code: "admin_review_re_approved",
        },
        summary: `Engagement eligibility restored (${input.serviceType})`,
      });
      await resolveEngagementReconciliationFailure({
        ancillaryCaseId: input.ancillaryCaseId,
        patientScreeningId: input.patientScreeningId ?? undefined,
        serviceType: input.serviceType,
        requestedAction: "deactivate",
      });
      return {
        status: "restored",
        ancillaryCaseId: input.ancillaryCaseId,
        membershipsRestored: restored,
      };
    }

    // First-time activation via historical list assignments.
    const distinctLists = new Set<number>();
    for (const m of allForCase) distinctLists.add(m.engagementListId);
    if (distinctLists.size === 0) {
      // No prior list to attach to. Admin Review approval IS the
      // "send to engagement" event for a case that never went through a
      // batch send, so ensure a canonical clinic-level admin_review list
      // and attach the membership to it. Deferring here was the bug: an
      // approved case with no source list never became visible in the
      // membership-required Engagement views. The list is idempotent
      // (one per clinic, keyed by source), so repeat approvals reuse it.
      try {
        const { upsertEngagementList } = await import(
          "../../repositories/engagementLists.repo"
        );
        const { list } = await upsertEngagementList({
          clinicId: input.clinicId,
          sourceType: "admin_review",
          sourceId: String(input.clinicId),
          sendIdempotencyKey: "",
          label: "Admin Review — Approved",
          createdByUserId: input.changedByUserId ?? null,
          metadata: { origin: "admin_review_first_approved" },
        });
        distinctLists.add(list.id);
      } catch (e) {
        // Could not ensure a list (e.g. migration/flag guard). Fall back
        // to the honest deferred state + durable retry rather than
        // claiming visibility we didn't create.
        try {
          await recordEngagementReconciliationFailure({
            clinicId: input.clinicId,
            patientScreeningId: input.patientScreeningId,
            ancillaryCaseId: input.ancillaryCaseId,
            serviceType: input.serviceType,
            requestedAction: "activate",
            previousAdminReviewStatus: input.previousAdminReviewStatus,
            newAdminReviewStatus: input.newAdminReviewStatus,
            sourceSystem: input.source,
            errorCode: "NO_LIST_ASSIGNMENT",
          });
        } catch { /* migration/flag guards */ }
        await appendEngagementJourneyEvent({
          eventType: ENGAGEMENT_JOURNEY_EVENT_TYPES.reconciliationFailed,
          input,
          metadata: {
            deferred: true,
            reason_code: "NO_LIST_ASSIGNMENT",
            ensure_list_error: (e as { code?: string })?.code ?? "unknown",
          },
          summary: `Engagement activation deferred (no list assignment)`,
        });
        return { status: "deferred_no_list", ancillaryCaseId: input.ancillaryCaseId };
      }
    }

    // Create one active membership per prior list.
    let added = 0;
    for (const listId of distinctLists) {
      const [row] = await db
        .insert(engagementListMemberships)
        .values({
          engagementListId: listId,
          ancillaryCaseId: input.ancillaryCaseId,
          patientScreeningId: input.patientScreeningId,
          executionCaseId: null,
          serviceType: input.serviceType,
          status: "active",
        })
        .returning();
      if (row) added++;
    }
    await appendEngagementJourneyEvent({
      eventType: ENGAGEMENT_JOURNEY_EVENT_TYPES.eligibilityAdded,
      input,
      metadata: {
        memberships_added: added,
        reason_code: "admin_review_first_approved",
      },
      summary: `Engagement eligibility added (${input.serviceType})`,
    });
    await resolveEngagementReconciliationFailure({
      ancillaryCaseId: input.ancillaryCaseId,
      patientScreeningId: input.patientScreeningId ?? undefined,
      serviceType: input.serviceType,
      requestedAction: "deactivate",
    });
    return {
      status: "activated",
      ancillaryCaseId: input.ancillaryCaseId,
      membershipsAdded: added,
    };
  } catch (e) {
    // Record a durable retry row + emit failure audit. Do not swallow.
    try {
      await recordEngagementReconciliationFailure({
        clinicId: input.clinicId,
        patientScreeningId: input.patientScreeningId,
        ancillaryCaseId: input.ancillaryCaseId,
        serviceType: input.serviceType,
        sourceListId: input.sourceListId ?? null,
        requestedAction: isApproved ? "activate" : "deactivate",
        previousAdminReviewStatus: input.previousAdminReviewStatus,
        newAdminReviewStatus: input.newAdminReviewStatus,
        sourceSystem: input.source,
        errorCode: (e as { code?: string })?.code ?? "unknown",
      });
    } catch { /* migration/flag guards already handled */ }
    await appendEngagementJourneyEvent({
      eventType: ENGAGEMENT_JOURNEY_EVENT_TYPES.reconciliationFailed,
      input,
      metadata: {
        error_code: (e as { code?: string })?.code ?? "unknown",
      },
      summary: `Engagement reconciliation failed (${input.serviceType})`,
    });
    throw e;
  }
}
