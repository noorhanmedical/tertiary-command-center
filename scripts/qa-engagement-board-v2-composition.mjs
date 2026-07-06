// QA: Engagement Center v2 composition (Bundle 51).
//
// Source-code invariants + runs the v2 composition test via tsx.
//
// Asserts:
//   1. The dormant service exposes the v2 composition function +
//      the opaque-cursor codec.
//   2. The service stays pure (no DB / schema / drizzle imports).
//   3. No non-test file outside the module imports the new
//      function — dormancy invariant carries over from Bundle 23.
//   4. The legacy assignment-board route does NOT adopt the v2
//      composition (cutover gate; the route still hand-rolls its
//      own filter / sort / summary).
//
// Source-code invariant + smoke run. No DB. No app boot. No
// network. No PHI.

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

const SERVICE_REL = "server/modules/engagement-board/service.ts";
const BARREL_REL = "server/modules/engagement-board/index.ts";
const TEST_REL =
  "server/modules/engagement-board/__tests__/v2-composition.test.ts";
const ROUTE_REL = "server/routes/engagementAssignmentBoard.ts";

requireFile(SERVICE_REL);
requireFile(BARREL_REL);
requireFile(TEST_REL);
requireFile(ROUTE_REL);

// 1. Service exposes the documented v2 surface.
requireText(SERVICE_REL, [
  "export function composeEngagementBoardV2Response",
  "export function encodeV2Cursor",
  "export function decodeV2Cursor",
]);

// 2. Service is still pure (no DB / schema / drizzle).
requireNotText(
  SERVICE_REL,
  [
    'from "../../db"',
    'from "../../../db"',
    'from "@shared/schema"',
    "drizzle-orm",
  ],
  "engagement-board service must stay pure",
);

// 3. Barrel re-exports the v2 surface.
requireText(BARREL_REL, [
  "composeEngagementBoardV2Response",
  "encodeV2Cursor",
  "decodeV2Cursor",
]);

// 4. Legacy route does NOT adopt the v2 composition. The route
//    still hand-rolls filter / sort / summary; the v2 helper
//    remains dormant.
requireNotText(
  ROUTE_REL,
  [
    "composeEngagementBoardV2Response",
    "encodeV2Cursor",
    "decodeV2Cursor",
  ],
  "engagement-board route must NOT adopt v2 composition yet",
);

if (failures.length > 0) {
  console.error("Engagement Center v2 composition QA failed (pre-run):");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

// 5. Smoke-run the test.
const testAbs = path.join(root, TEST_REL);
const result = spawnSync("npx", ["vitest", "run", testAbs], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (result.status !== 0) {
  console.error(
    `Engagement Center v2 composition QA failed (test exit ${result.status}).`,
  );
  process.exit(result.status ?? 1);
}

console.log("Engagement Center v2 composition QA passed.");
