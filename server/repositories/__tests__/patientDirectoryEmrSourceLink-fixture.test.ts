import { describe, it } from "vitest";
// Patient Directory EMR source-link fixture — verdict test (Bundle 42).
//
// Runnable via:
//   npx tsx server/repositories/__tests__/patientDirectoryEmrSourceLink-fixture.test.ts
//
// Imports the fixture (which runs its own top-level sanity checks)
// and asserts:
//   §1 every vendor in EMR_VENDOR_IDS_FIXTURE is plausibly addressable.
//   §2 every row carries the documented 12 fields.
//   §3 conflictFlag implies manualReviewRequired.
//   §4 same canonical patient may be linked to multiple vendors.
//   §5 medium / low match confidence flips manualReviewRequired on.
//   §6 PHI envelope.
//
// No DB. No app boot. No network. No PHI.

import {
  EMR_VENDOR_IDS_FIXTURE,
  MATCH_CONFIDENCE_BANDS_FIXTURE,
  PATIENT_DIRECTORY_EMR_SOURCE_LINK_FIXTURE_ROWS,
  type EmrSourceLinkFixtureRow,
} from "../../../tests/fixtures/patientDirectoryEmrSourceLink.fixture";

const failures: string[] = [];

function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}

// ─── §1: Vendor coverage ──────────────────────────────────────────
check(
  EMR_VENDOR_IDS_FIXTURE.length >= 7,
  `§1: expected >=7 vendors, got ${EMR_VENDOR_IDS_FIXTURE.length}`,
);
for (const expected of [
  "epic",
  "eclinicalworks",
  "cerner_oracle",
  "athena",
  "nextgen",
  "advancedmd",
  "pcc",
]) {
  check(
    (EMR_VENDOR_IDS_FIXTURE as ReadonlyArray<string>).includes(expected),
    `§1: vendor "${expected}" must be in the fixture`,
  );
}

// ─── §2: Every row carries the 12 documented fields ───────────────
const REQUIRED: ReadonlyArray<string> = [
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
  for (const key of REQUIRED) {
    check(
      key in (row as unknown as Record<string, unknown>),
      `§2: row ${row.linkId} must carry "${key}"`,
    );
  }
}

// ─── §3: conflictFlag → manualReviewRequired ──────────────────────
for (const row of PATIENT_DIRECTORY_EMR_SOURCE_LINK_FIXTURE_ROWS) {
  if (row.conflictFlag) {
    check(
      row.manualReviewRequired === true,
      `§3: row ${row.linkId} has conflictFlag but manualReviewRequired is false`,
    );
  }
}

// ─── §4: Same canonical patient may carry multiple vendor links ───
{
  const byPatient = new Map<string, EmrSourceLinkFixtureRow[]>();
  for (const row of PATIENT_DIRECTORY_EMR_SOURCE_LINK_FIXTURE_ROWS) {
    const arr = byPatient.get(row.canonicalPatientId) ?? [];
    arr.push(row);
    byPatient.set(row.canonicalPatientId, arr);
  }
  let multiLinked = 0;
  for (const arr of byPatient.values()) {
    if (arr.length >= 2) multiLinked += 1;
  }
  check(
    multiLinked >= 1,
    "§4: fixture must include at least one canonical patient with multiple vendor links",
  );
}

// ─── §5: Confidence band gates manualReviewRequired ───────────────
//
// medium or low matchConfidence → manualReviewRequired MUST be true.
// high matchConfidence MAY have manualReviewRequired=false unless
// some other signal (conflictFlag, low sourceConfidence) forces it.
for (const row of PATIENT_DIRECTORY_EMR_SOURCE_LINK_FIXTURE_ROWS) {
  if (row.matchConfidence === "medium" || row.matchConfidence === "low") {
    check(
      row.manualReviewRequired === true,
      `§5: row ${row.linkId} has matchConfidence=${row.matchConfidence} but manualReviewRequired=false`,
    );
  }
  // sourceConfidence=low always escalates to manualReviewRequired.
  if (row.sourceConfidence === "low") {
    check(
      row.manualReviewRequired === true,
      `§5: row ${row.linkId} has sourceConfidence=low but manualReviewRequired=false`,
    );
  }
  // Confidence band enum coverage.
  check(
    (MATCH_CONFIDENCE_BANDS_FIXTURE as ReadonlyArray<string>).includes(row.matchConfidence),
    `§5: row ${row.linkId} matchConfidence "${row.matchConfidence}" not in the canonical set`,
  );
  check(
    (MATCH_CONFIDENCE_BANDS_FIXTURE as ReadonlyArray<string>).includes(row.sourceConfidence),
    `§5: row ${row.linkId} sourceConfidence "${row.sourceConfidence}" not in the canonical set`,
  );
}

// ─── §6: PHI envelope — synthetic identifiers only ────────────────
for (const row of PATIENT_DIRECTORY_EMR_SOURCE_LINK_FIXTURE_ROWS) {
  check(
    row.mrn.startsWith("MRN-"),
    `§6: row ${row.linkId} mrn "${row.mrn}" must use synthetic MRN- prefix`,
  );
  check(
    /^pt-canonical-/.test(row.canonicalPatientId),
    `§6: row ${row.linkId} canonicalPatientId must use synthetic prefix`,
  );
  check(
    !row.externalPatientId.includes("@"),
    `§6: row ${row.linkId} externalPatientId must not look like an email`,
  );
}

describe("Patient Directory EMR source-link fixture test", () => {
  it("passes all checks", () => {
    if (failures.length > 0) {
      throw new Error(
        "Patient Directory EMR source-link fixture test failed:" + "\n" + failures.map((f) => `- ${f}`).join("\n"),
      );
    }
  });
});
