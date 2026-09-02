// Phase A — Physician Portal signature workflow tests.
//
// Runs standalone with:
//   npx tsx tests/unit/physicianSignatureWorkflow.test.ts

import assert from "node:assert/strict";
import {
  eligibleForSign,
  computeSignatureItem,
  type PhysicianSignatureItem,
  type SignatureCandidateRow,
} from "../../server/services/physicianPortal/signatureRules";
import type { ProcedureNote } from "../../shared/schema/generatedNotes";

const note = (over: Partial<ProcedureNote> = {}): ProcedureNote => ({
  id: 1,
  clinicId: null,
  executionCaseId: null,
  patientScreeningId: 100,
  procedureEventId: null,
  serviceType: "BrainWave",
  noteType: "order_note",
  generationStatus: "generated",
  generatedText: "body",
  generatedByAi: false,
  sourceData: {},
  errorMessage: null,
  signatureStatus: "needs_signature",
  signedAt: null,
  signedByUserId: null,
  returnReason: null,
  createdAt: new Date("2026-07-11T12:00:00Z"),
  updatedAt: new Date("2026-07-11T12:00:00Z"),
  ...over,
});

const row = (over: Partial<SignatureCandidateRow> = {}): SignatureCandidateRow => ({
  ...note(),
  patientName: "Jane Doe",
  patientDob: "1970-01-01",
  patientAge: 55,
  patientGender: "F",
  patientInsurance: "Medicare",
  patientFacility: "Clinic A",
  diagnoses: null,
  history: null,
  medications: null,
  ...over,
});

async function testEligibleForSignHappyPath() {
  const g = eligibleForSign(note());
  assert.equal(g.ok, true);
}

async function testEligibleForSignRejectsMissingNote() {
  const g = eligibleForSign(undefined);
  assert.equal(g.ok, false);
  if (!g.ok) {
    assert.equal(g.code, 404);
    assert.match(g.error, /not found/i);
  }
}

async function testEligibleForSignRejectsAlreadySigned() {
  const g = eligibleForSign(note({ signatureStatus: "signed" }));
  assert.equal(g.ok, false);
  if (!g.ok) {
    assert.equal(g.code, 409);
    assert.match(g.error, /already signed/i);
  }
}

async function testEligibleForSignRejectsUnsignableGenStatus() {
  const g = eligibleForSign(note({ generationStatus: "queued" }));
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.code, 409);
}

async function testEligibleForSignRejectsEmptyBody() {
  const g = eligibleForSign(note({ generatedText: null }));
  assert.equal(g.ok, false);
  if (!g.ok) {
    assert.equal(g.code, 409);
    assert.match(g.error, /no generated content/i);
  }
}

async function testEligibleForSignAcceptsApprovedGenStatus() {
  const g = eligibleForSign(note({ generationStatus: "approved" }));
  assert.equal(g.ok, true);
}

async function testComputeSignatureItemOrderNoteIsSignable() {
  const item = computeSignatureItem(row(), false, "ready_to_generate");
  assert.equal(item.signable, true);
  assert.equal(item.reportUploaded, false);
  assert.equal(item.flags.missingReport, false, "order notes never need a report");
  assert.equal(item.billingBlocked, false);
}

// Additive fields: requiresScreening + ancillaryCaseId are sourced from the
// server-side canonical context/row (no frontend inference).
async function testComputeSignatureItemExposesScreeningRequirementFromCtx() {
  // No orderNoteCtx → requiresScreening defaults false (legacy/flag-off path).
  const noCtx = computeSignatureItem(row(), false, "ready_to_generate");
  assert.equal(noCtx.requiresScreening, false);

  // Screening-required service (BW/VW) → surfaced true from ctx.requireScreening.
  const required = computeSignatureItem(
    row({ evaluatedScreeningEvidenceVersion: "v1" }),
    false,
    "ready_to_generate",
    { requireScreening: true, screeningComplete: true, currentScreeningVersion: "v1" },
  );
  assert.equal(required.requiresScreening, true);

  // Non-screening service → false even with ctx.
  const notRequired = computeSignatureItem(
    row(),
    false,
    "ready_to_generate",
    { requireScreening: false, screeningComplete: false, currentScreeningVersion: null },
  );
  assert.equal(notRequired.requiresScreening, false);
}

async function testComputeSignatureItemExposesAncillaryCaseId() {
  const linked = computeSignatureItem(row({ ancillaryCaseId: 4242 }), false, "ready_to_generate");
  assert.equal(linked.ancillaryCaseId, 4242);
  const unlinked = computeSignatureItem(row({ ancillaryCaseId: null }), false, "ready_to_generate");
  assert.equal(unlinked.ancillaryCaseId, null);
}

async function testComputeSignatureItemPostProcNeedsReport() {
  const item = computeSignatureItem(
    row({ noteType: "post_procedure_note" }),
    false,
    "ready_to_generate",
  );
  assert.equal(item.signable, false, "post-procedure needs a report");
  assert.equal(item.flags.missingReport, true);
}

async function testComputeSignatureItemPostProcSignableWithReport() {
  const item = computeSignatureItem(
    row({ noteType: "post_procedure_note" }),
    true,
    "ready_to_generate",
  );
  assert.equal(item.signable, true);
  assert.equal(item.flags.missingReport, false);
  assert.equal(item.reportUploaded, true);
}

async function testComputeSignatureItemAlreadySignedNotSignable() {
  const item = computeSignatureItem(
    row({ signatureStatus: "signed" }),
    true,
    "ready_to_generate",
  );
  assert.equal(item.signable, false);
  assert.equal(item.signatureStatus, "signed");
}

async function testComputeSignatureItemNullSignatureStatusDefaults() {
  const item = computeSignatureItem(
    row({ signatureStatus: null }),
    true,
    "ready_to_generate",
  );
  assert.equal(item.signatureStatus, "needs_signature");
}

async function testComputeSignatureItemBillingBlockedFlag() {
  const item: PhysicianSignatureItem = computeSignatureItem(
    row(),
    false,
    "denied",
  );
  assert.equal(item.billingBlocked, true);
  assert.equal(item.flags.billingBlocked, true);
  // Billing block is a warning, not a signing block.
  assert.equal(item.signable, true, "order note stays signable even when billing blocked");
}

async function testComputeSignatureItemMissingBodyBlocksAll() {
  const item = computeSignatureItem(
    row({ generatedText: null }),
    true,
    "ready_to_generate",
  );
  assert.equal(item.signable, false);
  assert.equal(item.flags.notSignable, true);
}

async function main() {
  await testEligibleForSignHappyPath();
  await testEligibleForSignRejectsMissingNote();
  await testEligibleForSignRejectsAlreadySigned();
  await testEligibleForSignRejectsUnsignableGenStatus();
  await testEligibleForSignRejectsEmptyBody();
  await testEligibleForSignAcceptsApprovedGenStatus();
  await testComputeSignatureItemOrderNoteIsSignable();
  await testComputeSignatureItemExposesScreeningRequirementFromCtx();
  await testComputeSignatureItemExposesAncillaryCaseId();
  await testComputeSignatureItemPostProcNeedsReport();
  await testComputeSignatureItemPostProcSignableWithReport();
  await testComputeSignatureItemAlreadySignedNotSignable();
  await testComputeSignatureItemNullSignatureStatusDefaults();
  await testComputeSignatureItemBillingBlockedFlag();
  await testComputeSignatureItemMissingBodyBlocksAll();
  console.log("physicianSignatureWorkflow.test.ts: all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
