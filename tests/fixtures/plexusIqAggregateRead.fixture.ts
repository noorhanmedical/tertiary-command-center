// Plexus IQ aggregate read — PHI-safe forwarding fixture (Bundle 52).
//
// Data-only fixture. NOT wired to any runtime path. Pins the
// byte-identical forwarding contract from
// docs/architecture/plexus-iq-read-model-contract.md (Bundle 25 §3)
// so a future aggregate read endpoint cannot reshape, re-derive, or
// re-rank the canonical reasoning blob, qualifying factors,
// supporting buttons, ICD chips, or Admin Review state.
//
// SCOPE / SAFETY
//   - No PHI. Synthetic patient ids; synthetic Greek-letter names;
//     synthetic dates.
//   - No Plexus IQ runtime change.
//   - No qualification logic change.
//   - No Admin Review change.
//   - No supporting button change.
//   - No canonical reasoning writes.
//
// CONTRACT REFERENCES
//   plexus-iq-read-model-contract.md (Bundle 25)
//   admin-review-approval-commit-inventory.md (Bundle 30)
//   qualification-structure-cleanup-design.md (Bundle 31)
//   pdf-protection-contract.md
//   icd-suggestion-safety-contract.md (Bundle 40)

/** Synthetic patient_screenings slice the aggregate forwards. */
export type LegacyScreeningForwardSlice = {
  id: number;
  name: string;
  dob: string;
  phoneNumber: string;
  email: string | null;
  facility: string;
  patientType: string;
  commitStatus: string;
  committedAt: string | null;
  committedByUserId: string | null;
  adminApprovalStatus: string;
  adminApprovedAt: string | null;
  adminApprovedByUserId: string | null;
  adminApprovalNote: string | null;
  qualifyingTests: string[];
  cooldownTests: string[];
  diagnoses: string | null;
  history: string | null;
  medications: string | null;
  previousAncillaries: string | null;
  insurance: string | null;
  status: string;
  reasoning: Record<string, unknown>;
};

/** Synthetic patient_execution_cases slice. */
export type LegacyExecutionCaseForwardSlice = {
  id: number;
  engagementStatus: string;
  engagementBucket: string;
  commitStatus: string;
  assignedTeamMemberId: number | null;
  assignedRole: string | null;
  lifecycleStatus: string;
};

/** Synthetic evidence slice (mirrors the admin-review/evidence body). */
export type LegacyEvidenceForwardSlice = {
  ancillaryId: string;
  ruleEngineVersion: string;
  candidateIcds: string[];
  evidenceSnapshot: { snippetHash: string; documentIds: number[] };
};

/** Canned reasoning blob with multiple ancillaries. */
const CANONICAL_REASONING: Record<string, unknown> = {
  // Per-ancillary AI rationale.
  brainwave: {
    rationale: "Synthetic brainwave rationale",
    qualifyingFactors: ["factor_a", "factor_b"],
    icdChips: ["G31.1", "G93.89"],
    guardrails: { under16: false },
  },
  vitalwave: {
    rationale: "Synthetic vitalwave rationale",
    qualifyingFactors: ["factor_c"],
    icdChips: ["I10"],
    guardrails: { under16: false },
  },
  ultrasound: {
    rationale: "Synthetic ultrasound rationale",
    qualifyingFactors: ["factor_d"],
    icdChips: ["R10.9"],
    guardrails: { under16: false },
  },
  // Per-ancillary Admin Review supplemental metadata.
  "adminReview:brainwave": {
    regeneratedAt: "2026-06-09T14:00:00.000Z",
    regeneratedByUserId: "u-admin-1",
    modelMetadata: { modelId: "synth-model-v1", promptHash: "abc123" },
    evidenceSnapshot: { snippetHash: "deadbeef", documentIds: [1001, 1002] },
  },
  "adminReview:vitalwave": {
    regeneratedAt: "2026-06-09T14:05:00.000Z",
    regeneratedByUserId: "u-admin-1",
    modelMetadata: { modelId: "synth-model-v1", promptHash: "def456" },
    evidenceSnapshot: { snippetHash: "feedface", documentIds: [1003] },
  },
};

/** Canned screening row (PHI-safe). */
export const FIXTURE_SCREENING_FORWARD: LegacyScreeningForwardSlice = {
  id: 5001,
  name: "Alpha One",
  dob: "1980-01-15",
  phoneNumber: "555-0101",
  email: null,
  facility: "Clinic A",
  patientType: "new",
  commitStatus: "Ready",
  committedAt: "2026-06-08T10:00:00.000Z",
  committedByUserId: "u-admin-1",
  adminApprovalStatus: "approved",
  adminApprovedAt: "2026-06-09T13:30:00.000Z",
  adminApprovedByUserId: "u-admin-1",
  adminApprovalNote: null,
  qualifyingTests: ["brainwave", "vitalwave", "ultrasound"],
  cooldownTests: [],
  diagnoses: null,
  history: null,
  medications: null,
  previousAncillaries: null,
  insurance: null,
  status: "completed",
  reasoning: CANONICAL_REASONING,
};

/** Canned execution-case row. */
export const FIXTURE_EXECUTION_CASE_FORWARD: LegacyExecutionCaseForwardSlice = {
  id: 7001,
  engagementStatus: "assigned",
  engagementBucket: "ready",
  commitStatus: "Ready",
  assignedTeamMemberId: 7,
  assignedRole: "scheduler",
  lifecycleStatus: "active",
};

/** Canned evidence rows per ancillary. */
export const FIXTURE_EVIDENCE_FORWARD: ReadonlyArray<LegacyEvidenceForwardSlice> = [
  {
    ancillaryId: "brainwave",
    ruleEngineVersion: "v1.2.0",
    candidateIcds: ["G31.1"],
    evidenceSnapshot: { snippetHash: "deadbeef", documentIds: [1001, 1002] },
  },
  {
    ancillaryId: "vitalwave",
    ruleEngineVersion: "v1.2.0",
    candidateIcds: ["I10"],
    evidenceSnapshot: { snippetHash: "feedface", documentIds: [1003] },
  },
];

/**
 * The aggregate response envelope. A reference projection MUST
 * produce this byte-equivalent from the legacy slices.
 */
export type AggregateResponseFixture = {
  screening: LegacyScreeningForwardSlice;
  executionCase: LegacyExecutionCaseForwardSlice;
  evidence: ReadonlyArray<LegacyEvidenceForwardSlice>;
};

/**
 * Reference forwarder — byte-identical pass-through. The aggregate
 * MUST NOT reshape, re-derive, or re-rank any input. If a future
 * PR's aggregate diverges, the verdict test (next file) fails.
 */
export function forwardLegacySlicesToAggregate_REFERENCE(
  screening: LegacyScreeningForwardSlice,
  executionCase: LegacyExecutionCaseForwardSlice,
  evidence: ReadonlyArray<LegacyEvidenceForwardSlice>,
): AggregateResponseFixture {
  return {
    screening,
    executionCase,
    evidence,
  };
}

/**
 * Import-time sanity check.
 */
{
  // The fixture must carry the canonical reasoning blob with the
  // adminReview:<ancillary> namespaces.
  for (const key of ["brainwave", "vitalwave", "ultrasound", "adminReview:brainwave", "adminReview:vitalwave"]) {
    if (!(key in FIXTURE_SCREENING_FORWARD.reasoning)) {
      throw new Error(
        `[plexus-iq aggregate fixture] reasoning missing required key "${key}"`,
      );
    }
  }
  // Synthetic-name guard.
  if (!/^(alpha|beta|gamma|delta|epsilon)\s/i.test(FIXTURE_SCREENING_FORWARD.name)) {
    throw new Error(
      `[plexus-iq aggregate fixture] screening name "${FIXTURE_SCREENING_FORWARD.name}" must use synthetic Greek-letter convention`,
    );
  }
  // 555-prefix phone guard.
  if (!FIXTURE_SCREENING_FORWARD.phoneNumber.startsWith("555-")) {
    throw new Error(
      `[plexus-iq aggregate fixture] phone "${FIXTURE_SCREENING_FORWARD.phoneNumber}" must use 555- prefix`,
    );
  }
}
