/**
 * Phase 2C — Transactional Admin Review recorder.
 *
 * One call point for every service-specific review action (manual,
 * bulk, same-day retroactive, reanalysis). The client must NOT be
 * able to set actualReviewedAt / evidenceSnapshot — both are
 * server-derived.
 *
 * Behavior contract:
 *
 *   FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW = OFF:
 *     Returns { status: "skipped_flag_off" }. Zero DB touches.
 *     Legacy /api/patient-screenings/:id/admin-approval remains the
 *     only Admin Review flow at runtime.
 *
 *   ON — Successful path:
 *     1. Load ancillary case (enforces tenant scope via clinicId
 *        comparison against caller-provided clinicId).
 *     2. Assert authorization (currently ALWAYS DENIES pending the
 *        Plexus-internal role — see authorization.ts blocker).
 *     3. Snapshot evidence (currently a fixed structural blob; the
 *        real evidence builder from Phase 3 will replace this).
 *     4. Append immutable review event.
 *     5. Update patient_ancillary_cases.admin_review_status projection.
 *     6. Compute + update patient_screenings.admin_approval_status
 *        compatibility projection.
 *     7. Enqueue Engagement reconciliation via the shared engagement
 *        service (which itself may enqueue durable retry work if the
 *        write path fails).
 *     8. Emit non-PHI journey event.
 *
 *   ON — Authorization / integrity failure:
 *     Throws with a structured code. No partial state written.
 */

import { db } from "../../db";
import { and, eq, sql } from "drizzle-orm";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { patientScreenings } from "@shared/schema/screening";
import { patientJourneyEvents } from "@shared/schema/executionCase";
import {
  ADMIN_REVIEW_JOURNEY_EVENT_TYPES,
  normalizeReviewStatus,
  type AncillaryReviewSource,
  type AncillaryReviewStatus,
} from "@shared/schema/adminReviewEvents";
import { featureFlags } from "../../lib/featureFlags";
import { assertAdminReviewAccess } from "./authorization";
import {
  appendAdminReviewEvent,
  getLatestAdminReviewEventsForCases,
} from "../../repositories/adminReviewEvents.repo";
import { projectScreeningStatusFromAncillaryStatuses } from "./screeningProjection";
import { listAncillaryCasesForScreening } from "../../repositories/ancillaryCases.repo";

/** Non-PHI journey event sentinel (matches ancillary-case sentinel from Phase 2B). */
export const ADMIN_REVIEW_AUDIT_SENTINEL_NAME = "[admin_review_audit]";

export type RecordAdminReviewInput = {
  ancillaryCaseId: number;
  clinicId: number;
  newStatus: string; // normalized inside — accepts "denied" alias
  effectiveClinicalDate?: string | null;
  rationale?: string | null;
  actor: { userId: string | null; role: string | null };
  source: AncillaryReviewSource;
};

export type EngagementOutcomeCode =
  | "activated"
  | "restored"
  | "already_active"
  | "deferred_no_list"
  | "deactivated"
  | "no_change"
  | "skipped_flag_off"
  | "failed";

export type RecordAdminReviewResult =
  | { status: "skipped_flag_off" }
  | { status: "case_not_found"; ancillaryCaseId: number }
  | { status: "cross_clinic_denied"; ancillaryCaseId: number }
  | {
      status: "recorded";
      ancillaryCaseId: number;
      serviceType: string;
      previousStatus: AncillaryReviewStatus | null;
      newStatus: AncillaryReviewStatus;
      eventId: number;
      patientScreeningId: number | null;
      screeningProjection: AncillaryReviewStatus;
      /**
       * The Engagement reconciliation outcome for this review event.
       * Distinguishes success, deferred, and failed states so callers
       * can return 202 / 503 as appropriate.
       */
      engagementOutcome: EngagementOutcomeCode;
      /** Non-PHI error code when engagementOutcome === "failed". */
      engagementErrorCode?: string;
      /** True when a durable retry row exists after this review. */
      retryPending: boolean;
    };

async function appendJourneyEvent(args: {
  eventType: string;
  patientScreeningId: number | null;
  ancillaryCaseId: number;
  metadata: Record<string, unknown>;
  summary: string;
  source: string;
  actorUserId: string | null;
}): Promise<void> {
  try {
    await db.insert(patientJourneyEvents).values({
      patientName: ADMIN_REVIEW_AUDIT_SENTINEL_NAME,
      patientDob: null,
      patientScreeningId: args.patientScreeningId,
      executionCaseId: null,
      eventType: args.eventType,
      eventSource: args.source,
      actorUserId: args.actorUserId,
      summary: args.summary,
      metadata: args.metadata,
    });
  } catch (e) {
    // Never break the review write on an audit-write failure.
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "warn",
      source: "admin_review",
      kind: "journey_event_write_failed",
      eventType: args.eventType,
      code: (e as { code?: string })?.code,
      message: (e as Error)?.message ?? String(e),
    }));
  }
}

export async function recordAncillaryCaseAdminReview(
  input: RecordAdminReviewInput,
): Promise<RecordAdminReviewResult> {
  if (!featureFlags.serviceSpecificAdminReview) {
    return { status: "skipped_flag_off" };
  }

  // Authorization is enforced BEFORE any DB read. Currently always
  // denies (see authorization.ts blocker).
  assertAdminReviewAccess({ role: input.actor.role, userId: input.actor.userId });

  const normalized: AncillaryReviewStatus = normalizeReviewStatus(input.newStatus);

  // Load + tenant check.
  const rows = await db
    .select()
    .from(patientAncillaryCases)
    .where(eq(patientAncillaryCases.id, input.ancillaryCaseId))
    .limit(1);
  const acase = rows[0];
  if (!acase) return { status: "case_not_found", ancillaryCaseId: input.ancillaryCaseId };
  if (acase.clinicId !== input.clinicId) {
    return { status: "cross_clinic_denied", ancillaryCaseId: input.ancillaryCaseId };
  }

  const previousStatus = (acase.adminReviewStatus ?? null) as AncillaryReviewStatus | null;

  // Evidence snapshot — structural stub for Phase 2C. Actual clinical
  // evidence builder is Phase 3 scope; here we snapshot the case's
  // qualification / prior review state so history is complete.
  const evidenceSnapshot = {
    ancillaryCaseId: acase.id,
    serviceType: acase.serviceType,
    qualificationStatus: acase.qualificationStatus,
    adminReviewStatus: acase.adminReviewStatus,
    lifecycleStatus: acase.lifecycleStatus,
    episodeSequence: acase.episodeSequence,
    snapshotAt: new Date().toISOString(),
    source: input.source,
  };

  // Transactional write: append event → update projection → refresh
  // screening compatibility projection.
  const written = await db.transaction(async (tx) => {
    const [event] = await tx
      .insert((await import("@shared/schema/adminReviewEvents")).ancillaryCaseAdminReviewEvents)
      .values({
        ancillaryCaseId: acase.id,
        serviceType: acase.serviceType,
        previousStatus,
        newStatus: normalized,
        reviewerUserId: input.actor.userId,
        reviewerRole: input.actor.role,
        effectiveClinicalDate: input.effectiveClinicalDate ?? null,
        rationale: input.rationale ?? null,
        evidenceSnapshot: evidenceSnapshot as unknown as never,
        source: input.source,
      })
      .returning();
    await tx
      .update(patientAncillaryCases)
      .set({ adminReviewStatus: normalized, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(patientAncillaryCases.id, acase.id));
    return event;
  });

  // Screening compatibility projection — computed from the CURRENT
  // set of active ancillary cases for the screening, using the new
  // projection helper. Skip when the case is not tied to a screening.
  let screeningProjection: AncillaryReviewStatus = normalized;
  const screeningId = acase.originatingScreeningId ?? null;
  if (screeningId != null) {
    const activeCases = await listAncillaryCasesForScreening(screeningId);
    const activeStatuses: AncillaryReviewStatus[] = activeCases
      .filter((c) =>
        c.lifecycleStatus === "new" ||
        c.lifecycleStatus === "active" ||
        c.lifecycleStatus === "on_hold",
      )
      .map((c) => (c.adminReviewStatus as AncillaryReviewStatus) ?? "pending");
    screeningProjection = projectScreeningStatusFromAncillaryStatuses(activeStatuses);
    // Apply to the screening column (compatibility only).
    await db
      .update(patientScreenings)
      .set({ adminApprovalStatus: screeningProjection })
      .where(eq(patientScreenings.id, screeningId));
  }

  // Non-PHI journey events. Both created (initial) and statusChanged
  // (subsequent) are emitted here — the difference is whether
  // previousStatus was null.
  await appendJourneyEvent({
    eventType:
      previousStatus === null
        ? ADMIN_REVIEW_JOURNEY_EVENT_TYPES.created
        : ADMIN_REVIEW_JOURNEY_EVENT_TYPES.statusChanged,
    patientScreeningId: screeningId,
    ancillaryCaseId: acase.id,
    metadata: {
      ancillary_case_id: acase.id,
      service_type: acase.serviceType,
      clinic_id: acase.clinicId,
      previous_status: previousStatus,
      new_status: normalized,
      reviewer_user_id: input.actor.userId,
      reviewer_role: input.actor.role,
      event_id: written.id,
      source: input.source,
      // Rationale intentionally stays in the protected review event
      // table; not stored in generic journey metadata.
    },
    summary: `Admin Review ${previousStatus ?? "(new)"} → ${normalized} (${acase.serviceType})`,
    source: input.source,
    actorUserId: input.actor.userId,
  });

  // Fire the Engagement eligibility reconciler (idempotent + failure-
  // durable inside). Capture the outcome so the caller can return an
  // accurate HTTP status (200 / 202 / 503).
  let engagementOutcome: EngagementOutcomeCode = "no_change";
  let engagementErrorCode: string | undefined;
  let retryPending = false;
  try {
    const { reconcileEngagementEligibility } = await import(
      "../engagementLists/reconciliation"
    );
    const rec = await reconcileEngagementEligibility({
      clinicId: acase.clinicId,
      patientScreeningId: acase.originatingScreeningId ?? null,
      ancillaryCaseId: acase.id,
      serviceType: acase.serviceType,
      previousAdminReviewStatus: previousStatus,
      newAdminReviewStatus: normalized,
      changedByUserId: input.actor.userId,
      source: "admin_review",
    });
    engagementOutcome = rec.status as EngagementOutcomeCode;
    retryPending = rec.status === "deferred_no_list";
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "error",
      source: "admin_review",
      kind: "engagement_reconciler_threw",
      ancillary_case_id: acase.id,
      code: (e as { code?: string })?.code,
      message: (e as Error)?.message ?? String(e),
    }));
    engagementOutcome = "failed";
    engagementErrorCode = (e as { code?: string })?.code ?? "unknown";
    // Best-effort durable-record.
    try {
      const { recordEngagementReconciliationFailure } = await import(
        "../../repositories/engagementLists.repo"
      );
      await recordEngagementReconciliationFailure({
        clinicId: acase.clinicId,
        patientScreeningId: acase.originatingScreeningId ?? null,
        ancillaryCaseId: acase.id,
        serviceType: acase.serviceType,
        requestedAction:
          normalized === "approved" ? "activate" : "deactivate",
        previousAdminReviewStatus: previousStatus,
        newAdminReviewStatus: normalized,
        sourceSystem: "admin_review",
        errorCode: engagementErrorCode,
      });
      retryPending = true;
    } catch { /* migration/flag guards already handled */ }
  }

  // Phase 2E-B — one side of the two-condition Order Note eligibility
  // boundary. After an APPROVED review commits, attempt canonical Order Note
  // create/reuse. Eligibility (approval AND a qualifying appointment) is
  // decided inside the Order Note service; a missing appointment yields
  // not_yet_eligible. NEVER throws — a hook failure records durable retry and
  // must never reverse the already-committed Admin Review transaction.
  if (normalized === "approved" && featureFlags.canonicalOrderNote) {
    try {
      const { ensureCanonicalOrderNoteForAncillaryCase } = await import(
        "../ancillaryDocuments/orderNoteOrchestration"
      );
      const hook = await ensureCanonicalOrderNoteForAncillaryCase({
        clinicId: acase.clinicId,
        ancillaryCaseId: acase.id,
        actorUserId: input.actor.userId,
        source: "admin_review",
      });
      if (hook.status === "failed" || hook.status === "reconciliation_not_recorded" || hook.status === "migration_missing") {
        // eslint-disable-next-line no-console
        console.error(JSON.stringify({
          level: "warn", source: "admin_review", kind: "order_note_hook",
          status: hook.status, ancillary_case_id: acase.id,
        }));
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        level: "error", source: "admin_review", kind: "order_note_hook_threw",
        ancillary_case_id: acase.id, code: (e as { code?: string })?.code ?? "unknown",
      }));
    }
  }

  return {
    status: "recorded",
    ancillaryCaseId: acase.id,
    serviceType: acase.serviceType,
    previousStatus,
    newStatus: normalized,
    eventId: written.id,
    patientScreeningId: screeningId,
    screeningProjection,
    engagementOutcome,
    engagementErrorCode,
    retryPending,
  };
}

// Re-export for the tests that assert the projection helper is used
// by the recorder.
export { projectScreeningStatusFromAncillaryStatuses } from "./screeningProjection";
export { getLatestAdminReviewEventsForCases };
