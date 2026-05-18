// Full-platform canonical spine QA.
//
// Run with: npm run qa:full-canonical-spine
//
// Exercises read paths across every canonical table in the platform.
// Does not write outside `isTest=true` rows. Skips cleanly when
// DATABASE_URL is missing so this can run anywhere.
//
// This is intentionally a thin spine test — domain-specific tests
// (qaPlexusFinalWiring, qaEngagementAssignmentBoard,
// qaTeamPortalCommandCenter, test:plexus-iq-*) cover their own
// contracts in depth. This one verifies that the broader spine is
// queryable end-to-end.

if (!process.env.DATABASE_URL) {
  console.log(
    "[qa-full-canonical-spine] DATABASE_URL missing — skipping.",
  );
  process.exit(0);
}

let passes = 0;
let failures = 0;
function assert(cond: unknown, label: string) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

async function main() {
  const dbMod = await import("../server/db");
  const schemaMod = await import("@shared/schema");
  const drizzleMod = await import("drizzle-orm");
  const { db } = dbMod;
  void drizzleMod;

  console.log("\n--- canonical read smoke ---");

  // Each `await db.select().from(table).limit(1)` returns an array; we
  // assert array-ness (succeeds even on empty tables). This is the
  // canonical "table exists + repo wired" check.
  const tableChecks: Array<[string, any]> = [
    ["screening_batches", schemaMod.screeningBatches],
    ["patient_screenings", schemaMod.patientScreenings],
    ["patient_execution_cases", schemaMod.patientExecutionCases],
    ["patient_journey_events", schemaMod.patientJourneyEvents],
    ["outreach_calls", schemaMod.outreachCalls],
    ["outreach_schedulers", schemaMod.outreachSchedulers],
    ["global_schedule_events", schemaMod.globalScheduleEvents],
    ["procedure_events", schemaMod.procedureEvents],
    ["plexus_tasks", schemaMod.plexusTasks],
    ["patient_test_history", schemaMod.patientTestHistory],
    ["insurance_eligibility_reviews", schemaMod.insuranceEligibilityReviews],
    ["documents", schemaMod.documents],
    ["analysis_jobs", schemaMod.analysisJobs],
    ["patient_communications", schemaMod.patientCommunications],
    ["admin_settings", (schemaMod as any).adminSettings],
  ];

  for (const [name, table] of tableChecks) {
    if (!table) {
      assert(false, `${name}: schema export missing`);
      continue;
    }
    try {
      const rows = await db.select().from(table).limit(1);
      assert(Array.isArray(rows), `${name}: select returns array`);
    } catch (err) {
      assert(
        false,
        `${name}: select threw — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(`\n=========================`);
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log(`=========================`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
