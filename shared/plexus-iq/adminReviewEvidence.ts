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
