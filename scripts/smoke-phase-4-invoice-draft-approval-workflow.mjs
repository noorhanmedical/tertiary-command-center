// Smoke — Phase 4 PR 4.4 approval state machine fixtures.

const VALID_TRANSITIONS = {
  draft: new Set(["submit_for_review", "void"]),
  pending_review: new Set(["approve", "void", "revise"]),
  approved: new Set(["void"]),
  voided: new Set([]),
  revised: new Set(["submit_for_review", "void"]),
};

const T_TO_STATUS = {
  submit_for_review: "pending_review",
  approve: "approved",
  void: "voided",
  revise: "revised",
};

const fails = [];
function expect(label, from, transition, reason, expected) {
  const allowed = VALID_TRANSITIONS[from];
  let to;
  let err;
  if (!allowed.has(transition)) err = `409 ${from} cannot ${transition}`;
  else if (transition === "void" && !reason) err = "400 reason";
  else to = T_TO_STATUS[transition];
  const actual = err ?? to;
  if (actual !== expected) fails.push(`${label} — actual=${actual} expected=${expected}`);
  else console.log(`PASS  ${label}`);
}

expect("1. draft → submit_for_review", "draft", "submit_for_review", null, "pending_review");
expect("2. pending_review → approve", "pending_review", "approve", null, "approved");
expect("3. approved → void w/ reason", "approved", "void", "wrong batch", "voided");
expect("4. approved → void w/o reason fails", "approved", "void", null, "400 reason");
expect("5. voided → approve fails", "voided", "approve", null, "409 voided cannot approve");
expect("6. revised → submit_for_review", "revised", "submit_for_review", null, "pending_review");
expect("7. draft → approve fails", "draft", "approve", null, "409 draft cannot approve");

if (fails.length > 0) {
  for (const f of fails) console.log(`FAIL  ${f}`);
  console.error(`Smoke failed: ${fails.length}`);
  process.exit(1);
}
console.log("Smoke passed: approval state machine fixtures honor the contract.");
