// Slice B-minimal — derived Order Note portal state + signature-item enrichment.
//   npx tsx tests/unit/orderNotePortalStateB.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import {
  deriveOrderNotePortalState,
  computeSignatureItem,
  type SignatureCandidateRow,
} from "../../server/services/physicianPortal/signatureRules";
import type { ProcedureNote } from "../../shared/schema/generatedNotes";

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: (e as Error).message }); }
}

function note(o: Partial<ProcedureNote> = {}): ProcedureNote {
  return {
    id: 1, noteType: "order_note", serviceType: "BrainWave",
    signatureStatus: "needs_signature", generationStatus: "generated", generatedText: "body",
    supersededAt: null, ancillaryCaseId: 5, evidenceFingerprint: "fp1", evaluatedScreeningEvidenceVersion: "v1",
    clinicId: 7, ...o,
  } as unknown as ProcedureNote;
}
function candidate(o: Partial<ProcedureNote> = {}): SignatureCandidateRow {
  return {
    ...note(o),
    patientName: "Maria Lopez", patientDob: "1968-01-01", patientAge: 57, patientGender: "F",
    patientInsurance: null, patientFacility: null, diagnoses: null, history: null, medications: null,
    createdAt: new Date(), returnReason: null, procedureEventId: null, patientScreeningId: 9, executionCaseId: 3,
  } as unknown as SignatureCandidateRow;
}

// ─── deriveOrderNotePortalState ───
test("signed ⇒ signed", () => {
  assert.equal(deriveOrderNotePortalState(note({ signatureStatus: "signed" }), { requireScreening: true, screeningComplete: true, currentScreeningVersion: "v1" }), "signed");
});
test("body-less pending ⇒ awaiting_screening", () => {
  assert.equal(deriveOrderNotePortalState(note({ generationStatus: "pending", generatedText: null }), { requireScreening: true, screeningComplete: false, currentScreeningVersion: null }), "awaiting_screening");
});
test("body + screening incomplete ⇒ awaiting_screening", () => {
  assert.equal(deriveOrderNotePortalState(note(), { requireScreening: true, screeningComplete: false, currentScreeningVersion: null }), "awaiting_screening");
});
test("body + screening complete + evaluated != current ⇒ updated_review_required", () => {
  assert.equal(deriveOrderNotePortalState(note({ evaluatedScreeningEvidenceVersion: "v1" }), { requireScreening: true, screeningComplete: true, currentScreeningVersion: "v2" }), "updated_review_required");
});
test("body + screening complete + evaluated == current ⇒ ready_for_review", () => {
  assert.equal(deriveOrderNotePortalState(note({ evaluatedScreeningEvidenceVersion: "v1" }), { requireScreening: true, screeningComplete: true, currentScreeningVersion: "v1" }), "ready_for_review");
});
test("non-screening service with body ⇒ ready_for_review", () => {
  assert.equal(deriveOrderNotePortalState(note({ serviceType: "Ultrasound", evaluatedScreeningEvidenceVersion: null }), { requireScreening: false, screeningComplete: true, currentScreeningVersion: null }), "ready_for_review");
});

// ─── computeSignatureItem enrichment ───
test("order note ready_for_review ⇒ signable + tokens exposed", () => {
  const item = computeSignatureItem(candidate(), false, "not_ready", { requireScreening: true, screeningComplete: true, currentScreeningVersion: "v1" });
  assert.equal(item.orderNotePortalState, "ready_for_review");
  assert.equal(item.signable, true);
  assert.equal(item.expectedEvidenceFingerprint, "fp1");
  assert.equal(item.expectedScreeningVersion, "v1");
  assert.equal(item.screeningComplete, true);
});
test("order note updated_review_required ⇒ NOT signable", () => {
  const item = computeSignatureItem(candidate(), false, "not_ready", { requireScreening: true, screeningComplete: true, currentScreeningVersion: "v2" });
  assert.equal(item.orderNotePortalState, "updated_review_required");
  assert.equal(item.signable, false);
});
test("order note awaiting_screening ⇒ NOT signable", () => {
  const item = computeSignatureItem(candidate(), false, "not_ready", { requireScreening: true, screeningComplete: false, currentScreeningVersion: null });
  assert.equal(item.orderNotePortalState, "awaiting_screening");
  assert.equal(item.signable, false);
});
test("legacy order note (no context) keeps body-based signable + null state", () => {
  const item = computeSignatureItem(candidate(), false, "not_ready", null);
  assert.equal(item.orderNotePortalState, null);
  assert.equal(item.signable, true); // has body, unsigned, order notes don't require report
});
test("post_procedure_note unchanged: needs report to be signable", () => {
  const noReport = computeSignatureItem(candidate({ noteType: "post_procedure_note" }), false, "not_ready", null);
  assert.equal(noReport.signable, false);
  const withReport = computeSignatureItem(candidate({ noteType: "post_procedure_note" }), true, "not_ready", null);
  assert.equal(withReport.signable, true);
  assert.equal(withReport.orderNotePortalState, null);
});

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`PASS  ${r.name}`);
  else { failed++; console.log(`FAIL  ${r.name}\n      ${r.err}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
console.log("B-minimal QA passed.");
