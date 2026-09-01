// Service for the Admin Review add-ancillary handler.
//
// Companion to adminReviewRemoveService.ts. Where the remove service drops a
// test from patient.qualifyingTests and clears its admin metadata, this
// service appends a manually-selected ancillary AND qualifies it against the
// patient's current clinical data (Dx/Hx/Rx) using the same evidence builder
// and single-category regenerate path the rest of Admin Review uses:
//
//   - Resolves the canonical qualifying-test name(s) for the chosen ancillary:
//       brainwave  → "BrainWave"
//       vitalwave  → "VitalWave"
//       ultrasound → caller-supplied subtype (e.g. "Bilateral Carotid Duplex
//                    (93880)"), or the generic "Ultrasound Studies" request
//                    which fans out to the qualifying subset of the AI
//                    ultrasound sub-tests.
//   - Builds evidence with buildAdminReviewEvidence and decides which
//     sub-tests qualify (BrainWave / VitalWave via their rule candidate;
//     ultrasound via clinical, non-medication supporting evidence).
//   - For everything that qualifies it appends the canonical test name to
//     patient.qualifyingTests (deduped) so the entire downstream spine flows
//     for free (execution-case selectedServices, call reason, PDF grouping all
//     read qualifyingTests), writes a canonical reasoning entry with the
//     deterministic qualifying factors + ICD codes derived from the evidence,
//     and then attempts to generate the clinical narrative
//     (clinician_understanding / patient_talking_points) via
//     regenerateCanonicalReasoning. If the AI narrative step fails the
//     deterministic entry is kept (honest "not generated yet" narrative).
//   - When NOTHING qualifies the patient is left untouched and the outcome
//     reports `qualified: false` with `state: "no_evidence"` so the UI can show
//     an honest "no qualifying evidence found" state and offer an explicit
//     admin override. An override (override: true + a required reason) hand-adds
//     the requested test honestly: blank narrative, operator factors only.
//   - Siblings are never altered: only the newly-added tests get reasoning
//     written; existing tests (same or other ancillary) are preserved verbatim.
//   - Stamps admin-added provenance in supplemental metadata keys:
//       `adminReview:test:<testName>` = { adminAdded, source, addedAt, reason,
//                                         factors, override }
//       `adminReview:<ancillaryId>`   merged with { adminAdded: true } so
//                                     existing assignedEvidence is preserved.
//
// No schema changes. The approval pipeline (commitPatient →
// createOrUpdateExecutionCaseFromScreening) picks up the new qualifyingTests
// entries on the next approve/commit.

import type { PatientScreening } from "@shared/schema";
import { storage } from "../../storage";
import { getRequestId } from "../../middleware/requestObservability";
import {
  classifyLogSafeProviderError,
  warnPhiSafe,
} from "../../lib/phiSafeLogger";
import { invalidatePatientDatabase } from "../../routes/patientDatabase";
// Phase 2B — canonical ancillary-case reconciliation. No-op with
// FEATURE_ANCILLARY_CASE_WRITE=OFF (default).
import { reconcileAncillaryCaseForService } from "../ancillaryCases/reconciliation";
import {
  buildAdminReviewEvidence,
  evidenceForUltrasoundTest,
  clinicalEvidenceForUltrasoundTest,
  qualifyingUltrasoundSubtests,
  ALL_ULTRASOUND_SUBTYPES,
  type AdminEvidenceChip,
} from "@shared/plexus-iq/adminReviewEvidence";
import {
  parsePreviousTests,
  canonicalAncillaryKey,
  cooldownDaysForInsurance,
  checkRecommendedTests,
} from "@shared/priorAncillaryHistory";

export type AdminReviewAncillaryId = "brainwave" | "vitalwave" | "ultrasound";

export type AddAdminReviewAncillaryFailure =
  | { kind: "invalid_id" }
  | { kind: "invalid_ancillary_id" }
  | { kind: "not_found" };

export type AddAdminReviewAncillaryOutcome =
  | {
      ok: true;
      qualified: true;
      patient: PatientScreening | undefined;
      ancillaryId: AdminReviewAncillaryId;
      testName: string;
      addedTests: string[];
      alreadyPresent: boolean;
      narrativeGenerated: boolean;
    }
  | {
      ok: true;
      qualified: false;
      ancillaryId: AdminReviewAncillaryId;
      requestedTestName: string;
      state: "no_evidence" | "needs_reason" | "already_present" | "in_cooldown";
      candidates: string[];
      cooldown?: {
        previousDate: string | null;
        intervalDays: number | null;
        message: string;
      };
    }
  | { ok: false; error: AddAdminReviewAncillaryFailure };

function reasoningAsObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, any>) };
}

/**
 * Resolve the canonical qualifying-test name requested for the chosen
 * ancillary. BrainWave / VitalWave map to their fixed names; an ultrasound
 * resolves to the supplied subtype or the generic "Ultrasound Studies" when
 * none is given.
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

function labelForQualifyingFactor(chip: AdminEvidenceChip): string {
  if (chip.icdCode && chip.label) return `${chip.icdCode} · ${chip.label}`;
  return chip.label;
}

function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function deterministicEntry(
  support: AdminEvidenceChip[],
  approvalRequired: boolean,
) {
  return {
    clinician_understanding: "",
    patient_talking_points: "",
    qualifying_factors: dedupePreserveOrder(support.map(labelForQualifyingFactor)),
    icd10_codes: dedupePreserveOrder(
      support.map((c) => c.icdCode ?? "").filter((c) => c.length > 0),
    ),
    pearls: [],
    confidence: support.some((c) => c.confidence === "high") ? "high" : "medium",
    approvalRequired,
  };
}

export async function addAdminReviewAncillary(
  patientId: number,
  body: Record<string, unknown> | undefined | null,
  /**
   * Phase 2B — passed through from the route so ancillary-case
   * journey events attribute correctly. Optional; when omitted the
   * event `actorUserId` is null (still valid — the schema allows NULL).
   */
  actorUserId: string | null = null,
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
  const requestedTestName = resolveTestName(ancillaryId, String(b.testName ?? ""));
  const isGenericUltrasound =
    ancillaryId === "ultrasound" && requestedTestName === "Ultrasound Studies";
  const reason =
    typeof b.reason === "string" && b.reason.trim() ? b.reason.trim() : null;
  const override = b.override === true;

  const patient = await storage.getPatientScreening(patientId);
  if (!patient) {
    return { ok: false, error: { kind: "not_found" } };
  }

  const allTests = Array.isArray(patient.qualifyingTests)
    ? patient.qualifyingTests
    : [];

  // ─── Prior-history cooldown gate ────────────────────────────────────
  // Parse the patient's free-text previousTests into structured entries and
  // compute the insurance-derived window (6mo PPO / 12mo Medicare, falling
  // back to the per-test defaults). A test blocked by a within-window prior
  // must not be hand-added — this guards a direct API call that bypasses the
  // UI menu.
  const priorEntries = parsePreviousTests(
    patient.previousTests,
    patient.previousTestsDate,
  );
  const cooldownOverrideDays = cooldownDaysForInsurance(patient.insurance);
  const cooldownWarningFor = (uiTestName: string) => {
    if (priorEntries.length === 0) return null;
    const key = canonicalAncillaryKey(uiTestName);
    const warnings = checkRecommendedTests(
      [key],
      priorEntries,
      new Date(),
      cooldownOverrideDays,
    );
    return warnings.find((w) => w.reason === "duplicate_in_window") ?? null;
  };

  // Concrete (non-generic) request blocked by a within-window prior.
  if (!isGenericUltrasound) {
    const w = cooldownWarningFor(requestedTestName);
    if (w) {
      return {
        ok: true,
        qualified: false,
        ancillaryId,
        requestedTestName,
        state: "in_cooldown",
        candidates: [requestedTestName],
        cooldown: {
          previousDate: w.previousDate,
          intervalDays: w.intervalDays,
          message: w.message,
        },
      };
    }
  }

  // Early dedupe for a concrete (non-generic) requested test that is already
  // present — preserve the existing focus-the-entry behavior.
  if (!isGenericUltrasound && allTests.includes(requestedTestName)) {
    return {
      ok: true,
      qualified: true,
      patient,
      ancillaryId,
      testName: requestedTestName,
      addedTests: [],
      alreadyPresent: true,
      narrativeGenerated: false,
    };
  }

  // Generic ultrasound with nothing left to add: every ultrasound sub-test is
  // already on the patient (or the generic sentinel itself is present). This is
  // an honest "already present" state — not "no evidence" — and override must
  // NOT hand-add the meaningless generic "Ultrasound Studies" sentinel.
  if (isGenericUltrasound) {
    const missingSubtypes = ALL_ULTRASOUND_SUBTYPES.filter(
      (t) => !allTests.includes(t),
    );
    if (
      allTests.includes("Ultrasound Studies") ||
      missingSubtypes.length === 0
    ) {
      return {
        ok: true,
        qualified: false,
        ancillaryId,
        requestedTestName,
        state: "already_present",
        candidates: [],
      };
    }
  }

  const under16 = typeof patient.age === "number" && patient.age < 16;

  // ─── Determine which tests qualify against the patient's clinical data ───
  const evidence = buildAdminReviewEvidence({
    age: patient.age,
    hx: patient.history,
    dx: patient.diagnoses,
    rx: patient.medications,
    previousTests: patient.previousTests,
  });

  const supportByTest: Record<string, AdminEvidenceChip[]> = {};
  let qualifiedTests: string[] = [];
  // For generic ultrasound: capture the subtypes that qualified clinically
  // before the cooldown filter so we can distinguish a true "no evidence"
  // result from one where every qualifying study was excluded by cooldown.
  let genericCooldownBlocked: NonNullable<
    ReturnType<typeof cooldownWarningFor>
  >[] = [];

  if (ancillaryId === "brainwave" || ancillaryId === "vitalwave") {
    const candidate = evidence.candidates.find(
      (c) => c.ancillaryId === ancillaryId,
    );
    const support = (candidate?.evidenceIds ?? [])
      .map((id) => evidence.evidence.find((e) => e.id === id))
      .filter((c): c is AdminEvidenceChip => !!c);
    if (support.length > 0) {
      qualifiedTests = [requestedTestName];
      supportByTest[requestedTestName] = support;
    }
  } else if (isGenericUltrasound) {
    // Fan a generic ultrasound out to the qualifying AI ultrasound sub-tests
    // that aren't already present AND aren't within a prior-history cooldown.
    const clinicallyQualifying = qualifyingUltrasoundSubtests(
      evidence.evidence,
    ).filter((t) => !allTests.includes(t));
    genericCooldownBlocked = clinicallyQualifying
      .map((t) => cooldownWarningFor(t))
      .filter((w): w is NonNullable<typeof w> => w !== null);
    const subtypes = clinicallyQualifying.filter((t) => !cooldownWarningFor(t));
    for (const t of subtypes) {
      supportByTest[t] = evidenceForUltrasoundTest(t, evidence.evidence);
    }
    qualifiedTests = subtypes;
  } else {
    // Specific ultrasound subtype.
    const clinical = clinicalEvidenceForUltrasoundTest(
      requestedTestName,
      evidence.evidence,
    );
    if (clinical.length > 0) {
      qualifiedTests = [requestedTestName];
      supportByTest[requestedTestName] = evidenceForUltrasoundTest(
        requestedTestName,
        evidence.evidence,
      );
    }
  }

  // ─── Generic ultrasound where every qualifying study is cooldown-blocked ───
  // Honest cooldown semantics: do NOT fall through to the override path, so a
  // direct API call cannot force-add "Ultrasound Studies" past the cooldown.
  if (
    qualifiedTests.length === 0 &&
    isGenericUltrasound &&
    genericCooldownBlocked.length > 0
  ) {
    const w = genericCooldownBlocked[0];
    return {
      ok: true,
      qualified: false,
      ancillaryId,
      requestedTestName,
      state: "in_cooldown",
      candidates: genericCooldownBlocked.map((c) => c.testName),
      cooldown: {
        previousDate: w.previousDate,
        intervalDays: w.intervalDays,
        message: w.message,
      },
    };
  }

  // ─── Nothing qualifies: honest empty state + explicit override path ───
  if (qualifiedTests.length === 0) {
    if (!override) {
      return {
        ok: true,
        qualified: false,
        ancillaryId,
        requestedTestName,
        state: "no_evidence",
        candidates: isGenericUltrasound
          ? qualifyingUltrasoundSubtests(evidence.evidence)
          : [requestedTestName],
      };
    }
    if (!reason) {
      return {
        ok: true,
        qualified: false,
        ancillaryId,
        requestedTestName,
        state: "needs_reason",
        candidates: [requestedTestName],
      };
    }
    // Override: hand-add the requested test honestly (no fabricated evidence).
    qualifiedTests = [requestedTestName];
    supportByTest[requestedTestName] = [];
  }

  // ─── Append qualifying tests + write reasoning ───
  const existingReasoning = reasoningAsObject(patient.reasoning);
  const addedTests: string[] = [];
  for (const t of qualifiedTests) {
    if (!allTests.includes(t)) addedTests.push(t);
  }
  const nextTests = dedupePreserveOrder([...allTests, ...addedTests]);

  // Deterministic entries first — these survive even if the AI narrative
  // step fails, keeping qualification factors honest and grounded.
  const entriesByTest: Record<string, any> = {};
  for (const t of addedTests) {
    entriesByTest[t] = deterministicEntry(supportByTest[t] ?? [], under16);
  }

  // Best-effort AI narrative for the newly-added tests only (siblings are
  // never regenerated). On any failure we keep the deterministic entry.
  let narrativeGenerated = false;
  if (addedTests.length > 0 && !override) {
    try {
      const { regenerateCanonicalReasoning } = await import(
        "./adminReviewAiRegeneration"
      );
      const supportUnion = addedTests.flatMap((t) => supportByTest[t] ?? []);
      const selectedSupportButtonsByTest: Record<string, AdminEvidenceChip[]> = {};
      for (const t of addedTests) {
        selectedSupportButtonsByTest[t] = supportByTest[t] ?? [];
      }
      const ai = await regenerateCanonicalReasoning({
        patient,
        qualifyingTests: addedTests,
        assignedEvidenceByAncillary: {
          brainwave: ancillaryId === "brainwave" ? supportUnion : [],
          vitalwave: ancillaryId === "vitalwave" ? supportUnion : [],
          ultrasound: ancillaryId === "ultrasound" ? supportUnion : [],
        },
        ancillaryNotes: {
          brainwave: ancillaryId === "brainwave" ? reason ?? "" : "",
          vitalwave: ancillaryId === "vitalwave" ? reason ?? "" : "",
          ultrasound: ancillaryId === "ultrasound" ? reason ?? "" : "",
        },
        icdCodes: [],
        existingReasoningByTest: {},
        removedFactorsByTest: {},
        selectedSupportButtonsByTest,
      });
      for (const t of addedTests) {
        const entry = ai.reasoningByTest[t];
        if (entry) {
          entriesByTest[t] = entry;
          narrativeGenerated = true;
        }
      }
    } catch (error: unknown) {
      warnPhiSafe({
        source: "ai_operation",
        operation: "admin_review",
        outcome: "partial",
        category: classifyLogSafeProviderError(error),
        requestId: getRequestId(),
      });
    }
  }

  // Write canonical entries for the newly-added tests + provenance.
  const addedAt = new Date().toISOString();
  for (const t of addedTests) {
    existingReasoning[t] = entriesByTest[t];
    existingReasoning[`adminReview:test:${t}`] = {
      adminAdded: true,
      source: "admin_added",
      addedAt,
      reason,
      override,
      factors: (entriesByTest[t]?.qualifying_factors ?? []) as string[],
    };
  }
  existingReasoning[`adminReview:${ancillaryId}`] = {
    ...reasoningAsObject(existingReasoning[`adminReview:${ancillaryId}`]),
    adminAdded: true,
  };

  const updated = await storage.updatePatientScreening(patientId, {
    qualifyingTests: nextTests,
    reasoning: existingReasoning,
  });

  // Phase 2B — ensure a canonical ancillary case exists for every
  // freshly-added test. No-op with FEATURE_ANCILLARY_CASE_WRITE=OFF.
  // Failure is logged non-PHI and does not disturb the admin-review
  // workflow (the reconciler already emits a structured audit event
  // on integrity / missing-links failures).
  const clinicId = (updated as { clinicId?: number | null } | null)?.clinicId ?? null;
  const globalPlexusPatientId = (updated as { globalPlexusPatientId?: number | null } | null)?.globalPlexusPatientId ?? null;
  const patientClinicMembershipId = (updated as { patientClinicMembershipId?: number | null } | null)?.patientClinicMembershipId ?? null;
  if (clinicId && globalPlexusPatientId && patientClinicMembershipId) {
    for (const testName of addedTests) {
      try {
        await reconcileAncillaryCaseForService({
          clinicId,
          globalPlexusPatientId,
          patientClinicMembershipId,
          originatingScreeningId: patientId,
          serviceType: testName,
          qualificationStatus: "qualified",
          adminReviewStatus: "approved",
          source: "admin_review_add_ancillary",
          actorUserId,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(JSON.stringify({
          level: "error",
          source: "ancillary_case_reconciliation",
          site: "adminReviewAddService",
          patientId,
          serviceType: testName,
          code: (e as { code?: string })?.code,
          message: (e as Error)?.message ?? String(e),
        }));
      }
    }
  }

  invalidatePatientDatabase();
  return {
    ok: true,
    qualified: true,
    patient: updated,
    ancillaryId,
    testName: addedTests[0] ?? requestedTestName,
    addedTests,
    alreadyPresent: addedTests.length === 0,
    narrativeGenerated,
  };
}
