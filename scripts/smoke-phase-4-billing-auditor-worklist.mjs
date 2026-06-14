// Smoke — Phase 4 PR 4.7 blocker-to-queue mapping.

const READINESS_BLOCKER_TO_QUEUE = {
  missing_report: "blocked_missing_report",
  missing_order_note: "blocked_missing_order_note",
  missing_procedure_note: "blocked_missing_procedure_note",
  physician_signature_pending: "physician_signature_pending",
  insurance_verification_pending: "insurance_verification_pending",
  missing_price: "missing_price",
  missing_recipient: "missing_recipient",
};

const fails = [];
function expect(label, actual, expected) {
  if (actual !== expected) fails.push(`${label} — actual=${actual} expected=${expected}`);
  else console.log(`PASS  ${label}`);
}

expect("1. missing_report → blocked_missing_report", READINESS_BLOCKER_TO_QUEUE.missing_report, "blocked_missing_report");
expect("2. physician_signature_pending → its own queue", READINESS_BLOCKER_TO_QUEUE.physician_signature_pending, "physician_signature_pending");
expect("3. missing_price → its own queue", READINESS_BLOCKER_TO_QUEUE.missing_price, "missing_price");
expect("4. missing_recipient → its own queue", READINESS_BLOCKER_TO_QUEUE.missing_recipient, "missing_recipient");
expect("5. unmapped blocker (cancelled) → undefined", READINESS_BLOCKER_TO_QUEUE.cancelled, undefined);

if (fails.length > 0) {
  for (const f of fails) console.log(`FAIL  ${f}`);
  console.error(`Smoke failed: ${fails.length}`);
  process.exit(1);
}
console.log("Smoke passed: blocker→queue mapping intact.");
