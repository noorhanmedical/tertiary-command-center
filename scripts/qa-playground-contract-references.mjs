// QA: Playground contract references (Bundle 33).
//
// Pins docs/architecture/team-portal-playground-wiring-contract.md
// (Bundle 11) so a future doc-edit cannot silently drop the
// load-bearing references to the surfaces and modules the contract
// binds.
//
// Source-code invariant. No DB. No app boot. No network. No PHI.
//
// What this asserts:
//   1. The contract doc exists.
//   2. It still references every surface a Playground PR must
//      cite when claiming compliance:
//        - PortalShell
//        - TeamPortalShell
//        - CommandPlayground
//        - Patient Directory
//        - Operational Queue
//        - Team Tasks
//        - Journey Events
//        - RBAC
//   3. The visual contract still names the canvas + pencil rules
//      from Bundle 11 §7-§11.
//   4. The data-envelope §22 list still bans financial / admin
//      data classes the Playground must not surface.

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

const CONTRACT_REL =
  "docs/architecture/team-portal-playground-wiring-contract.md";
const PLAN_REL =
  "docs/architecture/playground-design-system-implementation-plan.md";

// 1. Contract doc exists.
requireFile(CONTRACT_REL);

// 2. Required surface + module references.
requireText(CONTRACT_REL, [
  // Surfaces.
  "PortalShell",
  "TeamPortalShell",
  "CommandPlayground",
  // Canonical read-models the contract binds.
  "Patient Directory",
  "Operational Queue",
  "Team Task",
  "Journey Event",
  // RBAC envelope.
  "RBAC",
]);

// 3. Visual contract still names the canvas + pencil rules.
requireText(CONTRACT_REL, [
  "blank white",
  "no grid",
  "pencil",
  "sketchbook",
  // The black-pencil lettering rule (§11).
  "black pencil",
  // Side panels stay clinical (§6).
  "clinical",
  // EMR rules — panels remain EMR-like but Playground does not.
  "EMR",
]);

// 4. The §22 data-envelope ban.
requireText(CONTRACT_REL, [
  "financial",
  "PHI",
]);

// 5. The companion implementation plan (Bundle 32) — promoted to a
//    hard requireFile so the plan and the contract cannot drift
//    apart silently.
requireFile(PLAN_REL);
requireText(PLAN_REL, [
  // The plan must re-name the same surfaces so the eight-step
  // sequence stays grounded in the contract.
  "PortalShell",
  "TeamPortalShell",
  "CommandPlayground",
  "Patient Directory",
  "Operational Queue",
  // The data-envelope step (Step G).
  "data envelope",
]);

if (failures.length > 0) {
  console.error("Playground contract references QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Playground contract references QA passed.");
