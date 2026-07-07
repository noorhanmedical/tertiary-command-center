// Service wrapper for the Admin Review single-ancillary canonical-reasoning
// regenerate handler.
//
// SOURCE (canonical handler at the time of extraction):
//   server/routes/patients.ts lines 498-664, registered as
//   POST /api/patient-screenings/:id/admin-review/regenerate-ancillary.
//
// Behavior contract preserved by this wrapper (see
// docs/architecture/backend-route-parity-inventory.md §1.4):
//   - Validation order:
//       1. patientId NaN check        → invalid_id (route → 400 "Invalid patient id")
//       2. ancillaryId enum check     → invalid_ancillary_id (route → 400 "ancillaryId must be one of brainwave / vitalwave / ultrasound")
//       3. patient lookup             → not_found (route → 404 "Patient not found")
//   - Filtered-test rule: getAncillaryCategory(testName) === ancillaryId
//   - Canonical reasoning merge: spread existing reasoning, overlay
//     ai.reasoningByTest[testName] for each filtered test. Other tests' canonical
//     entries (including other ancillaries) and other adminReview:<a> entries
//     are preserved verbatim.
//   - Supplemental metadata write: reasoning["adminReview:<ancillaryId>"] is
//     rewritten with { ancillaryId, assignedEvidence, ancillaryNote,
//     regeneratedAt: <ISO now>, regeneratedMode: "ancillary" }.
//   - Conditional updates: diagnoses / medications / history are only written
//     when they differ from the patient's current values.
//   - storage.updatePatientScreening called once with the merged payload.
//   - invalidatePatientDatabase() called once after the update.
//   - Success response (route): { ok: true, patient: updated, ancillaryId }.
//   - The dynamic imports for getAncillaryCategory and regenerateCanonicalReasoning
//     remain inside the service so cold-start behavior matches the previous
//     handler.
//   - Under-16 guardrails, ICD-needed behavior, and OpenAI/Anthropic call
//     semantics are delegated unchanged to regenerateCanonicalReasoning.
//
// What this wrapper does NOT change:
//   - No prompt/model changes.
//   - No reasoning-blob schema change.
//   - No PDF data source change.
//   - No new DB columns or migrations.
//   - No audit-log call (the original handler did not log one; preserved).
//   - No patient_journey_event write (the original handler did not write one; preserved).

import type { PatientScreening } from "@shared/schema";
import { storage } from "../../storage";
import { invalidatePatientDatabase } from "../../routes/patientDatabase";
import { dedupeAssignedEvidence } from "@shared/plexus-iq/adminReviewEvidence";

export type AdminReviewAncillaryId = "brainwave" | "vitalwave" | "ultrasound";

export type RegenerateAncillaryFailure =
  | { kind: "invalid_id" }
  | { kind: "invalid_ancillary_id" }
  | { kind: "not_found" };

export type RegenerateAncillaryOutcome =
  | { ok: true; patient: PatientScreening | undefined; ancillaryId: AdminReviewAncillaryId }
  | { ok: false; error: RegenerateAncillaryFailure };

/**
 * Regenerate the canonical reasoning for every qualifying test that belongs
 * to a single ancillary, plus the supplemental adminReview:<ancillaryId>
 * metadata. Mirrors the previous inline handler in
 * server/routes/patients.ts step-for-step. The caller (the route) is
 * responsible only for parsing `:id` and mapping the discriminated-union
 * failure to the same HTTP envelope it has always returned.
 */
export async function regenerateAdminReviewAncillary(
  patientId: number,
  body: Record<string, unknown> | undefined | null,
): Promise<RegenerateAncillaryOutcome> {
  if (Number.isNaN(patientId)) {
    return { ok: false, error: { kind: "invalid_id" } };
  }
  const b = (body ?? {}) as Record<string, any>;
  const ancillaryIdRaw = String(b.ancillaryId ?? "");
  if (
    ancillaryIdRaw !== "brainwave" &&
    ancillaryIdRaw !== "vitalwave" &&
    ancillaryIdRaw !== "ultrasound"
  ) {
    return { ok: false, error: { kind: "invalid_ancillary_id" } };
  }
  const ancillaryId: AdminReviewAncillaryId = ancillaryIdRaw;

  const patient = await storage.getPatientScreening(patientId);
  if (!patient) {
    return { ok: false, error: { kind: "not_found" } };
  }

  // Server-side dedupe on the persisted assignedEvidence array. Same
  // factor on the same target dedupes; cross-target reuse (e.g. the same
  // ICD on both brainwave and vitalwave) is preserved because dedupe is
  // scoped to this single array.
  const assignedEvidence = dedupeAssignedEvidence(
    Array.isArray(b.assignedEvidence) ? b.assignedEvidence : [],
  );
  const ancillaryNote =
    typeof b.ancillaryNote === "string" ? b.ancillaryNote : "";
  const adminNote =
    typeof b.adminNote === "string" ? b.adminNote : "";
  const icdCodes: Array<{ code: string; label: string }> = Array.isArray(
    b.icdCodes,
  )
    ? b.icdCodes
        .map((c: any) => ({
          code: String(c?.code ?? "").trim(),
          label: String(c?.label ?? "").trim(),
        }))
        .filter((c: { code: string }) => c.code.length > 0)
    : [];
  const updatedDiagnoses =
    typeof b.diagnoses === "string" ? b.diagnoses : patient.diagnoses;
  const updatedMedications =
    typeof b.medications === "string" ? b.medications : patient.medications;
  const updatedHistory =
    typeof b.history === "string" ? b.history : patient.history;

  const { getAncillaryCategory } = await import("@shared/ancillaryCategory");
  const allTests = Array.isArray(patient.qualifyingTests)
    ? patient.qualifyingTests
    : [];
  const filteredTests = allTests.filter(
    (t) => getAncillaryCategory(t) === ancillaryId,
  );

  const { regenerateCanonicalReasoning } = await import(
    "./adminReviewAiRegeneration"
  );

  const priorReasoning =
    patient.reasoning && typeof patient.reasoning === "object" && !Array.isArray(patient.reasoning)
      ? (patient.reasoning as Record<string, any>)
      : {};
  const existingReasoningByTest: Record<string, any> = {};
  for (const t of filteredTests) {
    const e = priorReasoning[t];
    if (e && typeof e === "object" && !Array.isArray(e)) existingReasoningByTest[t] = e;
  }

  const selectedSupportButtonsByTest: Record<string, any[]> = {};
  for (const t of filteredTests) selectedSupportButtonsByTest[t] = assignedEvidence;

  const removedFactorsByTest: Record<string, string[]> = {};
  const removedAncillary = Array.isArray(b.removedFactors) ? b.removedFactors : [];
  if (removedAncillary.length) {
    for (const t of filteredTests) {
      removedFactorsByTest[t] = removedAncillary.map((s: any) => String(s));
    }
  }
  const removedPerTestBody = b.removedFactorsByTest;
  if (removedPerTestBody && typeof removedPerTestBody === "object") {
    for (const [t, arr] of Object.entries(removedPerTestBody)) {
      if (Array.isArray(arr)) {
        removedFactorsByTest[t] = [
          ...(removedFactorsByTest[t] ?? []),
          ...arr.map((s: any) => String(s)),
        ];
      }
    }
  }

  const priorQualifyingFactorsByTest: Record<string, string[]> = {};
  const priorFromBody = b.priorQualifyingFactorsByTest;
  if (priorFromBody && typeof priorFromBody === "object") {
    for (const [t, arr] of Object.entries(priorFromBody)) {
      if (Array.isArray(arr)) priorQualifyingFactorsByTest[t] = arr.map((s: any) => String(s));
    }
  }

  const ai = await regenerateCanonicalReasoning({
    patient: {
      ...patient,
      history: updatedHistory ?? null,
      diagnoses: updatedDiagnoses ?? null,
      medications: updatedMedications ?? null,
    } as typeof patient,
    qualifyingTests: filteredTests,
    assignedEvidenceByAncillary: {
      brainwave: ancillaryId === "brainwave" ? assignedEvidence : [],
      vitalwave: ancillaryId === "vitalwave" ? assignedEvidence : [],
      ultrasound: ancillaryId === "ultrasound" ? assignedEvidence : [],
    },
    ancillaryNotes: {
      brainwave: ancillaryId === "brainwave" ? ancillaryNote : "",
      vitalwave: ancillaryId === "vitalwave" ? ancillaryNote : "",
      ultrasound: ancillaryId === "ultrasound" ? ancillaryNote : "",
    },
    adminNote,
    icdCodes,
    existingReasoningByTest,
    removedFactorsByTest,
    selectedSupportButtonsByTest,
    priorQualifyingFactorsByTest,
  });

  const existingReasoning =
    patient.reasoning &&
    typeof patient.reasoning === "object" &&
    !Array.isArray(patient.reasoning)
      ? { ...(patient.reasoning as Record<string, unknown>) }
      : {};

  // Merge ONLY filtered-test entries. Other tests' canonical entries
  // (including other ancillaries) are preserved verbatim.
  for (const [testName, entry] of Object.entries(ai.reasoningByTest)) {
    existingReasoning[testName] = entry;
  }

  const timestamp = new Date().toISOString();
  existingReasoning[`adminReview:${ancillaryId}`] = {
    ancillaryId,
    assignedEvidence,
    ancillaryNote,
    regeneratedAt: timestamp,
    regeneratedMode: "ancillary",
  };

  const updatePayload: Record<string, unknown> = {
    reasoning: existingReasoning,
  };
  if (updatedDiagnoses !== patient.diagnoses) updatePayload.diagnoses = updatedDiagnoses;
  if (updatedMedications !== patient.medications) updatePayload.medications = updatedMedications;
  if (updatedHistory !== patient.history) updatePayload.history = updatedHistory;

  const updated = await storage.updatePatientScreening(patientId, updatePayload);

  invalidatePatientDatabase();
  return { ok: true, patient: updated, ancillaryId };
}
