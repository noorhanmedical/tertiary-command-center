// QA: SchedulerAssignment projection dormancy invariant (Bundle 19).
//
// Pinned by docs/architecture/portal-cutover-readiness-checklist.md.
// The projection module exists on main (Bundle 13 / PR #96) but is
// intentionally NOT wired to any route — the cutover that adopts it
// is gated by the §3 staging evidence and the §4–§7 invariants of
// the cutover-readiness checklist. This script enforces that gate at
// source-code level so an accidental import in an unrelated PR fails
// CI immediately.
//
// What this script checks:
//
//   1. The projection module + default fetcher + barrel still exist
//      and remain pure (no DB / schema in the pure module).
//   2. No file outside the projections/ directory and the
//      projection-parity test imports the projection module or the
//      default fetcher. That is the load-bearing invariant: dormancy
//      is provable via the import graph.
//   3. server/routes/schedulerAssignments.ts does NOT import the
//      projection. The shadow-read flag stays a parity-log instrument
//      until the cutover PR explicitly adopts the projection.
//   4. The default fetcher remains the only place that consumes the
//      Drizzle schema for the projection. No other consumer may
//      import `defaultFetchSchedulerAssignmentsByIds`.
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

function walk(dir, exts) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Skip noisy folders that can't import the projection at runtime.
      if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
      out.push(...walk(p, exts));
    } else if (exts.some((ext) => e.name.endsWith(ext))) {
      out.push(p);
    }
  }
  return out;
}

// ─── 1. Files exist ──────────────────────────────────────────────────
const MODULE_REL = "server/modules/operational-queue/projections/schedulerAssignment.ts";
const FETCHER_REL = "server/modules/operational-queue/projections/schedulerAssignmentDefaultFetcher.ts";
const BARREL_REL = "server/modules/operational-queue/projections/index.ts";
const TEST_REL = "server/modules/operational-queue/__tests__/projection-parity.test.ts";
const ROUTE_REL = "server/routes/schedulerAssignments.ts";

requireFile(MODULE_REL);
requireFile(FETCHER_REL);
requireFile(BARREL_REL);
requireFile(TEST_REL);
requireFile(ROUTE_REL);

// ─── 2. Pure-module invariant (catches drift Bundle 13 already set) ──
const modSrc = read(MODULE_REL) ?? "";
for (const needle of [
  'from "../../db"',
  'from "../../../db"',
  'from "@shared/schema"',
  "drizzle-orm",
]) {
  if (modSrc.includes(needle)) {
    failures.push(
      `${MODULE_REL}: pure-module invariant broken — contains "${needle}"`,
    );
  }
}

// ─── 3. Whole-tree import graph: only the barrel, the default
//        fetcher, and the parity test may import the projection
//        module. The barrel may re-export the default fetcher. No
//        runtime route may import either. ─────────────────────────
//
// We walk server/ and shared/ (the runtime / shared graph) and
// inspect every .ts / .tsx file. Allow-list is byte-exact.
const PROJ_IMPORT_NEEDLES = [
  '"./schedulerAssignment"',
  '"./schedulerAssignmentDefaultFetcher"',
  '"../projections/schedulerAssignment"',
  '"../projections/schedulerAssignmentDefaultFetcher"',
  '"../../operational-queue/projections/schedulerAssignment"',
  '"../../operational-queue/projections/schedulerAssignmentDefaultFetcher"',
  '"../../operational-queue/projections"',
  '"../projections"',
];

const ALLOWED_IMPORTERS = new Set([
  MODULE_REL,
  FETCHER_REL,
  BARREL_REL,
  TEST_REL,
]);

const surface = [];
for (const dir of ["server", "shared", "client"]) {
  const abs = path.join(root, dir);
  if (fs.existsSync(abs)) surface.push(...walk(abs, [".ts", ".tsx"]));
}

for (const abs of surface) {
  const rel = path.relative(root, abs);
  if (ALLOWED_IMPORTERS.has(rel)) continue;
  const src = fs.readFileSync(abs, "utf8");
  for (const needle of PROJ_IMPORT_NEEDLES) {
    if (src.includes(needle)) {
      failures.push(
        `dormancy invariant broken: ${rel} imports projection (matched "${needle}"). ` +
          `Only ${[...ALLOWED_IMPORTERS].join(", ")} may import the projection module.`,
      );
    }
  }
}

// ─── 4. The route file does not import the projection ────────────
const routeSrc = read(ROUTE_REL) ?? "";
for (const needle of [
  "projections/schedulerAssignment",
  "defaultFetchSchedulerAssignmentsByIds",
  "projectQueueItemsToSchedulerAssignments",
]) {
  if (routeSrc.includes(needle)) {
    failures.push(
      `${ROUTE_REL}: still imports projection (matched "${needle}"). ` +
        `Cutover requires the portal-cutover-readiness-checklist gate; do NOT wire here.`,
    );
  }
}

// ─── 5. Default fetcher is consumed only by the barrel and not by
//        any other file. The barrel-only allow-list keeps the
//        cutover PR's adoption surface to one import. ────────────
const FETCHER_ALLOWED = new Set([FETCHER_REL, BARREL_REL]);
for (const abs of surface) {
  const rel = path.relative(root, abs);
  if (FETCHER_ALLOWED.has(rel)) continue;
  const src = fs.readFileSync(abs, "utf8");
  if (src.includes("defaultFetchSchedulerAssignmentsByIds")) {
    failures.push(
      `dormancy invariant broken: ${rel} references defaultFetchSchedulerAssignmentsByIds. ` +
        `Only the projections barrel may re-export it; only the cutover PR may adopt it.`,
    );
  }
}

if (failures.length > 0) {
  console.error("SchedulerAssignment projection dormancy QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("SchedulerAssignment projection dormancy QA passed.");
