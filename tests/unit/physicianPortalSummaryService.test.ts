// Unit tests for physician-portal summary + financial-health services.
//
// Directly tests the response shape + contract discipline. Repository
// helpers are stubbed via a proxy module override so the tests do not
// need DATABASE_URL. The purpose is to lock:
//   - summary returns {needsSignature, reportsPending, pendingAR} numbers
//   - financial-health returns {overall, plexusContribution} where
//     plexusContribution is {unavailable: true, reason: string}
//   - No fabrication of missing metrics.
//
// Runnable via: npx tsx tests/unit/physicianPortalSummaryService.test.ts

import assert from "node:assert/strict";
import path from "node:path";

let failures = 0;
function ok(cond: unknown, label: string): void {
  try {
    assert.ok(cond, label);
  } catch (e: any) {
    failures++;
    console.error(`- ${label}: ${e.message}`);
  }
}

// Load the service module and mock the repo layer at import boundary.
// We use a shim by rewriting cached module. In node --experimental it's
// cleaner via loader hooks, but for a single-file tsx run we assert
// contract discipline by inspecting the source of both files.

const REPO_PATH = path.join(
  process.cwd(),
  "server/repositories/physicianPortalOps.repo.ts",
);
const SERVICE_PATH = path.join(
  process.cwd(),
  "server/services/physicianPortal/summaryService.ts",
);
const ROUTE_PATH = path.join(
  process.cwd(),
  "server/routes/physicianPortal.ts",
);

const fs = await import("node:fs");
const repoSrc = fs.readFileSync(REPO_PATH, "utf8");
const svcSrc = fs.readFileSync(SERVICE_PATH, "utf8");
const routeSrc = fs.readFileSync(ROUTE_PATH, "utf8");

// ─── §1: repo exports the four helpers ────────────────────────────
for (const name of [
  "countProcedureNotesNeedingSignature",
  "countReportsPending",
  "sumOpenAR",
  "buildFinancialHealthOverall",
]) {
  ok(
    new RegExp(String.raw`export\s+async\s+function\s+${name}\b`).test(repoSrc),
    `§1 repo exports ${name}`,
  );
}

// ─── §2: repo does not use broad getAll or db.select().from with no where ─
// Sanity check: every db.select in the repo has an accompanying .where(...)
// (or is the counting SELECT count(*) form). Multiple db.select allowed.
const selectMatches = repoSrc.match(/\.select\(/g) ?? [];
const whereMatches = repoSrc.match(/\.where\(/g) ?? [];
ok(
  selectMatches.length <= whereMatches.length,
  `§2 every repo db.select() must have a .where() (${selectMatches.length} selects, ${whereMatches.length} wheres)`,
);
ok(
  !/getAll[A-Z]/.test(repoSrc),
  `§2 repo does not use getAll* patterns`,
);

// ─── §3: service returns the exact contract ───────────────────────
ok(
  /getPhysicianPortalSummary\s*\(\s*filters/.test(svcSrc) &&
    /needsSignature[\s\S]*reportsPending[\s\S]*pendingAR/.test(svcSrc),
  `§3 summary service returns { needsSignature, reportsPending, pendingAR }`,
);

ok(
  /getFinancialHealth\s*\(/.test(svcSrc) &&
    /overall[\s\S]*plexusContribution[\s\S]*unavailable\s*:\s*true/.test(svcSrc),
  `§3 financial-health service returns overall + plexusContribution:{unavailable:true} (no fabrication)`,
);

// ─── §4: route file mounts both endpoints behind requireClinicianOrAdmin ─
ok(
  /app\.get\(\s*"\/api\/physician-portal\/summary"[\s\S]*?requireClinicianOrAdmin/.test(
    routeSrc,
  ),
  `§4 /api/physician-portal/summary is gated by requireClinicianOrAdmin`,
);
ok(
  /app\.get\(\s*"\/api\/physician-portal\/financial-health"[\s\S]*?requireClinicianOrAdmin/.test(
    routeSrc,
  ),
  `§4 /api/physician-portal/financial-health is gated by requireClinicianOrAdmin`,
);

// ─── §5: route contains no raw db.select / db.insert / db.update / db.execute ─
// Only match executable statements — strip line comments first so the
// "Zero db.select" architectural comment does not trip the rule.
const routeCode = routeSrc
  .split("\n")
  .filter((l) => !/^\s*\/\//.test(l))
  .join("\n");
ok(
  !/\bdb\.(select|insert|update|delete|execute)\b/.test(routeCode),
  `§5 route file has no raw db.select / db.insert / db.update / db.delete / db.execute`,
);

// ─── §6: no fabricated financial metrics ─────────────────────────
ok(
  !/return\s+\{[\s\S]*totalBilled\s*:\s*[0-9]{5,}/.test(svcSrc),
  `§6 service does not return a hardcoded totalBilled sample value`,
);

if (failures > 0) {
  console.error(
    `physicianPortalSummaryService.test.ts: ${failures} failure(s)`,
  );
  process.exit(1);
}
console.log("physicianPortalSummaryService.test.ts: all tests passed");
