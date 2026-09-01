// Service wrapper for the Admin Review regenerate-all handler.
//
// SOURCE (canonical handler at the time of extraction):
//   server/routes/patients.ts lines 321-492, registered as
//   POST /api/patient-screenings/:id/admin-review/regenerate-all.
//
// Scope (CONFIRMED by direct re-read of the source handler):
//   This handler is the BROADEST Admin Review reasoning writer.
//   It writes:
//     1. patient.reasoning[testName] for every entry returned by
//        regenerateCanonicalReasoning (one per qualifyingTest).
//     2. patient.reasoning["adminReview:brainwave"],
//        patient.reasoning["adminReview:vitalwave"],
//        patient.reasoning["adminReview:ultrasound"]  — all three,
//        every call, with regeneratedMode: "all".
//   It does NOT write:
//     - adminReview:test:<testName> entries (those are owned by
//       regenerate-test; preserved here by spread).
//     - Any other reasoning key (preserved by spread).
//   It optionally updates patient.diagnoses / medications / history
//   when those differ from the patient's current values.
//
// Behavior contract preserved by this wrapper (see
// docs/architecture/backend-route-parity-inventory.md §1.3):
//   - Validation order:
//       1. patientId NaN check  → invalid_id (route → 400 "Invalid patient id")
//       2. patient lookup       → not_found  (route → 404 "Patient not found")
//   - Body coercion (verbatim):
//       - assignedEvidenceByAncillary: per-key Array.isArray fallback to [].
//       - ancillaryNotes: per-key typeof string fallback to "".
//       - adminNote: typeof string fallback to "".
//       - icdCodes: Array.isArray map+filter; { code: string, label: string }.
//       - diagnoses/medications/history default to patient values when body
//         field is not a string.
//   - qualifyingTests source: patient.qualifyingTests (defensive Array.isArray).
//   - existingReasoningByTest: built from patient.reasoning for each
//     qualifyingTest entry that's a plain object.
//   - selectedSupportButtonsByTest: map test → ancillary via
//     getAncillaryCategory(testName), pulling the matching ancillary's
//     assignedEvidence array.
//   - removedFactorsByTest: merged from BOTH body.removedFactorsByTest (per-test)
//     AND body.removedFactorsByAncillary (per-ancillary, distributed to tests
//     via getAncillaryCategory). Same merge order as the original.
//   - priorQualifyingFactorsByTest: pulled from body verbatim.
//   - AI call: regenerateCanonicalReasoning with a patient object that
//     overrides history/diagnoses/medications using the body-derived values
//     (so the AI sees the latest admin edits even before they're persisted).
//   - Reasoning merge:
//       1. Spread existing patient.reasoning into a working object.
//       2. Overlay every ai.reasoningByTest[testName] entry.
//       3. Rewrite all three adminReview:<ancillaryId> entries with
//          { ancillaryId, assignedEvidence: assignedEvidenceByAncillary[id],
//            ancillaryNote: ancillaryNotes[id], regeneratedAt: <ISO now>,
//            regeneratedMode: "all" }.
//   - updatePayload: { reasoning } + conditional diagnoses/medications/history
//     when changed from patient's current value.
//   - storage.updatePatientScreening called once with updatePayload.
//   - invalidatePatientDatabase() called once after the update.
//   - Success response (route): { ok: true, patient: updated }.
//   - The dynamic imports of getAncillaryCategory and
//     regenerateCanonicalReasoning remain inside the service so cold-start
//     behavior matches the previous handler.
//   - Under-16 guardrails, ICD-needed behavior, qualifying-factors floor
//     merge, and OpenAI/Anthropic call semantics are delegated unchanged
//     to regenerateCanonicalReasoning.
//
// What this wrapper does NOT change:
//   - No scheduler assignment behavior (this handler doesn't touch it).
//   - No prompt/model changes.
//   - No reasoning-blob schema change.
//   - No PDF data source change.
//   - No new DB columns or migrations.
//   - No audit-log call (the original handler did not log one; preserved).
//   - No patient_journey_event write (the original handler did not write one; preserved).

import type { PatientScreening } from "@shared/schema";
import { storage } from "../../storage";
import { invalidatePatientDatabase } from "../../routes/patientDatabase";

export type AdminReviewRegenerateAllFailure =
  | { kind: "invalid_id" }
  | { kind: "not_found" };

export type AdminReviewRegenerateAllOutcome =
  | { ok: true; patient: PatientScreening | undefined }
  | { ok: false; error: AdminReviewRegenerateAllFailure };

/**
 * Canonical regenerate. Rebuilds patient.reasoning[testName] for every
 * qualifying test and rewrites all three adminReview:<ancillary> supplemental
 * entries. Optionally updates diagnoses/medications/history when the body
 * supplies new values.
 *
 * Mirrors the previous inline handler in server/routes/patients.ts
 * step-for-step. The caller (the route) is responsible only for parsing
 * `:id` and mapping the discriminated-union failure to the same HTTP
 * envelope it has always returned.
 */
export async function regenerateAdminReviewAll(
  patientId: number,
  body: Record<string, unknown> | undefined | null,
): Promise<AdminReviewRegenerateAllOutcome> {
  if (Number.isNaN(patientId)) {
    return { ok: false, error: { kind: "invalid_id" } };
  }
  const patient = await storage.getPatientScreening(patientId);
  if (!patient) {
    return { ok: false, error: { kind: "not_found" } };
  }

  const b = (body ?? {}) as Record<string, any>;

  const assignedEvidenceByAncillary = {
    brainwave: Array.isArray(b.assignedEvidenceByAncillary?.brainwave)
      ? b.assignedEvidenceByAncillary.brainwave
      : [],
    vitalwave: Array.isArray(b.assignedEvidenceByAncillary?.vitalwave)
      ? b.assignedEvidenceByAncillary.vitalwave
      : [],
    ultrasound: Array.isArray(b.assignedEvidenceByAncillary?.ultrasound)
      ? b.assignedEvidenceByAncillary.ultrasound
      : [],
  };
  const ancillaryNotes = {
    brainwave:
      typeof b.ancillaryNotes?.brainwave === "string"
        ? b.ancillaryNotes.brainwave
        : "",
    vitalwave:
      typeof b.ancillaryNotes?.vitalwave === "string"
        ? b.ancillaryNotes.vitalwave
        : "",
    ultrasound:
      typeof b.ancillaryNotes?.ultrasound === "string"
        ? b.ancillaryNotes.ultrasound
        : "",
  };
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

  const qualifyingTests = Array.isArray(patient.qualifyingTests)
    ? patient.qualifyingTests
    : [];

  const { regenerateCanonicalReasoning } = await import(
    "./adminReviewAiRegeneration"
  );
  const { getAncillaryCategory } = await import("@shared/ancillaryCategory");

  const existingReasoningByTest: Record<string, any> = {};
  const priorReasoning =
    patient.reasoning && typeof patient.reasoning === "object" && !Array.isArray(patient.reasoning)
      ? (patient.reasoning as Record<string, any>)
      : {};
  for (const t of qualifyingTests) {
    const e = priorReasoning[t];
    if (e && typeof e === "object" && !Array.isArray(e)) existingReasoningByTest[t] = e;
  }

  // Map test -> ancillary so selected support buttons follow the right bucket.
  const selectedSupportButtonsByTest: Record<string, any[]> = {};
  for (const t of qualifyingTests) {
    const cat = getAncillaryCategory(t);
    if (cat === "brainwave" || cat === "vitalwave" || cat === "ultrasound") {
      selectedSupportButtonsByTest[t] = assignedEvidenceByAncillary[cat] ?? [];
    }
  }

  // removedFactors come from the client and may be per-test or per-ancillary.
  const removedFactorsByTest: Record<string, string[]> = {};
  const removedFromBody = b.removedFactorsByTest;
  if (removedFromBody && typeof removedFromBody === "object") {
    for (const [t, arr] of Object.entries(removedFromBody)) {
      if (Array.isArray(arr)) removedFactorsByTest[t] = arr.map((s: any) => String(s));
    }
  }
  const removedByAncillary = b.removedFactorsByAncillary;
  if (removedByAncillary && typeof removedByAncillary === "object") {
    for (const t of qualifyingTests) {
      const cat = getAncillaryCategory(t);
      const arr = (removedByAncillary as Record<string, unknown>)[cat];
      if (Array.isArray(arr)) {
        removedFactorsByTest[t] = [
          ...(removedFactorsByTest[t] ?? []),
          ...arr.map((s: any) => String(s)),
        ];
      }
    }
  }

  // Authoritative qualifying-factor floor sent from the client (preferred
  // over reading patient.reasoning[testName] on the server, since older
  // stored shapes may lose the array on round-trip).
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
    qualifyingTests,
    assignedEvidenceByAncillary,
    ancillaryNotes,
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

  // Merge canonical regenerated entries onto patient.reasoning[testName].
  for (const [testName, entry] of Object.entries(ai.reasoningByTest)) {
    existingReasoning[testName] = entry;
  }

  // Supplemental adminReview metadata per ancillary (audit only).
  const timestamp = new Date().toISOString();
  for (const id of ["brainwave", "vitalwave", "ultrasound"] as const) {
    existingReasoning[`adminReview:${id}`] = {
      ancillaryId: id,
      assignedEvidence: assignedEvidenceByAncillary[id],
      ancillaryNote: ancillaryNotes[id],
      regeneratedAt: timestamp,
      regeneratedMode: "all",
    };
  }

  const updatePayload: Record<string, unknown> = {
    reasoning: existingReasoning,
  };
  if (updatedDiagnoses !== patient.diagnoses) updatePayload.diagnoses = updatedDiagnoses;
  if (updatedMedications !== patient.medications) updatePayload.medications = updatedMedications;
  if (updatedHistory !== patient.history) updatePayload.history = updatedHistory;

  const updated = await storage.updatePatientScreening(patientId, updatePayload);

  // Phase 2B — sync canonical ancillary cases when qualifyingTests
  // was persisted. No-op with FEATURE_ANCILLARY_CASE_WRITE=OFF. Missing
  // Phase 2A identity → durable retry rows recorded.
  if (updated && "qualifyingTests" in updatePayload) {
    try {
      const { syncScreeningAncillaryCases } = await import(
        "../ancillaryCases/screeningSync"
      );
      await syncScreeningAncillaryCases({
        screening: updated,
        executionCaseId: null,
        actorUserId: null,
        requestedServices: Array.isArray((updatePayload as { qualifyingTests?: string[] }).qualifyingTests)
          ? ((updatePayload as { qualifyingTests: string[] }).qualifyingTests)
          : [],
        requestedServicesDefined: Array.isArray((updatePayload as { qualifyingTests?: string[] }).qualifyingTests),
        source: "admin_review_regenerate_all",
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        level: "error",
        source: "ancillary_case_sync",
        site: "adminReviewRegenerateAllService",
        patientId,
        code: (e as { code?: string })?.code,
        message: (e as Error)?.message ?? String(e),
      }));
    }
  }

  invalidatePatientDatabase();
  return { ok: true, patient: updated };
}
