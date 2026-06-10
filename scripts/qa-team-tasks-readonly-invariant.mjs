// QA: Team Task read-only source invariant (Bundle 47).
//
// Proves the Team Task module (server/modules/team-tasks/) remains
// a READ-ONLY view across plexus_tasks + scheduler_assignments. Any
// future PR that adds a write through this module breaks CI.
//
// What this asserts:
//   1. server/modules/team-tasks/contracts.ts + repo.ts + service.ts
//      + index.ts all exist.
//   2. None of those files call db.insert / db.update / db.delete on
//      plexus_tasks or scheduler_assignments.
//   3. service.ts exposes only the documented read helpers
//      (getTeamTaskView, getTeamTaskViewByPatient); no write-shaped
//      exports are present.
//   4. The module is DORMANT — no non-test file outside the module
//      adopts the runtime entry points yet.
//   5. The legacy task-handling routes that already exist
//      (plexus task routes; scheduler assignment routes) do NOT
//      adopt the new module.
//
// Source-code invariant only. No DB. No app boot. No network. No PHI.

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

const MODULE_FILES = [
  "server/modules/team-tasks/contracts.ts",
  "server/modules/team-tasks/repo.ts",
  "server/modules/team-tasks/service.ts",
  "server/modules/team-tasks/index.ts",
];
for (const rel of MODULE_FILES) {
  requireFile(rel);
}

// 1. No writes. The module is read-only.
const WRITE_NEEDLES = [
  "db.insert(",
  "db.update(",
  "db.delete(",
  // Direct table set-call shapes.
  "plexusTasks).set(",
  "schedulerAssignments).set(",
];
for (const rel of MODULE_FILES) {
  const c = read(rel) ?? "";
  for (const needle of WRITE_NEEDLES) {
    if (c.includes(needle)) {
      failures.push(
        `${rel}: contains write verb "${needle}" — Team Task module must remain read-only`,
      );
    }
  }
}

// 2. service.ts exposes only the documented read helpers.
const SERVICE_REL = "server/modules/team-tasks/service.ts";
requireText(SERVICE_REL, [
  "export async function getTeamTaskView",
  "export async function getTeamTaskViewByPatient",
]);
requireNotText(
  SERVICE_REL,
  [
    "export async function createTeamTask",
    "export async function updateTeamTask",
    "export async function completeTeamTask",
    "export async function cancelTeamTask",
    "export async function reassignTeamTask",
    "export async function deleteTeamTask",
  ],
  "Team Task service must not expose write helpers",
);

// 3. The contracts file pins the canonical owner-type set with no
//    extras. A future PR that adds an owner type must explicitly
//    update both the contract and the parity test (Bundle 45).
const CONTRACT_REL = "server/modules/team-tasks/contracts.ts";
requireText(CONTRACT_REL, [
  "TEAM_TASK_OWNER_TYPES",
  '"plexus_task"',
  '"scheduler_assignment"',
]);

// 4. Dormancy: no non-test file outside the module imports the
//    module's runtime entry points (service / repo).
const ALLOWED_IMPORTERS = new Set([
  ...MODULE_FILES,
]);
const MODULE_IMPORT_NEEDLES = [
  '"./service"',
  '"./repo"',
  '"../team-tasks/service"',
  '"../team-tasks/repo"',
  '"../team-tasks"',
  '"../../modules/team-tasks/service"',
  '"../../modules/team-tasks/repo"',
  '"../../modules/team-tasks"',
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
  for (const needle of MODULE_IMPORT_NEEDLES) {
    if (src.includes(needle)) {
      // Only treat as a dormancy breach when the importer is
      // clearly our module's namespace — not another module's
      // unrelated `./service` re-export.
      const insideTt = rel.startsWith("server/modules/team-tasks/");
      const explicit =
        needle.includes("team-tasks/service") ||
        needle.includes("team-tasks/repo") ||
        needle === '"./service"' && insideTt ||
        needle === '"./repo"' && insideTt;
      if (insideTt || needle.includes("team-tasks")) {
        if (explicit || rel.startsWith("server/modules/team-tasks/")) {
          // Inside the module the imports are expected; only flag
          // when the importer is OUTSIDE the module.
          if (!rel.startsWith("server/modules/team-tasks/")) {
            failures.push(
              `Team Task dormancy invariant broken: ${rel} matched "${needle}"`,
            );
          }
        }
      }
    }
  }
}

// 5. Legacy plexus task routes + scheduler assignment routes do NOT
//    import the Team Task module. The legacy reads/writes stay
//    where they are.
const LEGACY_ROUTE_FILES = [
  "server/routes/plexusTasks.ts",
  "server/routes/plexusTaskTemplates.ts",
  "server/routes/schedulerAssignments.ts",
];
for (const rel of LEGACY_ROUTE_FILES) {
  const c = read(rel);
  if (c === null) continue; // not every legacy route exists; informational.
  for (const needle of ["modules/team-tasks", "getTeamTaskView", "TeamTask"]) {
    if (c.includes(needle)) {
      failures.push(
        `${rel}: still references Team Task module ("${needle}") — adoption requires its own approved PR`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Team Task read-only invariant QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Team Task read-only invariant QA passed.");
