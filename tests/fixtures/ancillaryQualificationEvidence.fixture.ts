// Ancillary qualification evidence bundle — PHI-safe fixture (Bundle 41).
//
// Data-only fixture. NOT wired to any runtime path. Pins the §11
// envelope from emr-integration-clinical-evidence-qualification-contract.md
// (Bundle 37) so a future Ancillary Qualification Engine PR cannot
// silently drop a required field on its suggestion output.
//
// SCOPE / SAFETY
//   - No PHI. Synthetic patient ids, synthetic provider ids, synthetic
//     evidence ids. No real names, DOBs, MRNs, addresses.
//   - No qualification runtime behavior change.
//   - No Admin Review change.
//   - No supporting-button change.
//   - The fixture does NOT decide who qualifies — it pins the shape
//     of the suggestion bundle the future engine emits.
//
// ANCILLARIES COVERED
//   - brainwave           (Bundle 37 §12)
//   - vitalwave           (Bundle 37 §12)
//   - ultrasound          (Bundle 37 §12)
//   - future_ancillary_a  (placeholder for §11 future entries)

export const ANCILLARY_NAMES_FIXTURE = [
  "brainwave",
  "vitalwave",
  "ultrasound",
  "future_ancillary_a",
] as const;
export type AncillaryNameFixture = (typeof ANCILLARY_NAMES_FIXTURE)[number];

export const SUGGESTED_STATUSES_FIXTURE = [
  "qualified",
  "not_qualified",
  "needs_more_evidence",
  "excluded",
] as const;
export type SuggestedStatusFixture = (typeof SUGGESTED_STATUSES_FIXTURE)[number];

export const REVIEW_STATUSES_FIXTURE = [
  "unreviewed",
  "clinician_accepted",
  "clinician_rejected",
  "admin_overridden",
] as const;
export type ReviewStatusFixture = (typeof REVIEW_STATUSES_FIXTURE)[number];

/**
 * Source reference slice mirroring Bundle 38 §2.6. Synthetic ids only.
 */
export type SourceReferenceFixture = {
  vendor: string;
  vendorRecordId: string;
  vendorRecordKind:
    | "fhir_resource"
    | "hl7_segment"
    | "vendor_native_document"
    | "pdf_attachment"
    | "manual_upload";
  rawPayloadPointer: string;
  extractionMethod:
    | "vendor_native"
    | "nlp_v1"
    | "clinician_manual"
    | "admin_manual";
};

/**
 * Evidence entry — points back to a ClinicalEvidence row by id, plus
 * the source reference for reviewer drill-down.
 */
export type EvidenceEntryFixture = {
  evidenceId: string;
  kind: string;
  summary: string;
  sourceReference: SourceReferenceFixture;
};

/**
 * Missing evidence item per Bundle 40 §4.
 */
export type MissingEvidenceItemFixture = {
  expectedEvidenceKind: string;
  reasonMissing:
    | "not_present_in_store"
    | "present_but_stale"
    | "present_but_low_confidence"
    | "present_but_rejected"
    | "not_queryable_from_adapter";
  whereLooked: string;
};

/**
 * Confidence envelope per Bundle 38 §2.8.
 */
export type ConfidenceFixture = {
  band: "low" | "medium" | "high";
  rationale: string;
  componentScores?: Record<string, number>;
};

/**
 * The suggestion bundle. Mirrors Bundle 37 §11.
 */
export type AncillaryQualificationSuggestionFixture = {
  suggestionId: string;
  ancillary: AncillaryNameFixture;
  canonicalPatientId: string;
  tenantId: string;
  suggestedStatus: SuggestedStatusFixture;
  supportingEvidence: EvidenceEntryFixture[];
  missingEvidence: MissingEvidenceItemFixture[];
  exclusions: string[];
  sourceReferences: SourceReferenceFixture[];
  confidence: ConfidenceFixture;
  reviewStatus: ReviewStatusFixture;
  humanApprovalRequired: boolean;
};

const SYNTH_TENANT = "tenant-test-1";
const SYNTH_PATIENT = "pt-canonical-test-1";

function srcRef(suffix: string): SourceReferenceFixture {
  return {
    vendor: "synth_vendor",
    vendorRecordId: `vendor-rec-${suffix}`,
    vendorRecordKind: "fhir_resource",
    rawPayloadPointer: `raw-payload-${suffix}`,
    extractionMethod: "vendor_native",
  };
}

/**
 * BrainWave — qualified with strong supporting evidence.
 */
export const FIXTURE_BRAINWAVE_QUALIFIED: AncillaryQualificationSuggestionFixture = {
  suggestionId: "sug-bw-1",
  ancillary: "brainwave",
  canonicalPatientId: SYNTH_PATIENT,
  tenantId: SYNTH_TENANT,
  suggestedStatus: "qualified",
  supportingEvidence: [
    {
      evidenceId: "ev-bw-1",
      kind: "note_extraction",
      summary: "Memory complaint documented in last visit note",
      sourceReference: srcRef("bw-note-1"),
    },
    {
      evidenceId: "ev-bw-2",
      kind: "imaging_impression",
      summary: "Mild generalized atrophy noted on brain MRI impression",
      sourceReference: srcRef("bw-mri-1"),
    },
  ],
  missingEvidence: [],
  exclusions: [],
  sourceReferences: [srcRef("bw-note-1"), srcRef("bw-mri-1")],
  confidence: {
    band: "high",
    rationale: "Vendor-native problem entry + imaging impression agreement",
  },
  reviewStatus: "unreviewed",
  humanApprovalRequired: true,
};

/**
 * VitalWave — needs more evidence (vitals available but no cardiac
 * imaging impression).
 */
export const FIXTURE_VITALWAVE_NEEDS_MORE_EVIDENCE: AncillaryQualificationSuggestionFixture = {
  suggestionId: "sug-vw-1",
  ancillary: "vitalwave",
  canonicalPatientId: SYNTH_PATIENT,
  tenantId: SYNTH_TENANT,
  suggestedStatus: "needs_more_evidence",
  supportingEvidence: [
    {
      evidenceId: "ev-vw-1",
      kind: "vital",
      summary: "BP trend elevated in last 6 measurements",
      sourceReference: srcRef("vw-bp-1"),
    },
  ],
  missingEvidence: [
    {
      expectedEvidenceKind: "imaging_impression",
      reasonMissing: "not_present_in_store",
      whereLooked: "imaging adapter, last 12 months, echocardiogram modality",
    },
    {
      expectedEvidenceKind: "lab_result",
      reasonMissing: "not_present_in_store",
      whereLooked: "lab adapter, BNP / NT-proBNP, last 12 months",
    },
  ],
  exclusions: [],
  sourceReferences: [srcRef("vw-bp-1")],
  confidence: {
    band: "low",
    rationale: "Single evidence kind; trend-only signal",
  },
  reviewStatus: "unreviewed",
  humanApprovalRequired: true,
};

/**
 * Ultrasound — excluded due to a contraindication.
 */
export const FIXTURE_ULTRASOUND_EXCLUDED: AncillaryQualificationSuggestionFixture = {
  suggestionId: "sug-us-1",
  ancillary: "ultrasound",
  canonicalPatientId: SYNTH_PATIENT,
  tenantId: SYNTH_TENANT,
  suggestedStatus: "excluded",
  supportingEvidence: [
    {
      evidenceId: "ev-us-1",
      kind: "condition",
      summary: "Active hospice care documented",
      sourceReference: srcRef("us-hospice-1"),
    },
  ],
  missingEvidence: [],
  exclusions: ["active_hospice_care"],
  sourceReferences: [srcRef("us-hospice-1")],
  confidence: {
    band: "high",
    rationale: "Single decisive contraindication; high confidence on exclusion",
  },
  reviewStatus: "unreviewed",
  humanApprovalRequired: true,
};

/**
 * Future ancillary placeholder — not_qualified with no
 * supporting evidence; illustrates the negative path.
 */
export const FIXTURE_FUTURE_ANCILLARY_NOT_QUALIFIED: AncillaryQualificationSuggestionFixture = {
  suggestionId: "sug-fut-1",
  ancillary: "future_ancillary_a",
  canonicalPatientId: SYNTH_PATIENT,
  tenantId: SYNTH_TENANT,
  suggestedStatus: "not_qualified",
  supportingEvidence: [],
  missingEvidence: [
    {
      expectedEvidenceKind: "condition",
      reasonMissing: "not_present_in_store",
      whereLooked: "problem list + diagnosis history",
    },
  ],
  exclusions: [],
  sourceReferences: [],
  confidence: {
    band: "medium",
    rationale: "Absence of any qualifying evidence",
  },
  reviewStatus: "unreviewed",
  humanApprovalRequired: true,
};

export const ANCILLARY_QUALIFICATION_FIXTURE_BUNDLES = [
  FIXTURE_BRAINWAVE_QUALIFIED,
  FIXTURE_VITALWAVE_NEEDS_MORE_EVIDENCE,
  FIXTURE_ULTRASOUND_EXCLUDED,
  FIXTURE_FUTURE_ANCILLARY_NOT_QUALIFIED,
] as const;

/**
 * Sanity-check the fixture at import time.
 */
{
  const required: Array<keyof AncillaryQualificationSuggestionFixture> = [
    "suggestionId",
    "ancillary",
    "canonicalPatientId",
    "tenantId",
    "suggestedStatus",
    "supportingEvidence",
    "missingEvidence",
    "exclusions",
    "sourceReferences",
    "confidence",
    "reviewStatus",
    "humanApprovalRequired",
  ];
  for (const bundle of ANCILLARY_QUALIFICATION_FIXTURE_BUNDLES) {
    for (const key of required) {
      if (!(key in bundle)) {
        throw new Error(
          `[ancillary qualification fixture] bundle ${bundle.suggestionId} missing required field "${key}"`,
        );
      }
    }
    if (!bundle.humanApprovalRequired) {
      throw new Error(
        `[ancillary qualification fixture] bundle ${bundle.suggestionId} must require human approval`,
      );
    }
    if (bundle.reviewStatus !== "unreviewed") {
      throw new Error(
        `[ancillary qualification fixture] bundle ${bundle.suggestionId} must emit as unreviewed`,
      );
    }
  }
  // PHI guard — no patient name / DOB / MRN strings.
  const stringified = JSON.stringify(ANCILLARY_QUALIFICATION_FIXTURE_BUNDLES);
  for (const banned of ["patientName", "patientDob", "mrn", "insurance"]) {
    if (stringified.toLowerCase().includes(banned.toLowerCase())) {
      throw new Error(
        `[ancillary qualification fixture] forbidden identifier "${banned}" present`,
      );
    }
  }
}
