// Shared service-relevance registry + relevant-first retention (the fix for
// pre-projection bounding / false-fresh).
//   npx tsx tests/unit/orderNoteEvidenceRelevance.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import {
  serviceKeyForOrderNoteMateriality,
  isEvidenceRelevantToService,
  retainRelevantFirst,
} from "../../server/services/ancillaryDocuments/orderNoteEvidenceRelevance";

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: (e as Error).message }); }
}

type Ev = { concept: string; displayText: string; id: string };
const ev = (concept: string, displayText: string, id: string): Ev => ({ concept, displayText, id });
const ck = (e: Ev) => `${e.concept}|${e.displayText}`;

// ── classification ──
test("service classification matches canonical identities", () => {
  assert.equal(serviceKeyForOrderNoteMateriality("Echocardiogram TTE"), "echo");
  assert.equal(serviceKeyForOrderNoteMateriality("Stress Echocardiogram"), "stress_echo");
  assert.equal(serviceKeyForOrderNoteMateriality("Renal Artery Doppler"), "renal");
  assert.equal(serviceKeyForOrderNoteMateriality("Bilateral Carotid Duplex"), "carotid");
  assert.equal(serviceKeyForOrderNoteMateriality("BrainWave"), "brainwave");
  assert.equal(serviceKeyForOrderNoteMateriality("Totally Unknown Service"), "generic");
});

// ── relevance predicate (parity: same helper both consumers use) ──
test("echo: BNP/troponin relevant; liver enzymes NOT relevant", () => {
  assert.equal(isEvidenceRelevantToService("echo", ev("bnp", "BNP 820 pg/mL [high]", "1")), true);
  assert.equal(isEvidenceRelevantToService("echo", ev("troponin", "Troponin 0.9 [high]", "2")), true);
  assert.equal(isEvidenceRelevantToService("echo", ev("alt", "ALT 88 U/L [high]", "3")), false);
  assert.equal(isEvidenceRelevantToService("echo", ev("ast", "AST 76 U/L [high]", "4")), false);
});
test("renal: creatinine/eGFR relevant; liver NOT relevant", () => {
  assert.equal(isEvidenceRelevantToService("renal", ev("creatinine", "Creatinine 2.1 mg/dL [high]", "1")), true);
  assert.equal(isEvidenceRelevantToService("renal", ev("egfr", "eGFR 38 [low]", "2")), true);
  assert.equal(isEvidenceRelevantToService("renal", ev("alt", "ALT 88 U/L [high]", "3")), false);
});
test("carotid: carotid imaging relevant; knee X-ray NOT relevant", () => {
  assert.equal(isEvidenceRelevantToService("carotid", ev("carotid cta", "Carotid CTA — 60% stenosis", "1")), true);
  assert.equal(isEvidenceRelevantToService("carotid", ev("knee xray", "Left knee X-ray — osteoarthritis", "2")), false);
});
test("generic service keeps ALL evidence (fail-safe)", () => {
  assert.equal(isEvidenceRelevantToService("generic", ev("alt", "ALT 88", "1")), true);
});

// ── retainRelevantFirst: THE fix ──
function unrelatedLabs(n: number): Ev[] {
  return Array.from({ length: n }, (_, i) => ev(`analyte${i}`, `Analyte${i} ${i} [high]`, `u${i}`));
}

test("14 unrelated + 1 relevant (relevant LAST) ⇒ relevant retained", () => {
  const ranked = [...unrelatedLabs(14), ev("bnp", "BNP 820 [high]", "rel")];
  const out = retainRelevantFirst(ranked, "echo", 14, ck);
  assert.ok(out.some((e) => e.id === "rel"), "relevant BNP must be retained despite 14 higher-ranked unrelated labs");
});
test("15 unrelated + 1 relevant ⇒ relevant retained (beyond old bound)", () => {
  const ranked = [...unrelatedLabs(15), ev("bnp", "BNP 820 [high]", "rel")];
  const out = retainRelevantFirst(ranked, "echo", 14, ck);
  assert.ok(out.some((e) => e.id === "rel"));
});
test("30 unrelated + 1 relevant ⇒ relevant retained", () => {
  const ranked = [...unrelatedLabs(30), ev("bnp", "BNP 820 [high]", "rel")];
  const out = retainRelevantFirst(ranked, "echo", 14, ck);
  assert.ok(out.some((e) => e.id === "rel"));
});
test("contextual portion stays bounded to the cap", () => {
  const ranked = [...unrelatedLabs(30), ev("bnp", "BNP 820 [high]", "rel")];
  const out = retainRelevantFirst(ranked, "echo", 14, ck);
  const contextualCount = out.filter((e) => !isEvidenceRelevantToService("echo", e)).length;
  assert.equal(contextualCount, 14, "contextual must be capped at 14");
});
test("relevant retention does NOT depend on rank/position among unrelated", () => {
  // Same relevant item, whether placed first or dead last, is always present.
  const first = retainRelevantFirst([ev("bnp", "BNP 820 [high]", "rel"), ...unrelatedLabs(30)], "echo", 14, ck);
  const last = retainRelevantFirst([...unrelatedLabs(30), ev("bnp", "BNP 820 [high]", "rel")], "echo", 14, ck);
  assert.ok(first.some((e) => e.id === "rel") && last.some((e) => e.id === "rel"));
});
test("dedupes by content identity (not row id)", () => {
  const ranked = [ev("bnp", "BNP 820 [high]", "id1"), ev("bnp", "BNP 820 [high]", "id2")];
  const out = retainRelevantFirst(ranked, "echo", 14, ck);
  assert.equal(out.length, 1, "identical content with different ids must dedupe");
});

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`PASS  ${r.name}`);
  else { failed++; console.log(`FAIL  ${r.name}\n      ${r.err}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
console.log("Order Note evidence relevance QA passed.");
