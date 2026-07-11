export type AdminEvidenceKind =
  | "diagnosis"
  | "medication"
  | "icd"
  | "symptom"
  | "risk_factor"
  | "prior_test"
  | "manual";

export type AdminEvidenceSource = "Hx" | "Dx" | "Rx" | "ICD" | "AI" | "Manual" | "Prior Test";

export type AdminEvidenceChip = {
  id: string;
  kind: AdminEvidenceKind;
  label: string;
  source: AdminEvidenceSource;
  detail?: string | null;
  icdCode?: string | null;
  icdLabel?: string | null;
  // requiresIcd is metadata only: the chip is still placeable on any
  // ancillary bar regardless of this flag.
  // SOURCE MARKER: requiresIcd does not block chip placement
  requiresIcd?: boolean;
  suggestedIcds?: Array<{ code: string; label: string }>;
  confidence?: "high" | "medium" | "low";
};

// A diagnosis SUGGESTION derived from a medication or risk-factor cue.
// Suggestions are inactive — they appear in the right-panel popover for
// the user to optionally accept. They are NOT auto-promoted to
// AdminEvidenceChip.
//
// SOURCE MARKER: Medications do not auto-create diagnoses
// SOURCE MARKER: Medication-derived diagnosis suggestions are inactive until accepted
export type AdminDiagnosisSuggestion = {
  id: string;
  label: string;
  reason: string;
  source: "Rx" | "Hx" | "AI";
  triggerLabel?: string;
  suggestedIcds?: Array<{ code: string; label: string }>;
};

export type AdminReviewAncillaryId = "brainwave" | "vitalwave" | "ultrasound";

export type AdminReviewRuleCandidate = {
  ancillaryId: AdminReviewAncillaryId;
  label: string;
  status: "suggested" | "needs_info" | "admin_approval_required";
  evidenceIds: string[];
  missing: string[];
};

export type AdminReviewRuleResult = {
  evidence: AdminEvidenceChip[];
  // Diagnosis suggestions (inactive until accepted). Always disjoint
  // from `evidence` so a suggestion never doubles as an active chip.
  suggestions: AdminDiagnosisSuggestion[];
  candidates: AdminReviewRuleCandidate[];
  flags: {
    under16: boolean;
    adminApprovalRequired: boolean;
    missingIcdCount: number;
  };
};

export const COMMON_ICD_SUGGESTIONS: Record<string, Array<{ code: string; label: string }>> = {
  diabetes: [
    { code: "E11.9", label: "Type 2 diabetes mellitus without complications" },
    { code: "E11.40", label: "Type 2 diabetes mellitus with diabetic neuropathy, unspecified" },
  ],
  hypertension: [
    { code: "I10", label: "Essential hypertension" },
  ],
  hyperlipidemia: [
    { code: "E78.5", label: "Hyperlipidemia, unspecified" },
  ],
  edema: [
    { code: "R60.0", label: "Localized edema" },
  ],
  dizziness: [
    { code: "R42", label: "Dizziness and giddiness" },
  ],
  dyspnea: [
    { code: "R06.02", label: "Shortness of breath" },
  ],
  pvd: [
    { code: "I73.9", label: "Peripheral vascular disease, unspecified" },
  ],
  venous_insufficiency: [
    { code: "I87.2", label: "Venous insufficiency (chronic) (peripheral)" },
  ],
  dvt: [
    { code: "I82.40", label: "Acute embolism and thrombosis of unspecified deep veins of lower extremity" },
  ],
  varicose: [
    { code: "I83.90", label: "Asymptomatic varicose veins of unspecified lower extremity" },
  ],
};

// Class of meds that suggest a diagnosis but never prove one. Each
// entry contains the medication label as it appears in Rx, the
// diagnosis the prescriber is *likely* treating, and the rationale
// shown to the user when they hover the suggestion chip.
//
// SOURCE MARKER: Medications do not auto-create diagnoses
export const COMMON_MEDICATION_SUGGESTIONS: Array<{
  diagnosisLabel: string;
  diagnosisKey: keyof typeof COMMON_ICD_SUGGESTIONS;
  triggers: string[];
  reason: string;
}> = [
  {
    diagnosisLabel: "Diabetes mellitus",
    diagnosisKey: "diabetes",
    triggers: ["metformin", "insulin", "glp-1", "semaglutide", "ozempic", "jardiance", "farxiga", "empagliflozin", "dapagliflozin"],
    reason: "Antidiabetic medication may suggest diabetes mellitus",
  },
  {
    diagnosisLabel: "Hypertension",
    diagnosisKey: "hypertension",
    triggers: ["amlodipine", "lisinopril", "losartan", "metoprolol", "hctz", "hydrochlorothiazide", "valsartan", "carvedilol"],
    reason: "Antihypertensive medication may suggest hypertension",
  },
  {
    diagnosisLabel: "Hyperlipidemia",
    diagnosisKey: "hyperlipidemia",
    triggers: ["atorvastatin", "rosuvastatin", "pravastatin", "simvastatin", "statin", "ezetimibe"],
    reason: "Statin/lipid medication may suggest hyperlipidemia",
  },
];

function normalize(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function stableId(kind: string, label: string, source: string, icd?: string | null) {
  return `${kind}:${source}:${label}:${icd ?? "no-icd"}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function pushUnique(out: AdminEvidenceChip[], chip: AdminEvidenceChip) {
  if (!out.some((x) => x.id === chip.id)) out.push(chip);
}

// ─── Ultrasound test classification helpers ─────────────────────────
// These split ultrasound subtests by vascular bed so the per-test bar
// only seeds chips with relevant clinical support. A venous test
// pulls edema/swelling/DVT support; an arterial/PVD test pulls
// claudication/PVD support; carotid pulls dizziness/bruit; echo pulls
// dyspnea/HTN/cardiac.

const VENOUS_TERMS = ["venous", "vein", "venous reflux", "venous insufficiency", "lower extremity venous", "upper extremity venous", "dvt", "duplex venous"];
const ARTERIAL_TERMS = ["arterial", "abi", "ankle-brachial", "pad", "pvd", "peripheral arterial"];
const CAROTID_TERMS = ["carotid"];
const ECHO_TERMS = ["echo", "echocardiogram", "tte", "tee"];
const RENAL_ABDO_TERMS = ["renal", "kidney", "aorta", "aaa", "abdominal"];

export function isVenousUltrasoundTest(testName: string | null | undefined): boolean {
  const t = normalize(testName);
  if (!t) return false;
  return VENOUS_TERMS.some((term) => t.includes(term));
}

export function isArterialUltrasoundTest(testName: string | null | undefined): boolean {
  const t = normalize(testName);
  if (!t) return false;
  return ARTERIAL_TERMS.some((term) => t.includes(term));
}

export function isCarotidUltrasoundTest(testName: string | null | undefined): boolean {
  const t = normalize(testName);
  if (!t) return false;
  return CAROTID_TERMS.some((term) => t.includes(term));
}

export function isEchoUltrasoundTest(testName: string | null | undefined): boolean {
  const t = normalize(testName);
  if (!t) return false;
  return ECHO_TERMS.some((term) => t.includes(term));
}

// Per-test ancillary support. Returns the subset of evidence chips
// (already built by buildAdminReviewEvidence) that are clinically
// supportive for the named ultrasound test. Medication chips are
// always included as supporting meds — they never become a diagnosis.
export function evidenceForUltrasoundTest(
  testName: string,
  evidence: AdminEvidenceChip[],
): AdminEvidenceChip[] {
  if (!evidence || evidence.length === 0) return [];
  const venous = isVenousUltrasoundTest(testName);
  const arterial = isArterialUltrasoundTest(testName);
  const carotid = isCarotidUltrasoundTest(testName);
  const echo = isEchoUltrasoundTest(testName);
  const renal = RENAL_ABDO_TERMS.some((t) => normalize(testName).includes(t));

  const out: AdminEvidenceChip[] = [];
  for (const chip of evidence) {
    const label = chip.label.toLowerCase();
    // Medications are always supporting context — they support any test.
    // SOURCE MARKER: Medications do not auto-create diagnoses
    if (chip.kind === "medication") {
      out.push(chip);
      continue;
    }
    if (venous) {
      // Phase 1 Slice 1.6 — venous studies require true venous
      // indications only. Vascular / metabolic risk diagnoses (HTN /
      // DM / HLD / arterial-vascular) do NOT qualify a venous study
      // by themselves; the prior Dx-fallback was removed because it
      // surfaced venous studies for patients without leg-vein
      // pathology, violating the clinical mapping in
      // CLAUDE_PHASE_GUARDRAILS.md §6.
      if (
        [
          "edema",
          "swelling",
          "venous",
          "dvt",
          "varicose",
          "leg swelling",
          "leg edema",
          "calf pain",
          "leg pain",
          "leg redness",
          "venous insufficiency",
          "post-op leg",
          "immobility",
          "pe", // history of pulmonary embolism — DVT proxy
        ].some((t) => label.includes(t))
      ) {
        out.push(chip);
        continue;
      }
    }
    if (carotid) {
      if (["dizziness", "syncope", "bruit", "neurovascular", "stroke", "tia"].some((t) => label.includes(t))) {
        out.push(chip);
        continue;
      }
      if (
        chip.kind === "diagnosis" &&
        chip.source !== "Rx" &&
        ["hypertension", "hyperlipidemia", "diabetes", "pvd"].some((t) => label.includes(t))
      ) {
        out.push(chip);
        continue;
      }
    }
    if (arterial) {
      if (["claudication", "pvd", "peripheral vascular", "leg pain"].some((t) => label.includes(t))) {
        out.push(chip);
        continue;
      }
      if (
        chip.kind === "diagnosis" &&
        chip.source !== "Rx" &&
        ["diabetes", "hypertension", "hyperlipidemia"].some((t) => label.includes(t))
      ) {
        out.push(chip);
        continue;
      }
    }
    if (echo) {
      if (["dyspnea", "edema", "shortness of breath", "chest pain", "palpitations"].some((t) => label.includes(t))) {
        out.push(chip);
        continue;
      }
      if (
        chip.kind === "diagnosis" &&
        chip.source !== "Rx" &&
        ["hypertension", "heart failure", "cad", "coronary"].some((t) => label.includes(t))
      ) {
        out.push(chip);
        continue;
      }
    }
    if (renal) {
      if (
        chip.kind === "diagnosis" &&
        chip.source !== "Rx" &&
        ["hypertension", "diabetes", "ckd", "kidney"].some((t) => label.includes(t))
      ) {
        out.push(chip);
        continue;
      }
    }
  }
  return out;
}

// The ultrasound sub-tests the qualification engine is allowed to
// auto-qualify on add. The three manual-only studies (Stress Echo,
// Upper Extremity Arterial / Venous) are deliberately excluded — they
// are never auto-qualified and can only be hand-added via an override.
export const AI_QUALIFYING_ULTRASOUND_TESTS: readonly string[] = [
  "Bilateral Carotid Duplex (93880)",
  "Echocardiogram TTE (93306)",
  "Renal Artery Doppler (93975)",
  "Lower Extremity Arterial Doppler (93925)",
  "Abdominal Aortic Aneurysm Duplex (93978)",
  "Lower Extremity Venous Duplex (93971)",
];

// Every ultrasound sub-test the Admin Review picker can add — the 6
// AI-qualifying studies plus the 3 manual-only ones. Used by both the picker
// (to hide the generic "Ultrasound" option when nothing is left to add) and
// the add service (to report an honest "already present" state).
export const ALL_ULTRASOUND_SUBTYPES: readonly string[] = [
  ...AI_QUALIFYING_ULTRASOUND_TESTS,
  "Stress Echocardiogram (93350)",
  "Upper Extremity Arterial Doppler (93930)",
  "Upper Extremity Venous Duplex (93970)",
];

// Clinical (non-medication) support for an ultrasound test. Medications
// are supporting context only and never qualify a study on their own, so
// the add-on qualifier gates on this set rather than the full
// evidenceForUltrasoundTest output.
export function clinicalEvidenceForUltrasoundTest(
  testName: string,
  evidence: AdminEvidenceChip[],
): AdminEvidenceChip[] {
  return evidenceForUltrasoundTest(testName, evidence).filter(
    (c) => c.kind !== "medication",
  );
}

// Given the patient's built evidence, return the subset of the
// AI-qualifying ultrasound sub-tests that have clinical (non-medication)
// supporting evidence. Used when a generic "Ultrasound Studies" is added
// to determine which specific studies actually qualify.
export function qualifyingUltrasoundSubtests(
  evidence: AdminEvidenceChip[],
  candidateTests: readonly string[] = AI_QUALIFYING_ULTRASOUND_TESTS,
): string[] {
  return candidateTests.filter(
    (t) => clinicalEvidenceForUltrasoundTest(t, evidence).length > 0,
  );
}

export function buildAdminReviewEvidence(input: {
  age?: number | null;
  hx?: string | null;
  dx?: string | null;
  rx?: string | null;
  diagnoses?: string | null;
  medications?: string | null;
  icdText?: string | null;
  previousTests?: string | null;
}): AdminReviewRuleResult {
  const hx = normalize(input.hx);
  const dx = normalize(`${input.dx ?? ""} ${input.diagnoses ?? ""}`);
  const rx = normalize(`${input.rx ?? ""} ${input.medications ?? ""}`);
  const icdText = normalize(input.icdText);
  const prior = normalize(input.previousTests);
  const dxAndIcd = `${dx} ${icdText}`;

  const evidence: AdminEvidenceChip[] = [];
  const suggestions: AdminDiagnosisSuggestion[] = [];
  const under16 = typeof input.age === "number" && input.age < 16;

  // Diagnosis chip seeding: ONLY look at Dx/ICD text. Medications are
  // explicitly excluded from the diagnosis trigger set — a statin in
  // Rx must never auto-create a Hyperlipidemia chip.
  //
  // SOURCE MARKER: Medications do not auto-create diagnoses
  const seedDiagnosis = (
    label: string,
    key: keyof typeof COMMON_ICD_SUGGESTIONS,
    dxTerms: string[],
    source: AdminEvidenceSource = "Dx",
  ) => {
    if (!hasAny(dxAndIcd, dxTerms)) return;
    const codeChecks = COMMON_ICD_SUGGESTIONS[key]?.map((s) => s.code.toLowerCase()) ?? [];
    const matchedCode = codeChecks.find((c) => icdText.includes(c))?.toUpperCase() ?? null;
    pushUnique(evidence, {
      id: stableId("diagnosis", label, source, matchedCode),
      kind: "diagnosis",
      label,
      source,
      icdCode: matchedCode,
      icdLabel: matchedCode
        ? COMMON_ICD_SUGGESTIONS[key]?.find((s) => s.code === matchedCode)?.label ?? null
        : null,
      // requiresIcd is metadata only — chip is still placeable.
      // SOURCE MARKER: requiresIcd does not block chip placement
      requiresIcd: !matchedCode,
      suggestedIcds: !matchedCode ? COMMON_ICD_SUGGESTIONS[key] : [],
      confidence: "high",
      detail: "Extracted from Dx/ICD text",
    });
  };

  seedDiagnosis("Diabetes mellitus", "diabetes", ["diabetes", "dm2", "type 2 dm", "e11"]);
  seedDiagnosis("Hypertension", "hypertension", ["hypertension", "htn", "i10"]);
  seedDiagnosis("Hyperlipidemia", "hyperlipidemia", ["hyperlipidemia", "hld", "dyslipidemia", "e78"]);
  seedDiagnosis("Venous insufficiency", "venous_insufficiency", ["venous insufficiency", "venous reflux", "i87"]);
  seedDiagnosis("DVT", "dvt", ["dvt", "deep vein thrombosis", "i82"]);
  seedDiagnosis("Varicose veins", "varicose", ["varicose", "i83"]);
  seedDiagnosis("Peripheral vascular disease", "pvd", ["pvd", "pad", "peripheral vascular", "i73"]);

  const meds: Array<[string, string[]]> = [
    ["Metformin", ["metformin"]],
    ["Insulin", ["insulin"]],
    ["Amlodipine", ["amlodipine"]],
    ["Lisinopril", ["lisinopril"]],
    ["Losartan", ["losartan"]],
    ["Metoprolol", ["metoprolol"]],
    ["Atorvastatin", ["atorvastatin"]],
    ["Rosuvastatin", ["rosuvastatin"]],
    ["Aspirin", ["aspirin"]],
    ["Apixaban", ["apixaban", "eliquis"]],
    ["Rivaroxaban", ["rivaroxaban", "xarelto"]],
    ["Warfarin", ["warfarin", "coumadin"]],
  ];

  for (const [label, terms] of meds) {
    if (hasAny(rx, terms)) {
      pushUnique(evidence, {
        id: stableId("medication", label, "Rx"),
        kind: "medication",
        label,
        source: "Rx",
        confidence: "high",
      });
    }
  }

  // Medication-derived diagnosis SUGGESTIONS. These are inactive —
  // they live in `suggestions` until the user clicks accept in the
  // right-panel Diagnosis popover, at which point the UI promotes
  // them to a real diagnosis SupportingButton.
  //
  // SOURCE MARKER: Medication-derived diagnosis suggestions are inactive until accepted
  const alreadyDiagnosed = new Set(
    evidence.filter((e) => e.kind === "diagnosis").map((e) => e.label.toLowerCase()),
  );
  for (const cue of COMMON_MEDICATION_SUGGESTIONS) {
    if (alreadyDiagnosed.has(cue.diagnosisLabel.toLowerCase())) continue;
    const hit = cue.triggers.find((t) => rx.includes(t));
    if (!hit) continue;
    suggestions.push({
      id: stableId("suggestion", cue.diagnosisLabel, "Rx", hit),
      label: cue.diagnosisLabel,
      reason: `${cue.reason} (Rx: ${hit})`,
      source: "Rx",
      triggerLabel: hit,
      suggestedIcds: COMMON_ICD_SUGGESTIONS[cue.diagnosisKey] ?? [],
    });
  }

  const symptoms: Array<[string, keyof typeof COMMON_ICD_SUGGESTIONS, string[]]> = [
    ["Lower extremity edema", "edema", ["edema", "swelling", "leg swelling"]],
    ["Dizziness / neurovascular symptom", "dizziness", ["dizziness", "syncope", "bruit", "vertigo"]],
    ["Dyspnea", "dyspnea", ["dyspnea", "shortness of breath", "sob"]],
    ["Peripheral vascular disease concern", "pvd", ["claudication", "pad", "pvd", "leg pain"]],
    ["Venous stasis / varicose history", "varicose", ["varicose", "venous stasis", "spider veins"]],
    ["Prior DVT", "dvt", ["dvt", "deep vein thrombosis"]],
    ["Calf pain", "edema", ["calf pain"]],
  ];

  for (const [label, key, terms] of symptoms) {
    if (hasAny(hx, terms)) {
      const code = COMMON_ICD_SUGGESTIONS[key]?.find((s) => icdText.includes(s.code.toLowerCase()))?.code ?? null;
      pushUnique(evidence, {
        id: stableId("symptom", label, "Hx", code),
        kind: "symptom",
        label,
        source: "Hx",
        icdCode: code,
        requiresIcd: false,
        suggestedIcds: code ? [] : COMMON_ICD_SUGGESTIONS[key] ?? [],
        confidence: "medium",
      });
    }
  }

  if (prior.trim()) {
    pushUnique(evidence, {
      id: stableId("prior_test", "Prior testing", "Prior Test"),
      kind: "prior_test",
      label: "Prior testing",
      source: "Prior Test",
      detail: input.previousTests ?? null,
      confidence: "medium",
    });
  }

  const missingIcdCount = evidence.filter((x) => x.requiresIcd).length;
  const evidenceIds = evidence.filter((x) => !x.requiresIcd).map((x) => x.id);

  const vascularEvidence = evidence.filter((x) =>
    [
      "Diabetes mellitus",
      "Hypertension",
      "Hyperlipidemia",
      "Lower extremity edema",
      "Peripheral vascular disease concern",
    ].some((term) => x.label.includes(term)),
  );

  const candidates: AdminReviewRuleCandidate[] = [
    {
      ancillaryId: "vitalwave",
      label: "VitalWave",
      status: under16
        ? "admin_approval_required"
        : vascularEvidence.length >= 2
          ? "suggested"
          : "needs_info",
      evidenceIds: vascularEvidence.filter((x) => !x.requiresIcd).map((x) => x.id),
      missing: vascularEvidence.filter((x) => x.requiresIcd).map((x) => `${x.label} ICD`),
    },
    {
      ancillaryId: "ultrasound",
      label: "Ultrasound Studies",
      status: under16 ? "admin_approval_required" : "needs_info",
      evidenceIds,
      missing: missingIcdCount ? ["ICD confirmation"] : [],
    },
    {
      ancillaryId: "brainwave",
      label: "BrainWave",
      status: under16
        ? "admin_approval_required"
        : hasAny(`${hx} ${dx}`, ["dizziness", "syncope", "neuropathy"])
          ? "suggested"
          : "needs_info",
      evidenceIds: evidence
        .filter((x) => ["symptom", "diagnosis", "icd"].includes(x.kind) && !x.requiresIcd)
        .map((x) => x.id),
      missing: [],
    },
  ];

  return {
    evidence,
    suggestions,
    candidates,
    flags: {
      under16,
      adminApprovalRequired: under16,
      missingIcdCount,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Admin Review — SupportingButton evidence model, assignment state, and
// reasoning-blob helpers extracted from AdminReviewDialog so the merge
// / dedupe / stale-flag rules are unit-testable outside React and
// reusable by packet-QA, batch-runner preservation, and server-side
// dedupe.
// ────────────────────────────────────────────────────────────────────

export type SupportingButtonKind =
  | "icd_disease"
  | "medication"
  | "symptom"
  | "history"
  | "prior_test";

export type SupportingButtonSource =
  | "Dx"
  | "Rx"
  | "Hx"
  | "Prior Test"
  | "AI ICD Search"
  | "Rule Engine";

export type SupportingButton = {
  id: string;
  kind: SupportingButtonKind;
  label: string;
  source: SupportingButtonSource;
  sourceText?: string | null;
  icdCode?: string | null;
  icdLabel?: string | null;
  requiresIcd?: boolean;
  medicationName?: string | null;
  symptomName?: string | null;
  confidence?: "high" | "medium" | "low";
};

export type UltrasoundAssignments = {
  parent: SupportingButton[];
  byTestName: Record<string, SupportingButton[]>;
};

export type AdminReviewAssignmentState = {
  brainwave: SupportingButton[];
  vitalwave: SupportingButton[];
  ultrasound: UltrasoundAssignments;
};

export type AssignmentTarget =
  | { type: "ancillary"; ancillaryId: "brainwave" | "vitalwave" }
  | { type: "ultrasound-parent" }
  | { type: "ultrasound-test"; testName: string }
  | { type: "all" };

export type ChipOrigin = "user" | "canonical" | "rule-seeded";

export type DisplayChipKind =
  | "icd_disease"
  | "medication"
  | "symptom"
  | "history"
  | "prior_test";

export type DisplayChip = {
  key: string;
  label: string;
  icdCode: string | null;
  kind: DisplayChipKind;
  origin: ChipOrigin;
  button?: SupportingButton;
  canonicalTestNames?: string[];
};

export type AssignedEvidenceMergeOptions = {
  staleAncillaries?: Set<string>;
  staleReason?: string;
  clearedAncillaries?: Set<string>;
};

// Deterministic key used everywhere client-side and server-side to
// deduplicate assigned SupportingButtons on a target. Same shape must
// be used by the runner preservation logic and the add/regen services.
export function buttonKey(b: SupportingButton): string {
  if (b.kind === "icd_disease") {
    return `icd:${b.icdCode ?? "needs"}:${b.label.toLowerCase()}`;
  }
  if (b.kind === "medication") {
    return `med:${(b.medicationName ?? b.label).toLowerCase()}`;
  }
  if (b.kind === "symptom" || b.kind === "history") {
    return `hx:${b.label.toLowerCase()}`;
  }
  if (b.kind === "prior_test") return `prior:${b.label.toLowerCase()}`;
  return `${b.kind}:${b.label.toLowerCase()}`;
}

export function chipKeyForAssignment(b: SupportingButton): string {
  return buttonKey(b);
}

export function emptyAssignmentState(): AdminReviewAssignmentState {
  return {
    brainwave: [],
    vitalwave: [],
    ultrasound: { parent: [], byTestName: {} },
  };
}

// Read the assignment state out of a `patient.reasoning` blob so the
// dialog can re-hydrate on open. Symmetrical inverse of
// `buildAssignedEvidenceReasoning`.
export function seedAssignmentsFromReasoning(
  reasoning: Record<string, any>,
): AdminReviewAssignmentState {
  const state = emptyAssignmentState();
  for (const id of ["brainwave", "vitalwave"] as const) {
    const entry = reasoning[`adminReview:${id}`];
    if (entry && typeof entry === "object" && Array.isArray(entry.assignedEvidence)) {
      state[id] = entry.assignedEvidence as SupportingButton[];
    }
  }
  const ultra = reasoning["adminReview:ultrasound"];
  if (ultra && typeof ultra === "object" && Array.isArray(ultra.assignedEvidence)) {
    state.ultrasound.parent = ultra.assignedEvidence as SupportingButton[];
  }
  for (const [key, value] of Object.entries(reasoning)) {
    if (!key.startsWith("adminReview:test:")) continue;
    const testName = key.slice("adminReview:test:".length);
    if (value && typeof value === "object" && Array.isArray((value as any).assignedEvidence)) {
      state.ultrasound.byTestName[testName] =
        (value as any).assignedEvidence as SupportingButton[];
    }
  }
  return state;
}

// Build the next `reasoning` blob so it reflects the current
// assignment state. Writer half; must stay symmetrical with
// `seedAssignmentsFromReasoning`.
//
// Merge rules:
//   - Other keys (canonical reasoning[testName], adminReview:updates,
//     adminReview:removedFactors, etc.) pass through.
//   - Each `adminReview:<ancillary>` and `adminReview:test:<name>` key
//     spreads its existing block then overwrites `assignedEvidence`
//     only, so other admin metadata (regeneratedAt, ancillaryNote…)
//     survives.
//   - staleAncillaries / clearedAncillaries flip the `stale` flag on
//     the touched blocks only; siblings' stale state is untouched.
export function buildAssignedEvidenceReasoning(
  prevReasoning: Record<string, unknown>,
  assignments: AdminReviewAssignmentState,
  options: AssignedEvidenceMergeOptions = {},
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...prevReasoning };
  const staleSet = options.staleAncillaries ?? new Set<string>();
  const clearedSet = options.clearedAncillaries ?? new Set<string>();
  const staleReason = options.staleReason ?? "Evidence assignment changed";
  const nowIso = new Date().toISOString();

  for (const id of ["brainwave", "vitalwave", "ultrasound"] as const) {
    const key = `adminReview:${id}`;
    const existing =
      next[key] && typeof next[key] === "object" && !Array.isArray(next[key])
        ? (next[key] as Record<string, unknown>)
        : {};
    const newAssigned =
      id === "ultrasound" ? assignments.ultrasound.parent : assignments[id];
    const merged: Record<string, unknown> = {
      ...existing,
      ancillaryId: id,
      assignedEvidence: newAssigned,
    };
    if (staleSet.has(id)) {
      merged.stale = true;
      merged.staleReason = staleReason;
      merged.staleAt = nowIso;
    }
    if (clearedSet.has(id)) {
      merged.stale = false;
      merged.staleReason = null;
      merged.staleAt = null;
    }
    next[key] = merged;
  }
  for (const [testName, assigned] of Object.entries(
    assignments.ultrasound.byTestName,
  )) {
    const key = `adminReview:test:${testName}`;
    const existing =
      next[key] && typeof next[key] === "object" && !Array.isArray(next[key])
        ? (next[key] as Record<string, unknown>)
        : {};
    const childKey = `test:${testName}`;
    const merged: Record<string, unknown> = {
      ...existing,
      testName,
      assignedEvidence: assigned,
    };
    if (staleSet.has(childKey)) {
      merged.stale = true;
      merged.staleReason = staleReason;
      merged.staleAt = nowIso;
    }
    if (clearedSet.has(childKey)) {
      merged.stale = false;
      merged.staleReason = null;
      merged.staleAt = null;
    }
    next[key] = merged;
  }
  return next;
}

// Given an operator's assignment target, return the set of "target
// ids" the writer marks stale on attach/detach. Parents:
// brainwave/vitalwave/ultrasound. Ultrasound children: test:<name>.
export function targetIdsForAssignmentTarget(
  target: AssignmentTarget,
): string[] {
  if (target.type === "all") return ["brainwave", "vitalwave", "ultrasound"];
  if (target.type === "ancillary") return [target.ancillaryId];
  if (target.type === "ultrasound-parent") return ["ultrasound"];
  if (target.type === "ultrasound-test") return [`test:${target.testName}`];
  return [];
}

// Read the stale target ids from a reasoning blob. Returns the same id
// shape (`brainwave|vitalwave|ultrasound|test:<n>`) the writer uses.
export function readStaleTargetIds(
  reasoning: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const id of ["brainwave", "vitalwave", "ultrasound"] as const) {
    const block = reasoning[`adminReview:${id}`];
    if (
      block &&
      typeof block === "object" &&
      (block as Record<string, unknown>).stale === true
    ) {
      out.push(id);
    }
  }
  for (const key of Object.keys(reasoning)) {
    if (!key.startsWith("adminReview:test:")) continue;
    const block = reasoning[key];
    if (
      block &&
      typeof block === "object" &&
      (block as Record<string, unknown>).stale === true
    ) {
      out.push(`test:${key.slice("adminReview:test:".length)}`);
    }
  }
  return out;
}

// Predicate: is this SupportingButton already assigned to the given
// target? Uses `chipKeyForAssignment` for structural equality, so
// dedupe is deterministic across client + server writers.
export function isAssignedToTarget(
  btn: SupportingButton,
  target: AssignmentTarget,
  state: AdminReviewAssignmentState,
): boolean {
  const key = chipKeyForAssignment(btn);
  if (target.type === "ancillary") {
    return state[target.ancillaryId].some(
      (b) => chipKeyForAssignment(b) === key,
    );
  }
  if (target.type === "ultrasound-parent") {
    return state.ultrasound.parent.some(
      (b) => chipKeyForAssignment(b) === key,
    );
  }
  if (target.type === "ultrasound-test") {
    return (state.ultrasound.byTestName[target.testName] ?? []).some(
      (b) => chipKeyForAssignment(b) === key,
    );
  }
  if (target.type === "all") {
    return (
      state.brainwave.some((b) => chipKeyForAssignment(b) === key) &&
      state.vitalwave.some((b) => chipKeyForAssignment(b) === key) &&
      state.ultrasound.parent.some((b) => chipKeyForAssignment(b) === key)
    );
  }
  return false;
}

// Dedupe a list of DisplayChips by `chip.key`. Higher-priority origin
// wins the merge; canonicalTestNames are unioned so an ancillary-level
// remove can strip every occurrence.
export function dedupeChips(chips: DisplayChip[]): DisplayChip[] {
  const priority: Record<ChipOrigin, number> = {
    user: 0,
    canonical: 1,
    "rule-seeded": 2,
  };
  const map = new Map<string, DisplayChip>();
  for (const chip of chips) {
    const existing = map.get(chip.key);
    if (!existing) {
      map.set(chip.key, {
        ...chip,
        canonicalTestNames: chip.canonicalTestNames
          ? [...chip.canonicalTestNames]
          : undefined,
      });
      continue;
    }
    const winsBy: ChipOrigin =
      priority[chip.origin] < priority[existing.origin]
        ? chip.origin
        : existing.origin;
    const winner = winsBy === chip.origin ? chip : existing;
    const merged: DisplayChip = {
      ...winner,
      canonicalTestNames: Array.from(
        new Set([
          ...(existing.canonicalTestNames ?? []),
          ...(chip.canonicalTestNames ?? []),
        ]),
      ),
    };
    if (merged.canonicalTestNames && merged.canonicalTestNames.length === 0) {
      merged.canonicalTestNames = undefined;
    }
    map.set(chip.key, merged);
  }
  return Array.from(map.values());
}

// Server-response merge helper (pure). Used by the dialog's
// mergeRegenerateResponseReasoning to trust the server for
// `regeneratedTargetIds` and carry forward every other adminReview:*
// block from the operator's live-staged reasoning.
export function mergeRegenerateResponseReasoning(
  serverReasoning: Record<string, unknown>,
  liveReasoning: Record<string, unknown>,
  assignmentsSnapshot: AdminReviewAssignmentState,
  regeneratedTargetIds: Set<string>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...serverReasoning };
  for (const key of new Set([
    ...Object.keys(liveReasoning),
    ...Object.keys(serverReasoning),
  ])) {
    if (!key.startsWith("adminReview:")) continue;
    if (key === "adminReview:updates") {
      if (serverReasoning[key] !== undefined) merged[key] = serverReasoning[key];
      else if (liveReasoning[key] !== undefined) merged[key] = liveReasoning[key];
      continue;
    }
    const targetId = key === "adminReview:ultrasound"
      ? "ultrasound"
      : key === "adminReview:brainwave"
      ? "brainwave"
      : key === "adminReview:vitalwave"
      ? "vitalwave"
      : key.startsWith("adminReview:test:")
      ? `test:${key.slice("adminReview:test:".length)}`
      : null;
    if (targetId == null) continue;
    if (regeneratedTargetIds.has(targetId)) {
      if (serverReasoning[key] !== undefined) merged[key] = serverReasoning[key];
    } else {
      if (liveReasoning[key] !== undefined) merged[key] = liveReasoning[key];
    }
  }
  return buildAssignedEvidenceReasoning(merged, assignmentsSnapshot, {
    clearedAncillaries: regeneratedTargetIds,
  });
}

// Dedupe an `assignedEvidence` array by `buttonKey`. Server-side use:
// call this before persisting any array so the add + regenerate
// services never write the same target twice. Cross-target reuse (same
// button in brainwave + vitalwave) is preserved because dedupe is
// scoped to a single array.
//
// The helper is intentionally payload-agnostic: it inspects only the
// keying properties buttonKey reads (kind, label, icdCode,
// medicationName), which both SupportingButton (client) and
// AdminEvidenceChip (server) share. Callers preserve their own element
// type via the return-shape identity below.
export function dedupeAssignedEvidence<T = unknown>(
  buttons: readonly T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const b of buttons) {
    const key = buttonKey(b as unknown as SupportingButton);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

// The list of adminReview:* key prefixes that the batch runner must
// preserve when it overwrites `reasoning`. The runner reads existing
// reasoning, picks every key matching this predicate, and merges it
// forward.
export function isAdminReviewReasoningKey(key: string): boolean {
  return key.startsWith("adminReview:");
}

// Preserve every adminReview:* key from `existing` on top of `next`.
// Preserved keys always win the merge — the runner cannot silently
// overwrite reviewer decisions. Returns the merged blob and the list
// of preserved keys so the caller can log them.
export function preserveAdminReviewReasoning(
  existing: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
): { reasoning: Record<string, unknown>; preservedKeys: string[] } {
  const existingObj = existing ?? {};
  const preservedKeys = Object.keys(existingObj).filter(
    isAdminReviewReasoningKey,
  );
  if (preservedKeys.length === 0) {
    return { reasoning: next, preservedKeys };
  }
  const merged: Record<string, unknown> = { ...next };
  for (const key of preservedKeys) {
    merged[key] = existingObj[key];
  }
  return { reasoning: merged, preservedKeys };
}
