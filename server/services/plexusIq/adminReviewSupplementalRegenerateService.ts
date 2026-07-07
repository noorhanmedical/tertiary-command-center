// Service wrapper for the Admin Review supplemental regenerate handler.
//
// SOURCE (canonical handler at the time of extraction):
//   server/routes/patients.ts lines 232-315, registered as
//   POST /api/patient-screenings/:id/admin-review/regenerate.
//
// Scope (CONFIRMED by direct re-read of the source handler):
//   This route writes ONLY the supplemental key
//     reasoning["adminReview:<ancillaryId || 'unknown'>"]
//   The canonical map reasoning[testName] is NOT touched. Every other
//   reasoning key is preserved verbatim via spread.
//
// Behavior contract preserved by this wrapper (see
// docs/architecture/backend-route-parity-inventory.md §1.2):
//   - Validation order:
//       1. patientId NaN check  → invalid_id (route → 400 "Invalid patient id")
//       2. patient lookup       → not_found  (route → 404 "Patient not found")
//   - Storage key: `adminReview:${ancillaryId || "unknown"}` — when the body's
//     ancillaryId is missing or empty the suffix becomes "unknown". Preserved.
//   - Mode normalization: `mode` is normalized to one of
//     "clinician" | "patient" | "all" (default "all"). Preserved.
//   - Mode-based merge from prior:
//       - clinicianReasoning: prior.clinicianReasoning when mode === "patient";
//         else regenerated.clinicianReasoning.
//       - patientExplanation: prior.patientExplanation when mode === "clinician";
//         else regenerated.patientExplanation.
//     Preserved.
//   - ancillaryNote merge: regenerated.ancillaryNote || ancillaryNote. Preserved.
//   - Timestamp: new Date().toISOString() captured at write time.
//   - regeneratedMode = normalizedMode (literal "clinician" | "patient" | "all").
//   - All other reasoning keys (canonical reasoning[testName] entries, sibling
//     adminReview:* entries) preserved by spread.
//   - storage.updatePatientScreening called once with { reasoning: nextReasoning }.
//   - invalidatePatientDatabase() called once after the update.
//   - Success response (route):
//       { ok: true, patient, ancillaryId, clinicianReasoning, patientExplanation }
//     where clinicianReasoning / patientExplanation come from nextEntry (i.e.
//     the post-merge values, NOT the AI's raw return).
//   - The dynamic import of regenerateAdminReviewReasoning remains inside the
//     service so cold-start behavior matches the previous handler.
//
// What this wrapper does NOT change:
//   - No canonical reasoning[testName] write — preserved exactly.
//   - No prompt/model changes.
//   - No reasoning-blob schema change.
//   - No PDF data source change.
//   - No new DB columns, indexes, or migrations.
//   - No audit-log call (the original handler did not log one; preserved).
//   - No patient_journey_event write (the original handler did not write one; preserved).

import type { PatientScreening } from "@shared/schema";
import { storage } from "../../storage";
import { invalidatePatientDatabase } from "../../routes/patientDatabase";
import { dedupeAssignedEvidence } from "@shared/plexus-iq/adminReviewEvidence";

export type AdminReviewSupplementalRegenerateFailure =
  | { kind: "invalid_id" }
  | { kind: "not_found" };

export type AdminReviewSupplementalRegenerateOutcome =
  | {
      ok: true;
      patient: PatientScreening | undefined;
      ancillaryId: string;
      clinicianReasoning: string;
      patientExplanation: string;
    }
  | { ok: false; error: AdminReviewSupplementalRegenerateFailure };

/**
 * Regenerate the supplemental `adminReview:<ancillaryId>` entry for one
 * ancillary's clinician + patient narrative. Does not touch canonical
 * reasoning[testName]. Mirrors the previous inline handler in
 * server/routes/patients.ts step-for-step. The caller (the route) is
 * responsible only for parsing `:id` and mapping the discriminated-union
 * failure to the same HTTP envelope it has always returned.
 */
export async function regenerateAdminReviewSupplemental(
  patientId: number,
  body: Record<string, unknown> | undefined | null,
): Promise<AdminReviewSupplementalRegenerateOutcome> {
  if (Number.isNaN(patientId)) {
    return { ok: false, error: { kind: "invalid_id" } };
  }
  const patient = await storage.getPatientScreening(patientId);
  if (!patient) {
    return { ok: false, error: { kind: "not_found" } };
  }

  const b = (body ?? {}) as Record<string, any>;
  const ancillaryId = String(b.ancillaryId ?? "");
  const mode = String(b.mode ?? "all");
  // Server-side dedupe on the persisted assignedEvidence array.
  const assignedEvidence = dedupeAssignedEvidence(
    Array.isArray(b.assignedEvidence) ? b.assignedEvidence : [],
  );
  const ancillaryNote =
    typeof b.ancillaryNote === "string" ? b.ancillaryNote : "";

  const existingReasoning =
    patient.reasoning &&
    typeof patient.reasoning === "object" &&
    !Array.isArray(patient.reasoning)
      ? { ...(patient.reasoning as Record<string, unknown>) }
      : {};

  const key = `adminReview:${ancillaryId || "unknown"}`;
  const prior = (existingReasoning as Record<string, any>)[key] ?? {};
  const normalizedMode =
    mode === "clinician" || mode === "patient" || mode === "all" ? mode : "all";

  const { regenerateAdminReviewReasoning } = await import(
    "./adminReviewAiRegeneration"
  );

  const regenerated = await regenerateAdminReviewReasoning({
    patient,
    ancillaryId,
    mode: normalizedMode,
    assignedEvidence,
    ancillaryNote,
    previousClinicianReasoning: prior.clinicianReasoning,
    previousPatientExplanation: prior.patientExplanation,
  });

  const timestamp = new Date().toISOString();
  const nextEntry = {
    ancillaryId,
    assignedEvidence,
    ancillaryNote: regenerated.ancillaryNote || ancillaryNote,
    clinicianReasoning:
      normalizedMode === "patient"
        ? prior.clinicianReasoning ?? regenerated.clinicianReasoning
        : regenerated.clinicianReasoning,
    patientExplanation:
      normalizedMode === "clinician"
        ? prior.patientExplanation ?? regenerated.patientExplanation
        : regenerated.patientExplanation,
    regeneratedAt: timestamp,
    regeneratedMode: normalizedMode,
  };

  const nextReasoning = {
    ...existingReasoning,
    [key]: nextEntry,
  };

  const updated = await storage.updatePatientScreening(patientId, {
    reasoning: nextReasoning,
  });

  invalidatePatientDatabase();
  return {
    ok: true,
    patient: updated,
    ancillaryId,
    clinicianReasoning: nextEntry.clinicianReasoning,
    patientExplanation: nextEntry.patientExplanation,
  };
}
