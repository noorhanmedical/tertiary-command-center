// Service wrapper for the Admin Review per-test regenerate handler.
//
// SOURCE (canonical handler at the time of extraction):
//   server/routes/patients.ts lines 743-900, registered as
//   POST /api/patient-screenings/:id/admin-review/regenerate-test.
//
// Scope (CONFIRMED by direct re-read of the source handler):
//   This handler regenerates canonical reasoning for EXACTLY ONE
//   qualifying test. It writes:
//     1. patient.reasoning[testName]            (the one regenerated test)
//     2. patient.reasoning["adminReview:test:<testName>"]
//        with regeneratedMode: "test".
//   It does NOT write:
//     - Any other reasoning[<testName>] entry (preserved by spread).
//     - Any adminReview:<ancillaryId> entry      (those belong to
//       regenerate-all / regenerate-ancillary / regenerate-supplemental).
//     - Any other reasoning key                   (preserved by spread).
//   It optionally updates patient.diagnoses / medications / history
//   when those differ from the patient's current values.
//
// Behavior contract preserved by this wrapper (see
// docs/architecture/backend-route-parity-inventory.md §1.5):
//   - Validation order:
//       1. patientId NaN check      → invalid_id (route → 400 "Invalid patient id")
//       2. testName non-empty check → missing_test_name (route → 400 "testName is required")
//       3. ancillaryId enum check   → invalid_ancillary_id (route → 400
//                                     "ancillaryId must be one of brainwave / vitalwave / ultrasound")
//       4. patient lookup           → not_found (route → 404 "Patient not found")
//       5. testName-in-qualifyingTests → test_not_in_qualifying (route → 400
//                                     `testName "<testName>" is not in patient.qualifyingTests`)
//   - Body coercion (verbatim):
//       - assignedEvidence: Array.isArray fallback to [].
//       - ancillaryNote: typeof string fallback to "".
//       - adminNote: typeof string fallback to "".
//       - icdCodes: Array.isArray map+filter; { code: string, label: string }.
//       - diagnoses/medications/history default to patient values when body
//         field is not a string.
//   - existingReasoningByTest: ONLY { [testName]: priorEntry } when priorEntry
//     is a plain object; otherwise {}.
//   - selectedSupportButtonsByTest: { [testName]: assignedEvidence } — the
//     selected support buttons follow the single test.
//   - removedFactorsByTest: { [testName]: removedArr } when removedArr is
//     non-empty; otherwise {}. (Unlike regenerate-all this route does NOT
//     accept removedFactorsByAncillary — only the flat removedFactors array.)
//   - priorQualifyingFactorsByTest: pulled from body.priorQualifyingFactorsByTest
//     verbatim (per-test map).
//   - AI call: regenerateCanonicalReasoning with:
//       - qualifyingTests: [testName]  (the single-element array signature)
//       - assignedEvidenceByAncillary: only the matching ancillaryId's key
//         carries assignedEvidence; the other two are [].
//       - ancillaryNotes: only the matching ancillaryId's key carries
//         ancillaryNote; the other two are "".
//       - Patient object overrides history/diagnoses/medications with
//         body-derived values (so the AI sees the latest admin edits even
//         before they're persisted).
//   - Reasoning merge:
//       1. Spread existing patient.reasoning into a working object.
//       2. Overlay ai.reasoningByTest[name] for every entry (in practice
//          this is one entry, but the loop matches the original handler).
//       3. Write reasoning["adminReview:test:<testName>"] with
//          { testName, ancillaryId, assignedEvidence, ancillaryNote,
//            regeneratedAt: <ISO now>, regeneratedMode: "test" }.
//   - updatePayload: { reasoning } + conditional diagnoses/medications/history
//     when changed from patient's current value.
//   - storage.updatePatientScreening called once with updatePayload.
//   - invalidatePatientDatabase() called once after the update.
//   - Success response (route):
//       { ok: true, patient: updated, testName, ancillaryId }
//   - The dynamic import of regenerateCanonicalReasoning remains inside the
//     service so cold-start behavior matches the previous handler.
//   - Under-16 guardrails, ICD-needed behavior, qualifying-factors floor
//     merge, and OpenAI/Anthropic call semantics are delegated unchanged to
//     regenerateCanonicalReasoning.
//
// What this wrapper does NOT change:
//   - No scheduler-assignment behavior (this handler doesn't touch it).
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

export type AdminReviewRegenerateTestFailure =
  | { kind: "invalid_id" }
  | { kind: "missing_test_name" }
  | { kind: "invalid_ancillary_id" }
  | { kind: "not_found" }
  | { kind: "test_not_in_qualifying"; testName: string };

export type AdminReviewRegenerateTestOutcome =
  | {
      ok: true;
      patient: PatientScreening | undefined;
      testName: string;
      ancillaryId: "brainwave" | "vitalwave" | "ultrasound";
    }
  | { ok: false; error: AdminReviewRegenerateTestFailure };

/**
 * Per-test canonical regenerate. Writes patient.reasoning[testName] for
 * exactly one qualifying test, and the supplemental
 * reasoning["adminReview:test:<testName>"] metadata. Mirrors the previous
 * inline handler in server/routes/patients.ts step-for-step.
 *
 * The caller (the route) is responsible only for parsing `:id` and mapping
 * the discriminated-union failure to the same HTTP envelope it has always
 * returned. For `test_not_in_qualifying` the route must reproduce the exact
 * message format: `testName "<testName>" is not in patient.qualifyingTests`.
 */
export async function regenerateAdminReviewTest(
  patientId: number,
  body: Record<string, unknown> | undefined | null,
): Promise<AdminReviewRegenerateTestOutcome> {
  if (Number.isNaN(patientId)) {
    return { ok: false, error: { kind: "invalid_id" } };
  }
  const b = (body ?? {}) as Record<string, any>;
  const testName = String(b.testName ?? "").trim();
  if (!testName) {
    return { ok: false, error: { kind: "missing_test_name" } };
  }
  const ancillaryIdRaw = String(b.ancillaryId ?? "");
  if (
    ancillaryIdRaw !== "brainwave" &&
    ancillaryIdRaw !== "vitalwave" &&
    ancillaryIdRaw !== "ultrasound"
  ) {
    return { ok: false, error: { kind: "invalid_ancillary_id" } };
  }
  const ancillaryId: "brainwave" | "vitalwave" | "ultrasound" = ancillaryIdRaw;

  const patient = await storage.getPatientScreening(patientId);
  if (!patient) {
    return { ok: false, error: { kind: "not_found" } };
  }

  const allTests = Array.isArray(patient.qualifyingTests)
    ? patient.qualifyingTests
    : [];
  if (!allTests.includes(testName)) {
    return {
      ok: false,
      error: { kind: "test_not_in_qualifying", testName },
    };
  }

  // Server-side dedupe (same key same test dedupes; cross-test reuse
  // is preserved because dedupe is scoped to this single array).
  const assignedEvidence = dedupeAssignedEvidence(
    Array.isArray(b.assignedEvidence) ? b.assignedEvidence : [],
  );
  const ancillaryNote =
    typeof b.ancillaryNote === "string" ? b.ancillaryNote : "";
  const adminNote = typeof b.adminNote === "string" ? b.adminNote : "";
  const icdCodes: Array<{ code: string; label: string }> = Array.isArray(b.icdCodes)
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

  const { regenerateCanonicalReasoning } = await import(
    "./adminReviewAiRegeneration"
  );

  const priorReasoning =
    patient.reasoning && typeof patient.reasoning === "object" && !Array.isArray(patient.reasoning)
      ? (patient.reasoning as Record<string, any>)
      : {};
  const priorEntry = priorReasoning[testName];
  const existingReasoningByTest: Record<string, any> =
    priorEntry && typeof priorEntry === "object" && !Array.isArray(priorEntry)
      ? { [testName]: priorEntry }
      : {};
  const selectedSupportButtonsByTest: Record<string, any[]> = {
    [testName]: assignedEvidence,
  };
  const removedFactorsByTest: Record<string, string[]> = {};
  const removedArr = Array.isArray(b.removedFactors) ? b.removedFactors : [];
  if (removedArr.length) {
    removedFactorsByTest[testName] = removedArr.map((s: any) => String(s));
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
    qualifyingTests: [testName],
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

  // Merge ONLY the single regenerated test's entry. Everything else preserved.
  for (const [name, entry] of Object.entries(ai.reasoningByTest)) {
    existingReasoning[name] = entry;
  }

  const timestamp = new Date().toISOString();
  existingReasoning[`adminReview:test:${testName}`] = {
    testName,
    ancillaryId,
    assignedEvidence,
    ancillaryNote,
    regeneratedAt: timestamp,
    regeneratedMode: "test",
  };

  const updatePayload: Record<string, unknown> = {
    reasoning: existingReasoning,
  };
  if (updatedDiagnoses !== patient.diagnoses) updatePayload.diagnoses = updatedDiagnoses;
  if (updatedMedications !== patient.medications) updatePayload.medications = updatedMedications;
  if (updatedHistory !== patient.history) updatePayload.history = updatedHistory;

  const updated = await storage.updatePatientScreening(patientId, updatePayload);

  invalidatePatientDatabase();
  return { ok: true, patient: updated, testName, ancillaryId };
}
