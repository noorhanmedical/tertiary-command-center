import { db } from "../db";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import {
  COMMIT_RECALL_WINDOW_MS,
  type CommitStatus,
  type PatientScreening,
} from "@shared/schema";
import { patientExecutionCases, type PatientExecutionCase } from "@shared/schema/executionCase";
import { resolveSchedulerForClinic } from "../../shared/platformSettings";
import {
  createOrUpdateExecutionCaseFromScreening,
  appendPatientJourneyEvent,
} from "../repositories/executionCase.repo";
import { createGlobalScheduleEventFromScreeningCommit } from "../repositories/globalSchedule.repo";
import { createOrUpdateInsuranceEligibilityReviewFromScreening } from "../repositories/insuranceEligibility.repo";
import { createOrUpdateCooldownRecordsFromScreening } from "../repositories/cooldown.repo";

export type CommitOutcome = {
  patient: PatientScreening;
  schedulerName: string | null;
};

export type CommitError =
  | { code: "not_found" }
  | { code: "validation"; missing: string[] }
  | { code: "already_committed" };

export type RecallError =
  | { code: "not_found" }
  | { code: "not_committed" }
  | { code: "window_elapsed" }
  | { code: "locked"; status: CommitStatus };

function missingRequiredFields(p: PatientScreening): string[] {
  const missing: string[] = [];
  if (!p.name?.trim()) missing.push("name");
  if (!p.dob?.trim()) missing.push("dob");
  if (!p.phoneNumber?.trim()) missing.push("phone");
  return missing;
}

async function resolveSchedulerName(p: PatientScreening): Promise<string | null> {
  const batch = await storage.getScreeningBatch(p.batchId);

  if (batch?.assignedSchedulerId != null) {
    const schedulers = await storage.getOutreachSchedulers();
    const assigned = schedulers.find((s) => s.id === batch.assignedSchedulerId) ?? null;
    if (assigned?.name) return assigned.name;
  }

  const facility = p.facility ?? batch?.facility ?? null;
  return resolveSchedulerForClinic(facility)?.name ?? null;
}

/**
 * Mark a patient as committed (Draft → Ready). Idempotent for already-committed
 * patients in the sense that re-running on Ready/WithScheduler/Scheduled is a
 * no-op success rather than an overwrite — we never downgrade state.
 */
export async function commitPatient(
  patientId: number,
  userId: string | null,
  options: { auto: boolean },
): Promise<{ ok: true; data: CommitOutcome } | { ok: false; error: CommitError }> {
  const patient = await storage.getPatientScreening(patientId);
  if (!patient) return { ok: false, error: { code: "not_found" } };

  if (patient.commitStatus !== "Draft") {
    // Already committed — return current state with scheduler so callers
    // (e.g. analyze auto-commit) don't error and the UI can refresh.
    return {
      ok: true,
      data: { patient, schedulerName: await resolveSchedulerName(patient) },
    };
  }

  // Manual commits enforce the contact-info gate; auto-commits from AI
  // analyze skip it because analysis itself is the qualifying signal and
  // schedulers can dial information later.
  if (!options.auto) {
    const missing = missingRequiredFields(patient);
    if (missing.length > 0) {
      return { ok: false, error: { code: "validation", missing } };
    }
  }

  const updated = await storage.updatePatientScreening(patientId, {
    commitStatus: "Ready",
    committedAt: new Date(),
    committedByUserId: userId,
  });

  if (!updated) return { ok: false, error: { code: "not_found" } };

  // Wire execution case + global schedule spine — fire-and-forget so a failure never breaks the commit
  void (async () => {
    try {
      const { executionCase, created } = await createOrUpdateExecutionCaseFromScreening(updated, userId);

      // Fetch batch to get scheduleDate for appointment datetime parsing
      const batch = await storage.getScreeningBatch(updated.batchId);
      const batchScheduleDate = batch?.scheduleDate ?? null;

      // Global schedule event — only when a usable appointment datetime exists
      const scheduleResult = await createGlobalScheduleEventFromScreeningCommit(
        updated,
        executionCase.id,
        batchScheduleDate,
        { auto: options.auto, actorUserId: userId },
      );

      // Insurance eligibility review — always created/updated from commit
      const eligibilityResult = await createOrUpdateInsuranceEligibilityReviewFromScreening(
        updated,
        executionCase.id,
      );

      // Cooldown records — one per qualifying service
      const cooldownResults = await createOrUpdateCooldownRecordsFromScreening(
        updated,
        executionCase.id,
      );

      await appendPatientJourneyEvent({
        patientName: updated.name,
        patientDob: updated.dob ?? undefined,
        patientScreeningId: updated.id,
        executionCaseId: executionCase.id,
        eventType: "screening_committed",
        eventSource: options.auto ? "auto_commit" : "manual_commit",
        actorUserId: userId ?? undefined,
        summary: `Screening committed (${options.auto ? "auto" : "manual"}); execution case ${created ? "created" : "updated"}`,
        metadata: {
          commitStatus: "Ready",
          auto: options.auto,
          // Bucket routing signals — make engagement bucket assignment
          // observable in the journey. patientType is the source signal
          // deriveEngagementBucket reads to choose the bucket.
          engagementBucket: executionCase.engagementBucket,
          patientType: updated.patientType ?? null,
          executionCaseSource: executionCase.source,
          globalScheduleEventId: scheduleResult?.event.id ?? null,
          globalScheduleCreated: scheduleResult?.created ?? null,
          noScheduleEventReason: scheduleResult === null ? "missing_appointment_datetime" : null,
          insuranceEligibilityReviewId: eligibilityResult.review.id,
          insuranceEligibilityCreated: eligibilityResult.created,
          eligibilityStatus: eligibilityResult.review.eligibilityStatus,
          approvalStatus: eligibilityResult.review.approvalStatus,
          priorityClass: eligibilityResult.review.priorityClass,
          cooldownRecordIds: cooldownResults.map((r) => r.id),
          cooldownRecordCount: cooldownResults.length,
        },
      });
      await appendPatientJourneyEvent({
        patientName: updated.name,
        patientDob: updated.dob ?? undefined,
        patientScreeningId: updated.id,
        executionCaseId: executionCase.id,
        eventType: created ? "execution_case_created" : "execution_case_updated",
        eventSource: "screening_commit_hook",
        actorUserId: userId ?? undefined,
        summary: created
          ? `Execution case created from screening commit`
          : `Execution case updated from screening commit`,
        metadata: { executionCaseId: executionCase.id },
      });
    } catch (err) {
      console.error("[patientCommitService] execution case spine failed:", err);
    }
  })();

  return {
    ok: true,
    data: { patient: updated, schedulerName: await resolveSchedulerName(updated) },
  };
}

export async function recallPatient(
  patientId: number,
): Promise<{ ok: true; data: PatientScreening } | { ok: false; error: RecallError }> {
  const patient = await storage.getPatientScreening(patientId);
  if (!patient) return { ok: false, error: { code: "not_found" } };

  if (patient.commitStatus === "Draft") {
    return { ok: false, error: { code: "not_committed" } };
  }

  if (patient.commitStatus !== "Ready") {
    // Once a scheduler has touched the patient or booked an appointment,
    // recall is locked — would erase scheduler work.
    return {
      ok: false,
      error: { code: "locked", status: patient.commitStatus as CommitStatus },
    };
  }

  const committedAtMs = patient.committedAt ? new Date(patient.committedAt).getTime() : 0;
  if (!committedAtMs || Date.now() - committedAtMs > COMMIT_RECALL_WINDOW_MS) {
    return { ok: false, error: { code: "window_elapsed" } };
  }

  const updated = await storage.updatePatientScreening(patientId, {
    commitStatus: "Draft",
    committedAt: null,
    committedByUserId: null,
  });

  if (!updated) return { ok: false, error: { code: "not_found" } };
  return { ok: true, data: updated };
}

// ─── ensureCanonicalSpineForScreening ──────────────────────────────────────
//
// Idempotent canonical spine setup keyed by patientScreeningId. Designed for
// flows that flip a screening to commit_status Ready/Scheduled or
// appointment_status scheduled WITHOUT going through commitPatient (e.g. the
// Visit Schedule appointment booking and the outreach call atomic write).
//
// Skip rules:
//   - Screening not found → skipped: "screening_not_found"
//   - Blank patient name → skipped: "blank_name"
//   - commitStatus = Draft → skipped: "draft_not_committed"
//
// Writes (all idempotent — repo helpers dedup by patientScreeningId):
//   1. patient_execution_cases   via createOrUpdateExecutionCaseFromScreening
//   2. engagement_status update  derived from appointment_status (no downgrade
//                                of completed/closed)
//   3. global_schedule_events    doctor_visit row when patient_type=visit AND
//                                batch.scheduleDate is set (defaults time to
//                                10:00 AM when screening.time is null)

export type EnsureCanonicalSpineResult =
  | { skipped: "screening_not_found" | "blank_name" | "draft_not_committed" }
  | {
      executionCase: PatientExecutionCase;
      executionCaseCreated: boolean;
      scheduleEventId: number | null;
      scheduleEventCreated: boolean;
      engagementStatusUpdated: boolean;
    };

const ENGAGEMENT_NEVER_DOWNGRADE = new Set(["completed", "closed"]);

function deriveEngagementStatusFromAppointment(appointmentStatus: string | null | undefined): string {
  const aps = (appointmentStatus ?? "").toLowerCase().trim();
  if (aps === "scheduled" || aps === "completed") return "scheduled";
  if (aps === "callback" || aps === "rescheduled" || aps === "reschedule_needed") return "in_progress";
  return "new";
}

export async function ensureCanonicalSpineForScreening(
  patientScreeningId: number,
  opts: { actorUserId?: string | null; auto?: boolean } = {},
): Promise<EnsureCanonicalSpineResult> {
  const screening = await storage.getPatientScreening(patientScreeningId);
  if (!screening) return { skipped: "screening_not_found" };
  if (!screening.name?.trim()) return { skipped: "blank_name" };
  if (screening.commitStatus === "Draft") return { skipped: "draft_not_committed" };

  const batch = await storage.getScreeningBatch(screening.batchId);

  // 1. Upsert execution case (idempotent by patient_screening_id)
  const { executionCase, created: ecCreated } =
    await createOrUpdateExecutionCaseFromScreening(screening, opts.actorUserId ?? null);

  // 2. Update engagement_status to match the screening's appointment_status,
  //    but never downgrade a case that has already reached a terminal state.
  const desiredStatus = deriveEngagementStatusFromAppointment(screening.appointmentStatus);
  let updatedExecutionCase: PatientExecutionCase = executionCase;
  let engagementStatusUpdated = false;
  if (
    !ENGAGEMENT_NEVER_DOWNGRADE.has(executionCase.engagementStatus) &&
    executionCase.engagementStatus !== desiredStatus
  ) {
    const [row] = await db
      .update(patientExecutionCases)
      .set({ engagementStatus: desiredStatus, updatedAt: new Date() })
      .where(eq(patientExecutionCases.id, executionCase.id))
      .returning();
    if (row) {
      updatedExecutionCase = row;
      engagementStatusUpdated = true;
    }
  }

  // 3. Doctor_visit global_schedule_event for visit patients with a
  //    batch.scheduleDate. Falls back to 10:00 AM when the screening row
  //    does not carry an explicit time.
  let scheduleEventId: number | null = null;
  let scheduleEventCreated = false;
  const isVisit = (screening.patientType ?? "visit").toLowerCase() === "visit";
  if (isVisit && batch?.scheduleDate) {
    const screeningWithDefaultedTime: PatientScreening = {
      ...screening,
      time: screening.time ?? "10:00 AM",
    };
    const result = await createGlobalScheduleEventFromScreeningCommit(
      screeningWithDefaultedTime,
      updatedExecutionCase.id,
      batch.scheduleDate,
      { auto: opts.auto ?? true, actorUserId: opts.actorUserId ?? null },
    );
    if (result) {
      scheduleEventId = result.event.id;
      scheduleEventCreated = result.created;
    }
  }

  // 4. Journey event only for newly-created spine rows so re-runs don't
  //    spam the timeline. Best-effort; never throws.
  if (ecCreated || scheduleEventCreated) {
    try {
      await appendPatientJourneyEvent({
        patientName: updatedExecutionCase.patientName,
        patientDob: updatedExecutionCase.patientDob ?? undefined,
        patientScreeningId: screening.id,
        executionCaseId: updatedExecutionCase.id,
        eventType: ecCreated ? "execution_case_created" : "execution_case_updated",
        eventSource: "ensure_canonical_spine",
        actorUserId: opts.actorUserId ?? undefined,
        summary: ecCreated
          ? "Execution case created from canonical spine ensure hook"
          : "Doctor visit schedule event created from canonical spine ensure hook",
        metadata: {
          executionCaseId: updatedExecutionCase.id,
          executionCaseCreated: ecCreated,
          engagementBucket: updatedExecutionCase.engagementBucket,
          engagementStatus: updatedExecutionCase.engagementStatus,
          appointmentStatus: screening.appointmentStatus ?? null,
          scheduleEventId,
          scheduleEventCreated,
          source: "ensure_canonical_spine",
          auto: opts.auto ?? true,
        },
      });
    } catch (err: any) {
      console.error("[ensureCanonicalSpineForScreening] journey append failed (non-fatal):", err.message);
    }
  }

  return {
    executionCase: updatedExecutionCase,
    executionCaseCreated: ecCreated,
    scheduleEventId,
    scheduleEventCreated,
    engagementStatusUpdated,
  };
}
