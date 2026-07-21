/**
 * Phase 2B — canonical ancillary-case reconciliation service.
 *
 * Every service-add path (execution-case sync, admin add-ancillary,
 * backfill, admin repair CLI) funnels through this single entry point.
 * Route/service layers must not duplicate the resolver logic.
 *
 * Behavior contract:
 *
 *   FEATURE_ANCILLARY_CASE_WRITE = OFF (default):
 *     • Returns { status: "skipped_flag_off" } immediately.
 *     • Zero DB reads. Zero DB writes.
 *     • Ingestion behavior byte-identical to pre-Phase-2B.
 *
 *   FEATURE_ANCILLARY_CASE_WRITE = ON:
 *     • Validates tenant + identity integrity.
 *     • Refuses cross-clinic linkage, membership/global mismatch,
 *       screening/clinic mismatch, execution-case/clinic mismatch.
 *     • Reuses the (unique) active case if one exists.
 *     • Otherwise computes MAX(episode_sequence)+1 and inserts.
 *     • Race handling: the DB's partial-unique-index does the final
 *       check; conflict → re-read active row.
 *     • Emits non-PHI journey events for created / reused /
 *       status-changed / reconciliation-failed outcomes.
 *
 * Never fire-and-forget. Never .catch(() => {}). Never returns
 * "linked/success" when a failure actually happened.
 */

import { db } from "../../db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { patientAncillaryCases, ANCILLARY_ACTIVE_LIFECYCLE_STATUSES, ANCILLARY_JOURNEY_EVENT_TYPES, type AncillaryLifecycleStatus, type AncillaryQualificationStatus, type AncillaryAdminReviewStatus, type PatientAncillaryCase } from "@shared/schema/ancillaryCases";
import { patientJourneyEvents } from "@shared/schema/executionCase";
import { featureFlags } from "../../lib/featureFlags";
import { checkAncillaryCaseIntegrity, type IntegrityFailureReason } from "./integrityValidator";
import { computeNextEpisodeSequence, createAncillaryCase, findActiveAncillaryCase } from "../../repositories/ancillaryCases.repo";

export type ReconcileInput = {
  clinicId: number;
  globalPlexusPatientId: number;
  patientClinicMembershipId: number;
  originatingScreeningId?: number | null;
  executionCaseId?: number | null;
  serviceType: string;
  qualificationStatus?: AncillaryQualificationStatus;
  adminReviewStatus?: AncillaryAdminReviewStatus;
  source: string;
  actorUserId?: string | null;
};

export type ReconcileResult =
  | { status: "skipped_flag_off" }
  | {
      status: "missing_identity_links";
      serviceType: string;
      details: {
        hasGlobalPatientId: boolean;
        hasMembershipId: boolean;
      };
    }
  | { status: "integrity_failure"; serviceType: string; reason: IntegrityFailureReason }
  | {
      status: "reused";
      serviceType: string;
      ancillaryCaseId: number;
      episodeSequence: number;
    }
  | {
      status: "created";
      serviceType: string;
      ancillaryCaseId: number;
      episodeSequence: number;
      isNewEpisode: boolean;
    };

// The existing `patient_journey_events` table declares `patient_name`
// as NOT NULL. All new Phase 2B events use this sentinel — the real
// patient name is NEVER stored on ancillary-case journey events. The
// existing PHI-column requirement of the shared table is satisfied by
// a stable, non-identifying string. Stable IDs remain in metadata.
export const ANCILLARY_AUDIT_SENTINEL_NAME = "[ancillary_case_audit]";

async function appendAncillaryJourneyEvent(args: {
  eventType: string;
  input: ReconcileInput;
  ancillaryCaseId: number | null;
  metadata: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  try {
    await db.insert(patientJourneyEvents).values({
      // Non-PHI sentinel — see ANCILLARY_AUDIT_SENTINEL_NAME. Never
      // the real patient name.
      patientName: ANCILLARY_AUDIT_SENTINEL_NAME,
      // NEVER store DOB on ancillary-case events.
      patientDob: null,
      patientScreeningId: args.input.originatingScreeningId ?? null,
      executionCaseId: args.input.executionCaseId ?? null,
      eventType: args.eventType,
      eventSource: args.input.source,
      actorUserId: args.input.actorUserId ?? null,
      summary: args.summary,
      metadata: {
        ancillary_case_id: args.ancillaryCaseId,
        service_type: args.input.serviceType,
        clinic_id: args.input.clinicId,
        global_plexus_patient_id: args.input.globalPlexusPatientId,
        patient_clinic_membership_id: args.input.patientClinicMembershipId,
        ...args.metadata,
      },
    });
  } catch (e) {
    // Never crash the reconciliation on an audit failure. Log
    // structured non-PHI and continue — the reconciliation outcome
    // is what matters.
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "warn",
      source: "ancillary_case_reconciliation",
      kind: "journey_event_write_failed",
      eventType: args.eventType,
      ancillaryCaseId: args.ancillaryCaseId,
      code: (e as { code?: string })?.code,
      message: (e as Error)?.message ?? String(e),
    }));
  }
}

/**
 * The one reconciliation entry point. Idempotent within a single
 * (patient, clinic, service) — repeated calls return { status:
 * "reused" } for the same active row.
 */
export async function reconcileAncillaryCaseForService(
  input: ReconcileInput,
): Promise<ReconcileResult> {
  if (!featureFlags.ancillaryCaseWrite) {
    return { status: "skipped_flag_off" };
  }
  if (!input.globalPlexusPatientId || !input.patientClinicMembershipId) {
    // Phase 2A hasn't been backfilled / this screening lacks identity
    // links. Refuse to fabricate. Emit a non-PHI failure audit event
    // so ops can observe how many rows are held back on this reason.
    await appendAncillaryJourneyEvent({
      eventType: ANCILLARY_JOURNEY_EVENT_TYPES.reconciliationFailed,
      input,
      ancillaryCaseId: null,
      metadata: {
        error_code: "MISSING_IDENTITY_LINKS",
        has_global_patient_id: Boolean(input.globalPlexusPatientId),
        has_membership_id: Boolean(input.patientClinicMembershipId),
      },
      summary: "Ancillary reconciliation skipped: Phase 2A identity links missing",
    });
    return {
      status: "missing_identity_links",
      serviceType: input.serviceType,
      details: {
        hasGlobalPatientId: Boolean(input.globalPlexusPatientId),
        hasMembershipId: Boolean(input.patientClinicMembershipId),
      },
    };
  }

  const integrity = await checkAncillaryCaseIntegrity({
    clinicId: input.clinicId,
    globalPlexusPatientId: input.globalPlexusPatientId,
    patientClinicMembershipId: input.patientClinicMembershipId,
    originatingScreeningId: input.originatingScreeningId ?? null,
    executionCaseId: input.executionCaseId ?? null,
  });
  if (!integrity.ok) {
    await appendAncillaryJourneyEvent({
      eventType: ANCILLARY_JOURNEY_EVENT_TYPES.reconciliationFailed,
      input,
      ancillaryCaseId: null,
      metadata: { error_code: "INTEGRITY_FAILURE", reason: integrity.reason },
      summary: `Ancillary reconciliation refused: ${integrity.reason}`,
    });
    return { status: "integrity_failure", serviceType: input.serviceType, reason: integrity.reason };
  }

  // Reuse-first path.
  const existing = await findActiveAncillaryCase({
    globalPlexusPatientId: input.globalPlexusPatientId,
    clinicId: input.clinicId,
    serviceType: input.serviceType,
  });
  if (existing) {
    await appendAncillaryJourneyEvent({
      eventType: ANCILLARY_JOURNEY_EVENT_TYPES.reused,
      input,
      ancillaryCaseId: existing.id,
      metadata: {
        episode_sequence: existing.episodeSequence,
        lifecycle_status: existing.lifecycleStatus,
      },
      summary: `Reused active ancillary case (${input.serviceType})`,
    });
    return {
      status: "reused",
      serviceType: input.serviceType,
      ancillaryCaseId: existing.id,
      episodeSequence: existing.episodeSequence,
    };
  }

  // No active row → compute next episode + insert. Wrapped in a
  // transaction so a concurrent insert doesn't skip the sequence.
  // The partial-unique-index is the last-line defence for a real
  // race; createAncillaryCase's conflict handler re-reads.
  const created = await db.transaction(async () => {
    const nextSeq = await computeNextEpisodeSequence({
      globalPlexusPatientId: input.globalPlexusPatientId,
      clinicId: input.clinicId,
      serviceType: input.serviceType,
    });
    return createAncillaryCase({
      globalPlexusPatientId: input.globalPlexusPatientId,
      patientClinicMembershipId: input.patientClinicMembershipId,
      clinicId: input.clinicId,
      originatingScreeningId: input.originatingScreeningId ?? null,
      executionCaseId: input.executionCaseId ?? null,
      serviceType: input.serviceType,
      episodeSequence: nextSeq,
      lifecycleStatus: "new",
      qualificationStatus: input.qualificationStatus,
      adminReviewStatus: input.adminReviewStatus,
    });
  });

  if (created.created) {
    // A brand-new row. Emit both "created" and — when episodeSequence
    // > 1 — the "episode_repeated" event so the analytics layer can
    // distinguish first-time work from a re-episode.
    await appendAncillaryJourneyEvent({
      eventType: ANCILLARY_JOURNEY_EVENT_TYPES.created,
      input,
      ancillaryCaseId: created.row.id,
      metadata: {
        episode_sequence: created.row.episodeSequence,
        lifecycle_status: created.row.lifecycleStatus,
      },
      summary: `Ancillary case created (${input.serviceType})`,
    });
    if (created.row.episodeSequence > 1) {
      await appendAncillaryJourneyEvent({
        eventType: ANCILLARY_JOURNEY_EVENT_TYPES.episodeRepeated,
        input,
        ancillaryCaseId: created.row.id,
        metadata: { episode_sequence: created.row.episodeSequence },
        summary: `Ancillary re-episode (${input.serviceType}, #${created.row.episodeSequence})`,
      });
    }
    return {
      status: "created",
      serviceType: input.serviceType,
      ancillaryCaseId: created.row.id,
      episodeSequence: created.row.episodeSequence,
      isNewEpisode: created.row.episodeSequence > 1,
    };
  }

  // Lost the race — same-as-reused semantics for the caller.
  await appendAncillaryJourneyEvent({
    eventType: ANCILLARY_JOURNEY_EVENT_TYPES.reused,
    input,
    ancillaryCaseId: created.conflict.id,
    metadata: {
      episode_sequence: created.conflict.episodeSequence,
      lifecycle_status: created.conflict.lifecycleStatus,
      race_conflict: true,
    },
    summary: `Reused active ancillary case (race conflict, ${input.serviceType})`,
  });
  return {
    status: "reused",
    serviceType: input.serviceType,
    ancillaryCaseId: created.conflict.id,
    episodeSequence: created.conflict.episodeSequence,
  };
}

/**
 * Bulk variant. Serial to keep per-row failures observable (a
 * Promise.all would race and mask origin). Fast-paths flag OFF with a
 * single check.
 */
export async function reconcileAncillaryCasesBulk(
  inputs: ReconcileInput[],
): Promise<{ ok: ReconcileResult[]; errors: Array<{ serviceType: string; code: string | undefined; message: string }> }> {
  const ok: ReconcileResult[] = [];
  const errors: Array<{ serviceType: string; code: string | undefined; message: string }> = [];
  if (!featureFlags.ancillaryCaseWrite) {
    for (const _ of inputs) ok.push({ status: "skipped_flag_off" });
    return { ok, errors };
  }
  for (const inp of inputs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      ok.push(await reconcileAncillaryCaseForService(inp));
    } catch (e) {
      errors.push({
        serviceType: inp.serviceType,
        code: (e as { code?: string })?.code,
        message: (e as Error)?.message ?? String(e),
      });
    }
  }
  return { ok, errors };
}

/**
 * Projection helper: derive the selectedServices[] array a caller
 * would surface to the UI from the current set of active ancillary
 * cases for a patient + clinic. Used both by the readers that used to
 * consume execution_case.selected_services and by the sync step in
 * createOrUpdateExecutionCaseFromScreening.
 */
export async function projectSelectedServicesFromAncillaryCases(args: {
  globalPlexusPatientId: number;
  clinicId: number;
}): Promise<string[]> {
  if (!featureFlags.ancillaryCaseWrite) return [];
  const rows = await db
    .select({ serviceType: patientAncillaryCases.serviceType })
    .from(patientAncillaryCases)
    .where(
      and(
        eq(patientAncillaryCases.globalPlexusPatientId, args.globalPlexusPatientId),
        eq(patientAncillaryCases.clinicId, args.clinicId),
        inArray(
          patientAncillaryCases.lifecycleStatus,
          ANCILLARY_ACTIVE_LIFECYCLE_STATUSES as unknown as string[],
        ),
      ),
    );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (!seen.has(r.serviceType)) {
      seen.add(r.serviceType);
      out.push(r.serviceType);
    }
  }
  return out;
}

/**
 * Conservative service-removal helper. Called when a service is
 * dropped from qualifyingTests / selectedServices. Never hard-deletes.
 *
 * Default action:  place the active case on_hold and emit
 *                  status_changed. This preserves originating screening,
 *                  execution case linkage, and audit history.
 *
 * The caller may opt in to a stronger transition (cancelled /
 * archived) when they have positive proof there is no downstream
 * work — Phase 2B does NOT compute that itself (Phase 2D adds the
 * appointment + document linkage that would enable it).
 */
export async function conservativelyRemoveAncillaryService(args: {
  clinicId: number;
  globalPlexusPatientId: number;
  serviceType: string;
  action?: "on_hold" | "cancelled" | "archived";
  actorUserId?: string | null;
  source: string;
}): Promise<
  | { status: "skipped_flag_off" }
  | { status: "no_active_case"; serviceType: string }
  | {
      status: "status_changed";
      serviceType: string;
      ancillaryCaseId: number;
      newStatus: AncillaryLifecycleStatus;
    }
> {
  if (!featureFlags.ancillaryCaseWrite) return { status: "skipped_flag_off" };

  const active = await findActiveAncillaryCase({
    globalPlexusPatientId: args.globalPlexusPatientId,
    clinicId: args.clinicId,
    serviceType: args.serviceType,
  });
  if (!active) return { status: "no_active_case", serviceType: args.serviceType };

  const nextStatus: AncillaryLifecycleStatus = args.action ?? "on_hold";
  const now = new Date();
  const values: Record<string, unknown> = {
    lifecycleStatus: nextStatus,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  };
  if (nextStatus === "cancelled" || nextStatus === "archived") {
    values.closedAt = now;
  }

  await db
    .update(patientAncillaryCases)
    .set(values)
    .where(eq(patientAncillaryCases.id, active.id));

  const eventType =
    nextStatus === "cancelled"
      ? ANCILLARY_JOURNEY_EVENT_TYPES.cancelled
      : nextStatus === "archived"
        ? ANCILLARY_JOURNEY_EVENT_TYPES.archived
        : ANCILLARY_JOURNEY_EVENT_TYPES.statusChanged;

  await appendAncillaryJourneyEvent({
    eventType,
    input: {
      clinicId: args.clinicId,
      globalPlexusPatientId: args.globalPlexusPatientId,
      patientClinicMembershipId: active.patientClinicMembershipId,
      originatingScreeningId: active.originatingScreeningId,
      executionCaseId: active.executionCaseId,
      serviceType: args.serviceType,
      source: args.source,
      actorUserId: args.actorUserId ?? null,
    },
    ancillaryCaseId: active.id,
    metadata: {
      previous_lifecycle_status: active.lifecycleStatus,
      new_lifecycle_status: nextStatus,
    },
    summary: `Ancillary case ${nextStatus} (${args.serviceType})`,
  });

  return {
    status: "status_changed",
    serviceType: args.serviceType,
    ancillaryCaseId: active.id,
    newStatus: nextStatus,
  };
}
