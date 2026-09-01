// Slice A0 — behavioral QA for the structured screening evidence contract.
//
// Pure (no DB): exercises the pinned BW/VW registries, evidence taxonomy,
// closed validator, completion policy, and the FULL screening version
// (canonical string). Run:
//
//   npx tsx tests/unit/screeningEvidenceA0.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import {
  SCREENING_REGISTRY,
  EVIDENCE_CLASSES,
  QUESTIONNAIRE_EMITTABLE_CLASSES,
  SEVERITY_MEANINGS,
  FREQUENCY_MEANINGS,
  BRAINWAVE_QUESTIONNAIRE_VERSION,
  VITALWAVE_QUESTIONNAIRE_VERSION,
  SCREENING_EVIDENCE_SCHEMA_VERSION,
  SCREENING_CONCEPT_CROSSWALK,
  ancillaryScreeningEvidenceSchema,
  screeningCaptureSchema,
  evaluateCompletion,
  canonicalScreeningEvidenceString,
  requiredQuestionIds,
  type ScreeningRegistryItem,
  type ScreeningResponse,
  type AncillaryScreeningEvidence,
} from "../../shared/schema/screeningEvidence";

// ── tiny harness ──
const results: Array<{ name: string; ok: boolean; err?: string }> = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, err: (e as Error).message });
  }
}

// ── helpers ──
function itemsBy(questionnaire: "brainwave" | "vitalwave", section?: string): ScreeningRegistryItem[] {
  return SCREENING_REGISTRY.filter(
    (i) => i.questionnaire === questionnaire && (section ? i.section === section : true),
  );
}

function buildResponse(item: ScreeningRegistryItem, opts: { scaleValue?: number; boolValue?: boolean }): ScreeningResponse {
  const base = {
    questionId: item.questionId,
    questionnaire: item.questionnaire,
    section: item.section,
    questionVersion: item.questionnaireVersion,
    concept: item.concept,
    evidenceClass: item.evidenceClass,
  } as const;
  if (item.responseType === "boolean") {
    const value = opts.boolValue ?? false;
    return { ...base, responseType: "boolean", value, ...(item.recency ? { recency: "recent" as const } : {}) };
  }
  const value = opts.scaleValue ?? 0;
  const normalizedMeaning = item.responseType === "severity_scale" ? SEVERITY_MEANINGS[value] : FREQUENCY_MEANINGS[value];
  return { ...base, responseType: item.responseType, value, normalizedMeaning };
}

function buildFullResponses(questionnaire: "brainwave" | "vitalwave"): ScreeningResponse[] {
  const version = questionnaire === "brainwave" ? BRAINWAVE_QUESTIONNAIRE_VERSION : VITALWAVE_QUESTIONNAIRE_VERSION;
  return SCREENING_REGISTRY
    .filter((i) => i.questionnaire === questionnaire && i.questionnaireVersion === version)
    .map((i, idx) => buildResponse(i, { scaleValue: (idx % 5) as number, boolValue: idx % 2 === 0 }));
}

const directCapture = {
  origin: "direct_entry" as const,
  documentedByUserId: "user-acs-1",
  documentedByRole: "ACS" as const,
  documentedAt: "2026-08-31T08:43:00.000Z",
  sourceForm: { name: "BrainWave Patient Questionnaire", revision: null },
};

function buildEvidence(questionnaire: "brainwave" | "vitalwave", overrides: Partial<AncillaryScreeningEvidence> = {}): AncillaryScreeningEvidence {
  const version = questionnaire === "brainwave" ? BRAINWAVE_QUESTIONNAIRE_VERSION : VITALWAVE_QUESTIONNAIRE_VERSION;
  return {
    schemaVersion: SCREENING_EVIDENCE_SCHEMA_VERSION,
    questionnaire,
    questionnaireVersion: version,
    ancillaryCaseId: 1001,
    clinicId: 7,
    serviceType: questionnaire === "brainwave" ? "BrainWave" : "VitalWave",
    screeningReadinessId: 555,
    completionMode: "structured_questionnaire",
    capture: {
      ...directCapture,
      sourceForm: { name: questionnaire === "brainwave" ? "BrainWave Patient Questionnaire" : "VitalWave Patient Questionnaire", revision: null },
    },
    responses: buildFullResponses(questionnaire),
    ...overrides,
  } as AncillaryScreeningEvidence;
}

// ─────────────────────────── REGISTRY FIDELITY ───────────────────────────

await test("BW page 1 (diagnosis_history) has exactly 54 items", () => {
  assert.equal(itemsBy("brainwave", "diagnosis_history").length, 54);
});

await test("BW page 2 (symptoms) has exactly 55 items", () => {
  assert.equal(itemsBy("brainwave", "symptoms").length, 55);
});

await test("VW has exactly 70 checkboxes (68 clinical + 2 control)", () => {
  const vw = itemsBy("vitalwave");
  assert.equal(vw.length, 70);
  assert.equal(vw.filter((i) => i.control).length, 2);
  assert.equal(vw.filter((i) => !i.control).length, 68);
});

await test("VW section counts match the PDF", () => {
  assert.equal(itemsBy("vitalwave", "general").length, 5);
  assert.equal(itemsBy("vitalwave", "symptoms").length, 12);
  assert.equal(itemsBy("vitalwave", "medication").length, 11);
  assert.equal(itemsBy("vitalwave", "recent_feelings").length, 3);
  assert.equal(itemsBy("vitalwave", "ever_diagnosed").length, 34);
  assert.equal(itemsBy("vitalwave", "recently_diagnosed").length, 5);
});

await test("no duplicate questionId across the whole registry", () => {
  const ids = SCREENING_REGISTRY.map((i) => i.questionId);
  assert.equal(new Set(ids).size, ids.length);
});

await test("every registry item carries an emittable patient_reported_* class", () => {
  for (const i of SCREENING_REGISTRY) {
    assert.ok(QUESTIONNAIRE_EMITTABLE_CLASSES.has(i.evidenceClass), `${i.questionId} → ${i.evidenceClass}`);
  }
});

await test("BW page 1 items are all patient_reported_condition_history", () => {
  for (const i of itemsBy("brainwave", "diagnosis_history")) {
    assert.equal(i.evidenceClass, "patient_reported_condition_history", i.questionId);
  }
});

await test("BW page 2 History-of items are condition_history; COVID is event_history; others symptom", () => {
  const byId = new Map(itemsBy("brainwave", "symptoms").map((i) => [i.questionId, i]));
  for (const id of ["bw_sym_concussion_history", "bw_sym_epilepsy_history", "bw_sym_ptsd_history", "bw_sym_seizures_history", "bw_sym_stroke_history"]) {
    assert.equal(byId.get(id)?.evidenceClass, "patient_reported_condition_history", id);
  }
  assert.equal(byId.get("bw_sym_covid_positive_6mo")?.evidenceClass, "patient_reported_event_history");
  assert.equal(byId.get("bw_sym_forgetful_poor_memory")?.evidenceClass, "patient_reported_symptom");
  // History-of rows faithfully keep the source frequency response type.
  assert.equal(byId.get("bw_sym_stroke_history")?.responseType, "frequency_scale");
});

await test("taxonomy includes patient_reported_event_history", () => {
  assert.ok((EVIDENCE_CLASSES as readonly string[]).includes("patient_reported_event_history"));
});

await test("VW medication normalized to one section with sourceSection block audit", () => {
  const meds = itemsBy("vitalwave", "medication");
  assert.ok(meds.every((i) => i.section === "medication"));
  assert.equal(meds.filter((i) => i.sourceSection === "medication_block_1").length, 4);
  assert.equal(meds.filter((i) => i.sourceSection === "medication_block_2").length, 7);
});

await test("intentional duplicate-concept rows remain distinct questionIds", () => {
  const byId = new Map(SCREENING_REGISTRY.map((i) => [i.questionId, i]));
  // Same concept, different source rows — both preserved.
  assert.equal(byId.get("bw_sym_get_lost")?.concept, "getting_lost");
  assert.equal(byId.get("bw_sym_lost_familiar_places")?.concept, "getting_lost");
  assert.equal(byId.get("bw_sym_headaches")?.concept, "headaches");
  assert.equal(byId.get("bw_sym_headaches_migraines")?.concept, "headaches");
  assert.equal(byId.get("vw_dx_atherosclerosis")?.concept, "atherosclerosis");
  assert.equal(byId.get("vw_dx_arteriosclerosis")?.concept, "arteriosclerosis");
  assert.equal(byId.get("vw_dx_hardening_arteries")?.concept, "arterial_hardening");
});

await test("crosswalk maps to qualification concepts but never mutates screening concept", () => {
  assert.deepEqual(SCREENING_CONCEPT_CROSSWALK["memory_difficulty"], ["Memory Loss", "Mild Cognitive Impairment"]);
  // A screening concept with a crosswalk is still just a screening concept.
  const memItem = SCREENING_REGISTRY.find((i) => i.questionId === "bw_dx_memory_problems");
  assert.equal(memItem?.evidenceClass, "patient_reported_condition_history");
});

// ─────────────────────────── VALIDATION ───────────────────────────

await test("valid BW evidence parses; direct capture requires no transcription block", () => {
  const ev = buildEvidence("brainwave");
  const r = ancillaryScreeningEvidenceSchema.safeParse(ev);
  assert.ok(r.success, r.success ? "" : JSON.stringify(r.error.issues.slice(0, 3)));
});

await test("valid VW evidence parses", () => {
  const r = ancillaryScreeningEvidenceSchema.safeParse(buildEvidence("vitalwave"));
  assert.ok(r.success, r.success ? "" : JSON.stringify(r.error.issues.slice(0, 3)));
});

await test("rejects unknown questionId", () => {
  const ev = buildEvidence("brainwave");
  ev.responses[0] = { ...ev.responses[0], questionId: "bw_dx_not_a_real_item" } as ScreeningResponse;
  assert.equal(ancillaryScreeningEvidenceSchema.safeParse(ev).success, false);
});

await test("rejects evidence-class upgrade to chart_documented_diagnosis", () => {
  const ev = buildEvidence("brainwave");
  ev.responses[0] = { ...ev.responses[0], evidenceClass: "chart_documented_diagnosis" } as ScreeningResponse;
  assert.equal(ancillaryScreeningEvidenceSchema.safeParse(ev).success, false);
});

await test("rejects BW value out of 0..5 range", () => {
  const ev = buildEvidence("brainwave");
  ev.responses[0] = { ...ev.responses[0], value: 6 } as ScreeningResponse;
  assert.equal(ancillaryScreeningEvidenceSchema.safeParse(ev).success, false);
});

await test("rejects non-boolean value for a VW boolean item", () => {
  const ev = buildEvidence("vitalwave");
  ev.responses[0] = { ...ev.responses[0], value: 3 as unknown as boolean } as ScreeningResponse;
  assert.equal(ancillaryScreeningEvidenceSchema.safeParse(ev).success, false);
});

await test("rejects duplicate response", () => {
  const ev = buildEvidence("brainwave");
  ev.responses.push({ ...ev.responses[0] });
  assert.equal(ancillaryScreeningEvidenceSchema.safeParse(ev).success, false);
});

await test("rejects concept/section mismatch vs registry", () => {
  const ev = buildEvidence("brainwave");
  ev.responses[0] = { ...ev.responses[0], concept: "totally_wrong_concept" } as ScreeningResponse;
  assert.equal(ancillaryScreeningEvidenceSchema.safeParse(ev).success, false);
});

await test("transcribed_from_paper requires a transcription block", () => {
  const bad = screeningCaptureSchema.safeParse({
    ...directCapture,
    origin: "transcribed_from_paper",
  });
  assert.equal(bad.success, false);
  const good = screeningCaptureSchema.safeParse({
    ...directCapture,
    origin: "transcribed_from_paper",
    transcription: {
      sourceReadinessId: 555,
      transcribedByUserId: "user-acs-1",
      transcribedByRole: "ACS",
      transcribedAt: "2026-08-31T08:41:00.000Z",
    },
  });
  assert.ok(good.success);
});

await test("direct_entry rejects a transcription block", () => {
  const r = screeningCaptureSchema.safeParse({
    ...directCapture,
    origin: "direct_entry",
    transcription: { transcribedByUserId: "x", transcribedByRole: "ACS", transcribedAt: "2026-08-31T08:41:00.000Z" },
  });
  assert.equal(r.success, false);
});

// ─────────────────────────── COMPLETION POLICY ───────────────────────────

await test("full BW response set is complete; 0 counts as answered", () => {
  const ev = buildEvidence("brainwave", {
    responses: SCREENING_REGISTRY
      .filter((i) => i.questionnaire === "brainwave")
      .map((i) => buildResponse(i, { scaleValue: 0 })), // all explicit N/A
  });
  const { complete, missing } = evaluateCompletion(ev);
  assert.equal(complete, true, `missing: ${missing.slice(0, 3).join(",")}`);
});

await test("full VW response set is complete; false counts as answered", () => {
  const ev = buildEvidence("vitalwave", {
    responses: SCREENING_REGISTRY
      .filter((i) => i.questionnaire === "vitalwave")
      .map((i) => buildResponse(i, { boolValue: false })),
  });
  assert.equal(evaluateCompletion(ev).complete, true);
});

await test("missing a required item ⇒ incomplete with that id (missing != 0)", () => {
  const all = buildFullResponses("brainwave");
  const dropped = all.filter((r) => r.questionId !== "bw_dx_memory_problems");
  const ev = buildEvidence("brainwave", { responses: dropped });
  const { complete, missing } = evaluateCompletion(ev);
  assert.equal(complete, false);
  assert.ok(missing.includes("bw_dx_memory_problems"));
});

await test("control items (Other/N/A) are not required for completion", () => {
  const req = requiredQuestionIds("vitalwave", VITALWAVE_QUESTIONNAIRE_VERSION);
  assert.ok(!req.includes("vw_med_other_na"));
  assert.ok(!req.includes("vw_recent_other_na"));
});

// ─────────────────────────── FULL SCREENING VERSION ───────────────────────────

await test("canonical string is order-independent", () => {
  const ev = buildEvidence("brainwave");
  const shuffled = buildEvidence("brainwave", { responses: [...ev.responses].reverse() });
  assert.equal(canonicalScreeningEvidenceString(ev), canonicalScreeningEvidenceString(shuffled));
});

await test("changing one BW value changes the version", () => {
  const ev = buildEvidence("brainwave");
  const before = canonicalScreeningEvidenceString(ev);
  const bumped = buildEvidence("brainwave");
  const idx = bumped.responses.findIndex((r) => r.responseType !== "boolean");
  (bumped.responses[idx] as { value: number }).value = ((bumped.responses[idx] as { value: number }).value + 1) % 6;
  assert.notEqual(before, canonicalScreeningEvidenceString(bumped));
});

await test("flipping one VW boolean changes the version", () => {
  const ev = buildEvidence("vitalwave");
  const before = canonicalScreeningEvidenceString(ev);
  const flipped = buildEvidence("vitalwave");
  const idx = flipped.responses.findIndex((r) => r.responseType === "boolean");
  (flipped.responses[idx] as { value: boolean }).value = !(flipped.responses[idx] as { value: boolean }).value;
  assert.notEqual(before, canonicalScreeningEvidenceString(flipped));
});

await test("re-transcription of identical answers (different capture identity/time) keeps the SAME version", () => {
  const ev = buildEvidence("brainwave");
  const reTranscribed = buildEvidence("brainwave", {
    capture: {
      origin: "transcribed_from_paper",
      documentedByUserId: "user-pcs-99",
      documentedByRole: "PCS",
      documentedAt: "2026-09-02T15:00:00.000Z",
      sourceForm: { name: "BrainWave Patient Questionnaire", revision: null },
      transcription: {
        sourceReadinessId: 555,
        transcribedByUserId: "user-pcs-99",
        transcribedByRole: "PCS",
        transcribedAt: "2026-09-02T14:55:00.000Z",
        verifiedByUserId: "user-md-2",
        verifiedAt: "2026-09-02T15:05:00.000Z",
      },
    },
  });
  assert.equal(canonicalScreeningEvidenceString(ev), canonicalScreeningEvidenceString(reTranscribed));
});

await test("patient answers keep patient_reported_* class even under paper transcription", () => {
  const ev = buildEvidence("brainwave", {
    capture: {
      origin: "transcribed_from_paper",
      documentedByUserId: "user-acs-1",
      documentedByRole: "ACS",
      documentedAt: "2026-08-31T08:43:00.000Z",
      sourceForm: { name: "BrainWave Patient Questionnaire", revision: null },
      transcription: {
        transcribedByUserId: "user-acs-1",
        transcribedByRole: "ACS",
        transcribedAt: "2026-08-31T08:41:00.000Z",
      },
    },
  });
  const r = ancillaryScreeningEvidenceSchema.safeParse(ev);
  assert.ok(r.success);
  assert.ok(ev.responses.every((x) => x.evidenceClass.startsWith("patient_reported_")));
});

// ── report ──
let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`PASS  ${r.name}`);
  } else {
    failed++;
    console.log(`FAIL  ${r.name}\n      ${r.err}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
console.log("A0 QA passed.");
