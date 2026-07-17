// Static contract tests for Phase 3 Mission Control + Home Stats
// enrichments. Locks:
//   - repo helpers exist and every db.select has a .where
//   - services expose the exact response shapes the client consumes
//   - no getAll* patterns
//   - no fabricated (hardcoded) financial or count values
//   - route file has no raw db.* calls
//
// Runnable via: npx tsx tests/unit/missionControlAndHomeStatsContract.test.ts

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const missionRepo = fs.readFileSync(
  path.join(ROOT, "server/repositories/missionControl.repo.ts"),
  "utf8",
);
const missionService = fs.readFileSync(
  path.join(ROOT, "server/services/missionControl/missionControlService.ts"),
  "utf8",
);
const homeRepo = fs.readFileSync(
  path.join(ROOT, "server/repositories/homeStats.repo.ts"),
  "utf8",
);
const homeService = fs.readFileSync(
  path.join(ROOT, "server/services/homeStats/homeStatsService.ts"),
  "utf8",
);
const missionRoute = fs.readFileSync(
  path.join(ROOT, "server/routes/missionControl.ts"),
  "utf8",
);
const homeRoute = fs.readFileSync(
  path.join(ROOT, "server/routes/homeStats.ts"),
  "utf8",
);

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (!cond) {
    failures++;
    console.error(`- ${label}`);
  }
}

// ─── §1: Mission Control repo exports every Phase 3 helper ──────
for (const name of [
  "countActiveExecutionCases",
  "countOpenPlexusTasks",
  "countRunningAnalysisJobs",
  "countCallbacksPending",
  "countScheduledToday",
  "countReadyForBilling",
  "countReportsMissing",
  "countPrescreenPending",
]) {
  ok(
    new RegExp(String.raw`export\s+async\s+function\s+${name}\b`).test(
      missionRepo,
    ),
    `§1 missionControl.repo exports ${name}`,
  );
}

// ─── §2: Every mission-control repo db.select has a .where ─────
const msSelects = (missionRepo.match(/\.select\(/g) ?? []).length;
const msWheres = (missionRepo.match(/\.where\(/g) ?? []).length;
ok(
  msSelects === msWheres,
  `§2 missionControl.repo: every db.select has a .where (${msSelects} selects, ${msWheres} wheres)`,
);
// Strip comments before check
const missionRepoCode = missionRepo
  .split("\n")
  .filter((l) => !/^\s*\/\//.test(l))
  .join("\n");
ok(!/getAll[A-Z]/.test(missionRepoCode), "§2 missionControl.repo has no getAll* pattern");

// ─── §3: Mission service returns the enriched spine + sections ─
for (const key of [
  "prescreen",
  "callbacks",
  "readyForBilling",
  "noReport",
  "tasks",
  "patientServices",
  "ancillaryToday",
  "qualification",
]) {
  ok(
    new RegExp(`${key}\\s*:`).test(missionService),
    `§3 missionControlService response includes ${key}`,
  );
}
ok(
  /qualificationBacklog/.test(missionService),
  "§3 mission service surfaces qualification backlog count",
);

// ─── §4: Home Stats repo exports every Phase 3 helper ──────────
for (const name of [
  "countPatientsAddedInRange",
  "countActiveSchedulesInRange",
  "countOutreachCallsInRange",
  "countAncillaryByCategoryInRange",
  "sumInvoicesPaidInRange",
  "sumInvoicesOutstanding",
  "countActiveExecutionCasesForUpcoming",
]) {
  ok(
    new RegExp(String.raw`export\s+async\s+function\s+${name}\b`).test(homeRepo),
    `§4 homeStats.repo exports ${name}`,
  );
}

// ─── §5: Home Stats service returns the exact contract shape ───
for (const key of [
  "finance",
  "windows",
  "upcoming",
  "ancillaryBreakdown",
  "callsByMember",
]) {
  ok(
    new RegExp(`${key}\\s*:`).test(homeService),
    `§5 homeStatsService response includes ${key}`,
  );
}
ok(
  /callsByMember\s*=\s*\{\s*last7\s*:\s*\[\s*\]/s.test(homeService) ||
    /callsByMember\s*=\s*\{\s*last7:\s*\[\]\s*as/i.test(homeService),
  "§5 homeStatsService leaves callsByMember empty (no fabricated leaderboard)",
);

// ─── §6: Home Stats repo: every db.select has a .where ─────────
const hsSelects = (homeRepo.match(/\.select\(/g) ?? []).length;
const hsWheres = (homeRepo.match(/\.where\(/g) ?? []).length;
ok(
  hsSelects === hsWheres,
  `§6 homeStats.repo: every db.select has a .where (${hsSelects} selects, ${hsWheres} wheres)`,
);
// Strip comments before checking for getAll pattern so architectural
// warnings ("no broad getAllScreeningBatches ...") don't trip the rule.
const homeRepoCode = homeRepo
  .split("\n")
  .filter((l) => !/^\s*\/\//.test(l))
  .join("\n");
ok(!/getAll[A-Z]/.test(homeRepoCode), "§6 homeStats.repo has no getAll* pattern");

// ─── §7: Routes have no raw db.* calls (comments stripped) ─────
for (const [name, src] of [
  ["missionControl.ts", missionRoute],
  ["homeStats.ts", homeRoute],
]) {
  const code = src
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
  ok(
    !/\bdb\.(select|insert|update|delete|execute)\b/.test(code),
    `§7 ${name} has no raw db.* calls`,
  );
}

// ─── §8: Home Stats supports date-window arguments ─────────────
ok(
  /DateWindow/.test(homeRepo) && /win\.start[\s\S]*win\.end/.test(homeRepo),
  "§8 homeStats.repo helpers accept explicit DateWindow { start, end }",
);
ok(
  /todayStart\s*=\s*utcMidnight/.test(homeService) &&
    /utcAddDays/.test(homeService),
  "§8 homeStatsService uses explicit UTC windows for today / last7 / last30",
);

// ─── §9: No fabricated financial values ────────────────────────
ok(
  !/return\s+\{[^\n]*total[^\n]*[0-9]{3,}/i.test(homeService),
  "§9 homeStatsService does not return hardcoded financial constants",
);

if (failures > 0) {
  console.error(`missionControlAndHomeStatsContract.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("missionControlAndHomeStatsContract.test.ts: all tests passed");
