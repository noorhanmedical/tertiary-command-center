// QA for the scheduling triage source-of-truth contract.
// Run with: `npm run qa:scheduling-triage`. No DB required.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SCHEDULING_TRIAGE_MAIN_TYPES,
  SCHEDULING_TRIAGE_STATUSES,
  SCHEDULING_TRIAGE_PRIORITIES,
} from "../shared/schema/schedulingTriage";

let passes = 0;
let failures = 0;
function assert(c: unknown, l: string) {
  if (c) { passes++; console.log(`  ✓ ${l}`); }
  else { failures++; console.log(`  ✗ ${l}`); }
}

function readFile(p: string): string {
  try { return readFileSync(resolve(process.cwd(), p), "utf8"); } catch { return ""; }
}

function main() {
  console.log("\n--- canonical mainType enum coverage ---");
  for (const t of [
    "reschedule",
    "cancellation",
    "no_show_follow_up",
    "outreach_callback",
    "insurance_verification",
    "authorization_pending",
    "same_day_add",
  ]) {
    assert(
      (SCHEDULING_TRIAGE_MAIN_TYPES as readonly string[]).includes(t),
      `mainType "${t}" registered`,
    );
  }

  console.log("\n--- status + priority enums ---");
  for (const s of ["open", "in_progress", "resolved", "closed", "escalated"]) {
    assert(
      (SCHEDULING_TRIAGE_STATUSES as readonly string[]).includes(s),
      `status "${s}" registered`,
    );
  }
  for (const p of ["low", "normal", "high", "urgent"]) {
    assert(
      (SCHEDULING_TRIAGE_PRIORITIES as readonly string[]).includes(p),
      `priority "${p}" registered`,
    );
  }

  console.log("\n--- canonical write path mapping (engagement-center call-result) ---");
  const callResultRoute = readFile("server/routes/executionCases.ts");
  assert(
    /callback:\s*\{\s*mainType:\s*"callback"/.test(callResultRoute) ||
      /mainType:\s*"outreach_callback"/.test(callResultRoute) ||
      /mainType:\s*"callback"/.test(callResultRoute),
    "engagement-center call-result handler maps callback → triage mainType",
  );
  assert(
    /no_answer:/.test(callResultRoute),
    "engagement-center handler maps no_answer disposition",
  );

  console.log("\n--- client helper exists with filter coverage ---");
  const helper = readFile("client/src/lib/workflow/schedulingTriageApi.ts");
  assert(/export async function fetchSchedulingTriageCases/.test(helper), "fetchSchedulingTriageCases exported");
  for (const f of [
    "facilityId",
    "mainType",
    "subtype",
    "status",
    "assignedUserId",
    "nextOwnerRole",
    "executionCaseId",
    "patientScreeningId",
    "globalScheduleEventId",
  ]) {
    assert(helper.includes(f), `helper filter accepts "${f}"`);
  }

  console.log("\n--- routes are read-only at the canonical surface ---");
  const route = readFile("server/routes/schedulingTriage.ts");
  assert(
    /GET\b.*\/api\/scheduling-triage-cases/.test(route) || /app\.get\("\/api\/scheduling-triage-cases"/.test(route),
    "GET /api/scheduling-triage-cases mounted",
  );
  // There must NOT be a free-standing POST that fabricates triage
  // rows outside the canonical write paths.
  assert(
    !/app\.post\("\/api\/scheduling-triage-cases"\s*[,)]/.test(route),
    "no free-standing POST /api/scheduling-triage-cases (writes flow through engagement-center / appointments / global-schedule)",
  );

  console.log("\n--- audit doc exists ---");
  const doc = readFile("docs/architecture/scheduling-triage-source-of-truth.md");
  assert(doc.length > 0, "scheduling-triage-source-of-truth.md exists");
  assert(/outreach_callback/.test(doc), "doc references outreach_callback mainType");
  assert(/Manager review/.test(doc), "doc covers manager review surface");

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main();
