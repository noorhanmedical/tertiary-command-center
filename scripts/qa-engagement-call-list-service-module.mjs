// QA: engagement call-list service module (Batch 15).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

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
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!c.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}
function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (c.includes(n)) failures.push(`${label}: ${rel} contains "${n}"`);
}

const SVC = "server/services/engagement/engagementCallListService.ts";
requireFile(SVC);
requireText(SVC, [
  "getEngagementCallList",
  "EngagementCallListItem",
  "EngagementCallListFilters",
  "EngagementCallListDependencies",
  "patientScreeningId",
  "engagementStatus",
  "lifecycleStatus",
  "assignedTeamMemberId",
  "callListAssignmentDate",
]);

// Purity: no DB / Express / @shared/schema / route / storage imports.
requireNotText(
  SVC,
  [
    'from "../../db"',
    'from "../../../db"',
    'from "express"',
    'from "@shared/schema"',
    'from "drizzle-orm"',
    'from "../../storage"',
    'from "../storage"',
    'from "../../routes/',
    'from "../journey/appendJourneyEvent"',
    "console.log",
    "console.info",
    "patientName",
    "patientDob",
    "mrn",
    "ssn",
  ],
  "engagement call-list service must stay pure / no PHI",
);

// Read-only invariant: no write verbs anywhere.
{
  const src = read(SVC) ?? "";
  for (const v of [
    "db.insert",
    "db.update",
    "db.delete",
    "storage.create",
    "storage.update",
    "storage.delete",
  ]) {
    if (src.includes(v)) {
      failures.push(`${SVC}: read-only invariant violated — contains "${v}"`);
    }
  }
}

const TEST = "server/services/engagement/__tests__/engagementCallListService.test.ts";
requireFile(TEST);
requireText(TEST, [
  "getEngagementCallList",
  "§1", "§2", "§3", "§4", "§5",
]);

// Dormancy: only the test imports the service (no runtime caller).
{
  const ROOTS = ["server", "shared", "client", "scripts"];
  const ALLOWED = new Set([SVC, TEST, "scripts/qa-engagement-call-list-service-module.mjs"]);
  const IMPORT_RE = /(?:from|import)\s+['"][^'"]*\/engagementCallListService(?:\.\w+)?['"]/;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (["node_modules", "dist", ".next", "build"].includes(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      if (ALLOWED.has(rel)) continue;
      if (rel.includes("/__tests__/") || rel.endsWith(".test.ts")) continue;
      const src = fs.readFileSync(abs, "utf8");
      if (IMPORT_RE.test(src)) {
        failures.push(`Dormancy violation: ${rel} imports engagementCallListService — Batch 15 ships scaffold only`);
      }
    }
  }
  for (const r of ROOTS) walk(path.join(root, r));
}

if (failures.length === 0) {
  try { execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Engagement call-list service test FAILED"); }
}

if (failures.length > 0) {
  console.error("Engagement call-list service module QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement call-list service module QA passed.");
