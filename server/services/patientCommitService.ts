import { storage } from "../storage";
import {
  COMMIT_RECALL_WINDOW_MS,
  type CommitStatus,
  type PatientScreening,
} from "@shared/schema";
import { resolveSchedulerForClinic } from "../../shared/platformSettings";

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
