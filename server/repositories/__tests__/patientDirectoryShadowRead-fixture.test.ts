// Patient Directory shadow-read parity fixture — verdict test (Bundle 48).
//
// Runnable via:
//   npx tsx server/repositories/__tests__/patientDirectoryShadowRead-fixture.test.ts
//
// Imports the fixture (which runs import-time sanity checks) and
// asserts the verdict derivation rules a future Patient Directory
// shadow-read engine MUST satisfy.
//
// No DB. No app boot. No network. No PHI.

import {
  PATIENT_DIRECTORY_SHADOW_READ_FIXTURE_ROWS,
  SHADOW_READ_PARITY_VERDICTS,
  deriveShadowReadVerdict_REFERENCE,
  type DeriveVerdictInput,
  type ShadowReadParityVerdict,
} from "../../../tests/fixtures/patientDirectoryShadowRead.fixture";

const failures: string[] = [];

function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    failures.push(`${label}: expected ${String(expected)} got ${String(actual)}`);
  }
}

// ─── §1: Verdict enum coverage ────────────────────────────────────
check(
  SHADOW_READ_PARITY_VERDICTS.length === 5,
  `§1: expected 5 verdicts, got ${SHADOW_READ_PARITY_VERDICTS.length}`,
);
for (const v of ["match", "drift_minor", "drift_major", "conflict", "not_resolvable"]) {
  check(
    (SHADOW_READ_PARITY_VERDICTS as ReadonlyArray<string>).includes(v),
    `§1: verdict "${v}" must be in SHADOW_READ_PARITY_VERDICTS`,
  );
}

// ─── §2: Every fixture row carries the documented 9 fields ───────
const REQUIRED: ReadonlyArray<string> = [
  "caseId",
  "legacy",
  "canonical",
  "parityMatch",
  "fieldsCompared",
  "fieldsDivergent",
  "verdict",
  "manualReviewRequired",
  "conflictFlag",
];
for (const row of PATIENT_DIRECTORY_SHADOW_READ_FIXTURE_ROWS) {
  for (const key of REQUIRED) {
    check(
      key in (row as unknown as Record<string, unknown>),
      `§2: row ${row.caseId} must carry "${key}"`,
    );
  }
  // Legacy and canonical sub-objects carry the documented identity
  // fields.
  for (const k of ["screeningId", "name", "dob", "phoneNumber", "email", "facility", "mrn", "externalPatientId", "deletedAt"]) {
    check(
      k in (row.legacy as unknown as Record<string, unknown>),
      `§2: row ${row.caseId} legacy must carry "${k}"`,
    );
  }
  for (const k of ["id", "primaryScreeningId", "screeningIds", "name", "dob", "facility", "totalScreenings", "hasDeletedScreening"]) {
    check(
      k in (row.canonical as unknown as Record<string, unknown>),
      `§2: row ${row.caseId} canonical must carry "${k}"`,
    );
  }
}

// ─── §3: conflictFlag implies manualReviewRequired ───────────────
for (const row of PATIENT_DIRECTORY_SHADOW_READ_FIXTURE_ROWS) {
  if (row.conflictFlag) {
    check(
      row.manualReviewRequired === true,
      `§3: row ${row.caseId} has conflictFlag but manualReviewRequired=false`,
    );
  }
}

// ─── §4: Match verdict requires fieldsDivergent === 0 ────────────
for (const row of PATIENT_DIRECTORY_SHADOW_READ_FIXTURE_ROWS) {
  if (row.verdict === "match") {
    eq(row.parityMatch, true, `§4: ${row.caseId} match verdict parityMatch`);
    eq(row.fieldsDivergent, 0, `§4: ${row.caseId} match verdict fieldsDivergent`);
    eq(row.conflictFlag, false, `§4: ${row.caseId} match verdict conflictFlag`);
    eq(
      row.manualReviewRequired,
      false,
      `§4: ${row.caseId} match verdict manualReviewRequired`,
    );
  }
}

// ─── §5: Reference verdict derivation matches the fixture ────────
{
  const cases: Array<{ input: DeriveVerdictInput; expected: ShadowReadParityVerdict }> = [
    { input: { legacyDeleted: false, identityIdMismatch: false, facilityChanged: false, fieldsDivergent: 0 }, expected: "match" },
    { input: { legacyDeleted: false, identityIdMismatch: false, facilityChanged: false, fieldsDivergent: 1 }, expected: "drift_minor" },
    { input: { legacyDeleted: false, identityIdMismatch: false, facilityChanged: true, fieldsDivergent: 1 }, expected: "drift_major" },
    { input: { legacyDeleted: false, identityIdMismatch: true, facilityChanged: false, fieldsDivergent: 0 }, expected: "conflict" },
    { input: { legacyDeleted: true, identityIdMismatch: false, facilityChanged: false, fieldsDivergent: 0 }, expected: "not_resolvable" },
  ];
  for (const c of cases) {
    const out = deriveShadowReadVerdict_REFERENCE(c.input);
    eq(out.verdict, c.expected, `§5: verdict derivation for ${JSON.stringify(c.input)}`);
    if (c.expected === "conflict") {
      eq(out.conflictFlag, true, `§5: conflict verdict must set conflictFlag`);
    }
    if (c.expected === "match") {
      eq(out.manualReviewRequired, false, `§5: match verdict must NOT require manual review`);
    } else {
      // drift_minor is the only non-match verdict that does NOT
      // require manual review by default.
      if (c.expected !== "drift_minor") {
        eq(
          out.manualReviewRequired,
          true,
          `§5: non-match non-drift_minor verdict must require manual review`,
        );
      }
    }
  }
}

// ─── §6: No auto-merge guarantee ─────────────────────────────────
//
// Conflict + not_resolvable verdicts MUST surface for manual
// review and MUST NEVER auto-collapse the legacy + canonical
// rows into a single record. We can't write that runtime
// guarantee from a fixture — but we can assert that fixtures
// emitting those verdicts always set manualReviewRequired=true
// AND that no fixture row sets parityMatch=true while also
// emitting a non-match verdict.
for (const row of PATIENT_DIRECTORY_SHADOW_READ_FIXTURE_ROWS) {
  if (row.verdict === "conflict" || row.verdict === "not_resolvable") {
    check(
      row.manualReviewRequired === true,
      `§6: row ${row.caseId} (${row.verdict}) must require manual review`,
    );
  }
  if (row.verdict !== "match" && row.parityMatch) {
    failures.push(
      `§6: row ${row.caseId} (${row.verdict}) cannot have parityMatch=true`,
    );
  }
}

// ─── §7: PHI envelope ─────────────────────────────────────────────
for (const row of PATIENT_DIRECTORY_SHADOW_READ_FIXTURE_ROWS) {
  if (row.legacy.phoneNumber !== null) {
    check(
      row.legacy.phoneNumber.startsWith("555-"),
      `§7: row ${row.caseId} legacy phone must use 555- prefix`,
    );
  }
  if (row.legacy.email !== null) {
    check(
      row.legacy.email.endsWith("@example.test"),
      `§7: row ${row.caseId} legacy email must use @example.test`,
    );
  }
  if (row.legacy.mrn !== null) {
    check(
      row.legacy.mrn.startsWith("MRN-"),
      `§7: row ${row.caseId} legacy mrn must use synthetic MRN- prefix`,
    );
  }
  check(
    /^(alpha|beta|gamma|delta|epsilon)\s/i.test(row.legacy.name),
    `§7: row ${row.caseId} legacy name must use synthetic Greek-letter convention`,
  );
}

if (failures.length > 0) {
  console.error("Patient Directory shadow-read fixture test FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("Patient Directory shadow-read fixture test passed.");
}
