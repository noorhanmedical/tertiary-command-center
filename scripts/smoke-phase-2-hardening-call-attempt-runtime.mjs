// Smoke — Phase 2 hardening item 1: call-attempt planner fixtures.
//
// We mirror the planner here as a JS port so the smoke runs without
// importing TS modules. Both must stay in sync; the QA pins the TS
// source contract.
//
// Run: node scripts/smoke-phase-2-hardening-call-attempt-runtime.mjs

const ATTEMPT_INCREMENTING_OUTCOMES = new Set([
  "voicemail", "no_answer", "wrong_number", "callback",
]);
const ATTEMPT_RESETTING_OUTCOMES = new Set([
  "scheduled", "completed", "declined", "dnc", "do_not_contact", "deceased", "cancelled",
]);

function planCallAttempt({ currentAttemptCount, outcome, maxCallAttempts }) {
  const o = (outcome ?? "").toLowerCase();
  const counted = ATTEMPT_INCREMENTING_OUTCOMES.has(o);
  const resets = ATTEMPT_RESETTING_OUTCOMES.has(o);
  const newAttemptCount = resets ? 0 : counted ? currentAttemptCount + 1 : currentAttemptCount;
  const transitionToUnableToReach = counted && newAttemptCount >= Math.max(1, maxCallAttempts);
  return { newAttemptCount, countedAsAttempt: counted, updateLastAttempt: counted, transitionToUnableToReach, maxCallAttempts };
}

const failures = [];
function expect(label, actual, expected) {
  for (const key of Object.keys(expected)) {
    if (actual[key] !== expected[key]) {
      failures.push(`${label} — ${key} actual=${actual[key]} expected=${expected[key]}`);
      return;
    }
  }
  console.log(`PASS  ${label}`);
}

expect(
  "1. voicemail at 0/6 → count 1, not unable_to_reach",
  planCallAttempt({ currentAttemptCount: 0, outcome: "voicemail", maxCallAttempts: 6 }),
  { newAttemptCount: 1, countedAsAttempt: true, updateLastAttempt: true, transitionToUnableToReach: false },
);

expect(
  "2. no_answer at 5/6 → count 6, transitions to unable_to_reach",
  planCallAttempt({ currentAttemptCount: 5, outcome: "no_answer", maxCallAttempts: 6 }),
  { newAttemptCount: 6, countedAsAttempt: true, transitionToUnableToReach: true },
);

expect(
  "3. callback at 2/6 → count 3, not yet unable_to_reach",
  planCallAttempt({ currentAttemptCount: 2, outcome: "callback", maxCallAttempts: 6 }),
  { newAttemptCount: 3, countedAsAttempt: true, transitionToUnableToReach: false },
);

expect(
  "4. scheduled at 4/6 → count resets to 0",
  planCallAttempt({ currentAttemptCount: 4, outcome: "scheduled", maxCallAttempts: 6 }),
  { newAttemptCount: 0, countedAsAttempt: false, updateLastAttempt: false, transitionToUnableToReach: false },
);

expect(
  "5. dnc at 5/6 → reset, never unable_to_reach",
  planCallAttempt({ currentAttemptCount: 5, outcome: "dnc", maxCallAttempts: 6 }),
  { newAttemptCount: 0, countedAsAttempt: false, transitionToUnableToReach: false },
);

expect(
  "6. needs_records at 2/6 → count unchanged, not counted",
  planCallAttempt({ currentAttemptCount: 2, outcome: "needs_records", maxCallAttempts: 6 }),
  { newAttemptCount: 2, countedAsAttempt: false, transitionToUnableToReach: false },
);

expect(
  "7. wrong_number at 5/6 → count 6, transitions to unable_to_reach",
  planCallAttempt({ currentAttemptCount: 5, outcome: "wrong_number", maxCallAttempts: 6 }),
  { newAttemptCount: 6, countedAsAttempt: true, transitionToUnableToReach: true },
);

expect(
  "8. lowercase normalization (VOICEMAIL → voicemail)",
  planCallAttempt({ currentAttemptCount: 0, outcome: "VOICEMAIL", maxCallAttempts: 6 }),
  { newAttemptCount: 1, countedAsAttempt: true },
);

if (failures.length > 0) {
  for (const f of failures) console.log(`FAIL  ${f}`);
  console.error(`Smoke failed: ${failures.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: call-attempt planner fixtures honor the contract.");
