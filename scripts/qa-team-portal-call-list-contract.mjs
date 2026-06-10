// QA: Team Portal call-list read-model contract (Batch J).
//
// Asserts the new shared contract:
//   1. Exists and is pure (no runtime imports; type-only).
//   2. Uses product terminology (Team Member, PCS, ACS,
//      callListAssignment) — not raw "scheduler" naming at the
//      top level.
//   3. Legacy field aliases are present only as legacy* mapping
//      fields per Batch D §2.
//   4. Is dormant — no non-test file imports it at runtime.
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

const CONTRACT_REL = "shared/contracts/teamPortalCallList.ts";
requireFile(CONTRACT_REL);

// 1. Pure — no Drizzle / schema / runtime imports. Type imports are
//    erased by TypeScript and would be fine, but this contract is
//    fully self-contained so we ban all import lines.
requireNotText(
  CONTRACT_REL,
  [
    'from "@shared/schema"',
    'from "../schema"',
    'from "drizzle-orm"',
    'from "../../db"',
    'from "../../../db"',
  ],
  "team-portal call-list contract must stay pure (type-only, no runtime imports)",
);

// 2. Product-layer types are present with the canonical names.
requireText(CONTRACT_REL, [
  "TeamMemberRoleProfile",
  '"patient_care_specialist"',
  '"ancillary_care_specialist"',
  "TeamPortalCallListItem",
  "TeamPortalCallListResponse",
  "CallHistoryItem",
  "CallResultOutcome",
  "CallResultNextAction",
  // Product field names (the canonical layer).
  "assignedTeamMemberId",
  "assignedTeamMember",
  "originalAssignedTeamMemberId",
  "callbackAt",
  "nextActionAt",
  "patientScreeningId",
  // Legacy mapping fields per Batch D §2.
  "legacySchedulerAssignmentId",
  "legacySchedulerId",
  "legacyOriginalSchedulerId",
]);

// 3. Top-level product field MUST NOT be named literally schedulerId
//    or originalSchedulerId. These names may appear ONLY as legacy*
//    mapping fields. Detect via the canonical TypeScript field
//    syntax `<name>:` and explicitly allow only the legacy aliases.
{
  const c = read(CONTRACT_REL) ?? "";
  // Bare `schedulerId:` (without `legacy` prefix) at a non-legacy
  // field location is forbidden.
  if (/(^|[^A-Za-z0-9_])schedulerId\s*:/m.test(c)) {
    failures.push(
      `${CONTRACT_REL}: top-level "schedulerId:" field is forbidden — use legacySchedulerId per Batch D §2`,
    );
  }
  if (/(^|[^A-Za-z0-9_])originalSchedulerId\s*:/m.test(c)) {
    failures.push(
      `${CONTRACT_REL}: top-level "originalSchedulerId:" field is forbidden — use legacyOriginalSchedulerId per Batch D §2`,
    );
  }
}

// 4. Dormancy invariant — no non-test, non-self file imports the
//    contract at runtime. Walk server/, shared/, client/.
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

const ALLOWED_IMPORTERS = new Set([CONTRACT_REL]);
const IMPORT_NEEDLES = [
  '"@shared/contracts/teamPortalCallList"',
  '"../contracts/teamPortalCallList"',
  '"./teamPortalCallList"',
];
const surface = [];
for (const dir of ["server", "shared", "client"]) {
  const abs = path.join(root, dir);
  if (fs.existsSync(abs)) surface.push(...walk(abs, [".ts", ".tsx"]));
}
for (const abs of surface) {
  const rel = path.relative(root, abs);
  if (ALLOWED_IMPORTERS.has(rel)) continue;
  if (rel.includes("/__tests__/")) continue;
  const src = fs.readFileSync(abs, "utf8");
  for (const needle of IMPORT_NEEDLES) {
    if (src.includes(needle)) {
      failures.push(
        `team-portal call-list contract dormancy broken: ${rel} imports the contract (matched "${needle}")`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Team Portal call-list contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Team Portal call-list contract QA passed.");
