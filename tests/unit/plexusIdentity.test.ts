// Phase 2A — Plexus identity contract tests.
//
// Runs standalone with:
//   npx tsx tests/unit/plexusIdentity.test.ts
//
// These are architecture/contract tests. They do not touch the DB.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  generatePlexusId,
  isValidPlexusId,
  generateUniquePlexusId,
} from "../../server/services/plexusIdentity/plexusIdGenerator";
import {
  checkPlexusIdentityAccess,
  assertPlexusIdentityAccess,
  PLEXUS_INTERNAL_ROLE_BLOCKER,
} from "../../server/services/plexusIdentity/authorization";
import {
  normalizeName,
  normalizeDob,
  normalizePhone,
  normalizeEmail,
  normalizeMrn,
} from "../../server/services/plexusIdentity/normalization";
import { SENSITIVE_IDENTIFIER_TYPES } from "../../shared/schema/plexusIdentity";
import { featureFlags } from "../../server/lib/featureFlags";

const REPO_ROOT = process.cwd();

// ─── Plexus ID generator ──────────────────────────────────────────
async function testGeneratorShape() {
  const id = generatePlexusId();
  assert.equal(id.length, 30, "PLX- + 26 ULID chars");
  assert.ok(id.startsWith("PLX-"), "prefix");
  assert.ok(isValidPlexusId(id), "shape validator agrees");
}

async function testGeneratorRejects() {
  assert.equal(isValidPlexusId(""), false);
  assert.equal(isValidPlexusId("PLX-"), false);
  assert.equal(isValidPlexusId("PLX-ABC"), false);
  assert.equal(isValidPlexusId("plx-" + "A".repeat(26)), false, "case-sensitive prefix");
  assert.equal(
    isValidPlexusId("PLX-" + "I".repeat(26)),
    false,
    "must reject Crockford-forbidden chars (I)",
  );
  assert.equal(
    isValidPlexusId("PLX-" + "O".repeat(26)),
    false,
    "must reject Crockford-forbidden chars (O)",
  );
}

async function testGeneratorHighEntropy() {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) seen.add(generatePlexusId());
  assert.equal(seen.size, 1000, "no collisions in 1k samples");
}

async function testGeneratorNeverDerivesFromPHI() {
  // Deterministic property: no matter what patient data we might pass in
  // (there's no parameter — the generator takes none), the ID must not
  // encode any input. Absence of a parameter is itself the guarantee.
  assert.equal(generatePlexusId.length, 0, "generator accepts no arguments (no PHI can be encoded)");
}

async function testGenerateUniqueRetriesUntilFree() {
  let calls = 0;
  const id = await generateUniquePlexusId(async (_candidate) => {
    calls++;
    return calls < 3; // first two "taken", third free
  }, 5);
  assert.ok(isValidPlexusId(id));
  assert.equal(calls, 3);
}

async function testGenerateUniqueGivesUp() {
  await assert.rejects(
    generateUniquePlexusId(async () => true, 4),
    /failed to allocate/,
  );
}

// ─── Authorization ────────────────────────────────────────────────
async function testAuthDeniesUndefinedSession() {
  const r = checkPlexusIdentityAccess(undefined);
  assert.equal(r.permitted, false);
}

async function testAuthDeniesAdmin() {
  const r = checkPlexusIdentityAccess({ role: "admin", userId: "u1" });
  assert.equal(r.permitted, false, "clinic admin must NOT get Plexus-internal access");
}

async function testAuthDeniesEveryKnownRole() {
  for (const role of ["clinician", "scheduler", "biller", "technician", "liaison"]) {
    const r = checkPlexusIdentityAccess({ role, userId: "u" });
    assert.equal(r.permitted, false, `role ${role} must be denied`);
  }
}

async function testAuthDeniesFabricatedInternalRole() {
  // Even if the flag is somehow flipped, until the role is added to
  // USER_ROLES *and* this file is updated, access must be denied.
  const prior = { ...featureFlags };
  // We cannot mutate `featureFlags` (const) — this test asserts the
  // blocker reason is exposed for future review, and that
  // assertPlexusIdentityAccess throws with a stable code.
  assert.equal(prior.plexusIdentityReview, false, "flag default OFF");
  try {
    assertPlexusIdentityAccess({ role: "plexus_internal_reviewer", userId: "u" });
    assert.fail("should have thrown while feature flag is off");
  } catch (e) {
    assert.equal((e as { code?: string }).code, "PLEXUS_IDENTITY_ACCESS_DENIED");
  }
}

async function testBlockerConstantShape() {
  assert.equal(
    PLEXUS_INTERNAL_ROLE_BLOCKER.proposedRole,
    "plexus_internal_reviewer",
  );
  for (const r of ["admin", "clinician", "scheduler", "biller", "technician", "liaison"]) {
    assert.ok(
      PLEXUS_INTERNAL_ROLE_BLOCKER.currentUserRoles.includes(r as never),
      `current roles list must include ${r}`,
    );
  }
}

// ─── Normalization ────────────────────────────────────────────────
async function testNormalizationName() {
  assert.equal(normalizeName("  José  García-López  "), "JOSE GARCIA LOPEZ");
  assert.equal(normalizeName(null), "");
  assert.equal(normalizeName(""), "");
  assert.equal(normalizeName("O'Brien"), "O BRIEN");
}
async function testNormalizationDob() {
  assert.equal(normalizeDob("1980-05-04"), "1980-05-04");
  assert.equal(normalizeDob("1980/5/4"), "1980-05-04");
  assert.equal(normalizeDob("5/4/1980"), "1980-05-04");
  assert.equal(normalizeDob("garbage"), "");
  assert.equal(normalizeDob(null), "");
}
async function testNormalizationPhone() {
  assert.equal(normalizePhone("(415) 555-1212"), "4155551212");
  assert.equal(normalizePhone("+1 415-555-1212"), "4155551212");
  assert.equal(normalizePhone("123"), "123");
  assert.equal(normalizePhone(null), "");
}
async function testNormalizationEmail() {
  assert.equal(normalizeEmail("  Dr.Imran@NoorhanMedical.com  "), "dr.imran@noorhanmedical.com");
  assert.equal(normalizeEmail(null), "");
}
async function testNormalizationMrn() {
  assert.equal(normalizeMrn(" abc-123 "), "ABC-123");
  assert.equal(normalizeMrn(null), "");
}

// ─── Sensitive identifier types ───────────────────────────────────
async function testSensitiveIdentifiers() {
  assert.ok(SENSITIVE_IDENTIFIER_TYPES.includes("payer_member_id"));
  assert.ok(SENSITIVE_IDENTIFIER_TYPES.includes("medicare_identifier"));
  assert.equal(
    SENSITIVE_IDENTIFIER_TYPES.includes("clinic_mrn"),
    false,
    "clinic_mrn is not on the sensitive-encryption list (per-clinic scope + uniqueness index is the guard)",
  );
}

// ─── Feature flags default OFF ────────────────────────────────────
async function testFeatureFlagsDefaultOff() {
  // At import time (no env vars set), both must be false. If either is
  // true here, deployment safety is compromised.
  assert.equal(featureFlags.plexusIdentityWrite, false, "write flag default OFF");
  assert.equal(featureFlags.plexusIdentityReview, false, "review flag default OFF");
}

// ─── Architectural invariants ─────────────────────────────────────
async function testRoutesFileNotRegistered() {
  const routesTs = readFileSync(join(REPO_ROOT, "server/routes.ts"), "utf8");
  assert.equal(
    routesTs.includes("registerPlexusIdentityRoutes"),
    false,
    "server/routes.ts MUST NOT import registerPlexusIdentityRoutes until Plexus-internal role exists",
  );
  assert.equal(
    routesTs.includes("plexusIdentity"),
    false,
    "server/routes.ts MUST NOT reference plexusIdentity while the blocker is unresolved",
  );
}

async function testMigrationIsAdditiveOnly() {
  const sqlText = readFileSync(
    join(REPO_ROOT, "migrations/0049_add_plexus_identity.sql"),
    "utf8",
  );
  // Must not contain any destructive verb in executable position.
  const forbidden = [/\bDROP\s+TABLE\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i];
  for (const re of forbidden) {
    const lines = sqlText.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("--")) continue;
      assert.equal(
        re.test(trimmed),
        false,
        `migration must not contain ${re} outside comments (offending line: ${trimmed})`,
      );
    }
  }
  assert.ok(
    sqlText.includes("CREATE TABLE IF NOT EXISTS global_plexus_patients"),
    "table create is present",
  );
  assert.ok(
    sqlText.includes("ADD COLUMN IF NOT EXISTS patient_clinic_membership_id"),
    "transitional column present",
  );
  assert.ok(
    /clinics\s*\(id\)/.test(sqlText),
    "FK to clinics(id) present on tenant table",
  );
}

async function testMigrationNoNameDobUnique() {
  const sqlText = readFileSync(
    join(REPO_ROOT, "migrations/0049_add_plexus_identity.sql"),
    "utf8",
  );
  // Reject any unique index/constraint that combines name and DOB.
  const nameDobUnique = /UNIQUE[^\n]*\bnormalized_name\b[^\n]*\bdob\b/i;
  assert.equal(
    nameDobUnique.test(sqlText),
    false,
    "identity model FORBIDS name+DOB as a unique identifier",
  );
}

async function testSchemaBarrelReexports() {
  const barrel = readFileSync(join(REPO_ROOT, "shared/schema/index.ts"), "utf8");
  assert.ok(
    barrel.includes("./plexusIdentity"),
    "shared/schema/index.ts must re-export ./plexusIdentity",
  );
}

// ─── Runner ───────────────────────────────────────────────────────
const tests = [
  ["generator shape", testGeneratorShape],
  ["generator rejects malformed", testGeneratorRejects],
  ["generator high entropy", testGeneratorHighEntropy],
  ["generator never derives from PHI", testGeneratorNeverDerivesFromPHI],
  ["generateUnique retries until free", testGenerateUniqueRetriesUntilFree],
  ["generateUnique gives up", testGenerateUniqueGivesUp],
  ["auth denies undefined session", testAuthDeniesUndefinedSession],
  ["auth denies clinic admin", testAuthDeniesAdmin],
  ["auth denies every known role", testAuthDeniesEveryKnownRole],
  ["auth denies fabricated internal role while flag off", testAuthDeniesFabricatedInternalRole],
  ["blocker constant shape", testBlockerConstantShape],
  ["normalize name", testNormalizationName],
  ["normalize dob", testNormalizationDob],
  ["normalize phone", testNormalizationPhone],
  ["normalize email", testNormalizationEmail],
  ["normalize mrn", testNormalizationMrn],
  ["sensitive identifiers list", testSensitiveIdentifiers],
  ["feature flags default off", testFeatureFlagsDefaultOff],
  ["routes NOT registered", testRoutesFileNotRegistered],
  ["migration additive only", testMigrationIsAdditiveOnly],
  ["migration has no name+dob unique", testMigrationNoNameDobUnique],
  ["schema barrel re-exports plexusIdentity", testSchemaBarrelReexports],
] as const;

async function run() {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      // eslint-disable-next-line no-console
      console.log(`ok  ${name}`);
    } catch (e) {
      failed++;
      // eslint-disable-next-line no-console
      console.error(`FAIL  ${name}\n     ${(e as Error).message}`);
    }
  }
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`\nAll ${tests.length} tests passed`);
}

run();
