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
  requiresIcd?: boolean;
  suggestedIcds?: Array<{ code: string; label: string }>;
  confidence?: "high" | "medium" | "low";
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
};

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
  const all = `${hx} ${dx} ${rx} ${icdText} ${prior}`;

  const evidence: AdminEvidenceChip[] = [];
  const under16 = typeof input.age === "number" && input.age < 16;

  const diagnosis = (
    label: string,
    key: keyof typeof COMMON_ICD_SUGGESTIONS,
    codeChecks: string[],
    terms: string[],
    source: AdminEvidenceSource = "AI",
  ) => {
    if (!hasAny(all, terms)) return;
    const matchedCode = codeChecks.find((c) => icdText.includes(c.toLowerCase())) ?? null;
    pushUnique(evidence, {
      id: stableId("diagnosis", label, source, matchedCode),
      kind: "diagnosis",
      label,
      source,
      icdCode: matchedCode,
      icdLabel: matchedCode
        ? COMMON_ICD_SUGGESTIONS[key]?.find((s) => s.code === matchedCode)?.label ?? null
        : null,
      requiresIcd: !matchedCode,
      suggestedIcds: !matchedCode ? COMMON_ICD_SUGGESTIONS[key] : [],
      confidence: "high",
      detail: "Extracted from Hx/Dx/Rx",
    });
  };

  diagnosis("Diabetes mellitus", "diabetes", ["E11.9", "E11.40"], [
    "diabetes", "dm2", "metformin", "insulin", "glp-1", "semaglutide", "jardiance", "farxiga",
  ]);
  diagnosis("Hypertension", "hypertension", ["I10"], [
    "hypertension", "htn", "amlodipine", "lisinopril", "losartan", "hctz", "hydrochlorothiazide", "metoprolol",
  ]);
  diagnosis("Hyperlipidemia", "hyperlipidemia", ["E78.5"], [
    "hyperlipidemia", "hld", "atorvastatin", "rosuvastatin", "pravastatin", "simvastatin", "statin",
  ]);

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

  const symptoms: Array<[string, keyof typeof COMMON_ICD_SUGGESTIONS, string[]]> = [
    ["Lower extremity edema", "edema", ["edema", "swelling"]],
    ["Dizziness / neurovascular symptom", "dizziness", ["dizziness", "syncope", "bruit"]],
    ["Dyspnea", "dyspnea", ["dyspnea", "shortness of breath", "sob"]],
    ["Peripheral vascular disease concern", "pvd", ["claudication", "pad", "pvd", "leg pain"]],
  ];

  for (const [label, key, terms] of symptoms) {
    if (hasAny(all, terms)) {
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
        : hasAny(all, ["dizziness", "syncope", "neuropathy"])
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
    candidates,
    flags: {
      under16,
      adminApprovalRequired: under16,
      missingIcdCount,
    },
  };
}
