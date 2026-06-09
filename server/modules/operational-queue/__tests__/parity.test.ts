// Operational queue — live parity test fixture (Batch 11b).
//
// Runnable via:   npx tsx server/modules/operational-queue/__tests__/parity.test.ts
//
// What this test does:
//   - Connects to the live database (via DATABASE_URL).
//   - Picks a canned (userId, facility, dateFrom, dateTo) fixture from env
//     vars (with sensible defaults).
//   - Independently queries each of the four source tables
//     (scheduler_assignments, plexus_tasks, patient_execution_cases,
//      ancillary_appointments, global_schedule_events) with the same
//     filter rules the module uses.
//   - Calls getOperationalQueueForUser with the same filters.
//   - Asserts: per-kind counts in the unified queue equal the per-source
//     counts from the direct queries.
//   - Asserts: per-kind ownerId sets match.
//
// NOT WIRED TO CI in this batch. CI integration is deferred to phase
// 11g once the integration-test substrate (a Playwright variant or
// equivalent) is in place.
//
// Three run modes:
//   1. No DATABASE_URL → skip with message, exit 0.
//   2. DATABASE_URL but no PARITY_TEST_USER_ID → skip with message, exit 0.
//      (We deliberately do NOT pick a user automatically — choosing a
//      fixture is the operator's call; running the test "on whoever"
//      could produce noisy results.)
//   3. Full env → run the parity comparison. Exit 0 on pass; 1 on fail.
//
// Env vars (all optional; defaults are sensible for the local team):
//   - DATABASE_URL                    (required to run)
//   - PARITY_TEST_USER_ID             (required to run; gates execution)
//   - PARITY_TEST_FACILITY            (default: undefined = no facility filter)
//   - PARITY_TEST_DATE_FROM           (default: today)
//   - PARITY_TEST_DATE_TO             (default: today + 7 days)
//   - PARITY_TEST_INCLUDE_CLOSED      ("1" / "true" / "yes" to include closed)

if (!process.env.DATABASE_URL) {
  console.log("Operational queue parity test: SKIPPED (DATABASE_URL not set).");
  process.exit(0);
}

const FIXTURE_USER_ID = process.env.PARITY_TEST_USER_ID;
if (!FIXTURE_USER_ID) {
  console.log(
    "Operational queue parity test: SKIPPED (PARITY_TEST_USER_ID not set; " +
      "set it to a real outreach_schedulers.userId for the local team to run).",
  );
  process.exit(0);
}

// Lazy-import after the skip gates above so we never trigger a DB
// connection in environments where the test should be a no-op.
const { db } = await import("../../../db");
const schema = await import("@shared/schema");
const drizzle = await import("drizzle-orm");
const { getOperationalQueueForUser } = await import("../service");

const {
  schedulerAssignments,
  plexusTasks,
  patientExecutionCases,
  globalScheduleEvents,
  outreachSchedulers,
} = schema as Record<string, any>;
const { and, eq, inArray, sql } = drizzle;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(start: string, days: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const FIXTURE_FACILITY = process.env.PARITY_TEST_FACILITY?.trim() || undefined;
const FIXTURE_DATE_FROM =
  process.env.PARITY_TEST_DATE_FROM?.trim() || todayIso();
const FIXTURE_DATE_TO =
  process.env.PARITY_TEST_DATE_TO?.trim() || addDaysIso(FIXTURE_DATE_FROM, 7);
const FIXTURE_INCLUDE_CLOSED =
  process.env.PARITY_TEST_INCLUDE_CLOSED === "1" ||
  process.env.PARITY_TEST_INCLUDE_CLOSED === "true" ||
  process.env.PARITY_TEST_INCLUDE_CLOSED === "yes";

console.log("Operational queue parity test — fixture:");
console.log(`  userId:    ${FIXTURE_USER_ID}`);
console.log(`  facility:  ${FIXTURE_FACILITY ?? "(any)"}`);
console.log(`  dateFrom:  ${FIXTURE_DATE_FROM}`);
console.log(`  dateTo:    ${FIXTURE_DATE_TO}`);
console.log(`  closed:    ${FIXTURE_INCLUDE_CLOSED ? "included" : "excluded"}`);

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

// ─── Source A: scheduler_assignments → kind "call_list_item" ────────
const callListConds = [eq(outreachSchedulers.userId, FIXTURE_USER_ID)];
if (FIXTURE_FACILITY) {
  callListConds.push(eq(outreachSchedulers.facility, FIXTURE_FACILITY));
}
callListConds.push(sql`${schedulerAssignments.asOfDate} >= ${FIXTURE_DATE_FROM}`);
callListConds.push(sql`${schedulerAssignments.asOfDate} <= ${FIXTURE_DATE_TO}`);
if (!FIXTURE_INCLUDE_CLOSED) {
  callListConds.push(
    sql`${schedulerAssignments.status} NOT IN ('completed','released')`,
  );
}
const callListRows = await db
  .select({ id: schedulerAssignments.id })
  .from(schedulerAssignments)
  .leftJoin(
    outreachSchedulers,
    eq(schedulerAssignments.schedulerId, outreachSchedulers.id),
  )
  .where(and(...callListConds));
const callListExpectedIds = new Set(callListRows.map((r: any) => r.id));

// ─── Source B: plexus_tasks → kind "scheduler_task" ─────────────────
const plexusConds = [eq(plexusTasks.assignedToUserId, FIXTURE_USER_ID)];
plexusConds.push(sql`${plexusTasks.dueDate} >= ${FIXTURE_DATE_FROM}`);
plexusConds.push(sql`${plexusTasks.dueDate} <= ${FIXTURE_DATE_TO}`);
if (!FIXTURE_INCLUDE_CLOSED) {
  plexusConds.push(sql`${plexusTasks.status} NOT IN ('done','closed')`);
}
const plexusRows = await db
  .select({ id: plexusTasks.id })
  .from(plexusTasks)
  .where(and(...plexusConds));
const plexusExpectedIds = new Set(plexusRows.map((r: any) => r.id));

// ─── Source C: patient_execution_cases → kind "scheduler_task" ──────
const myScheds = await db
  .select({ id: outreachSchedulers.id })
  .from(outreachSchedulers)
  .where(eq(outreachSchedulers.userId, FIXTURE_USER_ID));
const myScheduleIds: number[] = myScheds.map((s: any) => s.id);

let engagementExpectedIds = new Set<number>();
if (myScheduleIds.length > 0) {
  const engagementConds = [
    inArray(patientExecutionCases.assignedTeamMemberId, myScheduleIds),
    eq(patientExecutionCases.lifecycleStatus, "active"),
  ];
  if (FIXTURE_FACILITY) {
    engagementConds.push(
      eq(patientExecutionCases.facilityId, FIXTURE_FACILITY),
    );
  }
  if (!FIXTURE_INCLUDE_CLOSED) {
    engagementConds.push(
      sql`${patientExecutionCases.engagementStatus} NOT IN ('completed','closed','cancelled','archived')`,
    );
  }
  const engagementRows = await db
    .select({ id: patientExecutionCases.id })
    .from(patientExecutionCases)
    .where(and(...engagementConds));
  engagementExpectedIds = new Set(engagementRows.map((r: any) => r.id));
}

// ─── Source D: global_schedule_events → kind "global_calendar_event" ─
const globalConds = [eq(globalScheduleEvents.assignedUserId, FIXTURE_USER_ID)];
if (FIXTURE_FACILITY) {
  globalConds.push(eq(globalScheduleEvents.facilityId, FIXTURE_FACILITY));
}
globalConds.push(
  sql`${globalScheduleEvents.startsAt} >= ${FIXTURE_DATE_FROM}::timestamp`,
);
globalConds.push(
  sql`${globalScheduleEvents.startsAt} <= (${FIXTURE_DATE_TO}::date + interval '1 day')`,
);
if (!FIXTURE_INCLUDE_CLOSED) {
  globalConds.push(
    sql`${globalScheduleEvents.status} NOT IN ('completed','cancelled','no_show')`,
  );
}
const globalRows = await db
  .select({ id: globalScheduleEvents.id })
  .from(globalScheduleEvents)
  .where(and(...globalConds));
const globalExpectedIds = new Set(globalRows.map((r: any) => r.id));

// ─── Run the unified queue ──────────────────────────────────────────
const items = await getOperationalQueueForUser(FIXTURE_USER_ID, {
  facility: FIXTURE_FACILITY,
  dateFrom: FIXTURE_DATE_FROM,
  dateTo: FIXTURE_DATE_TO,
  includeClosed: FIXTURE_INCLUDE_CLOSED,
});

// ─── Per-kind partition + assertions ────────────────────────────────
const callListIds = new Set(
  items.filter((i) => i.kind === "call_list_item").map((i) => i.ownerId),
);
const plexusIds = new Set(
  items
    .filter((i) => i.kind === "scheduler_task" && i.ownerType === "plexus_task")
    .map((i) => i.ownerId),
);
const engagementIds = new Set(
  items
    .filter(
      (i) => i.kind === "scheduler_task" && i.ownerType === "engagement_case",
    )
    .map((i) => i.ownerId),
);
const globalIds = new Set(
  items.filter((i) => i.kind === "global_calendar_event").map((i) => i.ownerId),
);

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

console.log("\nPer-source counts (direct query → unified queue):");
console.log(`  call_list_item:                 ${callListExpectedIds.size} → ${callListIds.size}`);
console.log(`  scheduler_task (plexus_task):   ${plexusExpectedIds.size} → ${plexusIds.size}`);
console.log(`  scheduler_task (engagement):    ${engagementExpectedIds.size} → ${engagementIds.size}`);
console.log(`  global_calendar_event:          ${globalExpectedIds.size} → ${globalIds.size}`);

check(
  setsEqual(callListExpectedIds, callListIds),
  `call_list_item ownerId set mismatch: direct=${[...callListExpectedIds].sort()} vs queue=${[...callListIds].sort()}`,
);
check(
  setsEqual(plexusExpectedIds, plexusIds),
  `scheduler_task(plexus_task) ownerId set mismatch: direct=${[...plexusExpectedIds].sort()} vs queue=${[...plexusIds].sort()}`,
);
check(
  setsEqual(engagementExpectedIds, engagementIds),
  `scheduler_task(engagement_case) ownerId set mismatch: direct=${[...engagementExpectedIds].sort()} vs queue=${[...engagementIds].sort()}`,
);
check(
  setsEqual(globalExpectedIds, globalIds),
  `global_calendar_event ownerId set mismatch: direct=${[...globalExpectedIds].sort()} vs queue=${[...globalIds].sort()}`,
);

// ─── Total bound check ──────────────────────────────────────────────
const expectedTotal =
  callListExpectedIds.size +
  plexusExpectedIds.size +
  engagementExpectedIds.size +
  globalExpectedIds.size;
const actualTotal = items.length;
check(
  expectedTotal === actualTotal,
  `Unified queue total mismatch: expected ${expectedTotal}, got ${actualTotal}`,
);

if (failures.length > 0) {
  console.error("\nOperational queue parity test FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("\nOperational queue parity test passed.");
  process.exit(0);
}
