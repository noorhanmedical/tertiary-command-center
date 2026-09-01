// Slice A1 — behavioral QA for canonical Order Note projection + body +
// fingerprint. Pure (no DB). Run:
//
//   npx tsx tests/unit/orderNoteA1.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import {
  projectScreeningFindings,
  narratedFindings,
  type OrderNoteEvidenceBundle,
} from "../../server/services/ancillaryDocuments/orderNoteProjection";
import { renderOrderNoteBody } from "../../server/services/ancillaryDocuments/orderNoteBody";
import { canonicalOrderNoteEvidenceString } from "../../server/services/ancillaryDocuments/orderNoteFingerprint";
import type { ScreeningResponse } from "../../shared/schema/screeningEvidence";

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: (e as Error).message }); }
}

function sev(questionId: string, concept: string, evidenceClass: string, value: number): ScreeningResponse {
  return { questionId, questionnaire: "brainwave", section: "diagnosis_history", questionVersion: "bw_v1", responseType: "severity_scale", value, normalizedMeaning: "x", concept, evidenceClass } as ScreeningResponse;
}
function freq(questionId: string, concept: string, evidenceClass: string, value: number): ScreeningResponse {
  return { questionId, questionnaire: "brainwave", section: "symptoms", questionVersion: "bw_v1", responseType: "frequency_scale", value, normalizedMeaning: "x", concept, evidenceClass } as ScreeningResponse;
}
function bool(questionId: string, section: string, concept: string, evidenceClass: string, value: boolean): ScreeningResponse {
  return { questionId, questionnaire: "vitalwave", section, questionVersion: "vw_v1", responseType: "boolean", value, concept, evidenceClass } as ScreeningResponse;
}

function bwBundle(overrides: Partial<OrderNoteEvidenceBundle> = {}): OrderNoteEvidenceBundle {
  return {
    service: "BrainWave",
    serviceLabel: "BrainWave – Comprehensive Assessment",
    patient: { name: "Maria Lopez", dob: "1968-04-12", mrn: "MRN-9", plexusId: "PLX-1", clinicName: "Downtown Clinic" },
    orderingClinician: { name: "Dr. Alan Carter", npi: "1234567890", id: "clin-1" },
    orderDate: "2026-08-28",
    chartDiagnoses: [{ displayText: "Mild Cognitive Impairment", concept: "Mild Cognitive Impairment", source: "chart_documented" }],
    qualificationFactors: ["Memory Loss"],
    clinicianUnderstanding: "Objective neurocognitive testing is indicated.",
    screening: {
      questionnaire: "brainwave",
      version: "ver-abc",
      responses: [
        sev("bw_dx_memory_problems", "memory_difficulty", "patient_reported_condition_history", 2),
        freq("bw_sym_forgetful_poor_memory", "memory_difficulty", "patient_reported_symptom", 4),
        freq("bw_sym_seizures_history", "seizures_history", "patient_reported_condition_history", 1),
        sev("bw_dx_headaches", "headaches", "patient_reported_condition_history", 4),
        sev("bw_dx_nausea", "nausea", "patient_reported_condition_history", 1),
        sev("bw_dx_adhd", "adhd", "patient_reported_condition_history", 0), // N/A — excluded
      ],
    },
    ...overrides,
  };
}

// ─── projection ───
test("all 1–5 positives are projected; explicit 0 is excluded", () => {
  const f = projectScreeningFindings(bwBundle());
  const concepts = f.map((x) => x.concept);
  assert.ok(concepts.includes("memory_difficulty"));
  assert.ok(concepts.includes("nausea")); // preserved as structured evidence
  assert.ok(!concepts.includes("adhd")); // value 0 = N/A, not positive
});

test("memory difficulty (severity 2) + chart MCI ⇒ narrated via corroboration", () => {
  const f = projectScreeningFindings(bwBundle());
  const mem = f.find((x) => x.concept === "memory_difficulty");
  assert.ok(mem?.narrate);
  assert.equal(mem?.corroboratedByChart, true);
  assert.ok(mem?.reasons.includes("chart_corroborated"));
});

test("seizure history (frequency 1) is narrated by concept priority despite low value", () => {
  const f = projectScreeningFindings(bwBundle());
  const sz = f.find((x) => x.concept === "seizures_history");
  assert.ok(sz?.narrate);
  assert.ok(sz?.reasons.includes("concept_priority"));
});

test("nonspecific symptom (nausea, value 1, no support) is preserved but NOT narrated", () => {
  const f = projectScreeningFindings(bwBundle());
  const n = f.find((x) => x.concept === "nausea");
  assert.ok(n);
  assert.equal(n?.narrate, false);
  assert.ok(!narratedFindings(f).some((x) => x.concept === "nausea"));
});

test("NO universal >=3 rule: value-2 corroborated finding is narrated while value-1 unsupported is not", () => {
  const f = projectScreeningFindings(bwBundle());
  assert.ok(narratedFindings(f).some((x) => x.concept === "memory_difficulty"));
  assert.ok(!narratedFindings(f).some((x) => x.concept === "nausea"));
});

// ─── body ───
test("body is patient-specific, preserves certainty, and contains NO ICD/CPT", () => {
  const { text } = renderOrderNoteBody(bwBundle());
  assert.ok(text.includes("Maria Lopez"));
  assert.ok(/reports /i.test(text)); // patient-reported certainty
  assert.ok(text.includes("memory difficulty"));
  assert.ok(!/\bICD\b/i.test(text), "ICD must not appear");
  assert.ok(!/\bCPT\b/i.test(text), "CPT must not appear");
  assert.ok(!/\b\d{5}\b/.test(text), "no CPT-like 5-digit code");
  assert.ok(!/__screening_meta__/.test(text));
});

test("body has all required Order Note sections", () => {
  const { sections } = renderOrderNoteBody(bwBundle());
  const headings = sections.map((s) => s.heading);
  for (const h of ["PATIENT INFORMATION", "REASON FOR EVALUATION", "QUALIFYING CLINICAL CONDITIONS", "ASSESSMENT", "MEDICAL NECESSITY / QUALIFICATION", "PROCEDURE ORDERED", "CLINICAL OBJECTIVES", "ORDERING CLINICIAN ATTESTATION"]) {
    assert.ok(headings.includes(h), `missing ${h}`);
  }
});

test("qualifying conditions mark chart items documented and screening items reported", () => {
  const { sections } = renderOrderNoteBody(bwBundle());
  const qc = sections.find((s) => s.heading === "QUALIFYING CLINICAL CONDITIONS")!.body;
  assert.ok(qc.includes("Mild Cognitive Impairment (documented)"));
  assert.ok(/\(reported\)/.test(qc));
});

test("patient-reported memory difficulty is NOT phrased as a diagnosis", () => {
  const { sections } = renderOrderNoteBody(bwBundle());
  const reason = sections.find((s) => s.heading === "REASON FOR EVALUATION")!.body;
  assert.ok(/reports .*memory difficulty/i.test(reason));
  assert.ok(!/has mild cognitive impairment/i.test(reason));
});

// ─── fingerprint ───
test("same projected evidence ⇒ same fingerprint", () => {
  assert.equal(canonicalOrderNoteEvidenceString(bwBundle()), canonicalOrderNoteEvidenceString(bwBundle()));
});

test("adding a NON-narrated low finding does not change the fingerprint", () => {
  const base = canonicalOrderNoteEvidenceString(bwBundle());
  const withExtra = bwBundle();
  withExtra.screening!.responses.push(sev("bw_dx_allergies", "allergies", "patient_reported_condition_history", 1));
  assert.equal(base, canonicalOrderNoteEvidenceString(withExtra));
});

test("a material narrated change (headaches 4→5) changes the fingerprint", () => {
  const base = canonicalOrderNoteEvidenceString(bwBundle());
  const bumped = bwBundle();
  const h = bumped.screening!.responses.find((r) => r.concept === "headaches")! as { value: number };
  h.value = 5;
  assert.notEqual(base, canonicalOrderNoteEvidenceString(bumped));
});

test("losing chart corroboration changes the fingerprint", () => {
  const base = canonicalOrderNoteEvidenceString(bwBundle());
  const noChart = bwBundle({ chartDiagnoses: [], qualificationFactors: [] });
  assert.notEqual(base, canonicalOrderNoteEvidenceString(noChart));
});

// ─── VitalWave ───
test("VW: PVD history narrated (priority); unrelated cancer preserved but not narrated; no ICD/CPT", () => {
  const vw: OrderNoteEvidenceBundle = {
    service: "VitalWave",
    serviceLabel: "VitalWave – Comprehensive Autonomic & Vascular Assessment",
    patient: { name: "John Reyes" },
    orderingClinician: { name: "Dr. Pat Lee", id: "clin-2" },
    chartDiagnoses: [],
    qualificationFactors: [],
    clinicianUnderstanding: null,
    screening: {
      questionnaire: "vitalwave",
      version: "vw-1",
      responses: [
        bool("vw_dx_peripheral_vascular_disease", "ever_diagnosed", "pvd", "patient_reported_diagnosis_history", true),
        bool("vw_sym_dizziness_lightheadedness", "symptoms", "dizziness_lightheadedness", "patient_reported_symptom", true),
        bool("vw_dx_cancer", "ever_diagnosed", "cancer", "patient_reported_diagnosis_history", true),
      ],
    },
  };
  const narrated = narratedFindings(projectScreeningFindings(vw)).map((f) => f.concept);
  assert.ok(narrated.includes("pvd"));
  assert.ok(narrated.includes("dizziness_lightheadedness"));
  assert.ok(!narrated.includes("cancer"));
  const { text } = renderOrderNoteBody(vw);
  assert.ok(/reports /i.test(text));
  assert.ok(/a history of peripheral vascular disease/i.test(text)); // reported certainty
  assert.ok(!/documented peripheral vascular disease/i.test(text)); // never upgraded to documented
  assert.ok(!/\bICD\b/i.test(text) && !/\bCPT\b/i.test(text));
});

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`PASS  ${r.name}`);
  else { failed++; console.log(`FAIL  ${r.name}\n      ${r.err}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
console.log("A1 QA passed.");
