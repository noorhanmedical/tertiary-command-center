// QA: billing packet architecture fixture (Bundle 28).
//
// Source-code invariants only. The fixture's own runtime sanity
// checks (executed when the module is imported via tsx) cover the
// transition-map + money-field guards; this script tightens the
// PHI envelope and asserts the fixture stays aligned with the
// canonical enums in shared/schema/billingReadiness.ts.
//
// No DB. No app boot. No network. No PHI.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}
function requireFile(rel) {
  const c = read(rel);
  if (c === null) failures.push(`Missing file: ${rel}`);
  return c;
}
function requireText(rel, needles) {
  const c = read(rel);
  if (c === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (!c.includes(needle)) failures.push(`Missing "${needle}" in ${rel}`);
  }
}
function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (c.includes(needle)) failures.push(`${label}: ${rel} contains "${needle}"`);
  }
}

const FIXTURE_REL = "tests/fixtures/billingPacketArchitecture.fixture.ts";
const SCHEMA_REL = "shared/schema/billingReadiness.ts";

requireFile(FIXTURE_REL);
requireFile(SCHEMA_REL);

// 1. The fixture pins every status name in the canonical enum.
requireText(FIXTURE_REL, [
  "not_ready",
  "missing_requirements",
  "ready_to_generate",
  "billing_document_generated",
  "sent_to_billing",
  "BILLING_READINESS_STATUSES_FIXTURE",
  "BILLING_READINESS_TRANSITIONS_FIXTURE",
  "BILLING_READINESS_FIXTURE_ROWS",
  "evaluatedDocs",
  "missingRequirements",
]);

// 2. The canonical schema still exports the same enum — drift here
//    would mean the fixture has fallen out of sync with the live
//    type.
requireText(SCHEMA_REL, [
  'BILLING_READINESS_STATUSES = [',
  "not_ready",
  "missing_requirements",
  "ready_to_generate",
  "billing_document_generated",
  "sent_to_billing",
]);

// 3. PHI envelope — synthetic names + facilities only.
requireNotText(
  FIXTURE_REL,
  [
    "John",
    "Jane",
    "Smith",
    "Doe",
    "@gmail",
    "@hotmail",
    "@yahoo",
    "(555)",
    "diagnosis",
    "insurance",
  ],
  "billing packet fixture must remain PHI-free",
);

// 4. Money-field guard. The fixture is permitted to NAME these
//    strings in its doc comment and its runtime guard array, but
//    MUST NOT use them as object KEYS on the row type or any row
//    literal. We detect the latter by looking for the
//    `<key>:` pattern that would only appear inside an object
//    literal or a type definition.
{
  const c = read(FIXTURE_REL) ?? "";
  const moneyKeys = [
    "fullAmountPaid",
    "paymentStatus",
    "paymentDate",
    "amountDue",
    "amountPaid",
    "balanceDue",
    "claimAmount",
    "remittanceAmount",
  ];
  for (const k of moneyKeys) {
    // Detect `key:` as an object/type field — anchored at word
    // boundary on the left so `subFullAmountPaid:` does not false-
    // positive, and not preceded by `"` so the guard array (which
    // uses string literals) is exempt.
    const re = new RegExp(`(^|[^A-Za-z0-9_"\\\\])${k}\\s*:`, "g");
    if (re.test(c)) {
      failures.push(
        `billing packet fixture uses money key "${k}" as an object/type field — ` +
          `money territory is out of scope for this bundle`,
      );
    }
  }
}

// 5. The fixture import test under server/repositories/__tests__/
//    imports the fixture (which fires its own top-level sanity
//    checks) AND runs verdict assertions. Run it via tsx.
const TEST_REL = "server/repositories/__tests__/billingPacketArchitecture-fixture.test.ts";
requireFile(TEST_REL);
requireText(TEST_REL, [
  "BILLING_READINESS_STATUSES_FIXTURE",
  "BILLING_READINESS_TRANSITIONS_FIXTURE",
  "sent_to_billing",
  "§1",
  "§2",
  "§3",
  "§4",
  "§5",
  "§6",
  "§7",
  "§8",
]);

if (failures.length > 0) {
  console.error("Billing packet architecture fixture QA failed (pre-run):");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

const testAbs = path.join(root, TEST_REL);
const result = spawnSync("npx", ["vitest", "run", testAbs], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (result.status !== 0) {
  console.error(`Billing packet architecture fixture QA failed (test exit ${result.status}).`);
  process.exit(result.status ?? 1);
}

console.log("Billing packet architecture fixture QA passed.");
