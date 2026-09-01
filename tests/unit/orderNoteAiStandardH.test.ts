// Order Note AI standard — behavioral QA for the DETERMINISTIC pieces:
// per-service config, the compliance/grounding validator, and the 5-section
// renderer. (The OpenAI call itself is not exercised here — that needs a live
// model key and is covered by the acceptance slice.)
//   npx tsx tests/unit/orderNoteAiStandardH.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { orderNoteServiceConfig, orderNoteServiceLabel } from "../../server/services/ancillaryDocuments/orderNoteServiceConfig";
import { validateOrderNoteNarrative } from "../../server/services/ancillaryDocuments/orderNoteComplianceValidator";
import { renderAiOrderNoteBody } from "../../server/services/ancillaryDocuments/orderNoteBody";
import type { OrderNoteEvidenceBundle } from "../../server/services/ancillaryDocuments/orderNoteEvidenceBundle";
import type { OrderNoteNarrative } from "../../server/services/ancillaryDocuments/orderNoteNarrativeAi";

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: (e as Error).message }); }
}

function bundle(overrides: Partial<OrderNoteEvidenceBundle> = {}): OrderNoteEvidenceBundle {
  const base: OrderNoteEvidenceBundle = {
    bundleVersion: "order_note_evidence_bundle_v1",
    service: "BrainWave",
    serviceLabel: "BrainWave – Comprehensive Assessment",
    orderedComponents: orderNoteServiceConfig("BrainWave").orderedComponents,
    patient: { name: "Maria Lopez", dob: "1964-04-18", age: 62, sex: "F", plexusId: "184", clinicName: "Taylor Family Practice" },
    orderingClinician: { name: "Sarah Taylor, MD", npi: null },
    orderDate: "2026-09-01",
    diagnoses: [{ factId: "dx_0", concept: "hypertension", displayText: "Hypertension", date: null, sourceType: "patient_screening.diagnoses", sourceRecordId: "3", evidenceClass: "chart_documented_diagnosis" }],
    history: [{ factId: "hx_0", concept: "anxiety", displayText: "Anxiety", date: null, sourceType: "patient_screening.history", sourceRecordId: "3", evidenceClass: "chart_documented_history" }],
    medications: [],
    labs: [],
    vitals: [],
    priorImaging: [],
    clinicalNotes: [],
    clinicianFindings: [],
    structuredScreening: {
      questionnaire: "brainwave", version: "abc123", completedAt: "2026-09-01T10:00:00Z",
      findings: [
        { questionId: "bw_dx_memory_problems", concept: "memory_difficulty", displayText: "memory difficulty", value: 3, normalizedMeaning: "moderate", evidenceClass: "patient_reported_symptom", section: "diagnosis_history" },
        { questionId: "bw_sym_headaches", concept: "headaches", displayText: "headaches", value: 3, normalizedMeaning: "sometimes", evidenceClass: "patient_reported_symptom", section: "symptoms" },
      ],
    },
    qualification: { factors: ["memory difficulty"], clinicianUnderstanding: null },
    adminReview: { status: "approved" },
    screeningEvidenceVersion: "abc123",
    sourceRecordIds: ["patient_screening:3", "screening_evidence:23"],
  };
  return { ...base, ...overrides };
}

// A compliant narrative for the base BrainWave bundle.
const goodNarrative: OrderNoteNarrative = {
  clinicalHistoryIndication:
    "Maria Lopez is being evaluated for cognitive and neurologic concerns. During BrainWave screening, Maria reports moderate memory difficulty and recurrent headaches. Her documented history includes hypertension and anxiety, which provide relevant clinical context.",
  assessmentMedicalNecessity:
    "Maria's reported memory difficulty and headaches, considered alongside her documented hypertension and anxiety, support objective neurocognitive and neurophysiologic characterization. Neuropsychological testing is appropriate to assess memory, attention, and executive function. EEG acquisition with digital analysis provides objective information about cerebral electrical activity in the setting of these neurologic symptoms, and rhythm ECG provides concurrent cardiac rhythm information during the encounter. Visual and auditory evoked-potential testing may objectively assess conduction through the corresponding sensory pathways where the presentation supports it. No specific abnormality is presumed; results will be correlated with her clinical picture to guide further management.",
};

// ── Service config ──
test("service config resolves BW/VW/echo/carotid/renal/LE arterial/LE venous", () => {
  assert.match(orderNoteServiceLabel("BrainWave"), /BrainWave/);
  assert.match(orderNoteServiceLabel("VitalWave"), /VitalWave/);
  assert.match(orderNoteServiceLabel("Echocardiogram TTE"), /Transthoracic Echocardiogram/);
  assert.match(orderNoteServiceLabel("Bilateral Carotid Duplex"), /Carotid Duplex/);
  assert.match(orderNoteServiceLabel("Renal Artery Doppler"), /Renal Artery/);
  assert.match(orderNoteServiceLabel("Lower Extremity Arterial Doppler"), /Arterial/);
  assert.match(orderNoteServiceLabel("Lower Extremity Venous Duplex"), /Venous/);
  for (const s of ["BrainWave", "VitalWave", "Echocardiogram TTE", "Bilateral Carotid Duplex"]) {
    assert.ok(orderNoteServiceConfig(s).orderedComponents.length > 0, `${s} has ordered components`);
  }
});

// ── Validator: passing ──
test("compliant BrainWave narrative passes", () => {
  const r = validateOrderNoteNarrative(goodNarrative, bundle());
  assert.equal(r.passed, true, JSON.stringify(r.failures));
});

// ── Validator: rejections ──
test("rejects ICD-10 code", () => {
  const r = validateOrderNoteNarrative({ ...goodNarrative, assessmentMedicalNecessity: goodNarrative.assessmentMedicalNecessity + " Consistent with R41.3." }, bundle());
  assert.ok(r.failures.some((f) => f.code === "icd_present"));
});
test("rejects CPT code", () => {
  const r = validateOrderNoteNarrative({ ...goodNarrative, assessmentMedicalNecessity: goodNarrative.assessmentMedicalNecessity + " Bill 96132 for this." }, bundle());
  assert.ok(r.failures.some((f) => f.code === "cpt_present"));
});
test("rejects procedure-completion language", () => {
  const r = validateOrderNoteNarrative({ ...goodNarrative, assessmentMedicalNecessity: goodNarrative.assessmentMedicalNecessity + " The EEG was performed and tolerated the procedure well." }, bundle());
  assert.ok(r.failures.some((f) => f.code === "completion_language"));
});
test("rejects results/finding language for the ordered study", () => {
  const r = validateOrderNoteNarrative({ ...goodNarrative, clinicalHistoryIndication: goodNarrative.clinicalHistoryIndication + " Results showed slowing." }, bundle());
  assert.ok(r.failures.some((f) => f.code === "results_language"));
});
test("allows PRIOR-attributed imaging finding language", () => {
  const b = bundle({ priorImaging: [{ factId: "img_1", concept: "brain mri", displayText: "Brain MRI — impression: chronic small-vessel ischemic changes", value: null, date: "2025-01-01", sourceType: "patient_imaging_studies", sourceRecordId: "9", evidenceClass: "prior_imaging_result" }] });
  const r = validateOrderNoteNarrative({ ...goodNarrative, clinicalHistoryIndication: goodNarrative.clinicalHistoryIndication + " Her prior brain MRI documented chronic small-vessel ischemic changes." }, b);
  assert.ok(!r.failures.some((f) => f.code === "results_language"), JSON.stringify(r.failures));
  assert.ok(!r.failures.some((f) => f.code === "imaging_untraceable"));
});
test("rejects imaging finding with no prior imaging in bundle", () => {
  const r = validateOrderNoteNarrative({ ...goodNarrative, clinicalHistoryIndication: goodNarrative.clinicalHistoryIndication + " Her prior MRI documented an infarct." }, bundle());
  assert.ok(r.failures.some((f) => f.code === "imaging_untraceable"));
});
test("rejects foreign (un-ordered) component: tilt-table in a BrainWave note", () => {
  const r = validateOrderNoteNarrative({ ...goodNarrative, assessmentMedicalNecessity: goodNarrative.assessmentMedicalNecessity + " Tilt-table evaluation is warranted." }, bundle());
  assert.ok(r.failures.some((f) => f.code === "unordered_component"));
});
test("rejects EEG discussion in a Carotid Duplex note", () => {
  const b = bundle({ service: "Bilateral Carotid Duplex", serviceLabel: orderNoteServiceLabel("Bilateral Carotid Duplex"), orderedComponents: orderNoteServiceConfig("Bilateral Carotid Duplex").orderedComponents });
  const r = validateOrderNoteNarrative({ clinicalHistoryIndication: "Maria Lopez reports dizziness with a documented history of hypertension.", assessmentMedicalNecessity: "Carotid duplex grayscale imaging, Doppler velocities, and color-flow are appropriate to evaluate the carotid arteries. An EEG is also indicated." }, b);
  assert.ok(r.failures.some((f) => f.code === "unordered_component"));
});
test("rejects fabricated signature artifact", () => {
  const r = validateOrderNoteNarrative({ ...goodNarrative, assessmentMedicalNecessity: goodNarrative.assessmentMedicalNecessity + " Signature: Dr. Taylor" }, bundle());
  assert.ok(r.failures.some((f) => f.code === "signature_fabrication"));
});
test("rejects untraceable lab value", () => {
  const r = validateOrderNoteNarrative({ ...goodNarrative, assessmentMedicalNecessity: goodNarrative.assessmentMedicalNecessity + " Her A1c of 9.1 is concerning." }, bundle());
  assert.ok(r.failures.some((f) => f.code === "lab_untraceable"));
});
test("allows traceable lab value", () => {
  const b = bundle({ labs: [{ factId: "lab_1", concept: "a1c", displayText: "A1c 9.1 % (ref 4-5.6) [high]", value: "9.1", date: "2026-08-01", sourceType: "patient_labs.Metabolic", sourceRecordId: "5", evidenceClass: "laboratory_result" }] });
  const r = validateOrderNoteNarrative({ ...goodNarrative, assessmentMedicalNecessity: goodNarrative.assessmentMedicalNecessity + " Her A1c of 9.1 supports metabolic context." }, b);
  assert.ok(!r.failures.some((f) => f.code === "lab_untraceable"), JSON.stringify(r.failures));
});
test("rejects missing/short assessment", () => {
  const r = validateOrderNoteNarrative({ clinicalHistoryIndication: goodNarrative.clinicalHistoryIndication, assessmentMedicalNecessity: "Test indicated." }, bundle());
  assert.ok(r.failures.some((f) => f.code === "missing_assessment"));
});
test("rejects narrative missing the patient name", () => {
  const r = validateOrderNoteNarrative({ clinicalHistoryIndication: "The patient is being evaluated for memory difficulty and headaches in the setting of hypertension and anxiety.", assessmentMedicalNecessity: "The patient's reported memory difficulty and headaches support neuropsychological testing, EEG acquisition with digital analysis, rhythm ECG, and evoked-potential testing to characterize the presentation. No abnormality is presumed." }, bundle());
  assert.ok(r.failures.some((f) => f.code === "patient_name_absent"));
});

// ── Renderer ──
test("renderer produces exactly the 5 standard sections in order", () => {
  const r = renderAiOrderNoteBody(bundle(), goodNarrative);
  assert.deepEqual(r.sections.map((s) => s.heading), [
    "PATIENT INFORMATION",
    "CLINICAL HISTORY / INDICATION",
    "ASSESSMENT / MEDICAL NECESSITY",
    "ORDER / PLAN",
    "ORDERING CLINICIAN ATTESTATION",
  ]);
});
test("renderer patient info is deterministic + names the patient/clinic/clinician", () => {
  const r = renderAiOrderNoteBody(bundle(), goodNarrative);
  assert.match(r.text, /Patient: Maria Lopez/);
  assert.match(r.text, /Clinic: Taylor Family Practice/);
  assert.match(r.text, /Ordering Clinician: Sarah Taylor, MD/);
});
test("renderer ORDER/PLAN lists the ordered components + no-presumption line", () => {
  const r = renderAiOrderNoteBody(bundle(), goodNarrative);
  const plan = r.sections.find((s) => s.heading === "ORDER / PLAN")!.body;
  assert.match(plan, /Neuropsychological testing/);
  assert.match(plan, /No specific abnormal result or final diagnosis is presumed/);
});
test("renderer output contains NO ICD/CPT", () => {
  const r = renderAiOrderNoteBody(bundle(), goodNarrative);
  assert.ok(!/\b[A-TV-Z]\d[0-9A-Z](?:\.[0-9A-Z]{1,4})?\b/.test(r.text), "no ICD");
  assert.ok(!/\b\d{5}\b/.test(r.text), "no CPT");
});

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`PASS  ${r.name}`);
  else { failed++; console.log(`FAIL  ${r.name}\n      ${r.err}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
console.log("Order Note AI standard (deterministic) QA passed.");
