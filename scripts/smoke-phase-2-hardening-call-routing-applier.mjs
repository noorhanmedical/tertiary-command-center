// Smoke — Phase 2 hardening item 2: routing applier fixtures.
//
// Mirror the TS service so the smoke runs without TS imports.
//
// Run: node scripts/smoke-phase-2-hardening-call-routing-applier.mjs

function deriveRoutingApplication(plan, capabilities = {
  triageWriter: true,
  taskWriter: true,
  closeAssignmentWriter: false,
}) {
  const triageNeeded = plan.openTriageCase;
  const taskNeeded = plan.openFollowUpTask;
  const closeNeeded = plan.terminal;
  return {
    nextActionAt: plan.nextActionAt,
    openTriageCase: triageNeeded && capabilities.triageWriter,
    openFollowUpTask: taskNeeded && capabilities.taskWriter,
    closeAssignment: closeNeeded && capabilities.closeAssignmentWriter,
    requiresWriter: {
      triage: triageNeeded && !capabilities.triageWriter,
      task: taskNeeded && !capabilities.taskWriter,
      closeAssignment: closeNeeded && !capabilities.closeAssignmentWriter,
    },
  };
}

const failures = [];
function expect(label, actual, expected) {
  for (const key of Object.keys(expected)) {
    if (typeof expected[key] === "object" && expected[key] !== null) {
      for (const k2 of Object.keys(expected[key])) {
        if (actual[key]?.[k2] !== expected[key][k2]) {
          failures.push(`${label} — ${key}.${k2} actual=${JSON.stringify(actual[key]?.[k2])} expected=${JSON.stringify(expected[key][k2])}`);
          return;
        }
      }
    } else if (actual[key] !== expected[key]) {
      failures.push(`${label} — ${key} actual=${JSON.stringify(actual[key])} expected=${JSON.stringify(expected[key])}`);
      return;
    }
  }
  console.log(`PASS  ${label}`);
}

expect(
  "1. terminal scheduled → closeAssignment honestly pending",
  deriveRoutingApplication({
    outcome: "scheduled", terminal: true, nextActionAt: null,
    openTriageCase: false, openFollowUpTask: false,
  }),
  { closeAssignment: false, requiresWriter: { closeAssignment: true, triage: false, task: false } },
);

expect(
  "2. callback → triage applied + writer NOT required",
  deriveRoutingApplication({
    outcome: "callback", terminal: false, nextActionAt: new Date(),
    openTriageCase: true, openFollowUpTask: false,
  }),
  { openTriageCase: true, requiresWriter: { triage: false, task: false, closeAssignment: false } },
);

expect(
  "3. manager_review → task applied",
  deriveRoutingApplication({
    outcome: "manager_review", terminal: false, nextActionAt: null,
    openTriageCase: false, openFollowUpTask: true,
  }),
  { openFollowUpTask: true, requiresWriter: { task: false } },
);

expect(
  "4. capabilities override: triageWriter=false → triage required",
  deriveRoutingApplication({
    outcome: "callback", terminal: false, nextActionAt: new Date(),
    openTriageCase: true, openFollowUpTask: false,
  }, { triageWriter: false, taskWriter: true, closeAssignmentWriter: true }),
  { openTriageCase: false, requiresWriter: { triage: true } },
);

if (failures.length > 0) {
  for (const f of failures) console.log(`FAIL  ${f}`);
  console.error(`Smoke failed: ${failures.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: routing applier fixtures honor the contract.");
