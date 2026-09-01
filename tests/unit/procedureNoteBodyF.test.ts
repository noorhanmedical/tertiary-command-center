// Slice F — behavioral QA for canonical Procedure Note body + component evidence.
//   npx tsx tests/unit/procedureNoteBodyF.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import {
  parseProcedureComponents,
  allExpectedComponentsPerformed,
  performedComponentKeys,
  type ProcedureComponents,
} from "../../shared/schema/procedureComponents";
import { renderProcedureNoteBody, type ProcedureNoteRenderInput } from "../../server/services/procedureLifecycle/procedureNoteBody";

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: (e as Error).message }); }
}

const bwAll = parseProcedureComponents("BrainWave", {
  neuropsychologicalTesting: { performed: true }, eeg: { performed: true, channelCount: 21 },
  ecg: { performed: true }, vep: { performed: true }, aep: { performed: true },
})!;
const bwMissingAep = parseProcedureComponents("BrainWave", {
  neuropsychologicalTesting: { performed: true }, eeg: { performed: true },
  ecg: { performed: true }, vep: { performed: true }, aep: { performed: false },
})!;
const vwAll = parseProcedureComponents("VitalWave", {
  autonomicTesting: { performed: true }, tiltTable: { performed: true },
  bloodPressureHeartRateMonitoring: { performed: true }, segmentalPressures: { performed: true },
  waveformAnalysis: { performed: true }, rhythmEcg: { performed: true },
})!;

function input(service: string, serviceLabel: string, components: ProcedureComponents | null): ProcedureNoteRenderInput {
  return {
    service, serviceLabel,
    patient: { name: "Maria Lopez", dob: "1968-04-12", mrn: "MRN-9", clinicName: "Downtown Clinic" },
    orderingClinician: { name: "Dr. Alan Carter", npi: "1234567890" },
    dateOfService: "2026-08-31T10:15:00.000Z",
    components,
    procedureStatus: "complete",
    associatedOrder: { orderNoteId: 42, orderDate: "2026-08-28", signedAt: "2026-08-31T09:01:00.000Z", orderingClinicianName: "Dr. Alan Carter", status: "signed" },
  };
}

// ── component evidence ──
test("parse + allExpectedComponentsPerformed (BW all true)", () => {
  assert.equal(bwAll.service, "brainwave");
  assert.equal(allExpectedComponentsPerformed(bwAll), true);
});
test("missing one component ⇒ not all performed; performed keys exclude it", () => {
  assert.equal(allExpectedComponentsPerformed(bwMissingAep), false);
  assert.ok(!performedComponentKeys(bwMissingAep).includes("aep"));
});

// ── renderer ──
test("BW full protocol ⇒ approved paragraph verbatim, correct DOS, no ICD/CPT", () => {
  const { text } = renderProcedureNoteBody(input("BrainWave", "BrainWave – Comprehensive Assessment", bwAll));
  assert.ok(text.includes("VEP and AEP studies were conducted to assess visual and auditory evoked potentials."));
  assert.ok(text.includes("The BrainWave testing was completed successfully."));
  assert.ok(text.includes("Date of Service: 2026-08-31T10:15:00.000Z")); // real completed_at, not now()
  assert.ok(!/\bICD\b/i.test(text) && !/\bCPT\b/i.test(text) && !/\b\d{5}\b/.test(text));
});
test("BW missing AEP ⇒ does NOT claim AEP; not the full approved paragraph", () => {
  const { text } = renderProcedureNoteBody(input("BrainWave", "BrainWave – Comprehensive Assessment", bwMissingAep));
  assert.ok(!/AEP studies/i.test(text));
  assert.ok(!text.includes("visual and auditory evoked potentials")); // combined approved claim not used
  assert.ok(/Neuropsychological testing was performed/i.test(text)); // performed components still claimed
});
test("VitalWave full protocol ⇒ approved VitalWave paragraph", () => {
  const { text } = renderProcedureNoteBody(input("VitalWave", "VitalWave – Comprehensive Autonomic & Vascular Assessment", vwAll));
  assert.ok(text.includes("the patient was discharged in stable condition."));
  assert.ok(text.includes("Rhythm electrocardiography was performed with continuous monitoring and interpretation."));
});
test("no components ⇒ neutral statement, no fabricated component claims", () => {
  const { text } = renderProcedureNoteBody(input("BrainWave", "BrainWave – Comprehensive Assessment", null));
  assert.ok(/was not recorded/i.test(text));
  assert.ok(!/Neuropsychological testing was performed/i.test(text));
});
test("ASSOCIATED ORDER references the exact signed note and does NOT embed the order body", () => {
  const rendered = renderProcedureNoteBody(input("BrainWave", "BrainWave – Comprehensive Assessment", bwAll));
  assert.equal(rendered.associatedOrderNoteId, 42);
  assert.ok(rendered.text.includes("Order Note #42"));
  assert.ok(rendered.text.includes("Signed Order Note on File"));
  // no Order Note body sections embedded
  assert.ok(!/MEDICAL NECESSITY/i.test(rendered.text));
  assert.ok(!/QUALIFYING CLINICAL CONDITIONS/i.test(rendered.text));
});
test("required Procedure Note sections present; no fake progress-note sections", () => {
  const { sections } = renderProcedureNoteBody(input("BrainWave", "BrainWave – Comprehensive Assessment", bwAll));
  const h = sections.map((s) => s.heading);
  for (const x of ["PATIENT INFORMATION", "PROCEDURE", "INDICATION", "PROCEDURE DETAILS", "PROCEDURE STATUS", "ASSOCIATED ORDER"]) {
    assert.ok(h.includes(x), `missing ${x}`);
  }
  assert.ok(!h.includes("CHIEF COMPLAINT") && !h.includes("SUBJECTIVE") && !h.includes("ASSESSMENT & PLAN"));
});

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`PASS  ${r.name}`);
  else { failed++; console.log(`FAIL  ${r.name}\n      ${r.err}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
console.log("F QA passed.");
