// Static architecture + semantic tests for Phase 3 (corrected).
//
// These tests do NOT hit a database. They lock the contract discipline
// of the Mission Control + Home Stats stacks:
//
//   §1  route → service → repo layering (no raw db in routes)
//   §2  repositories use bounded aggregate queries only (no getAll*)
//   §3  invoicePayments (not invoices.createdAt) is the payment source
//   §4  "reports missing" definition uses documentStatus='missing'
//        ONLY (not 'pending', not 'uploaded')
//   §5  billing readiness "ready" uses 'ready_to_generate' ONLY
//   §6  prescreen uses patient_screenings.status ∈ {pending, draft}
//        (removed the guessed 'pending_review' from Phase 3 v1)
//   §7  plexus_tasks "open" definition = NOT closed AND NOT done
//        (removed the guessed active / in_progress from Phase 3 v1)
//   §8  MetricValue<T> discriminated union: sourceMissing is decided
//        by `available`, NOT by `value === 0`
//   §9  Helpers that cannot honor a clinic scope are named
//        `_platformWide` (no silent scope drop)
//   §10 Repos never call `new Date()` — callback + window Dates flow
//        in from the service
//   §11 Home Stats calls outreach + finance helpers with an explicit
//        ClinicScope (no leaking cross-clinic data)
//   §12 Home Stats route uses req.clinicId (no unscoped route call)
//   §13 Home Stats service does NOT proxy active-case count into
//        ancillaryPatients — that metric flows from
//        countDistinctPatientsScheduledInRange
//   §14 clinicContext middleware populates req.clinicId
//
// Runnable via: npx tsx tests/unit/missionControlAndHomeStatsContract.test.ts

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const F = {
  missionRoute: "server/routes/missionControl.ts",
  homeStatsRoute: "server/routes/homeStats.ts",
  missionService: "server/services/missionControl/missionControlService.ts",
  homeStatsService: "server/services/homeStats/homeStatsService.ts",
  missionRepo: "server/repositories/missionControl.repo.ts",
  homeStatsRepo: "server/repositories/homeStats.repo.ts",
  clinicCtx: "server/middleware/clinicContext.ts",
} as const;

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
function stripComments(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*(--|\/\/)/.test(l))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`- ${msg}`);
};

const missionRouteCode = stripComments(read(F.missionRoute));
const homeRouteCode = stripComments(read(F.homeStatsRoute));
const missionServiceCode = stripComments(read(F.missionService));
const homeServiceCode = stripComments(read(F.homeStatsService));
const missionRepoCode = stripComments(read(F.missionRepo));
const homeRepoCode = stripComments(read(F.homeStatsRepo));
const missionRepoRaw = read(F.missionRepo);
const homeRepoRaw = read(F.homeStatsRepo);
const missionServiceRaw = read(F.missionService);
const homeServiceRaw = read(F.homeStatsService);

// §1: no raw db access in route files
for (const src of [
  { name: F.missionRoute, code: missionRouteCode },
  { name: F.homeStatsRoute, code: homeRouteCode },
]) {
  if (/\bdb\.(select|selectDistinct|insert|update|delete|execute)\s*\(/.test(src.code)) {
    fail(`§1 route ${src.name} contains raw db.<method>(`);
  }
  if (/from\s+["']drizzle-orm["']/.test(src.code)) {
    fail(`§1 route ${src.name} imports from drizzle-orm`);
  }
  if (/from\s+["']\.\.\/db["']/.test(src.code)) {
    fail(`§1 route ${src.name} imports ../db directly`);
  }
}

// §2: repositories use only single-row COUNT/SUM helpers.
for (const src of [
  { name: F.missionRepo, code: missionRepoCode },
  { name: F.homeStatsRepo, code: homeRepoCode },
]) {
  if (/getAll[A-Z]/.test(src.code)) fail(`§2 ${src.name} has getAll* pattern`);
  const selects = (src.code.match(/\.select\(/g) ?? []).length;
  const wheres = (src.code.match(/\.where\(/g) ?? []).length;
  if (selects === 0 || wheres === 0) {
    fail(`§2 ${src.name} has zero select/where (${selects}/${wheres})`);
  }
}

// §3: invoicePayments must be the payment source; invoices.createdAt
// must NOT appear in the finance sum path.
if (!/invoicePayments/.test(homeRepoRaw)) {
  fail("§3 home stats repo does not reference invoicePayments");
}
if (/invoices\.createdAt/.test(stripComments(homeRepoRaw))) {
  fail("§3 home stats repo still references invoices.createdAt as payment proxy");
}
if (!/paymentDate/.test(homeRepoRaw)) {
  fail("§3 home stats repo does not filter on paymentDate");
}
if (!/sumPaymentsPostedInRange/.test(homeRepoRaw)) {
  fail("§3 sumPaymentsPostedInRange helper missing");
}
if (/export\s+async\s+function\s+sumInvoicesPaidInRange/.test(homeRepoRaw)) {
  fail("§3 prior proxy sumInvoicesPaidInRange should have been removed");
}

// §4: reports missing = documentStatus 'missing' only.
if (!/documentStatus,\s*["']missing["']/.test(missionRepoRaw)) {
  fail("§4 reports-missing helper does not filter documentStatus='missing'");
}
if (
  /documentStatus,\s*["']pending["']|documentStatus,\s*["']uploaded["']/.test(
    missionRepoRaw,
  )
) {
  fail("§4 reports-missing helper still uses 'pending' or 'uploaded'");
}

// §5: ready-for-billing = 'ready_to_generate' only.
if (!/readinessStatus,\s*["']ready_to_generate["']/.test(missionRepoRaw)) {
  fail("§5 ready-for-billing helper does not filter 'ready_to_generate'");
}
if (/readinessStatus,\s*["']ready["']/.test(missionRepoRaw)) {
  fail("§5 ready-for-billing helper still contains guessed 'ready' status");
}

// §6: prescreen uses only 'pending' or 'draft'.
if (/patientScreenings\.status,\s*["']pending_review["']/.test(missionRepoRaw)) {
  fail("§6 prescreen helper still uses 'pending_review'");
}
if (
  !/patientScreenings\.status,\s*["']pending["']/.test(missionRepoRaw) ||
  !/patientScreenings\.status,\s*["']draft["']/.test(missionRepoRaw)
) {
  fail("§6 prescreen helper missing 'pending' or 'draft'");
}

// §7: plexus_tasks "open" = NOT closed AND NOT done.
if (
  !/ne\(plexusTasks\.status,\s*["']closed["']\)/.test(missionRepoRaw) ||
  !/ne\(plexusTasks\.status,\s*["']done["']\)/.test(missionRepoRaw)
) {
  fail("§7 open-plexus-tasks helper does not exclude closed AND done");
}
if (
  /eq\(plexusTasks\.status,\s*["']active["']\)|eq\(plexusTasks\.status,\s*["']in_progress["']\)/.test(
    missionRepoRaw,
  )
) {
  fail("§7 open-plexus-tasks helper still uses guessed active/in_progress");
}

// §8: MetricValue<T> shape + sourceMissing rules.
if (
  !/MetricValue<[^>]+>/.test(missionRepoRaw) ||
  !/MetricValue<[^>]+>/.test(homeRepoRaw)
) {
  fail("§8 MetricValue type not exported from both repos");
}
if (
  !/available:\s*true/.test(missionRepoRaw) ||
  !/available:\s*true/.test(homeRepoRaw)
) {
  fail("§8 repos missing `available: true` branch");
}
if (
  /sourceMissing:\s*[a-zA-Z]+\s*===\s*0/.test(stripComments(missionServiceRaw)) ||
  /sourceMissing:\s*[a-zA-Z]+\s*===\s*0/.test(stripComments(homeServiceRaw))
) {
  fail("§8 service still derives sourceMissing from count === 0");
}
if (
  !/\.available/.test(missionServiceRaw) ||
  !/\.available/.test(homeServiceRaw)
) {
  fail("§8 service does not consult .available on the repo response");
}

// §9: platform-wide-only helpers are explicitly named.
if (
  !/countOpenPlexusTasks_platformWide/.test(missionRepoRaw) ||
  !/countRunningAnalysisJobs_platformWide/.test(missionRepoRaw) ||
  !/countCallbacksPending_platformWide/.test(missionRepoRaw)
) {
  fail("§9 platform-wide helpers missing explicit _platformWide suffix");
}
if (!/PlatformScope/.test(missionRepoRaw)) {
  fail("§9 PlatformScope type not defined");
}

// §10: repos never call new Date(). Callback + window Dates flow in.
// Strip comments before applying the check so architectural notes
// mentioning `new Date()` don't cause false positives.
if (/\bnew\s+Date\(\s*\)/.test(missionRepoCode)) {
  fail("§10 mission repo still calls new Date()");
}
if (/\bnew\s+Date\(\s*\)/.test(homeRepoCode)) {
  fail("§10 home stats repo still calls new Date()");
}

// §11: Home Stats service scopes every finance + outreach call.
for (const helper of [
  "sumPaymentsPostedInRange",
  "sumInvoicesOutstanding",
  "countOutreachCallsInRange",
]) {
  const re = new RegExp(`${helper}\\([^)]*\\bscope\\b`, "s");
  if (!re.test(homeServiceRaw)) {
    fail(`§11 home stats service calls ${helper} without a scope arg`);
  }
}

// §12: Home Stats route reads req.clinicId + passes it to the service.
const routeRaw = read(F.homeStatsRoute);
if (!/req\.clinicId/.test(routeRaw)) {
  fail("§12 home stats route never reads req.clinicId");
}
if (!/buildHomeStats\(\s*\{\s*clinicId\s*\}/.test(routeRaw)) {
  fail("§12 home stats route does not pass clinicId to buildHomeStats");
}

// §13: Home Stats service does not use active-case count as
// ancillaryPatients proxy.
if (/countActiveExecutionCasesForUpcoming/.test(homeServiceRaw)) {
  fail("§13 home stats service still references the active-case proxy");
}
if (!/countDistinctPatientsScheduledInRange/.test(homeServiceRaw)) {
  fail(
    "§13 home stats service does not use countDistinctPatientsScheduledInRange",
  );
}

// §14: clinic context middleware sets req.clinicId.
if (!/req\.clinicId\s*=/.test(read(F.clinicCtx))) {
  fail("§14 clinicContext middleware does not set req.clinicId");
}

if (failures > 0) {
  console.error(
    `missionControlAndHomeStatsContract.test.ts: ${failures} failure(s)`,
  );
  process.exit(1);
}
console.log("missionControlAndHomeStatsContract.test.ts: all tests passed");
