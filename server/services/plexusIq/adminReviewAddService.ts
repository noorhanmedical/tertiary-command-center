// Service for the Admin Review add-ancillary handler.
//
// Companion to adminReviewRemoveService.ts. Where the remove service drops a
// test from patient.qualifyingTests and clears its admin metadata, this
// service appends a manually-selected ancillary by hand:
//
//   - Resolves the canonical qualifying-test name for the chosen ancillary:
//       brainwave  → "BrainWave"
//       vitalwave  → "VitalWave"
//       ultrasound → caller-supplied subtype (e.g. "Bilateral Carotid Duplex
//                    (93880)") or the generic "Ultrasound Studies" fallback.
//   - Dedupes per test name (alreadyPresent is reported, never duplicated).
//   - Appends the test name to patient.qualifyingTests so the entire
//     downstream spine flows for free (execution-case selectedServices, call
//     reason, PDF service grouping all read qualifyingTests).
//   - Records an HONEST canonical reasoning entry: it writes ONLY the
//     operator-selected qualifying factors. The AI narrative fields
//     (clinician_understanding / patient_talking_points) are left blank so the
//     UI and PDFs render "Not generated yet" rather than fabricated text. The
//     canonical entry is only created when one does not already exist, so a
//     re-add never clobbers prior AI reasoning.
//   - Stamps admin-added provenance in supplemental metadata keys:
//       `adminReview:test:<testName>` = { adminAdded, source, addedAt, reason,
//                                         factors }
//       `adminReview:<ancillaryId>`   merged with { adminAdded: true } so
//                                     existing assignedEvidence is preserved.
//
// No schema changes, no AI calls, no scheduler-assignment side effects. The
// approval pipeline (commitPatient → createOrUpdateExecutionCaseFromScreening)
// picks up the new qualifyingTests entry on the next approve/commit.

import type { PatientScreening } from "@shared/schema";
import { storage } from "../../storage";
import { invalidatePatientDatabase } from "../../routes/patientDatabase";

export type AdminReviewAncillaryId = "brainwave" | "vitalwave" | "ultrasound";

export type AddAdminReviewAncillaryFailure =
  | { kind: "invalid_id" }
  | { kind: "invalid_ancillary_id" }
  | { kind: "not_found" };

export type AddAdminReviewAncillaryOutcome =
  | {
      ok: true;
      patient: PatientScreening | undefined;
      ancillaryId: AdminReviewAncillaryId;
      testName: string;
      alreadyPresent: boolean;
    }
  | { ok: false; error: AddAdminReviewAncillaryFailure };

function reasoningAsObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, any>) };
}

/**
 * Resolve the canonical qualifying-test name to store in
 * patient.qualifyingTests for the chosen ancillary. BrainWave / VitalWave map
 * to their fixed names; an ultrasound resolves to the supplied subtype or the
 * generic "Ultrasound Studies" when none is given.
 */
function resolveTestName(
  ancillaryId: AdminReviewAncillaryId,
  rawTestName: string,
): string {
  if (ancillaryId === "brainwave") return "BrainWave";
  if (ancillaryId === "vitalwave") return "VitalWave";
  const t = rawTestName.trim();
  return t.length > 0 ? t : "Ultrasound Studies";
}

export async function addAdminReviewAncillary(
  patientId: number,
  body: Record<string, unknown> | undefined | null,
): Promise<AddAdminReviewAncillaryOutcome> {
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
  const testName = resolveTestName(ancillaryId, String(b.testName ?? ""));
  const reason =
    typeof b.reason === "string" && b.reason.trim() ? b.reason.trim() : null;
  const factors: string[] = Array.isArray(b.factors)
    ? b.factors.filter((f: unknown) => typeof f === "string" && f.trim()).map((f: string) => f.trim())
    : [];

  const patient = await storage.getPatientScreening(patientId);
  if (!patient) {
    return { ok: false, error: { kind: "not_found" } };
  }

  const allTests = Array.isArray(patient.qualifyingTests)
    ? patient.qualifyingTests
    : [];
  const alreadyPresent = allTests.includes(testName);
  const nextTests = alreadyPresent ? allTests : [...allTests, testName];

  const existingReasoning = reasoningAsObject(patient.reasoning);

  // Honest canonical entry: write only operator-selected factors, leave the
  // AI narrative blank, and only create when absent so we never clobber prior
  // AI reasoning on a re-add.
  if (existingReasoning[testName] == null) {
    existingReasoning[testName] = {
      clinician_understanding: "",
      patient_talking_points: "",
      qualifying_factors: factors,
      icd10_codes: [],
      pearls: [],
      confidence: null,
      approvalRequired: false,
    };
  }

  // Admin-added provenance, kept out of canonical reasoning so the
  // not-generated state survives until a regenerate populates the narrative.
  existingReasoning[`adminReview:test:${testName}`] = {
    adminAdded: true,
    source: "admin_added",
    addedAt: new Date().toISOString(),
    reason,
    factors,
  };
  existingReasoning[`adminReview:${ancillaryId}`] = {
    ...reasoningAsObject(existingReasoning[`adminReview:${ancillaryId}`]),
    adminAdded: true,
  };

  const updated = await storage.updatePatientScreening(patientId, {
    qualifyingTests: nextTests,
    reasoning: existingReasoning,
  });

  invalidatePatientDatabase();
  return {
    ok: true,
    patient: updated,
    ancillaryId,
    testName,
    alreadyPresent,
  };
}
