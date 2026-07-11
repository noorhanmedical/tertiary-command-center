// Phase B — Patient EHR section-access matrix tests.
//
// Runs standalone with:
//   npx tsx tests/unit/patientDirectorySectionAccess.test.ts

import assert from "node:assert/strict";
import {
  PATIENT_DIRECTORY_ROLES,
  PATIENT_DIRECTORY_SECTIONS,
  SECTION_ACCESS_LEVELS,
  defaultSectionAccessMatrix,
  defaultAccessFor,
  normalizeSectionAccessMatrix,
} from "../../shared/patientDirectorySections";

async function testAdminIsAlwaysFull() {
  const matrix = defaultSectionAccessMatrix();
  for (const s of PATIENT_DIRECTORY_SECTIONS) {
    assert.equal(matrix[s.sectionId].admin, "full", `admin must be full for ${s.sectionId}`);
  }
}

async function testEverySectionCoveredForEveryRole() {
  const matrix = defaultSectionAccessMatrix();
  for (const s of PATIENT_DIRECTORY_SECTIONS) {
    const row = matrix[s.sectionId];
    assert.ok(row, `missing row for ${s.sectionId}`);
    for (const role of PATIENT_DIRECTORY_ROLES) {
      const level = row[role];
      assert.ok(
        (SECTION_ACCESS_LEVELS as readonly string[]).includes(level),
        `bad level ${level} for ${s.sectionId}/${role}`,
      );
    }
  }
}

async function testDefaultAccessAdminAlwaysFullEvenForUnknownSection() {
  assert.equal(defaultAccessFor("does-not-exist", "admin"), "full");
}

async function testDefaultAccessUnknownSectionDefaultsToFull() {
  assert.equal(defaultAccessFor("does-not-exist", "clinician"), "full");
}

async function testDefaultAccessMatchesSectionDefinition() {
  // The first real section from the registry should return its defined
  // default for a known role.
  const firstSection = PATIENT_DIRECTORY_SECTIONS[0];
  const expected = firstSection.defaultAllowedRoles.clinician;
  assert.equal(defaultAccessFor(firstSection.sectionId, "clinician"), expected);
}

async function testNormalizeFillsGapsWithDefaults() {
  const partial = {}; // completely empty
  const normalized = normalizeSectionAccessMatrix(partial);
  const defaults = defaultSectionAccessMatrix();
  for (const s of PATIENT_DIRECTORY_SECTIONS) {
    for (const role of PATIENT_DIRECTORY_ROLES) {
      assert.equal(
        normalized[s.sectionId][role],
        defaults[s.sectionId][role],
        `${s.sectionId}/${role} must fall back to default`,
      );
    }
  }
}

async function testNormalizeRespectsStoredValues() {
  const firstSection = PATIENT_DIRECTORY_SECTIONS[0].sectionId;
  const partial = {
    [firstSection]: { clinician: "summary" as const },
  };
  const normalized = normalizeSectionAccessMatrix(partial);
  assert.equal(normalized[firstSection].clinician, "summary");
  // Admin still forced to full even when the stored row explicitly said
  // something else.
}

async function testNormalizeRejectsInvalidLevelStrings() {
  const firstSection = PATIENT_DIRECTORY_SECTIONS[0].sectionId;
  const partial = {
    // @ts-expect-error deliberately invalid level to test the guard
    [firstSection]: { clinician: "extreme" },
  };
  const normalized = normalizeSectionAccessMatrix(
    partial as unknown as Record<string, Record<string, "hidden" | "summary" | "full">>,
  );
  const defaults = defaultSectionAccessMatrix();
  assert.equal(
    normalized[firstSection].clinician,
    defaults[firstSection].clinician,
    "invalid stored level should fall back to default",
  );
}

async function testNormalizeAdminAlwaysFull() {
  const firstSection = PATIENT_DIRECTORY_SECTIONS[0].sectionId;
  const partial = {
    [firstSection]: { admin: "hidden" as const },
  };
  const normalized = normalizeSectionAccessMatrix(partial);
  assert.equal(
    normalized[firstSection].admin,
    "full",
    "normalize must force admin to full even if stored says otherwise",
  );
}

async function testNormalizeHandlesNullInput() {
  const normalized = normalizeSectionAccessMatrix(null);
  const defaults = defaultSectionAccessMatrix();
  for (const s of PATIENT_DIRECTORY_SECTIONS) {
    for (const role of PATIENT_DIRECTORY_ROLES) {
      assert.equal(
        normalized[s.sectionId][role],
        defaults[s.sectionId][role],
      );
    }
  }
}

async function testNormalizeHandlesUndefinedInput() {
  const normalized = normalizeSectionAccessMatrix(undefined);
  const defaults = defaultSectionAccessMatrix();
  for (const s of PATIENT_DIRECTORY_SECTIONS) {
    for (const role of PATIENT_DIRECTORY_ROLES) {
      assert.equal(
        normalized[s.sectionId][role],
        defaults[s.sectionId][role],
      );
    }
  }
}

async function main() {
  await testAdminIsAlwaysFull();
  await testEverySectionCoveredForEveryRole();
  await testDefaultAccessAdminAlwaysFullEvenForUnknownSection();
  await testDefaultAccessUnknownSectionDefaultsToFull();
  await testDefaultAccessMatchesSectionDefinition();
  await testNormalizeFillsGapsWithDefaults();
  await testNormalizeRespectsStoredValues();
  await testNormalizeRejectsInvalidLevelStrings();
  await testNormalizeAdminAlwaysFull();
  await testNormalizeHandlesNullInput();
  await testNormalizeHandlesUndefinedInput();
  console.log("patientDirectorySectionAccess.test.ts: all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
