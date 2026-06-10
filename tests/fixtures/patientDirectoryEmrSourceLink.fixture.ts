// Patient Directory EMR source-link — PHI-safe fixture (Bundle 42).
//
// Data-only fixture. NOT wired to any runtime path. Pins the
// EmrSourceLink entity from
// emr-integration-clinical-evidence-qualification-contract.md
// Bundle 37 §13 so a future Patient Directory adoption PR cannot
// silently drop a required field on the bridge between a canonical
// patient and one or more EMR records (per vendor, per facility).
//
// SCOPE / SAFETY
//   - No PHI. Synthetic canonical patient ids, synthetic external ids,
//     synthetic MRNs (prefixed `MRN-`), synthetic vendor names.
//   - No Patient Directory runtime change.
//   - No matching runtime change.
//   - No migrations.
//
// CROSS-REFERENCES
//   patient-directory-design.md (Bundle 5)
//   patient-directory-shadow-read-contract.md (Bundle 20)
//   emr-integration-clinical-evidence-qualification-contract.md
//     (Bundle 37 §3 + §13 + §15)
//   emr-adapter-interface-design.md (Bundle 39 §2.3 + §2.4)

export const EMR_VENDOR_IDS_FIXTURE = [
  "epic",
  "eclinicalworks",
  "cerner_oracle",
  "athena",
  "nextgen",
  "advancedmd",
  "pcc",
  "future_a",
] as const;
export type EmrVendorIdFixture = (typeof EMR_VENDOR_IDS_FIXTURE)[number];

export const MATCH_CONFIDENCE_BANDS_FIXTURE = ["low", "medium", "high"] as const;
export type MatchConfidenceBandFixture =
  (typeof MATCH_CONFIDENCE_BANDS_FIXTURE)[number];

/**
 * EmrSourceLink fixture row.
 *
 * Mirrors Bundle 37 §13 conceptual entity. Every field is required
 * unless explicitly optional.
 */
export type EmrSourceLinkFixtureRow = {
  /** Opaque bridge id. */
  linkId: string;
  /** Multi-tenant isolation key. */
  tenantId: string;
  /** Patient Directory canonical id (SHA-256 hex per Bundle 5). */
  canonicalPatientId: string;
  /** Vendor / adapter identifier. */
  sourceEmr: EmrVendorIdFixture;
  /** Vendor's patient record id. */
  externalPatientId: string;
  /** Vendor MRN (synthetic; prefix `MRN-`). */
  mrn: string;
  /** Facility / clinic scope inside the vendor. */
  facilityId: string;
  /** Confidence the canonical-id ↔ external-id match is correct. */
  matchConfidence: MatchConfidenceBandFixture;
  /**
   * Confidence the SOURCE data on the vendor side is reliable
   * (separate from match confidence). Low source confidence
   * surfaces e.g. when a vendor returns suspected-duplicate records.
   */
  sourceConfidence: MatchConfidenceBandFixture;
  /** ISO 8601 timestamp of the most recent successful sync. */
  lastSyncAt: string;
  /**
   * True when the link has been flagged for human review (e.g.
   * conflicting demographics across vendors, suspected duplicate).
   */
  conflictFlag: boolean;
  /**
   * True when a clinician or admin must reconcile before downstream
   * consumers may use the link. ALWAYS true when conflictFlag is
   * true; may also be true for low-confidence matches per §1 of the
   * shadow-read contract.
   */
  manualReviewRequired: boolean;
};

const SYNTH_TENANT = "tenant-test-1";

/**
 * Three canonical patients, each linked to one or more EMR records
 * across the spectrum of confidence / conflict / review states.
 */
export const PATIENT_DIRECTORY_EMR_SOURCE_LINK_FIXTURE_ROWS: ReadonlyArray<EmrSourceLinkFixtureRow> = [
  // Canonical patient A — clean high-confidence Epic link, no conflict.
  {
    linkId: "link-1",
    tenantId: SYNTH_TENANT,
    canonicalPatientId: "pt-canonical-a",
    sourceEmr: "epic",
    externalPatientId: "epic-ext-a-1",
    mrn: "MRN-EPIC-A-001",
    facilityId: "Clinic A",
    matchConfidence: "high",
    sourceConfidence: "high",
    lastSyncAt: "2026-06-09T08:00:00.000Z",
    conflictFlag: false,
    manualReviewRequired: false,
  },
  // Same canonical patient A — secondary link in Athena, medium match
  // (slight demographic drift but agree on DOB + last name).
  {
    linkId: "link-2",
    tenantId: SYNTH_TENANT,
    canonicalPatientId: "pt-canonical-a",
    sourceEmr: "athena",
    externalPatientId: "athena-ext-a-1",
    mrn: "MRN-ATH-A-022",
    facilityId: "Clinic A",
    matchConfidence: "medium",
    sourceConfidence: "high",
    lastSyncAt: "2026-06-08T19:30:00.000Z",
    conflictFlag: false,
    manualReviewRequired: true, // medium match → reviewer must confirm
  },
  // Canonical patient B — low-confidence ECW link, conflict raised.
  {
    linkId: "link-3",
    tenantId: SYNTH_TENANT,
    canonicalPatientId: "pt-canonical-b",
    sourceEmr: "eclinicalworks",
    externalPatientId: "ecw-ext-b-1",
    mrn: "MRN-ECW-B-100",
    facilityId: "Clinic B",
    matchConfidence: "low",
    sourceConfidence: "medium",
    lastSyncAt: "2026-06-07T12:15:00.000Z",
    conflictFlag: true,
    manualReviewRequired: true,
  },
  // Canonical patient C — single high-confidence Cerner link, no facility
  // overlap with A or B (illustrates cross-clinic scenario).
  {
    linkId: "link-4",
    tenantId: SYNTH_TENANT,
    canonicalPatientId: "pt-canonical-c",
    sourceEmr: "cerner_oracle",
    externalPatientId: "cerner-ext-c-1",
    mrn: "MRN-CERN-C-501",
    facilityId: "Clinic C",
    matchConfidence: "high",
    sourceConfidence: "high",
    lastSyncAt: "2026-06-09T07:45:00.000Z",
    conflictFlag: false,
    manualReviewRequired: false,
  },
  // Canonical patient B — historical PCC link, low source confidence
  // (older data from a SNF stay; admins may still want it for context).
  {
    linkId: "link-5",
    tenantId: SYNTH_TENANT,
    canonicalPatientId: "pt-canonical-b",
    sourceEmr: "pcc",
    externalPatientId: "pcc-ext-b-1",
    mrn: "MRN-PCC-B-310",
    facilityId: "SNF C",
    matchConfidence: "medium",
    sourceConfidence: "low",
    lastSyncAt: "2026-03-12T15:00:00.000Z",
    conflictFlag: false,
    manualReviewRequired: true,
  },
];

/**
 * Sanity-check the fixture at import time.
 */
{
  const required: Array<keyof EmrSourceLinkFixtureRow> = [
    "linkId",
    "tenantId",
    "canonicalPatientId",
    "sourceEmr",
    "externalPatientId",
    "mrn",
    "facilityId",
    "matchConfidence",
    "sourceConfidence",
    "lastSyncAt",
    "conflictFlag",
    "manualReviewRequired",
  ];
  for (const row of PATIENT_DIRECTORY_EMR_SOURCE_LINK_FIXTURE_ROWS) {
    for (const key of required) {
      if (!(key in row)) {
        throw new Error(
          `[emr-source-link fixture] row ${row.linkId} missing required field "${key}"`,
        );
      }
    }
    if (
      !(EMR_VENDOR_IDS_FIXTURE as ReadonlyArray<string>).includes(row.sourceEmr)
    ) {
      throw new Error(
        `[emr-source-link fixture] row ${row.linkId} has unknown sourceEmr "${row.sourceEmr}"`,
      );
    }
    if (!row.mrn.startsWith("MRN-")) {
      throw new Error(
        `[emr-source-link fixture] row ${row.linkId} mrn "${row.mrn}" must use synthetic MRN- prefix`,
      );
    }
    if (row.conflictFlag === true && row.manualReviewRequired === false) {
      throw new Error(
        `[emr-source-link fixture] row ${row.linkId} has conflictFlag without manualReviewRequired`,
      );
    }
  }
}
