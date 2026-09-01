// Slice E — behavioral QA for semantic procedure prerequisite resolution.
//   npx tsx tests/unit/procedurePrereqSemanticE.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { applySemanticPrerequisites } from "../../server/services/procedureLifecycle/procedurePrerequisiteRules";

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: (e as Error).message }); }
}

test("PDF/flag-only screening_form does NOT satisfy the structured requirement (BW/VW)", () => {
  const raw = new Set(["screening_form", "informed_consent"]); // screening_form from a PDF/flag readiness row
  const out = applySemanticPrerequisites(raw, { requiresStructuredScreening: true, structuredScreeningComplete: false, currentOrderNoteSigned: false });
  assert.ok(!out.has("screening_form"));
  assert.ok(out.has("informed_consent")); // other doc types pass through
});

test("structured screening complete satisfies screening_form", () => {
  const out = applySemanticPrerequisites(new Set(), { requiresStructuredScreening: true, structuredScreeningComplete: true, currentOrderNoteSigned: false });
  assert.ok(out.has("screening_form"));
});

test("non-structured service leaves screening_form presence untouched", () => {
  const out = applySemanticPrerequisites(new Set(["screening_form"]), { requiresStructuredScreening: false, structuredScreeningComplete: false, currentOrderNoteSigned: false });
  assert.ok(out.has("screening_form"));
});

test("order_note_signature satisfied only by a current signed Order Note", () => {
  const signed = applySemanticPrerequisites(new Set(), { requiresStructuredScreening: true, structuredScreeningComplete: true, currentOrderNoteSigned: true });
  assert.ok(signed.has("order_note_signature"));
  const unsigned = applySemanticPrerequisites(new Set(["order_note_signature"]), { requiresStructuredScreening: true, structuredScreeningComplete: true, currentOrderNoteSigned: false });
  assert.ok(!unsigned.has("order_note_signature")); // never trust a stray token
});

test("BW ready: structured screening + signed order note ⇒ both satisfied", () => {
  const out = applySemanticPrerequisites(new Set(["informed_consent"]), { requiresStructuredScreening: true, structuredScreeningComplete: true, currentOrderNoteSigned: true });
  assert.ok(out.has("screening_form") && out.has("order_note_signature") && out.has("informed_consent"));
});

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`PASS  ${r.name}`);
  else { failed++; console.log(`FAIL  ${r.name}\n      ${r.err}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
console.log("E QA passed.");
