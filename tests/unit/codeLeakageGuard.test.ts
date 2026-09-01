// ICD/CPT boundary guard — renders real Order Note + Procedure Note bodies and
// asserts NO ICD-10 / CPT leakage. Billing Document is the only place codes are
// allowed (covered by billingCodeSelectionG).
//   npx tsx tests/unit/codeLeakageGuard.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { renderOrderNoteBody, type OrderNoteEvidenceBundle } from "../../server/services/ancillaryDocuments/orderNoteBody";
import { renderProcedureNoteBody } from "../../server/services/procedureLifecycle/procedureNoteBody";
import { parseProcedureComponents } from "../../shared/schema/procedureComponents";

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: (e as Error).message }); }
}

// Scans for ICD-10 (e.g. G31.84, I10), CPT (5-digit), and the literals.
function assertNoCodes(text: string, where: string) {
  assert.ok(!/\bICD\b/i.test(text), `${where}: ICD literal`);
  assert.ok(!/\bCPT\b/i.test(text), `${where}: CPT literal`);
  assert.ok(!/\b\d{5}\b/.test(text), `${where}: CPT-like 5-digit code`);
  assert.ok(!/\b[A-TV-Z]\d{2}(\.\d+)?\b/.test(text), `${where}: ICD-10-like code`);
}

test("Order Note body (chart dx present) contains no ICD/CPT", () => {
  const bundle: OrderNoteEvidenceBundle = {
    service: "BrainWave", serviceLabel: "BrainWave – Comprehensive Assessment",
    patient: { name: "Maria Lopez", dob: "1968-04-12" },
    orderingClinician: { name: "Dr. Alan Carter", id: "c1" },
    chartDiagnoses: [{ displayText: "Mild Cognitive Impairment", concept: "Mild Cognitive Impairment", source: "chart_documented" }],
    qualificationFactors: ["Memory Loss"], clinicianUnderstanding: "Objective testing indicated.",
    screening: { questionnaire: "brainwave", version: "v1", responses: [
      { questionId: "bw_dx_memory_problems", questionnaire: "brainwave", section: "diagnosis_history", questionVersion: "bw_v1", responseType: "severity_scale", value: 4, normalizedMeaning: "severe", concept: "memory_difficulty", evidenceClass: "patient_reported_condition_history" } as any,
    ] },
  };
  assertNoCodes(renderOrderNoteBody(bundle).text, "OrderNote");
});

test("Procedure Note body (full BW) contains no ICD/CPT", () => {
  const bwAll = parseProcedureComponents("BrainWave", {
    neuropsychologicalTesting: { performed: true }, eeg: { performed: true }, ecg: { performed: true }, vep: { performed: true }, aep: { performed: true },
  })!;
  const text = renderProcedureNoteBody({
    service: "BrainWave", serviceLabel: "BrainWave – Comprehensive Assessment",
    patient: { name: "Maria Lopez" }, orderingClinician: { name: "Dr. Alan Carter" },
    dateOfService: "2026-08-31T10:15:00.000Z", components: bwAll, procedureStatus: "complete",
    associatedOrder: { orderNoteId: 42, orderDate: "2026-08-28", signedAt: "2026-08-31T09:01:00.000Z", orderingClinicianName: "Dr. Alan Carter", status: "signed" },
  }).text;
  assertNoCodes(text, "ProcedureNote");
});

test("Procedure Note body (VitalWave full) contains no ICD/CPT", () => {
  const vwAll = parseProcedureComponents("VitalWave", {
    autonomicTesting: { performed: true }, tiltTable: { performed: true }, bloodPressureHeartRateMonitoring: { performed: true },
    segmentalPressures: { performed: true }, waveformAnalysis: { performed: true }, rhythmEcg: { performed: true },
  })!;
  const text = renderProcedureNoteBody({
    service: "VitalWave", serviceLabel: "VitalWave – Comprehensive Autonomic & Vascular Assessment",
    patient: { name: "John Reyes" }, orderingClinician: { name: "Dr. Pat Lee" },
    dateOfService: "2026-08-31T11:00:00.000Z", components: vwAll, procedureStatus: "complete", associatedOrder: null,
  }).text;
  assertNoCodes(text, "ProcedureNote-VW");
});

let failed = 0;
for (const r of results) { if (r.ok) console.log(`PASS  ${r.name}`); else { failed++; console.log(`FAIL  ${r.name}\n      ${r.err}`); } }
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
console.log("Code-leakage guard passed.");
