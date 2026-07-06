// QA: operational-queue → SchedulerAssignment projection parity
// (Batch 11d.2 / Bundles 12 + 13).
//
// Two-layer check:
//   1. Source-code invariants — the projection contract file, the real
//      projection module (Bundle 13), and the projection-design doc
//      still name the 5 lossy fields and the canonical PHI-safe log
//      prefix.
//   2. Runs the parity test under server/modules/operational-queue/__tests__/
//      via tsx (the test itself runs without a DB, so this QA pass is
//      safe in any environment).
//
// No DB. No app boot. No network. No PHI.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

function requireFile(rel) {
  const c = read(rel);
  if (c === null) failures.push(`Missing file: ${rel}`);
  return c;
}

function requireText(rel, needles) {
  const c = read(rel);
  if (c === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (!c.includes(needle)) failures.push(`Missing "${needle}" in ${rel}`);
  }
}

function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (c.includes(needle)) failures.push(`${label}: ${rel} contains "${needle}"`);
  }
}

// 1. The parity test file exists.
const TEST_REL = "server/modules/operational-queue/__tests__/projection-parity.test.ts";
requireFile(TEST_REL);

// 2. The test pins the canonical lossy-field list from the design doc.
//    These names are also load-bearing in the GAP_MAPPING_MARKER inside
//    the test itself.
requireText(TEST_REL, [
  "schedulerId",
  "assignedAt",
  "originalSchedulerId",
  "reason",
  "completedAt",
  "OPERATIONAL_QUEUE_ITEM_KINDS",
  "call_list_item",
  "projectQueueItemsToSchedulerAssignments_REFERENCE",
  "missing_row",
  "[operational-queue/projection/schedulerAssignment]",
]);

// 2b. The test imports the real projection module (Bundle 13) and
//     asserts equivalence with the inline reference. Both ends of
//     the contract come from one source of truth.
requireText(TEST_REL, [
  'from "../projections/schedulerAssignment"',
  "MISSING_ROW_LOG_PREFIX",
  "LegacySchedulerAssignmentRowShape",
  "§10",
  "§11",
]);

// 3. The test must not import the live DB or any service-layer module —
//    the no-DB invariant is the whole point. The pure projection module
//    under ../projections/schedulerAssignment is explicitly allowed
//    (it has no DB / schema runtime deps).
requireNotText(
  TEST_REL,
  [
    'from "../../../db"',
    'from "../service"',
    'from "../repo"',
    'from "@shared/schema"',
    'from "../projections/schedulerAssignmentDefaultFetcher"',
  ],
  "projection-parity test pulls in DB / service / schema / default-fetcher deps",
);

// 3b. The real projection module is also pure — no DB / schema runtime
//     deps — so the test (and any future consumer that does not need
//     the default fetcher) can import it freely.
const MODULE_REL = "server/modules/operational-queue/projections/schedulerAssignment.ts";
requireFile(MODULE_REL);
requireText(MODULE_REL, [
  "export async function projectQueueItemsToSchedulerAssignments",
  "MISSING_ROW_LOG_PREFIX",
  "LegacySchedulerAssignmentRowShape",
  "SchedulerAssignmentFetchByIds",
  "[operational-queue/projection/schedulerAssignment] missing_row",
  // Mirrors the design doc's lossy-field list inline so a future
  // refactor that drops one is caught here too.
  "schedulerId",
  "assignedAt",
  "originalSchedulerId",
  "reason",
  "completedAt",
]);
requireNotText(
  MODULE_REL,
  [
    'from "../../db"',
    'from "../../../db"',
    'from "@shared/schema"',
    'from "../service"',
    'from "../repo"',
    "drizzle-orm",
  ],
  "projection module must stay pure (no DB / schema / drizzle deps)",
);

// 3c. The default fetcher file lives next to the pure module so a
//     future runtime PR can adopt it with a single import.
const FETCHER_REL = "server/modules/operational-queue/projections/schedulerAssignmentDefaultFetcher.ts";
requireFile(FETCHER_REL);
requireText(FETCHER_REL, [
  "defaultFetchSchedulerAssignmentsByIds",
  "inArray",
  "schedulerAssignments",
  "from \"@shared/schema\"",
  "from \"./schedulerAssignment\"",
]);
// The default fetcher is the one place that DOES import the DB pool
// — assert that path exists so a refactor that breaks the import is
// noticed.
requireText(FETCHER_REL, ['from "../../../db"']);

// 3d. The projections barrel re-exports both halves so consumers have
//     one import path.
const BARREL_REL = "server/modules/operational-queue/projections/index.ts";
requireFile(BARREL_REL);
requireText(BARREL_REL, [
  "projectQueueItemsToSchedulerAssignments",
  "MISSING_ROW_LOG_PREFIX",
  "defaultFetchSchedulerAssignmentsByIds",
]);

// 4. The projection-design doc still names the same five lossy fields
//    and the canonical PHI-safe log line. If a future PR changes the
//    contract, BOTH the doc and the test have to be updated together.
const DESIGN_REL = "docs/architecture/operational-queue-call-list-projection-design.md";
requireText(DESIGN_REL, [
  "schedulerId",
  "assignedAt",
  "originalSchedulerId",
  "reason",
  "completedAt",
  "[operational-queue/projection/schedulerAssignment] missing_row",
  "projectQueueItemsToSchedulerAssignments",
]);

// 5. The bulk-fetch single-call rule is pinned in the design doc.
requireText(DESIGN_REL, ["EXACTLY one DB query"]);

// 6. The PHI-safe log line in the design must remain counts-only —
//    no patient field names allowed in the projection-module log spec.
//
//    Scope: applies to the original projection-spec sections only
//    (everything BEFORE the Bundle 14 "## 6. Shadow-read parity-log
//    schema" heading). Bundle 14's §6.3 prohibition list deliberately
//    names the forbidden identifiers for the route-level shadow-read
//    log — that list IS the contract, not a leak, and lives in a
//    different log line than the projection module's missing-row log.
{
  const designContent = read(DESIGN_REL);
  if (designContent !== null) {
    const cutoff = designContent.indexOf("## 6. Shadow-read parity-log schema");
    const projectionSpecOnly =
      cutoff === -1 ? designContent : designContent.slice(0, cutoff);
    for (const needle of ["patientName", "patientDob", "summary:"]) {
      if (projectionSpecOnly.includes(needle)) {
        failures.push(
          `design doc PHI-safe log spec must remain counts-only: ` +
            `${DESIGN_REL} (pre-§6 section) contains "${needle}"`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Operational queue projection parity QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

// 7. Run the parity test. The test is no-DB; tsx loads the .ts directly.
const testAbs = path.join(root, TEST_REL);
const result = spawnSync("npx", ["vitest", "run", testAbs], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (result.status !== 0) {
  console.error(`Operational queue projection parity QA failed (test exit ${result.status}).`);
  process.exit(result.status ?? 1);
}

console.log("Operational queue projection parity QA passed.");
