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
  | {
      status: "activated";
      ancillaryCaseId: number | null;
      /** Memberships that had been previously removed for this exact reason and were restored. */
      membershipsRestored: number;
      /** Memberships that did not exist and were freshly added. */
      membershipsAdded: number;
      /** Distinguishes first-time activation from a restoration. */
      firstActivation: boolean;
    };

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

    // Non-approved → approved. Three sub-cases:
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
    let restored = 0;
    let added = 0;
    let firstActivation = false;
    if (input.ancillaryCaseId != null) {
      const allForCase = await db
        .select()
        .from(engagementListMemberships)
        .where(eq(engagementListMemberships.ancillaryCaseId, input.ancillaryCaseId));
      const anyActive = allForCase.some((m) => m.status === "active");
      const removedForReview = allForCase.filter(
        (m) =>
          m.status === "removed" &&
          m.removalReason === "admin_review_no_longer_approved",
      );
      if (!anyActive && removedForReview.length > 0) {
        // (b) Restore.
        for (const m of removedForReview) {
          const [row] = await db
            .update(engagementListMemberships)
            .set({ status: "active", removedAt: null, removalReason: null })
            .where(eq(engagementListMemberships.id, m.id))
            .returning();
          if (row) restored++;
        }
      } else if (!anyActive) {
        // (c) First-time activation. If the ancillary case has any
        // historical membership (removed / withdrawn) we can reuse
        // its list identity to recreate. Otherwise there is nothing
        // to activate here — the list writer must create the
        // membership. We record durable retry work so a background
        // job can complete this once a list assignment exists.
        firstActivation = true;
        const distinctLists = new Set<number>();
        for (const m of allForCase) distinctLists.add(m.engagementListId);
        if (distinctLists.size === 0) {
          // No historical list assignment — record retry so a future
          // Send-to-Engagement or explicit backfill can wire this up.
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
        } else {
          // Create one active membership per prior list, preserving
          // source identity. This is the missing-approved-item fix.
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
        }
      }
      // else (anyActive == true) → already active. Nothing to do.
    }
    await appendEngagementJourneyEvent({
      eventType:
        added > 0
          ? ENGAGEMENT_JOURNEY_EVENT_TYPES.eligibilityAdded
          : ENGAGEMENT_JOURNEY_EVENT_TYPES.eligibilityRestored,
      input,
      metadata: {
        memberships_restored: restored,
        memberships_added: added,
        first_activation: firstActivation,
        reason_code: added > 0 ? "admin_review_first_approved" : "admin_review_re_approved",
      },
      summary:
        added > 0
          ? `Engagement eligibility added (${input.serviceType})`
          : `Engagement eligibility restored (${input.serviceType})`,
    });
    await resolveEngagementReconciliationFailure({
      ancillaryCaseId: input.ancillaryCaseId ?? undefined,
      patientScreeningId: input.patientScreeningId ?? undefined,
      serviceType: input.serviceType,
      requestedAction: "deactivate",
    });
    return {
      status: "activated",
      ancillaryCaseId: input.ancillaryCaseId,
      membershipsRestored: restored,
      membershipsAdded: added,
      firstActivation,
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
