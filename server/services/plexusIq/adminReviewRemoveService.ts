// Service wrappers for the Admin Review remove-test and remove-ancillary
// handlers.
//
// SOURCE (canonical handlers at the time of extraction):
//   server/routes/patients.ts
//     lines 907-957 — POST /api/patient-screenings/:id/admin-review/remove-test
//     lines 964-1027 — POST /api/patient-screenings/:id/admin-review/remove-ancillary
//
// Scope (CONFIRMED by direct re-read of both source handlers):
//   These are no-AI handlers. Each deletes ONLY supplemental metadata keys
//   from patient.reasoning; neither deletes any canonical reasoning[testName]
//   entry. The UI display invariant — "presence in qualifyingTests governs
//   whether the test renders; canonical reasoning[testName] is the data
//   source for the cards and PDFs" — is the reason canonical reasoning is
//   preserved even after a test is removed from qualifyingTests.
//
// removeAdminReviewTest:
//   Writes:
//     - patient.qualifyingTests filtered to exclude the supplied testName.
//     - patient.reasoning with ONLY `adminReview:test:<testName>` deleted.
//   Preserves:
//     - patient.reasoning[testName]            (canonical narrative; survives)
//     - Every other reasoning key             (spread)
//     - Every other qualifyingTests entry
//
// removeAdminReviewAncillary:
//   Writes:
//     - patient.qualifyingTests filtered to exclude every test in the
//       ancillary (mapped via getAncillaryCategory).
//     - patient.reasoning with:
//         - `adminReview:<ancillaryId>` deleted
//         - `adminReview:test:<t>` deleted for every removed test
//   Preserves:
//     - patient.reasoning[<removedTest>]       (canonical narrative; survives)
//     - Every other reasoning key             (spread)
//     - Every other qualifyingTests entry
//     - Sibling adminReview:<otherAncillaryId> entries
//     - Sibling adminReview:test:<otherTest> entries
//
// Behavior contract preserved by these wrappers (see
// docs/architecture/backend-route-parity-inventory.md §1.6 + §1.7):
//   removeAdminReviewTest validation order:
//     1. patientId NaN check              → invalid_id     (route → 400 "Invalid patient id")
//     2. testName non-empty check         → missing_test_name (route → 400 "testName is required")
//     3. patient lookup                   → not_found      (route → 404 "Patient not found")
//     4. testName-in-qualifyingTests      → test_not_in_qualifying (route → 400 with the exact format `testName "<n>" is not in patient.qualifyingTests`)
//   removeAdminReviewAncillary validation order:
//     1. patientId NaN check              → invalid_id
//     2. ancillaryId enum check           → invalid_ancillary_id (route → 400 "ancillaryId must be one of brainwave / vitalwave / ultrasound")
//     3. patient lookup                   → not_found
//   Side effects (both):
//     - storage.updatePatientScreening called once with
//       { qualifyingTests, reasoning }.
//     - invalidatePatientDatabase() called once after the update.
//   Success responses:
//     - removeAdminReviewTest:        { ok: true, patient, removedTestName: testName }
//     - removeAdminReviewAncillary:   { ok: true, patient, ancillaryId, removedTests }
//   Dynamic import of getAncillaryCategory remains inside the service so
//   cold-start behavior matches the previous handler.
//
// What these wrappers do NOT change:
//   - No canonical patient.reasoning[testName] is ever deleted.
//   - No scheduler-assignment behavior (handlers don't touch it).
//   - No PDF data source change.
//   - No new DB columns or migrations.
//   - No audit-log call (none in originals; preserved).
//   - No patient_journey_event write (none in originals; preserved).

import type { PatientScreening } from "@shared/schema";
import { storage } from "../../storage";
import { invalidatePatientDatabase } from "../../routes/patientDatabase";

export type AdminReviewAncillaryId = "brainwave" | "vitalwave" | "ultrasound";

// ──────────────────────────────────────────────────────────────────────────
// removeAdminReviewTest
// ──────────────────────────────────────────────────────────────────────────

export type RemoveAdminReviewTestFailure =
  | { kind: "invalid_id" }
  | { kind: "missing_test_name" }
  | { kind: "not_found" }
  | { kind: "test_not_in_qualifying"; testName: string };

export type RemoveAdminReviewTestOutcome =
  | {
      ok: true;
      patient: PatientScreening | undefined;
      removedTestName: string;
    }
  | { ok: false; error: RemoveAdminReviewTestFailure };

/**
 * Remove a single qualifying test from patient.qualifyingTests and clear
 * the associated `adminReview:test:<testName>` metadata. Canonical
 * patient.reasoning[testName] is intentionally preserved so the historical
 * narrative survives the removal (the UI display is governed by
 * qualifyingTests, but the cards and PDFs still need the data).
 */
export async function removeAdminReviewTest(
  patientId: number,
  body: Record<string, unknown> | undefined | null,
): Promise<RemoveAdminReviewTestOutcome> {
  if (Number.isNaN(patientId)) {
    return { ok: false, error: { kind: "invalid_id" } };
  }
  const b = (body ?? {}) as Record<string, any>;
  const testName = String(b.testName ?? "").trim();
  if (!testName) {
    return { ok: false, error: { kind: "missing_test_name" } };
  }
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
  const nextTests = allTests.filter((t) => t !== testName);

  const existingReasoning =
    patient.reasoning &&
    typeof patient.reasoning === "object" &&
    !Array.isArray(patient.reasoning)
      ? { ...(patient.reasoning as Record<string, unknown>) }
      : {};
  delete existingReasoning[`adminReview:test:${testName}`];

  const updated = await storage.updatePatientScreening(patientId, {
    qualifyingTests: nextTests,
    reasoning: existingReasoning,
  });

  await conservativelyRemoveAncillaryForScreening({
    patient: updated,
    serviceTypes: [testName],
    source: "admin_review_remove_test",
  });

  invalidatePatientDatabase();
  return { ok: true, patient: updated, removedTestName: testName };
}

// ──────────────────────────────────────────────────────────────────────────
// removeAdminReviewAncillary
// ──────────────────────────────────────────────────────────────────────────

export type RemoveAdminReviewAncillaryFailure =
  | { kind: "invalid_id" }
  | { kind: "invalid_ancillary_id" }
  | { kind: "not_found" };

export type RemoveAdminReviewAncillaryOutcome =
  | {
      ok: true;
      patient: PatientScreening | undefined;
      ancillaryId: AdminReviewAncillaryId;
      removedTests: string[];
    }
  | { ok: false; error: RemoveAdminReviewAncillaryFailure };

/**
 * Remove every qualifying test whose ancillary category matches `ancillaryId`,
 * and clear the matching `adminReview:<ancillaryId>` block plus every
 * `adminReview:test:<removedTest>` entry. Canonical
 * patient.reasoning[<removedTest>] entries are intentionally preserved.
 */
export async function removeAdminReviewAncillary(
  patientId: number,
  body: Record<string, unknown> | undefined | null,
): Promise<RemoveAdminReviewAncillaryOutcome> {
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

  const { getAncillaryCategory } = await import("@shared/ancillaryCategory");
  const allTests = Array.isArray(patient.qualifyingTests)
    ? patient.qualifyingTests
    : [];
  const toRemove = new Set(
    allTests.filter((t) => getAncillaryCategory(t) === ancillaryId),
  );
  const nextTests = allTests.filter((t) => !toRemove.has(t));

  const existingReasoning =
    patient.reasoning &&
    typeof patient.reasoning === "object" &&
    !Array.isArray(patient.reasoning)
      ? { ...(patient.reasoning as Record<string, unknown>) }
      : {};
  delete existingReasoning[`adminReview:${ancillaryId}`];
  for (const t of toRemove) {
    delete existingReasoning[`adminReview:test:${t}`];
  }

  const updated = await storage.updatePatientScreening(patientId, {
    qualifyingTests: nextTests,
    reasoning: existingReasoning,
  });

  await conservativelyRemoveAncillaryForScreening({
    patient: updated,
    serviceTypes: Array.from(toRemove),
    source: "admin_review_remove_ancillary",
  });

  invalidatePatientDatabase();
  return {
    ok: true,
    patient: updated,
    ancillaryId,
    removedTests: Array.from(toRemove),
  };
}

// Phase 2B — canonical ancillary-case conservative removal helper.
// Called by both removeAdminReviewTest and removeAdminReviewAncillary.
// No-op with FEATURE_ANCILLARY_CASE_WRITE=OFF (default). Never
// hard-deletes; places the active case on_hold and emits a status_changed
// journey event. The removed test's canonical patient.reasoning entry
// remains preserved by the admin-review workflow (unchanged).
async function conservativelyRemoveAncillaryForScreening(args: {
  patient: PatientScreening | undefined;
  serviceTypes: string[];
  source: string;
}): Promise<void> {
  if (!args.patient || args.serviceTypes.length === 0) return;
  const p = args.patient as PatientScreening & {
    clinicId?: number | null;
    globalPlexusPatientId?: number | null;
    patientClinicMembershipId?: number | null;
  };
  const clinicId = p.clinicId ?? null;
  const globalPlexusPatientId = p.globalPlexusPatientId ?? null;
  if (!clinicId || !globalPlexusPatientId) return;

  const { conservativelyRemoveAncillaryService } = await import(
    "../ancillaryCases/reconciliation"
  );
  for (const serviceType of args.serviceTypes) {
    try {
      await conservativelyRemoveAncillaryService({
        clinicId,
        globalPlexusPatientId,
        serviceType,
        action: "on_hold",
        source: args.source,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        level: "error",
        source: "ancillary_case_reconciliation",
        site: args.source,
        patientId: p.id,
        serviceType,
        code: (e as { code?: string })?.code,
        message: (e as Error)?.message ?? String(e),
      }));
    }
  }
}
