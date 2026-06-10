// QA: Plexus IQ clinical-import fixture invariants (Bundle 6).
//
// Source-code invariant check. No DB, no app boot, no network, no PHI.
// Locks the canned 3-groups × 5-rows × 2-skips fixture used by the
// future PIQ-3b.1 wrapper PR so the fixture cannot drift silently.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

function requireFile(rel) {
  const content = read(rel);
  if (content === null) failures.push(`Missing file: ${rel}`);
  return content;
}

function requireText(rel, needles) {
  const content = read(rel);
  if (content === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (!content.includes(needle)) {
      failures.push(`Missing "${needle}" in ${rel}`);
    }
  }
}

// 1. Fixture exists and exports the documented totals.
requireFile("tests/fixtures/plexusIqClinicalImport.fixture.ts");
requireText("tests/fixtures/plexusIqClinicalImport.fixture.ts", [
  "CLINICAL_IMPORT_FIXTURE_ROWS",
  "CLINICAL_IMPORT_FIXTURE_EXPECTED",
  "importedCount: 13",
  "skippedCount: 2",
  "batchIdsLength: 3",
  "errorsLength: 2",
  // The three facility groups must remain (drift-detection).
  "Bay Pavilion",
  "Harbor Medical",
  "Sandy Bay Center",
  "2026-06-15",
  "2026-06-16",
  "2026-06-17",
]);

// 2. Cross-reference doc (informational only). The parity-inventory
//    doc ships in a separately-tracked PR; once it lands on main we
//    can promote this to a hard requireFile.
{
  const docRel = "docs/architecture/plexus-iq-route-parity-inventory.md";
  if (!fs.existsSync(path.join(root, docRel))) {
    console.log(`[info] parity-inventory doc not on main yet: ${docRel}`);
  }
}

// 3. Bundle 24 — expansion fixture covers the schema-rejection
//    surface the Bundle 6 fixture omitted (outreach patientType,
//    invalid patientType enum, every malformed-scheduleDate variant
//    the YYYY-MM-DD regex rejects, max-fields + min-fields rows).
//    Additive — the Bundle 6 totals above are unchanged.
requireFile("tests/fixtures/plexusIqClinicalImport.expansion.fixture.ts");
requireText("tests/fixtures/plexusIqClinicalImport.expansion.fixture.ts", [
  "CLINICAL_IMPORT_FIXTURE_EXPANSION_ROWS",
  "CLINICAL_IMPORT_FIXTURE_EXPANSION_EXPECTED",
  "totalRows: 13",
  "importedCount: 9",
  "skippedCount: 4",
  "batchIdsLength: 4",
  "errorsLength: 4",
  "skipRowIndexes: [110, 112, 113, 114]",
  // Group D — outreach patientType the original fixture omitted.
  "patientType: \"outreach\"",
  // Group E — schema-rejection variants the original fixture omitted.
  "2026/06/20",
  "2026-06-20T00:00:00Z",
  "2026-6-2",
  // Group F — max-fields + min-fields rows.
  "Mountain Care",
  "Cove Surgical",
  // PHI-safe sentinel — synthetic phone prefix + email domain.
  "555-0140",
  "@example.test",
]);

if (failures.length > 0) {
  console.error("Plexus IQ clinical-import fixture QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("Plexus IQ clinical-import fixture QA passed.");
}
