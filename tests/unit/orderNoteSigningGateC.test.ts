// Slice C — behavioral QA for the Order Note signing gate (pure). Run:
//   npx tsx tests/unit/orderNoteSigningGateC.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { orderNoteSigningEligibility, type OrderNoteSignGate } from "../../server/services/physicianPortal/signatureRules";
import type { ProcedureNote } from "../../shared/schema/generatedNotes";

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: (e as Error).message }); }
}

function note(overrides: Partial<ProcedureNote> = {}): ProcedureNote {
  return {
    id: 1,
    noteType: "order_note",
    serviceType: "BrainWave",
    signatureStatus: "needs_signature",
    generationStatus: "generated",
    generatedText: "body",
    supersededAt: null,
    ancillaryCaseId: 100,
    evidenceFingerprint: "fp1",
    evaluatedScreeningEvidenceVersion: "v1",
    clinicId: 7,
    ...overrides,
  } as unknown as ProcedureNote;
}
function gate(overrides: Partial<OrderNoteSignGate> = {}): OrderNoteSignGate {
  return {
    requireScreening: true,
    screeningComplete: true,
    currentScreeningVersion: "v1",
    expectedEvidenceFingerprint: null,
    expectedScreeningVersion: null,
    authorizedSigner: true,
    ...overrides,
  };
}

test("current unsigned note, screening complete + versions match ⇒ eligible", () => {
  assert.deepEqual(orderNoteSigningEligibility(note(), gate()), { ok: true });
});

test("superseded note ⇒ 409 ORDER_NOTE_STALE", () => {
  const r = orderNoteSigningEligibility(note({ supersededAt: new Date() }), gate());
  assert.equal(r.ok, false);
  assert.equal((r as any).code, 409);
  assert.equal((r as any).reason, "ORDER_NOTE_STALE");
});

test("unlinked note (no ancillary case) ⇒ 409 ORDER_NOTE_NOT_READY", () => {
  const r = orderNoteSigningEligibility(note({ ancillaryCaseId: null }), gate());
  assert.equal((r as any).reason, "ORDER_NOTE_NOT_READY");
});

test("screening incomplete ⇒ 409 REQUIRED_SCREENING_INCOMPLETE", () => {
  const r = orderNoteSigningEligibility(note(), gate({ screeningComplete: false, currentScreeningVersion: null }));
  assert.equal((r as any).reason, "REQUIRED_SCREENING_INCOMPLETE");
});

test("note evaluated against v1 but current screening is v2 ⇒ 409 ORDER_NOTE_STALE", () => {
  const r = orderNoteSigningEligibility(note({ evaluatedScreeningEvidenceVersion: "v1" }), gate({ currentScreeningVersion: "v2" }));
  assert.equal((r as any).reason, "ORDER_NOTE_STALE");
});

test("stale client screening-version token ⇒ 409 ORDER_NOTE_STALE", () => {
  const r = orderNoteSigningEligibility(note(), gate({ expectedScreeningVersion: "v0" }));
  assert.equal((r as any).reason, "ORDER_NOTE_STALE");
});

test("stale client fingerprint token ⇒ 409 ORDER_NOTE_STALE", () => {
  const r = orderNoteSigningEligibility(note({ evidenceFingerprint: "fpNEW" }), gate({ expectedEvidenceFingerprint: "fpOLD" }));
  assert.equal((r as any).reason, "ORDER_NOTE_STALE");
});

test("matching client tokens ⇒ eligible", () => {
  const r = orderNoteSigningEligibility(note({ evidenceFingerprint: "fpX" }), gate({ expectedEvidenceFingerprint: "fpX", expectedScreeningVersion: "v1" }));
  assert.deepEqual(r, { ok: true });
});

test("unauthorized signer ⇒ 403 CLINICIAN_NOT_AUTHORIZED", () => {
  const r = orderNoteSigningEligibility(note(), gate({ authorizedSigner: false }));
  assert.equal((r as any).code, 403);
  assert.equal((r as any).reason, "CLINICIAN_NOT_AUTHORIZED");
});

test("non-screening service (requireScreening=false) is not blocked by screening currency", () => {
  const r = orderNoteSigningEligibility(
    note({ serviceType: "Ultrasound", evaluatedScreeningEvidenceVersion: null }),
    gate({ requireScreening: false, screeningComplete: false, currentScreeningVersion: null }),
  );
  assert.deepEqual(r, { ok: true });
});

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`PASS  ${r.name}`);
  else { failed++; console.log(`FAIL  ${r.name}\n      ${r.err}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
console.log("C QA passed.");
