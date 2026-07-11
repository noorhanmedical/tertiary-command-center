// Phase 3 admin-review helper tests.
//
// Runs standalone with:
//   npx tsx tests/unit/adminReviewEvidence.test.ts

import assert from "node:assert/strict";
import {
  preserveAdminReviewReasoning,
  isAdminReviewReasoningKey,
  dedupeAssignedEvidence,
  buttonKey,
  buildAssignedEvidenceReasoning,
  readStaleTargetIds,
  emptyAssignmentState,
  seedAssignmentsFromReasoning,
  type SupportingButton,
} from "../../shared/plexus-iq/adminReviewEvidence";

const btn = (
  overrides: Partial<SupportingButton> & Pick<SupportingButton, "id" | "kind" | "label" | "source">,
): SupportingButton => ({
  sourceText: null,
  icdCode: null,
  icdLabel: null,
  ...overrides,
});

async function testIsAdminReviewReasoningKey() {
  assert.equal(isAdminReviewReasoningKey("adminReview:brainwave"), true);
  assert.equal(isAdminReviewReasoningKey("adminReview:test:Bilateral Carotid Duplex"), true);
  assert.equal(isAdminReviewReasoningKey("adminReview:updates"), true);
  assert.equal(isAdminReviewReasoningKey("BrainWave EEG"), false);
  assert.equal(isAdminReviewReasoningKey("__analysisError"), false);
}

async function testPreservePreservesAdminReviewKeys() {
  const existing = {
    "adminReview:brainwave": { assignedEvidence: [{ id: "a" }] },
    "adminReview:test:Bilateral Carotid Duplex": { assignedEvidence: [{ id: "b" }] },
    "BrainWave EEG": { qualifying_factors: ["stale ai"] },
  };
  const next = {
    "BrainWave EEG": { qualifying_factors: ["fresh ai"] },
    "VitalWave TTE": { qualifying_factors: ["fresh ai 2"] },
  };
  const { reasoning, preservedKeys } = preserveAdminReviewReasoning(existing, next);

  // adminReview keys carried forward
  assert.deepEqual(reasoning["adminReview:brainwave"], existing["adminReview:brainwave"]);
  assert.deepEqual(
    reasoning["adminReview:test:Bilateral Carotid Duplex"],
    existing["adminReview:test:Bilateral Carotid Duplex"],
  );
  // AI-derived reasoning[TestName] wins (fresh)
  assert.deepEqual(reasoning["BrainWave EEG"], next["BrainWave EEG"]);
  assert.deepEqual(reasoning["VitalWave TTE"], next["VitalWave TTE"]);
  // Preserved-keys list matches
  assert.deepEqual(
    [...preservedKeys].sort(),
    ["adminReview:brainwave", "adminReview:test:Bilateral Carotid Duplex"].sort(),
  );
}

async function testPreserveHandlesNullExisting() {
  const { reasoning, preservedKeys } = preserveAdminReviewReasoning(null, {
    "BrainWave EEG": { qualifying_factors: ["x"] },
  });
  assert.deepEqual(reasoning, { "BrainWave EEG": { qualifying_factors: ["x"] } });
  assert.deepEqual(preservedKeys, []);
}

async function testPreserveEmptyNextWithExistingAdminReview() {
  // Reset-to-draft path: next is `{}` but existing has adminReview keys.
  const existing = {
    "adminReview:brainwave": { assignedEvidence: [{ id: "keep-me" }] },
  };
  const { reasoning, preservedKeys } = preserveAdminReviewReasoning(existing, {});
  assert.deepEqual(reasoning, {
    "adminReview:brainwave": { assignedEvidence: [{ id: "keep-me" }] },
  });
  assert.deepEqual(preservedKeys, ["adminReview:brainwave"]);
}

async function testPreserveNoAdminReviewKeys() {
  // Fast path: existing has no adminReview keys → next passes through unchanged.
  const { reasoning, preservedKeys } = preserveAdminReviewReasoning(
    { "BrainWave EEG": { qualifying_factors: ["stale"] } },
    { "BrainWave EEG": { qualifying_factors: ["fresh"] } },
  );
  assert.deepEqual(reasoning, { "BrainWave EEG": { qualifying_factors: ["fresh"] } });
  assert.deepEqual(preservedKeys, []);
}

async function testButtonKey() {
  // ICD disease keyed by code + label
  assert.equal(
    buttonKey(btn({ id: "1", kind: "icd_disease", label: "Diabetes", source: "Dx", icdCode: "E11.9" })),
    "icd:E11.9:diabetes",
  );
  // Missing ICD code falls back to "needs"
  assert.equal(
    buttonKey(btn({ id: "2", kind: "icd_disease", label: "Diabetes", source: "Dx" })),
    "icd:needs:diabetes",
  );
  // Medication uses medicationName then falls back to label
  assert.equal(
    buttonKey(btn({ id: "3", kind: "medication", label: "Lisinopril", source: "Rx", medicationName: "Lisinopril" })),
    "med:lisinopril",
  );
  // History collapses onto label
  assert.equal(
    buttonKey(btn({ id: "4", kind: "history", label: "Dizziness", source: "Hx" })),
    "hx:dizziness",
  );
  assert.equal(
    buttonKey(btn({ id: "5", kind: "symptom", label: "Dizziness", source: "Hx" })),
    "hx:dizziness",
  );
  // Prior test uses label only
  assert.equal(
    buttonKey(btn({ id: "6", kind: "prior_test", label: "TTE", source: "Prior Test" })),
    "prior:tte",
  );
}

async function testDedupeAssignedEvidenceSameTarget() {
  // Two ICD chips for the same disease → dedupe to one.
  const a = btn({ id: "a", kind: "icd_disease", label: "Diabetes", source: "Dx", icdCode: "E11.9" });
  const dupe = btn({ id: "b", kind: "icd_disease", label: "Diabetes", source: "Dx", icdCode: "E11.9" });
  const other = btn({ id: "c", kind: "medication", label: "Metformin", source: "Rx", medicationName: "Metformin" });

  const deduped = dedupeAssignedEvidence([a, dupe, other]);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].id, "a", "first-write-wins for same key");
  assert.equal(deduped[1].id, "c");
}

async function testDedupeAssignedEvidenceCrossTarget() {
  // The same button assigned to two different targets survives — dedupe is
  // scoped per array. Both target arrays keep the button independently.
  const shared = btn({ id: "x", kind: "icd_disease", label: "AFib", source: "Dx", icdCode: "I48.91" });
  const brainwave = dedupeAssignedEvidence([shared]);
  const vitalwave = dedupeAssignedEvidence([shared]);
  assert.equal(brainwave.length, 1);
  assert.equal(vitalwave.length, 1);
  assert.equal(brainwave[0].id, "x");
  assert.equal(vitalwave[0].id, "x");
}

async function testDedupeAcceptsAdminEvidenceChipShape() {
  // Server-side callers pass AdminEvidenceChip. buttonKey only reads the
  // shared keying fields, so mixed types should flow through the helper.
  const chip1 = { kind: "icd_disease", label: "AFib", icdCode: "I48.91" };
  const chip2 = { kind: "icd_disease", label: "AFib", icdCode: "I48.91" };
  const chip3 = { kind: "medication", label: "Metformin", medicationName: "Metformin" };
  const deduped = dedupeAssignedEvidence([chip1, chip2, chip3]);
  assert.equal(deduped.length, 2);
}

async function testBuildAssignedEvidenceReasoningStaleFlag() {
  const state = emptyAssignmentState();
  const dx = btn({ id: "dx1", kind: "icd_disease", label: "Diabetes", source: "Dx", icdCode: "E11.9" });
  state.brainwave = [dx];
  state.vitalwave = [dx];

  // Mark only brainwave stale.
  const next = buildAssignedEvidenceReasoning({}, state, {
    staleAncillaries: new Set(["brainwave"]),
    staleReason: "Evidence assignment changed",
  });
  const bw = next["adminReview:brainwave"] as Record<string, unknown>;
  const vw = next["adminReview:vitalwave"] as Record<string, unknown>;
  assert.equal(bw.stale, true);
  assert.equal(bw.staleReason, "Evidence assignment changed");
  assert.ok(typeof bw.staleAt === "string");
  assert.equal(vw.stale, undefined, "vitalwave sibling should NOT be marked stale");
}

async function testBuildAssignedEvidenceReasoningClearsStale() {
  // Start from a reasoning where brainwave is stale, then clear it via the
  // clearedAncillaries option.
  const state = emptyAssignmentState();
  const prior = buildAssignedEvidenceReasoning({}, state, {
    staleAncillaries: new Set(["brainwave"]),
  });
  const cleared = buildAssignedEvidenceReasoning(prior, state, {
    clearedAncillaries: new Set(["brainwave"]),
  });
  const bw = cleared["adminReview:brainwave"] as Record<string, unknown>;
  assert.equal(bw.stale, false);
  assert.equal(bw.staleReason, null);
  assert.equal(bw.staleAt, null);
}

async function testReadStaleTargetIdsMatchesWriter() {
  const state = emptyAssignmentState();
  state.ultrasound.byTestName["Bilateral Carotid Duplex"] = [];
  const reasoning = buildAssignedEvidenceReasoning({}, state, {
    staleAncillaries: new Set(["ultrasound", "test:Bilateral Carotid Duplex"]),
  });
  const stale = readStaleTargetIds(reasoning);
  assert.deepEqual(stale.sort(), ["test:Bilateral Carotid Duplex", "ultrasound"].sort());
}

async function testSeedAssignmentsFromReasoningRoundTrip() {
  // Writer → reader round-trip: whatever we persist should re-hydrate.
  const state = emptyAssignmentState();
  const b = btn({ id: "1", kind: "icd_disease", label: "AFib", source: "Dx", icdCode: "I48.91" });
  state.brainwave = [b];
  state.ultrasound.parent = [b];
  state.ultrasound.byTestName["Bilateral Carotid Duplex"] = [b];
  const reasoning = buildAssignedEvidenceReasoning({}, state, {});
  const rehydrated = seedAssignmentsFromReasoning(reasoning);
  assert.deepEqual(rehydrated.brainwave, [b]);
  assert.deepEqual(rehydrated.ultrasound.parent, [b]);
  assert.deepEqual(rehydrated.ultrasound.byTestName["Bilateral Carotid Duplex"], [b]);
}

async function main() {
  await testIsAdminReviewReasoningKey();
  await testPreservePreservesAdminReviewKeys();
  await testPreserveHandlesNullExisting();
  await testPreserveEmptyNextWithExistingAdminReview();
  await testPreserveNoAdminReviewKeys();
  await testButtonKey();
  await testDedupeAssignedEvidenceSameTarget();
  await testDedupeAssignedEvidenceCrossTarget();
  await testDedupeAcceptsAdminEvidenceChipShape();
  await testBuildAssignedEvidenceReasoningStaleFlag();
  await testBuildAssignedEvidenceReasoningClearsStale();
  await testReadStaleTargetIdsMatchesWriter();
  await testSeedAssignmentsFromReasoningRoundTrip();
  console.log("adminReviewEvidence.test.ts: all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
