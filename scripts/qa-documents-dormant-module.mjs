// QA: documents dormant module (Bundle 27).
//
// Asserts the dormant pure-helpers module under
// server/modules/documents/ remains pure and is not imported by any
// non-test file. Mirrors scripts/qa-engagement-board-dormant-service.mjs
// and scripts/qa-scheduler-assignment-projection-dormancy.mjs.
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

const CONTRACT_REL = "server/modules/documents/contracts.ts";
const SERVICE_REL = "server/modules/documents/service.ts";
const BARREL_REL = "server/modules/documents/index.ts";

requireFile(CONTRACT_REL);
requireFile(SERVICE_REL);
requireFile(BARREL_REL);

// Contracts file uses `import type` only — runtime erasure means no
// DB pull-in at import time. The text check guards against a
// future contributor turning `import type` into `import`.
{
  const c = read(CONTRACT_REL) ?? "";
  if (
    c.includes('from "@shared/schema/documentReadiness"') &&
    !c.includes('import type { DocumentType, DocumentStatus, DocumentTrigger } from "@shared/schema/documentReadiness"')
  ) {
    failures.push(
      `${CONTRACT_REL}: import from @shared/schema/documentReadiness must use "import type"`,
    );
  }
}

// Service is pure — no DB / schema runtime / drizzle imports.
const svc = read(SERVICE_REL) ?? "";
for (const needle of [
  'from "../../db"',
  'from "../../../db"',
  'from "@shared/schema"',
  // Schema sub-modules pull in Drizzle table values at runtime.
  'from "@shared/schema/documentReadiness"',
  "drizzle-orm",
]) {
  if (svc.includes(needle)) {
    failures.push(`${SERVICE_REL}: must not import "${needle}"`);
  }
}

// Service exports the documented helpers.
requireText(SERVICE_REL, [
  "export function evaluateBillingReadinessFromRows",
  "export function getPassingStatusesForDocType",
  "export function isPassingStatusForDocType",
]);

// Barrel re-exports both halves.
requireText(BARREL_REL, [
  "evaluateBillingReadinessFromRows",
  "getPassingStatusesForDocType",
  "isPassingStatusForDocType",
]);

// Dormancy invariant: only test files may import from
// server/modules/documents/. Allow-list:
const ALLOWED_IMPORTERS = new Set([CONTRACT_REL, SERVICE_REL, BARREL_REL]);
const MODULE_IMPORT_NEEDLES = [
  '"./contracts"',
  '"./service"',
  '"../documents/contracts"',
  '"../documents/service"',
  '"../documents"',
  '"../modules/documents"',
  '"../../modules/documents"',
];

const surface = [];
for (const dir of ["server", "shared", "client"]) {
  const abs = path.join(root, dir);
  if (fs.existsSync(abs)) surface.push(...walk(abs, [".ts", ".tsx"]));
}

for (const abs of surface) {
  const rel = path.relative(root, abs);
  if (ALLOWED_IMPORTERS.has(rel)) continue;
  // Test files anywhere under __tests__/ are exempt.
  if (rel.includes("/__tests__/")) continue;
  const src = fs.readFileSync(abs, "utf8");
  for (const needle of MODULE_IMPORT_NEEDLES) {
    if (src.includes(needle)) {
      // Only treat as dormancy break if this is actually our module —
      // other modules also have `./service`. Scope by directory.
      const insideOurModule = rel.startsWith("server/modules/documents/");
      const explicitDocs =
        needle.includes("documents/contracts") ||
        needle.includes("documents/service") ||
        needle.includes("modules/documents") ||
        (needle === '"../documents"' && rel.startsWith("server/modules/"));
      if (insideOurModule || explicitDocs) {
        failures.push(
          `dormancy invariant broken: ${rel} imports server/modules/documents (matched "${needle}").`,
        );
      }
    }
  }
}

// And the legacy repos do NOT import from the new module.
for (const repoRel of [
  "server/repositories/documentReadiness.repo.ts",
  "server/repositories/billingReadiness.repo.ts",
]) {
  const c = read(repoRel) ?? "";
  if (
    c.includes("modules/documents") ||
    c.includes("evaluateBillingReadinessFromRows") ||
    c.includes("getPassingStatusesForDocType") ||
    c.includes("isPassingStatusForDocType")
  ) {
    failures.push(
      `${repoRel}: still imports dormant documents module helper. ` +
        `Adoption requires its own explicitly approved PR.`,
    );
  }
}

if (failures.length > 0) {
  console.error("Documents dormant module QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Documents dormant module QA passed.");
