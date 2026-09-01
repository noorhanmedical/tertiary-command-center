// Slice G — behavioral QA for Billing Document CPT/ICD selection.
//   npx tsx tests/unit/billingCodeSelectionG.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import {
  selectBillingDocumentCodes,
  approvedCptCatalogForService,
  extractApprovedIcd10FromReasoning,
} from "../../shared/schema/billingCodeMap";
import { parseProcedureComponents } from "../../shared/schema/procedureComponents";

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: (e as Error).message }); }
}

const bwAll = parseProcedureComponents("BrainWave", {
  neuropsychologicalTesting: { performed: true }, eeg: { performed: true },
  ecg: { performed: true }, vep: { performed: true }, aep: { performed: true },
})!;
const bwNoAep = parseProcedureComponents("BrainWave", {
  neuropsychologicalTesting: { performed: true }, eeg: { performed: true },
  ecg: { performed: true }, vep: { performed: true }, aep: { performed: false },
})!;
const vwAll = parseProcedureComponents("VitalWave", {
  autonomicTesting: { performed: true }, tiltTable: { performed: true },
  bloodPressureHeartRateMonitoring: { performed: true }, segmentalPressures: { performed: true },
  waveformAnalysis: { performed: true }, rhythmEcg: { performed: true },
})!;

const BW_ALL_APPROVED = ["96132", "96138", "96139", "95816", "95957", "93040", "95930", "92653"];
const VW_ALL_APPROVED = ["93923", "95924", "93040"];

test("BW all performed + all approved ⇒ all BW codes, deduped", () => {
  const r = selectBillingDocumentCodes({ serviceType: "BrainWave", components: bwAll, approvedCptCodes: BW_ALL_APPROVED, approvedIcd10Codes: ["G31.84"] });
  assert.deepEqual([...r.cpt].sort(), [...BW_ALL_APPROVED].sort());
  assert.deepEqual(r.icd10, ["G31.84"]);
});

test("component not performed (AEP) ⇒ 92653 excluded even though approved", () => {
  const r = selectBillingDocumentCodes({ serviceType: "BrainWave", components: bwNoAep, approvedCptCodes: BW_ALL_APPROVED, approvedIcd10Codes: [] });
  assert.ok(!r.cpt.includes("92653"));
  assert.ok(r.excludedNotPerformed.includes("92653"));
});

test("code supported but NOT approved ⇒ excluded", () => {
  const r = selectBillingDocumentCodes({ serviceType: "BrainWave", components: bwAll, approvedCptCodes: ["96132", "95816"], approvedIcd10Codes: [] });
  assert.deepEqual([...r.cpt].sort(), ["95816", "96132"]);
  assert.ok(r.excludedNotApproved.includes("95930")); // supported (VEP performed) but not approved
});

test("VitalWave ⇒ 93040 appears once (deduped), plus 93923 + 95924", () => {
  const r = selectBillingDocumentCodes({ serviceType: "VitalWave", components: vwAll, approvedCptCodes: VW_ALL_APPROVED, approvedIcd10Codes: ["I95.1"] });
  assert.equal(r.cpt.filter((c) => c === "93040").length, 1);
  assert.ok(r.cpt.includes("93923") && r.cpt.includes("95924") && r.cpt.includes("93040"));
});

test("no approved codes ⇒ nothing billed (fail-closed) + warning", () => {
  const r = selectBillingDocumentCodes({ serviceType: "BrainWave", components: bwAll, approvedCptCodes: [], approvedIcd10Codes: [] });
  assert.deepEqual(r.cpt, []);
  assert.ok(r.warnings.includes("no_approved_cpt_codes"));
});

test("no invented codes: every billed code is component-supported AND approved", () => {
  const r = selectBillingDocumentCodes({ serviceType: "BrainWave", components: bwNoAep, approvedCptCodes: BW_ALL_APPROVED, approvedIcd10Codes: [] });
  for (const c of r.cpt) {
    assert.ok(r.componentSupportedCpt.includes(c), `${c} not component-supported`);
    assert.ok(BW_ALL_APPROVED.includes(c), `${c} not approved`);
  }
});

test("no components ⇒ nothing billed; approved ICD still surfaced", () => {
  const r = selectBillingDocumentCodes({ serviceType: "BrainWave", components: null, approvedCptCodes: BW_ALL_APPROVED, approvedIcd10Codes: ["G31.84"] });
  assert.deepEqual(r.cpt, []);
  assert.deepEqual(r.icd10, ["G31.84"]);
  assert.ok(r.warnings.includes("no_component_evidence"));
});

// ── approvedCptCatalogForService (canonical approved catalog, deduped) ──
test("approvedCptCatalogForService(BrainWave) ⇒ 8 canonical CPT, deduped", () => {
  const cat = approvedCptCatalogForService("BrainWave");
  assert.deepEqual([...cat].sort(), [...BW_ALL_APPROVED].sort());
  assert.equal(cat.length, new Set(cat).size); // no dupes
});

test("approvedCptCatalogForService(VitalWave) ⇒ 93923/95924/93040, 93040 once", () => {
  const cat = approvedCptCatalogForService("VitalWave");
  assert.deepEqual([...cat].sort(), [...VW_ALL_APPROVED].sort());
  assert.equal(cat.filter((c) => c === "93040").length, 1);
});

test("approvedCptCatalogForService(unknown service) ⇒ []", () => {
  assert.deepEqual(approvedCptCatalogForService("Radiology"), []);
  assert.deepEqual(approvedCptCatalogForService(""), []);
});

// ── extractApprovedIcd10FromReasoning (per-case approved ICD) ──
test("extractApprovedIcd10FromReasoning finds brain key, returns icd10_codes", () => {
  const reasoning = { "BrainWave Testing": { icd10_codes: ["G31.84", "R41.3"] } };
  assert.deepEqual(extractApprovedIcd10FromReasoning(reasoning, "BrainWave"), ["G31.84", "R41.3"]);
});

test("extractApprovedIcd10FromReasoning finds vital key, returns icd10_codes", () => {
  const reasoning = { "VitalWave Assessment": { icd10_codes: ["I95.1"] } };
  assert.deepEqual(extractApprovedIcd10FromReasoning(reasoning, "VitalWave"), ["I95.1"]);
});

test("extractApprovedIcd10FromReasoning dedupes", () => {
  const reasoning = { brainwave: { icd10_codes: ["G31.84", "G31.84", "R41.3"] } };
  assert.deepEqual(extractApprovedIcd10FromReasoning(reasoning, "BrainWave"), ["G31.84", "R41.3"]);
});

test("extractApprovedIcd10FromReasoning ⇒ [] when service key absent", () => {
  const reasoning = { "VitalWave Assessment": { icd10_codes: ["I95.1"] } };
  assert.deepEqual(extractApprovedIcd10FromReasoning(reasoning, "BrainWave"), []);
});

test("extractApprovedIcd10FromReasoning ⇒ [] when reasoning null/empty/malformed", () => {
  assert.deepEqual(extractApprovedIcd10FromReasoning(null, "BrainWave"), []);
  assert.deepEqual(extractApprovedIcd10FromReasoning({}, "BrainWave"), []);
  assert.deepEqual(extractApprovedIcd10FromReasoning({ brainwave: {} }, "BrainWave"), []);
  assert.deepEqual(extractApprovedIcd10FromReasoning({ brainwave: { icd10_codes: "nope" } }, "BrainWave"), []);
});

test("extractApprovedIcd10FromReasoning filters non-string entries", () => {
  const reasoning = { brainwave: { icd10_codes: ["G31.84", 42, null, "R41.3"] } };
  assert.deepEqual(extractApprovedIcd10FromReasoning(reasoning, "BrainWave"), ["G31.84", "R41.3"]);
});

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`PASS  ${r.name}`);
  else { failed++; console.log(`FAIL  ${r.name}\n      ${r.err}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
console.log("G QA passed.");
