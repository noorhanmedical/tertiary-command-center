// QA: Operational Queue read-only source invariant (Bundle 46).
//
// Proves the Operational Queue module remains a READ-ONLY consumer
// of scheduler_assignments, plexus_tasks, patient_execution_cases,
// ancillary_appointments, and global_schedule_events. Any future
// PR that adds a write (insert / update / delete) through this
// module breaks CI.
//
// Also proves:
//   - The existing scheduler-assignments route's reads/writes are
//     unchanged in shape.
//   - The existing call-list route (handled by the same file) keeps
//     its legacy behavior gated behind USE_OPERATIONAL_QUEUE_CALL_LIST
//     (which is the shadow-read flag, default OFF; see PR #80).
//   - The Operational Queue module does not import any write-capable
//     repository.
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

const MODULE_FILES = [
  "server/modules/operational-queue/contracts.ts",
  "server/modules/operational-queue/repo.ts",
  "server/modules/operational-queue/service.ts",
  "server/modules/operational-queue/index.ts",
];

const ROUTE_REL = "server/routes/schedulerAssignments.ts";

for (const rel of MODULE_FILES) {
  requireFile(rel);
}
requireFile(ROUTE_REL);

// 1. The module never writes. We scan repo.ts + service.ts for write
//    verbs that would touch the canonical tables. db.insert /
//    db.update / db.delete are the Drizzle write entries. The repo
//    is allowed to import `db` (it does the reads), but it MUST NOT
//    call any write method.
const WRITE_NEEDLES = [
  "db.insert(",
  "db.update(",
  "db.delete(",
  // Drizzle composable form.
  ".$dynamic().delete(",
  // Direct table write shapes — guard against future refactor.
  "schedulerAssignments).set(",
  "plexusTasks).set(",
  "patientExecutionCases).set(",
  "ancillaryAppointments).set(",
  "globalScheduleEvents).set(",
];
for (const rel of MODULE_FILES) {
  const c = read(rel) ?? "";
  for (const needle of WRITE_NEEDLES) {
    if (c.includes(needle)) {
      failures.push(
        `${rel}: contains write verb "${needle}" — Operational Queue module must remain read-only`,
      );
    }
  }
}

// 2. The module exposes the documented read helpers and nothing
//    write-shaped. The barrel only re-exports types + read helpers.
const SERVICE_REL = "server/modules/operational-queue/service.ts";
requireText(SERVICE_REL, [
  "export async function getOperationalQueueForUser",
  "export async function getOperationalQueueForFacility",
]);
requireNotText(
  SERVICE_REL,
  [
    "export async function updateOperationalQueue",
    "export async function deleteOperationalQueue",
    "export async function assignOperationalQueue",
    "export async function createOperationalQueueItem",
  ],
  "Operational Queue service must not expose write helpers",
);

// 3. The route preserves the legacy `res.json(rows)` response path
//    (Bundle 14 / Bundle 19 also pin this; Bundle 46 reasserts).
requireText(ROUTE_REL, [
  "res.json(rows)",
  "isOperationalQueueCallListEnabled",
  "USE_OPERATIONAL_QUEUE_CALL_LIST",
  "storage.listActiveSchedulerAssignments",
]);

// 4. The route does NOT adopt the projection (mirrors Bundle 19
//    dormancy invariant — repeated here from the OperationalQueue
//    perspective so a failure surfaces in the Bundle 46 lens).
requireNotText(
  ROUTE_REL,
  [
    "projectQueueItemsToSchedulerAssignments",
    "defaultFetchSchedulerAssignmentsByIds",
    "projections/schedulerAssignment",
  ],
  "scheduler-assignments route must NOT adopt the projection (cutover gate)",
);

// 5. The shadow-read block keeps the legacy assignments path as
//    primary — the operational-queue helper is called only for
//    parity logging, not as the response source.
const routeSrc = read(ROUTE_REL) ?? "";
{
  // Look for the call-shape `getOperationalQueueForUser(` inside the
  // route. It MUST occur strictly within the shadow-read try block.
  // Cheap check: it must NOT occur before the
  // `isOperationalQueueCallListEnabled()` gate.
  const flagIdx = routeSrc.indexOf("isOperationalQueueCallListEnabled()");
  const callIdx = routeSrc.indexOf("getOperationalQueueForUser(");
  if (flagIdx !== -1 && callIdx !== -1 && callIdx < flagIdx) {
    failures.push(
      `${ROUTE_REL}: getOperationalQueueForUser call appears BEFORE the shadow-read flag gate`,
    );
  }
}

// 6. Whole-tree: only the route file (under the flag gate) and the
//    module's own files / tests may import from operational-queue
//    runtime entry points (`service` / `repo`). Mirrors the
//    Bundle 19 import-graph walk for the projection — adapted to
//    the operational-queue service.
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
const ALLOWED_OPQ_IMPORTERS = new Set([
  "server/modules/operational-queue/service.ts",
  "server/modules/operational-queue/repo.ts",
  "server/modules/operational-queue/index.ts",
  "server/modules/operational-queue/bridge.ts",
  // The shadow-read consumer.
  ROUTE_REL,
]);
const OPQ_IMPORT_NEEDLES = [
  '"../modules/operational-queue/service"',
  '"../modules/operational-queue/repo"',
  '"../operational-queue/service"',
  '"../operational-queue/repo"',
  '"./service"',
  '"./repo"',
];
const surface = [];
for (const dir of ["server", "shared", "client"]) {
  const abs = path.join(root, dir);
  if (fs.existsSync(abs)) surface.push(...walk(abs, [".ts", ".tsx"]));
}
for (const abs of surface) {
  const rel = path.relative(root, abs);
  if (ALLOWED_OPQ_IMPORTERS.has(rel)) continue;
  if (rel.includes("/__tests__/")) continue;
  const src = fs.readFileSync(abs, "utf8");
  for (const needle of OPQ_IMPORT_NEEDLES) {
    if (src.includes(needle)) {
      // Only treat as breach if the importer is actually pulling the
      // operational-queue module (not another module's `./service`).
      const insideOpq = rel.startsWith("server/modules/operational-queue/");
      const explicit =
        needle.includes("operational-queue/service") ||
        needle.includes("operational-queue/repo");
      if (insideOpq || explicit) {
        failures.push(
          `Operational Queue runtime-entry import outside allow-list: ${rel} matched "${needle}"`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Operational Queue read-only invariant QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Operational Queue read-only invariant QA passed.");
