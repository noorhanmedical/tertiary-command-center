// Service-relevant materiality projection — deterministic freshness signal.
//   npx tsx tests/unit/orderNoteMateriality.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { orderNoteServiceConfig } from "../../server/services/ancillaryDocuments/orderNoteServiceConfig";
import type { OrderNoteEvidenceBundle, EvidenceFact } from "../../server/services/ancillaryDocuments/orderNoteEvidenceBundle";
import {
  materialOrderNoteEvidenceFingerprint,
  projectMaterialOrderNoteEvidence,
  materialityServiceKey,
} from "../../server/services/ancillaryDocuments/orderNoteMateriality";

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: (e as Error).message }); }
}

let seq = 0;
function lab(name: string, value: string, flag = "high"): EvidenceFact {
  seq += 1;
  return {
    factId: `lab_${seq}`, concept: name.toLowerCase(), displayText: `${name} ${value} [${flag}]`,
    value, date: null, sourceType: "patient_labs", sourceRecordId: String(1000 + seq), evidenceClass: "laboratory_result",
  };
}
function imaging(study: string): EvidenceFact {
  seq += 1;
  return {
    factId: `img_${seq}`, concept: study.toLowerCase(), displayText: study,
    value: null, date: null, sourceType: "patient_imaging_studies", sourceRecordId: String(2000 + seq), evidenceClass: "prior_imaging_result",
  };
}

function bundle(service: string, over: Partial<OrderNoteEvidenceBundle> = {}): OrderNoteEvidenceBundle {
  const cfg = orderNoteServiceConfig(service);
  return {
    bundleVersion: "order_note_evidence_bundle_v1",
    service, serviceLabel: cfg.serviceLabel, orderedComponents: cfg.orderedComponents,
    patient: { name: "Test Patient", dob: "1960-01-01", age: 66, sex: "F", plexusId: "1", clinicName: "Clinic" },
    orderingClinician: { name: "Dr X", npi: null }, orderDate: null,
    diagnoses: [], history: [], medications: [], labs: [], vitals: [], priorImaging: [],
    clinicalNotes: [], clinicianFindings: [],
    structuredScreening: null,
    qualification: { factors: [], clinicianUnderstanding: null },
    adminReview: { status: "approved" },
    screeningEvidenceVersion: null, sourceRecordIds: [],
    ...over,
  } as OrderNoteEvidenceBundle;
}

// ── service key classification ──
test("service key classification is deterministic", () => {
  assert.equal(materialityServiceKey(bundle("BrainWave")), "brainwave");
  assert.equal(materialityServiceKey(bundle("VitalWave")), "vitalwave");
  assert.equal(materialityServiceKey(bundle("Bilateral Carotid Duplex")), "carotid");
  assert.equal(materialityServiceKey(bundle("Echocardiogram TTE")), "echo");
  assert.equal(materialityServiceKey(bundle("Renal Artery Doppler")), "renal");
  assert.equal(materialityServiceKey(bundle("Lower Extremity Arterial Doppler")), "le_arterial");
  assert.equal(materialityServiceKey(bundle("Lower Extremity Venous Duplex")), "le_venous");
});

// ── CAROTID ──
test("CAROTID: unrelated abnormal liver lab ⇒ material fingerprint UNCHANGED", () => {
  const base = bundle("Bilateral Carotid Duplex", {
    diagnoses: [{ factId: "d1", concept: "hypertension", displayText: "Hypertension", value: null, date: null, sourceType: "s", sourceRecordId: "1", evidenceClass: "chart_documented_diagnosis" }],
    qualification: { factors: ["smoking", "hypertension"], clinicianUnderstanding: null },
  });
  const fp0 = materialOrderNoteEvidenceFingerprint(base);
  const withLiver = { ...base, labs: [lab("ALT", "88 U/L"), lab("AST", "76 U/L")] };
  assert.equal(materialOrderNoteEvidenceFingerprint(withLiver), fp0, "unrelated liver labs must not change carotid material fp");
});
test("CAROTID: relevant carotid imaging added ⇒ material fingerprint CHANGES (stale)", () => {
  const base = bundle("Bilateral Carotid Duplex", { qualification: { factors: ["smoking"], clinicianUnderstanding: null } });
  const fp0 = materialOrderNoteEvidenceFingerprint(base);
  const withCarotid = { ...base, priorImaging: [imaging("Carotid CTA — 60% stenosis right ICA")] };
  assert.notEqual(materialOrderNoteEvidenceFingerprint(withCarotid), fp0);
});
test("CAROTID: changing qualification reasoning ⇒ CHANGES (always material)", () => {
  const a = bundle("Bilateral Carotid Duplex", { qualification: { factors: ["smoking"], clinicianUnderstanding: null } });
  const b = bundle("Bilateral Carotid Duplex", { qualification: { factors: ["smoking", "prior TIA"], clinicianUnderstanding: null } });
  assert.notEqual(materialOrderNoteEvidenceFingerprint(a), materialOrderNoteEvidenceFingerprint(b));
});

// ── ECHO ──
test("ECHO: unrelated orthopedic imaging ⇒ UNCHANGED; relevant BNP ⇒ CHANGES", () => {
  const base = bundle("Echocardiogram TTE", { qualification: { factors: ["dyspnea"], clinicianUnderstanding: null } });
  const fp0 = materialOrderNoteEvidenceFingerprint(base);
  const withOrtho = { ...base, priorImaging: [imaging("Left knee X-ray — mild osteoarthritis")] };
  assert.equal(materialOrderNoteEvidenceFingerprint(withOrtho), fp0, "unrelated ortho imaging must not change echo material fp");
  const withBnp = { ...base, labs: [lab("BNP", "820 pg/mL")] };
  assert.notEqual(materialOrderNoteEvidenceFingerprint(withBnp), fp0, "relevant BNP must change echo material fp");
});

// ── BRAINWAVE ──
test("BRAINWAVE: unrelated lab ⇒ UNCHANGED; screening finding change ⇒ CHANGES", () => {
  const scr = (v: number) => ({ questionnaire: "brainwave", version: "q1", completedAt: null, findings: [
    { questionId: "bw_memory", concept: "memory_difficulty", displayText: "memory difficulty", value: v, normalizedMeaning: "moderate", evidenceClass: "patient_reported_symptom", section: "symptoms" },
  ] });
  const base = bundle("BrainWave", { structuredScreening: scr(3) as OrderNoteEvidenceBundle["structuredScreening"] });
  const fp0 = materialOrderNoteEvidenceFingerprint(base);
  const withUrine = { ...base, labs: [lab("Urinalysis protein", "trace")] };
  assert.equal(materialOrderNoteEvidenceFingerprint(withUrine), fp0, "unrelated urinalysis must not change brainwave material fp");
  const scrChanged = { ...base, structuredScreening: scr(5) as OrderNoteEvidenceBundle["structuredScreening"] };
  assert.notEqual(materialOrderNoteEvidenceFingerprint(scrChanged), fp0, "screening answer change must change brainwave material fp");
});

// ── VITALWAVE ──
test("VITALWAVE: unrelated imaging ⇒ UNCHANGED; screening change ⇒ CHANGES", () => {
  const scr = (v: boolean) => ({ questionnaire: "vitalwave", version: "q1", completedAt: null, findings: [
    { questionId: "vw_dizzy", concept: "dizziness", displayText: "dizziness", value: v, normalizedMeaning: null, evidenceClass: "patient_reported_symptom", section: "symptoms" },
  ] });
  const base = bundle("VitalWave", { structuredScreening: scr(true) as OrderNoteEvidenceBundle["structuredScreening"] });
  const fp0 = materialOrderNoteEvidenceFingerprint(base);
  const withKnee = { ...base, priorImaging: [imaging("Right shoulder MRI — rotator cuff tear")] };
  assert.equal(materialOrderNoteEvidenceFingerprint(withKnee), fp0);
  // remove the positive finding (materially different screening)
  const scrChanged = { ...base, structuredScreening: { ...(scr(true)), findings: [] } as OrderNoteEvidenceBundle["structuredScreening"] };
  assert.notEqual(materialOrderNoteEvidenceFingerprint(scrChanged), fp0);
});

// ── Always material: ordered components ──
test("changing ordered components ⇒ material fingerprint CHANGES", () => {
  const base = bundle("Bilateral Carotid Duplex");
  const fp0 = materialOrderNoteEvidenceFingerprint(base);
  const fewer = { ...base, orderedComponents: base.orderedComponents.slice(0, 1) };
  assert.notEqual(materialOrderNoteEvidenceFingerprint(fewer), fp0);
});

// ── Bounded-evidence / record-identity stability ──
test("same relevant content re-recorded with a DIFFERENT record id ⇒ UNCHANGED (content-keyed)", () => {
  const base = bundle("Echocardiogram TTE", { labs: [lab("BNP", "820 pg/mL")] });
  const fp0 = materialOrderNoteEvidenceFingerprint(base);
  const relabeled = { ...base, labs: [{ ...base.labs[0], factId: "different", sourceRecordId: "999999" }] };
  assert.equal(materialOrderNoteEvidenceFingerprint(relabeled), fp0, "record-id change alone must not move material fp");
});
test("adding an unrelated abnormal lab does NOT drop a relevant lab from the material projection", () => {
  const base = bundle("Echocardiogram TTE", { labs: [lab("BNP", "820 pg/mL")] });
  const proj0 = projectMaterialOrderNoteEvidence(base);
  const withUnrelated = { ...base, labs: [base.labs[0], lab("ALT", "88 U/L")] };
  const proj1 = projectMaterialOrderNoteEvidence(withUnrelated);
  // BNP still present; ALT excluded; projection identical.
  assert.deepEqual(proj1.relevantLabs, proj0.relevantLabs);
  assert.equal(materialOrderNoteEvidenceFingerprint(withUnrelated), materialOrderNoteEvidenceFingerprint(base));
});

// ── determinism ──
test("material fingerprint is deterministic + order-insensitive", () => {
  const a = bundle("Renal Artery Doppler", { diagnoses: [
    { factId: "d1", concept: "resistant hypertension", displayText: "Resistant hypertension", value: null, date: null, sourceType: "s", sourceRecordId: "1", evidenceClass: "chart_documented_diagnosis" },
    { factId: "d2", concept: "ckd", displayText: "CKD stage 3", value: null, date: null, sourceType: "s", sourceRecordId: "2", evidenceClass: "chart_documented_diagnosis" },
  ] });
  const b = bundle("Renal Artery Doppler", { diagnoses: [a.diagnoses[1], a.diagnoses[0]] });
  assert.equal(materialOrderNoteEvidenceFingerprint(a), materialOrderNoteEvidenceFingerprint(b));
});

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`PASS  ${r.name}`);
  else { failed++; console.log(`FAIL  ${r.name}\n      ${r.err}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
console.log("Order Note materiality QA passed.");
