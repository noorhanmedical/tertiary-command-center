// QA: Background jobs dormant module invariant (Bundle 34).
//
// Pins the Batch 18 / Bundle 9 skeleton at
// server/modules/background-jobs/ so:
//   - The contract types stay in the module.
//   - No runtime side effect is added.
//   - No existing job runner / service has been migrated to consume
//     the contracts (the cutover ships one job at a time, each
//     behind its own feature flag, and is OUT OF SCOPE for any
//     safe bundle).
//   - The contracts cover the canonical JobKind / JobSchedule /
//     JobRunOutcome shapes.
//
// Source-code invariant. No DB. No app boot. No network. No PHI.

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

const CONTRACT_REL = "server/modules/background-jobs/contracts.ts";
const BARREL_REL = "server/modules/background-jobs/index.ts";
const DESIGN_REL = "docs/architecture/background-jobs-design.md";

requireFile(CONTRACT_REL);
requireFile(BARREL_REL);

// 1. Contract names every documented JobKind (these are the
//    existing background job names the cutover will register).
requireText(CONTRACT_REL, [
  "morning_rebuild",
  "absence_watcher",
  "scheduler_auto_assign",
  "ai_batch_runner",
  "outreach_sync",
  "outbox_drain",
  "invoice_reminder",
  "cooldown_canonical_sweep",
]);

// 2. The three canonical contract types are still exported.
requireText(CONTRACT_REL, [
  "JobKind",
  "JobSchedule",
  "JobRunOutcome",
]);

// 3. Schedule kinds + outcome kinds remain a closed set.
requireText(CONTRACT_REL, [
  '"cron"',
  '"interval"',
  '"once"',
  '"manual"',
  // Outcome kinds.
  '"ok"',
  '"skipped"',
  '"failed"',
  // Skip reasons.
  '"disabled"',
  '"lock_held"',
  '"duplicate"',
]);

// 4. The contract is PURE. No DB import, no schema import, no
//    drizzle, no runtime fetch.
requireNotText(
  CONTRACT_REL,
  [
    'from "../../db"',
    'from "../../../db"',
    'from "@shared/schema"',
    "drizzle-orm",
    "fetch(",
  ],
  "background-jobs contracts must stay pure",
);

// 5. Barrel re-exports the contracts. No runtime side effect.
requireText(BARREL_REL, [
  'export * from "./contracts"',
]);
// Reject anything that would turn the barrel into a runtime entry.
requireNotText(
  BARREL_REL,
  [
    "setInterval",
    "setTimeout",
    "scheduleJob",
    "register",
  ],
  "background-jobs barrel must remain side-effect-free",
);

// 6. Dormancy: nothing under server/, shared/, client/ imports
//    from the module other than the module itself.
const surface = [];
for (const dir of ["server", "shared", "client"]) {
  const abs = path.join(root, dir);
  if (fs.existsSync(abs)) surface.push(...walk(abs, [".ts", ".tsx"]));
}
const ALLOWED = new Set([CONTRACT_REL, BARREL_REL]);
const NEEDLES = [
  '"./contracts"',
  '"../background-jobs/contracts"',
  '"../background-jobs"',
  '"../modules/background-jobs"',
  '"../../modules/background-jobs"',
  // Identifier-level adoption.
  "JobDescriptor",
  "registerBackgroundJob",
];
for (const abs of surface) {
  const rel = path.relative(root, abs);
  if (ALLOWED.has(rel)) continue;
  if (rel.includes("/__tests__/")) continue;
  const src = fs.readFileSync(abs, "utf8");
  for (const needle of NEEDLES) {
    if (src.includes(needle)) {
      // Only treat as dormancy break for clearly-namespaced needles.
      const isPathImport = needle.includes("background-jobs");
      const isIdAdoption =
        needle === "JobDescriptor" || needle === "registerBackgroundJob";
      if (
        isPathImport ||
        (isIdAdoption && rel.startsWith("server/") && !rel.includes("__tests__"))
      ) {
        failures.push(
          `background-jobs dormancy broken: ${rel} references "${needle}"`,
        );
      }
    }
  }
}

// 7. The design doc still exists. Pinning to the human-readable
//    job names + the canonical file references the doc uses, so
//    a future doc-edit can't drop the load-bearing inventory.
if (fs.existsSync(path.join(root, DESIGN_REL))) {
  requireText(DESIGN_REL, [
    "Morning scheduler rebuild",
    "Absence watcher",
    "Batch AI analysis runner",
    "morningRebuildScheduler.ts",
    "absenceWatcher.ts",
    "batchAnalysisRunner.ts",
  ]);
} else {
  console.log(`[info] background-jobs design doc not on main yet: ${DESIGN_REL}`);
}

if (failures.length > 0) {
  console.error("Background-jobs dormant module QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Background-jobs dormant module QA passed.");
