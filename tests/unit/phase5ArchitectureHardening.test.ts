// Phase 5 architecture hardening — static contract tests.
//
// Locks these rules for the 4 files refactored in Phase 5:
//   §1 no `db.select/insert/update/delete/execute(` in route file
//   §2 no `import * from "drizzle-orm"` in route file
//   §3 no `from "../db"` in route file
//   §4 each refactored route delegates through a *.repo.ts file that
//      DOES import drizzle-orm and ../db.
//
// The 6 route files that were "clean-by-facade" (0 raw db calls) are
// audited only for regression: they must not gain any db.* call in
// the future.
//
// Runnable via: npx tsx tests/unit/phase5ArchitectureHardening.test.ts

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const REFACTORED_ROUTES = [
  "server/routes/invoiceDelivery.ts",
  "server/routes/invoiceFinancialEvents.ts",
  "server/routes/documentLibrary.ts",
  "server/routes/portal.ts",
];

const FACADE_ROUTES_MUST_STAY_CLEAN = [
  "server/routes/engagementAssignmentBoard.ts",
  "server/routes/engagementBaskets.ts",
  "server/routes/plexusIqClinicalImport.ts",
  "server/routes/completedBillingPackages.ts",
  "server/routes/callListAudit.ts",
  "server/routes/billing.ts",
];

const REQUIRED_REPO_FILES = [
  "server/repositories/invoiceDelivery.repo.ts",
  "server/repositories/invoiceFinancialEvents.repo.ts",
  "server/repositories/documentLibraryLegacy.repo.ts",
  "server/repositories/portal.repo.ts",
];

let failures = 0;
function fail(label: string) {
  failures++;
  console.error(`- ${label}`);
}

// Strip line and block comments so pattern hits inside intentional
// architectural comments don't cause false positives.
function stripComments(src: string): string {
  const lines = src.split("\n").filter((l) => !/^\s*(--|\/\/)/.test(l));
  let out = lines.join("\n");
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");
  return out;
}

const DB_METHOD_RE =
  /\bdb\.(select|selectDistinct|insert|update|delete|execute)\s*\(/;
const DRIZZLE_IMPORT_RE = /from\s+["']drizzle-orm["']/;
const DB_MODULE_IMPORT_RE = /from\s+["']\.\.\/db["']/;

// §1–§3: refactored routes must have no raw db surface.
for (const rel of REFACTORED_ROUTES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    fail(`§0 refactored route missing: ${rel}`);
    continue;
  }
  const src = stripComments(fs.readFileSync(abs, "utf8"));
  if (DB_METHOD_RE.test(src)) fail(`§1 ${rel} still calls db.<method>(`);
  if (DRIZZLE_IMPORT_RE.test(src)) fail(`§2 ${rel} still imports from drizzle-orm`);
  if (DB_MODULE_IMPORT_RE.test(src)) fail(`§3 ${rel} still imports ../db`);
}

// §4: each required repo file exists and imports the pieces it needs
// (../db + drizzle-orm). If a repo swaps to storage.ts one day, it
// still owns the concern — this just prevents an empty stub.
for (const rel of REQUIRED_REPO_FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    fail(`§4 missing repo: ${rel}`);
    continue;
  }
  const src = fs.readFileSync(abs, "utf8");
  if (!/from\s+["']\.\.\/db["']/.test(src)) {
    fail(`§4 ${rel} does not import ../db`);
  }
  if (!/from\s+["']drizzle-orm["']/.test(src)) {
    fail(`§4 ${rel} does not import drizzle-orm`);
  }
}

// §5: the 6 "clean-by-facade" routes must not regress into raw db use.
for (const rel of FACADE_ROUTES_MUST_STAY_CLEAN) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    fail(`§5 facade route missing: ${rel}`);
    continue;
  }
  const src = stripComments(fs.readFileSync(abs, "utf8"));
  if (DB_METHOD_RE.test(src)) {
    fail(`§5 ${rel} regressed to a raw db.<method>( call`);
  }
}

// §6: nothing in client/** may import from drizzle-orm or the server.
//     A defense against accidental server-side leakage into the SPA.
function walk(dir: string, out: string[]) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p);
  }
}
const clientFiles: string[] = [];
walk(path.join(ROOT, "client", "src"), clientFiles);
let clientHits = 0;
for (const p of clientFiles) {
  const src = fs.readFileSync(p, "utf8");
  if (/from\s+["']drizzle-orm/.test(src)) {
    clientHits++;
    fail(`§6 client file imports drizzle-orm: ${path.relative(ROOT, p)}`);
  }
  if (/from\s+["']@\/?\.?server/.test(src) || /from\s+["']\.\.\/\.\.\/server/.test(src)) {
    clientHits++;
    fail(`§6 client file imports server: ${path.relative(ROOT, p)}`);
  }
}

if (failures > 0) {
  console.error(
    `phase5ArchitectureHardening.test.ts: ${failures} failure(s); ` +
      `client scanned=${clientFiles.length}, client hits=${clientHits}`,
  );
  process.exit(1);
}
console.log(
  `phase5ArchitectureHardening.test.ts: all tests passed ` +
    `(refactored=${REFACTORED_ROUTES.length}, repos=${REQUIRED_REPO_FILES.length}, ` +
    `facade-clean=${FACADE_ROUTES_MUST_STAY_CLEAN.length}, client scanned=${clientFiles.length})`,
);
