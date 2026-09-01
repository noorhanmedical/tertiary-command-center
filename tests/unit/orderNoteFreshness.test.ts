// Post-signature Order Note freshness — pure comparison semantics.
//   npx tsx tests/unit/orderNoteFreshness.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { isSignedNoteStale } from "../../server/services/ancillaryDocuments/orderNoteFreshness";

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: (e as Error).message }); }
}

test("signed + matching fingerprint ⇒ NOT stale (fresh)", () => {
  assert.equal(isSignedNoteStale({ signatureStatus: "signed", evidenceFingerprint: "abc" }, "abc"), false);
});
test("signed + differing fingerprint ⇒ STALE (material change)", () => {
  assert.equal(isSignedNoteStale({ signatureStatus: "signed", evidenceFingerprint: "abc" }, "def"), true);
});
test("signed + null current fingerprint ⇒ STALE (fail closed)", () => {
  assert.equal(isSignedNoteStale({ signatureStatus: "signed", evidenceFingerprint: "abc" }, null), true);
});
test("unsigned note ⇒ never stale (freshness only applies post-signature)", () => {
  assert.equal(isSignedNoteStale({ signatureStatus: "needs_signature", evidenceFingerprint: "abc" }, "def"), false);
});
test("signed + null frozen fingerprint vs a current fingerprint ⇒ STALE", () => {
  assert.equal(isSignedNoteStale({ signatureStatus: "signed", evidenceFingerprint: null }, "abc"), true);
});

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`PASS  ${r.name}`);
  else { failed++; console.log(`FAIL  ${r.name}\n      ${r.err}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
console.log("Order Note freshness QA passed.");
