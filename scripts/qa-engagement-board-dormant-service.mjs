// QA: Engagement Board dormant service (Bundle 23).
//
// Asserts the pure helpers added to
// server/modules/engagement-board/service.ts remain dormant and pure
// until a future v2 wiring PR explicitly adopts them. Same pattern
// as scripts/qa-scheduler-assignment-projection-dormancy.mjs.
//
// No DB. No app boot. No network. No PHI.

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
function walk(dir, exts) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
      out.push(...walk(p, exts));
    } else if (exts.some((ext) => e.name.endsWith(ext))) {
      out.push(p);
    }
  }
  return out;
}

const SERVICE_REL = "server/modules/engagement-board/service.ts";
const BARREL_REL = "server/modules/engagement-board/index.ts";
const ROUTE_REL = "server/routes/engagementAssignmentBoard.ts";

requireFile(SERVICE_REL);
requireFile(BARREL_REL);
requireFile(ROUTE_REL);

// 1. Service module is pure — no DB / schema / drizzle imports.
const svcSrc = read(SERVICE_REL) ?? "";
for (const needle of [
  'from "../../db"',
  'from "../../../db"',
  // The @shared/schema runtime ships Drizzle. Only @shared/contracts
  // is allowed (type-only contracts package).
  'from "@shared/schema"',
  "drizzle-orm",
]) {
  if (svcSrc.includes(needle)) {
    failures.push(`${SERVICE_REL}: must not import "${needle}"`);
  }
}

// 2. Each helper is exported.
requireText(SERVICE_REL, [
  "export function computeMissingInfoFromScreening",
  "export function applyEngagementBoardFilters",
  "export function sortEngagementBoardRows",
  "export function computeEngagementBoardSummary",
]);

// 3. Barrel re-exports the helpers.
requireText(BARREL_REL, [
  "applyEngagementBoardFilters",
  "computeEngagementBoardSummary",
  "computeMissingInfoFromScreening",
  "sortEngagementBoardRows",
]);

// 4. The legacy route does NOT import the new service. The whole
//    point of dormancy is the legacy handler keeps its inline copy
//    until a future approved cutover PR adopts the service.
const routeSrc = read(ROUTE_REL) ?? "";
for (const needle of [
  "engagement-board/service",
  "applyEngagementBoardFilters",
  "computeEngagementBoardSummary",
  "computeMissingInfoFromScreening",
  "sortEngagementBoardRows",
]) {
  if (routeSrc.includes(needle)) {
    failures.push(
      `${ROUTE_REL}: still imports dormant engagement-board service helper ("${needle}"). ` +
        `Cutover requires the portal-cutover-readiness-checklist gate.`,
    );
  }
}

// 5. Whole-tree import graph: only the barrel and test files may
//    pull from server/modules/engagement-board/service.ts. Allow-
//    list is byte-exact.
const ALLOWED_IMPORTERS = new Set([
  SERVICE_REL,
  BARREL_REL,
  // Tests are exempt — they exercise the helpers.
  // (Match any __tests__/ file under server/modules/engagement-board/.)
]);
const SERVICE_IMPORT_NEEDLES = [
  '"./service"',
  '"../service"',
  '"./engagement-board/service"',
];

const surface = [];
for (const dir of ["server", "shared", "client"]) {
  const abs = path.join(root, dir);
  if (fs.existsSync(abs)) surface.push(...walk(abs, [".ts", ".tsx"]));
}

for (const abs of surface) {
  const rel = path.relative(root, abs);
  if (ALLOWED_IMPORTERS.has(rel)) continue;
  if (rel.startsWith("server/modules/engagement-board/__tests__/")) continue;
  const src = fs.readFileSync(abs, "utf8");
  for (const needle of SERVICE_IMPORT_NEEDLES) {
    if (src.includes(needle)) {
      // Only treat as dormancy break if it's the engagement-board
      // service — other modules also have `./service` files. Scope
      // the check by also requiring the file path to NOT be in
      // another module.
      if (rel.startsWith("server/modules/engagement-board/")) {
        failures.push(
          `dormancy invariant broken: ${rel} imports engagement-board/service (matched "${needle}").`,
        );
      } else if (needle === '"./engagement-board/service"') {
        failures.push(
          `dormancy invariant broken: ${rel} imports engagement-board/service.`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Engagement Board dormant service QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Engagement Board dormant service QA passed.");
