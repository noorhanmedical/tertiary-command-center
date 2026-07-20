// tests/unit/seedE2EPlaywrightUsers.test.ts
//
// Static architecture + safety tests for the Playwright fixture-user
// seed. No DB is required — every assertion is a source-level check
// against script/seedE2EPlaywrightUsers.ts.
//
//   §1  Dry-run is the default. Writing requires E2E_SEED_APPLY=YES.
//   §2  Production execution is refused (NODE_ENV=production guard).
//   §3  E2E_TEST_CLINIC_ID is required, validated as a positive int,
//       and verified against the clinics table (no clinic mutation).
//   §4  Only usernames starting with `e2e_playwright_` may be created
//       or updated. The prefix appears both in the FIXTURES table and
//       in the runtime UPDATE guard.
//   §5  No DELETE (db.delete or SQL DELETE) exists anywhere in the
//       seed script. The seed never removes users.
//   §6  No migration / db:push / drizzle-kit / TRUNCATE / DROP TABLE
//       references.
//   §7  No patient / appointment / clinical / billing / invoice /
//       document tables are referenced.
//   §8  No Twilio / patient-SMS references anywhere.
//   §9  Role strings match the canonical USER_ROLES enum on
//       shared/schema/users.ts. No guessed role strings.
//   §10 Password plaintext is never printed — the export lines use
//       the literal `$E2E_TEST_PASSWORD`.
//   §11 Password is hashed via the same bcrypt path the users
//       repository uses (bcryptjs, cost 12).
//   §12 npm script "seed:e2e-users" wires this file.

import fs from "node:fs";
import path from "node:path";
import { USER_ROLES } from "@shared/schema/users";

const ROOT = process.cwd();
const SEED_PATH = path.join(ROOT, "script/seedE2EPlaywrightUsers.ts");
const PKG_PATH = path.join(ROOT, "package.json");

const src = fs.readFileSync(SEED_PATH, "utf8");
const srcCode = src
  .split("\n")
  .filter((l) => !/^\s*(--|\/\/)/.test(l))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`- ${msg}`);
};

// §1: dry-run default; E2E_SEED_APPLY=YES required to write.
if (!/E2E_SEED_APPLY/.test(src)) {
  fail("§1 seed does not reference E2E_SEED_APPLY");
}
if (!/E2E_SEED_APPLY\s*===\s*"YES"/.test(src)) {
  fail("§1 apply must strictly equal 'YES'");
}
if (!/DRY-RUN/i.test(src)) {
  fail("§1 seed does not document DRY-RUN default in a log message");
}

// §2: production is refused.
if (
  !/NODE_ENV[^=]*==\s*["']production["']/.test(srcCode) &&
  !/NODE_ENV\s*===\s*["']production["']/.test(srcCode)
) {
  fail("§2 seed does not guard NODE_ENV === 'production'");
}
if (!/Refusing to run/i.test(src) && !/production/i.test(src)) {
  fail("§2 seed does not print a refusal message");
}

// §3: clinic id required + validated + verified.
if (!/E2E_TEST_CLINIC_ID/.test(src)) {
  fail("§3 seed does not reference E2E_TEST_CLINIC_ID");
}
if (!/parseInt\([^)]*E2E_TEST_CLINIC_ID/.test(srcCode) && !/parseInt\([^)]*rawClinic/.test(srcCode)) {
  fail("§3 seed does not parseInt E2E_TEST_CLINIC_ID");
}
if (!/Number\.isFinite/.test(srcCode)) {
  fail("§3 seed does not validate the clinic id shape");
}
if (!/select[\s\S]{0,80}\.from\(clinics\)/.test(srcCode)) {
  fail("§3 seed does not verify the clinic row exists");
}
// Clinics table must NEVER be inserted, updated, or deleted.
if (/\.insert\(clinics\)|\.update\(clinics\)|\.delete\(clinics\)/.test(srcCode)) {
  fail("§3 seed mutates the clinics table (must be read-only)");
}

// §4: only e2e_playwright_* usernames may be created / updated.
if (!/e2e_playwright_/.test(src)) {
  fail("§4 seed does not use the e2e_playwright_ prefix");
}
// Runtime UPDATE guard: WHERE must include the prefix filter.
if (!/like\(\s*users\.username,\s*`\${SEED_USERNAME_PREFIX}%`\s*\)/.test(srcCode)) {
  fail("§4 UPDATE WHERE clause missing e2e_playwright_ prefix filter");
}
// The insertion loop must iterate the FIXTURES constant only.
if (!/for\s*\(\s*const\s+f\s+of\s+FIXTURES\s*\)/.test(srcCode)) {
  fail("§4 seed does not iterate FIXTURES");
}
// Fail-fast at boot if any FIXTURES entry drifts from the prefix.
if (!/if\s*\(\s*!f\.username\.startsWith\(SEED_USERNAME_PREFIX\)/.test(srcCode)) {
  fail("§4 seed does not verify each FIXTURES.username starts with the prefix");
}

// §5: no DELETE anywhere in the seed.
if (/\bdb\.delete\s*\(/.test(srcCode)) {
  fail("§5 seed contains db.delete(");
}
if (/\bDELETE\s+FROM\b/i.test(srcCode)) {
  fail("§5 seed contains a raw DELETE FROM");
}

// §6: no migration / db:push / drizzle-kit / TRUNCATE / DROP TABLE.
for (const pat of [
  /db:push/i,
  /drizzle-kit/i,
  /\bTRUNCATE\b/i,
  /\bDROP\s+TABLE\b/i,
  /\bALTER\s+TABLE\b/i,
  /migrations\//,
]) {
  if (pat.test(srcCode)) {
    fail(`§6 seed references forbidden pattern ${pat}`);
  }
}

// §7: no patient / clinical / billing tables referenced.
for (const t of [
  "patientScreenings",
  "patientExecutionCases",
  "procedureEvents",
  "procedureNotes",
  "ancillaryAppointments",
  "invoices",
  "invoicePayments",
  "invoiceAdjustments",
  "invoiceDenials",
  "billingReadinessChecks",
  "caseDocumentReadiness",
  "documentsTable",
  "uploadedDocuments",
  "outreachCalls",
  "plexusTasks",
]) {
  if (new RegExp(`\\b${t}\\b`).test(srcCode)) {
    fail(`§7 seed references clinical/billing table ${t}`);
  }
}

// §8: no Twilio / SMS references.
for (const pat of [/twilio/i, /\bsms\b/i, /patient_sms/i, /patientSms/i]) {
  if (pat.test(srcCode)) fail(`§8 seed contains forbidden pattern ${pat}`);
}

// §9: role strings must be from the canonical USER_ROLES enum.
// Extract each FIXTURES entry's role literal and confirm it appears
// in the canonical enum.
const roleMatches = Array.from(
  src.matchAll(/role:\s*"([^"]+)"/g),
).map((m) => m[1]);
if (roleMatches.length === 0) {
  fail("§9 no role literals found in FIXTURES");
}
for (const r of roleMatches) {
  if (!(USER_ROLES as readonly string[]).includes(r)) {
    fail(`§9 fixture role "${r}" is not in canonical USER_ROLES`);
  }
}
// The seed must also assert the canonical enum at boot.
if (!/REQUIRED_CANONICAL_ROLES/.test(srcCode)) {
  fail("§9 seed does not assert the canonical role list at boot");
}
if (!/USER_ROLES as readonly string\[\]/.test(srcCode)) {
  fail("§9 seed does not check USER_ROLES membership at boot");
}

// §10: password plaintext never printed — export lines use
// $E2E_TEST_PASSWORD.
if (/console\.(log|error)\([^)]*password[^)]*\)/i.test(srcCode) && !/hashed|plaintext value is not|literal/i.test(src)) {
  // Presence of `password` inside a console call is only OK when the
  // surrounding text explains the guard. Otherwise fail.
  if (!/plaintext value is not printed|literal `\$E2E_TEST_PASSWORD`/i.test(src)) {
    fail("§10 seed prints a `password` token in console — potential plaintext leak");
  }
}
if (!/\$E2E_TEST_PASSWORD/.test(src)) {
  fail("§10 seed does not print the $E2E_TEST_PASSWORD reference form");
}
// The seed must never print gate.password directly.
if (/console\.(log|error)\([^)]*gate\.password[^)]*\)/.test(srcCode)) {
  fail("§10 seed prints gate.password directly");
}
if (/console\.(log|error)\([^)]*process\.env\.E2E_TEST_PASSWORD[^)]*\)/.test(srcCode)) {
  fail("§10 seed prints process.env.E2E_TEST_PASSWORD directly");
}

// §11: password hashed via bcryptjs cost 12.
if (!/bcrypt\.hash\([^)]*,\s*12\)/.test(srcCode)) {
  fail("§11 seed does not use bcrypt.hash(..., 12)");
}
if (!/from\s+["']bcryptjs["']/.test(src)) {
  fail("§11 seed does not import bcryptjs (matching users.repo)");
}

// §12: npm script "seed:e2e-users" wires this file.
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
if (pkg.scripts?.["seed:e2e-users"] !== "tsx script/seedE2EPlaywrightUsers.ts") {
  fail(
    `§12 package.json "seed:e2e-users" script incorrect (got: ${pkg.scripts?.["seed:e2e-users"] ?? "<missing>"})`,
  );
}

if (failures > 0) {
  console.error(`seedE2EPlaywrightUsers.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log(
  `seedE2EPlaywrightUsers.test.ts: all tests passed (fixtures=${roleMatches.length}, canonical USER_ROLES=${USER_ROLES.length})`,
);
