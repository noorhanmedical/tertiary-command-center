// Billing packet architecture fixture — import probe (Bundle 28).
//
// Runnable via:
//   npx tsx server/repositories/__tests__/billingPacketArchitecture-fixture.test.ts
//
// The fixture under tests/fixtures/billingPacketArchitecture.fixture.ts
// runs sanity checks at module-load time (transition map coverage,
// money-field guard). This test imports it so those checks fire,
// then runs a few additional verdict assertions.

import {
  BILLING_READINESS_STATUSES_FIXTURE,
  BILLING_READINESS_TRANSITIONS_FIXTURE,
  BILLING_READINESS_FIXTURE_ROWS,
  type BillingReadinessStatusFixture,
} from "../../../tests/fixtures/billingPacketArchitecture.fixture";

const failures: string[] = [];
function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}

// ─── §1: Five statuses, no more, no less ──────────────────────────
check(
  BILLING_READINESS_STATUSES_FIXTURE.length === 5,
  `§1: expected 5 statuses got ${BILLING_READINESS_STATUSES_FIXTURE.length}`,
);

// ─── §2: Terminal status has no outbound transitions ──────────────
{
  const targets = BILLING_READINESS_TRANSITIONS_FIXTURE.sent_to_billing;
  check(
    targets.length === 0,
    `§2: sent_to_billing must be terminal (no outbound transitions) — got ${targets.length}`,
  );
}

// ─── §3: ready_to_generate may transition to billing_document_generated ─
{
  const ok = (
    BILLING_READINESS_TRANSITIONS_FIXTURE.ready_to_generate as ReadonlyArray<string>
  ).includes("billing_document_generated");
  check(ok, "§3: ready_to_generate must allow → billing_document_generated");
}

// ─── §4: not_ready may NOT jump directly to billing_document_generated ─
{
  const targets = BILLING_READINESS_TRANSITIONS_FIXTURE.not_ready as ReadonlyArray<string>;
  check(
    !targets.includes("billing_document_generated"),
    "§4: not_ready must NOT transition directly to billing_document_generated",
  );
}

// ─── §5: Every fixture row uses a known status ────────────────────
{
  const known = new Set<string>(BILLING_READINESS_STATUSES_FIXTURE);
  for (const row of BILLING_READINESS_FIXTURE_ROWS) {
    check(
      known.has(row.readinessStatus),
      `§5: row #${row.id} has unknown status ${row.readinessStatus}`,
    );
  }
}

// ─── §6: missingRequirements is consistent with readinessStatus ───
{
  for (const row of BILLING_READINESS_FIXTURE_ROWS) {
    if (row.readinessStatus === "missing_requirements") {
      check(
        row.missingRequirements.length > 0,
        `§6: row #${row.id} missing_requirements status but empty missing array`,
      );
    }
    if (row.readinessStatus === "ready_to_generate" || row.readinessStatus === "billing_document_generated") {
      check(
        row.missingRequirements.length === 0,
        `§6: row #${row.id} status ${row.readinessStatus} must have empty missing`,
      );
    }
  }
}

// ─── §7: No money fields surface on any row ───────────────────────
{
  const moneyKeys = [
    "fullAmountPaid",
    "paymentStatus",
    "paymentDate",
    "amount",
    "amountDue",
    "amountPaid",
    "balanceDue",
    "claimAmount",
    "remittanceAmount",
  ];
  for (const row of BILLING_READINESS_FIXTURE_ROWS) {
    for (const k of moneyKeys) {
      check(
        !(k in (row as unknown as Record<string, unknown>)),
        `§7: row #${row.id} carries forbidden money field "${k}"`,
      );
    }
  }
}

// ─── §8: PHI envelope — synthetic identifiers only ────────────────
{
  for (const row of BILLING_READINESS_FIXTURE_ROWS) {
    if (row.patientName !== null) {
      check(
        /^Test Patient/.test(row.patientName),
        `§8: row #${row.id} patientName "${row.patientName}" must use synthetic prefix`,
      );
    }
  }
}

// Use a value-side reference to BillingReadinessStatusFixture to
// silence the unused-import lint (TS keeps the type imports erased).
const _typeProbe: BillingReadinessStatusFixture = "not_ready";
void _typeProbe;

if (failures.length > 0) {
  console.error("Billing packet architecture fixture test FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("Billing packet architecture fixture test passed.");
}
