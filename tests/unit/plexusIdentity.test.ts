// Phase 2A — Plexus identity contract tests.
//
// Runs standalone with:
//   npx tsx tests/unit/plexusIdentity.test.ts
//
// Includes both file-based architecture assertions and runtime tests
// that dynamic-import the repository layer. The runtime tests stub
// the DB — DATABASE_URL is set to a placeholder solely so
// `server/db.ts` can import cleanly. No real query is issued.

// Set a placeholder DATABASE_URL so dynamic imports of server/db
// don't hard-fail. Only used to satisfy the module's startup check;
// the tests below monkey-patch `db.select` before any real call.
process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

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

// ═══ Phase 2A patch — 16 integration-contract tests ═══════════════
// These verify the Drizzle/migration alignment, the shared orchestrator,
// the flag-aware error path, and the wire-up of every active ingestion
// route. They are file-based/static assertions where possible; the
// runtime-behavior tests use a light dependency-injection technique so
// they never touch the real DB.

// (1) Drizzle schema contains both transitional screening columns.
async function testDrizzleScreeningHasLinkColumns() {
  const { patientScreenings } = await import("../../shared/schema/screening");
  const cols = Object.keys(patientScreenings);
  assert.ok(cols.includes("patientClinicMembershipId"), "patientClinicMembershipId column missing");
  assert.ok(cols.includes("globalPlexusPatientId"), "globalPlexusPatientId column missing");
}

// (2) Migration 0049 contains matching columns and FK targets.
async function testMigrationHasScreeningLinkColumns() {
  const sqlText = readFileSync(join(REPO_ROOT, "migrations/0049_add_plexus_identity.sql"), "utf8");
  assert.ok(/ADD COLUMN IF NOT EXISTS patient_clinic_membership_id INTEGER/.test(sqlText));
  assert.ok(/ADD COLUMN IF NOT EXISTS global_plexus_patient_id\s+INTEGER/.test(sqlText));
  // Note: the transitional columns are added without inline REFERENCES
  // to avoid rewriting the patient_screenings table; the Drizzle schema
  // declares the FK relationship at the application layer.
  const drizzleScreening = readFileSync(join(REPO_ROOT, "shared/schema/screening.ts"), "utf8");
  assert.ok(
    /references\(\s*\(\)\s*=>\s*patientClinicMemberships\.id/.test(drizzleScreening),
    "Drizzle screening.ts must declare FK to patientClinicMemberships",
  );
  assert.ok(
    /references\(\s*\(\)\s*=>\s*globalPlexusPatients\.id/.test(drizzleScreening),
    "Drizzle screening.ts must declare FK to globalPlexusPatients",
  );
}

// (3) Feature flag OFF leaves existing ingestion behavior unchanged.
async function testFlagOffOrchestratorIsNoop() {
  const mod = await import("../../server/services/plexusIdentity/screeningIntegration");
  // With FEATURE_PLEXUS_IDENTITY_WRITE unset (default OFF), the
  // orchestrator must return immediately without any DB call. We prove
  // this by never providing a DB — if it tried to read/write, the
  // import would already have failed OR the call would throw. Instead
  // it returns `skipped_flag_off`.
  const r = await mod.resolveAndLinkPlexusIdentityForScreening({
    screeningId: 42,
    clinicId: 7,
    demographics: { displayName: "Ada Lovelace", dob: "1815-12-10" },
  });
  assert.deepEqual(r, { status: "skipped_flag_off" });
}

// (4) Feature flag ON invokes the shared identity orchestration
// (proven via the orchestrator's early-exit branch: with the flag ON
// and a null clinicId it must return `skipped_no_clinic` — the fact it
// reaches that check confirms the flag branch was taken; with the flag
// OFF it would have returned `skipped_flag_off` before the clinicId
// check). We simulate the flag ON by monkey-patching the module.
async function testFlagOnRoutesThroughOrchestration() {
  const flagsMod = await import("../../server/lib/featureFlags");
  const original = flagsMod.featureFlags.plexusIdentityWrite;
  (flagsMod.featureFlags as unknown as { plexusIdentityWrite: boolean }).plexusIdentityWrite = true;
  try {
    const mod = await import("../../server/services/plexusIdentity/screeningIntegration");
    const r = await mod.resolveAndLinkPlexusIdentityForScreening({
      screeningId: 99,
      clinicId: null, // triggers the ON-flag-only branch
      demographics: { displayName: "X" },
    });
    assert.deepEqual(r, { status: "skipped_no_clinic", screeningId: 99 });
  } finally {
    (flagsMod.featureFlags as unknown as { plexusIdentityWrite: boolean }).plexusIdentityWrite = original;
  }
}

// (5) Successful resolution links both screening FK columns.
// Verified by static reading of the orchestrator: the .set() clause
// must include both columns. This catches accidental removal of either
// FK write without needing a live DB.
async function testOrchestratorWritesBothScreeningFks() {
  const src = readFileSync(
    join(REPO_ROOT, "server/services/plexusIdentity/screeningIntegration.ts"),
    "utf8",
  );
  assert.ok(/patientClinicMembershipId:\s*commit\.membershipId/.test(src), "must set patientClinicMembershipId");
  assert.ok(/globalPlexusPatientId:\s*commit\.globalPlexusPatientId/.test(src), "must set globalPlexusPatientId");
  assert.ok(/db\s*\.update\(patientScreenings\)/.test(src), "must UPDATE patient_screenings");
}

// (6) Existing membership is reused idempotently.
async function testCommitReusesExistingMembership() {
  const resolver = await import("../../server/services/plexusIdentity/resolver");
  // Static assertion: commitResolution's ensureMembership helper
  // returns { created: false } when findActiveMembership yields a row.
  const src = readFileSync(
    join(REPO_ROOT, "server/services/plexusIdentity/resolver.ts"),
    "utf8",
  );
  assert.ok(/if\s*\(existing\)\s*return\s*\{\s*membership:\s*existing,\s*created:\s*false/.test(src),
    "ensureMembership must return the existing membership without creating a duplicate");
  assert.ok(typeof resolver.commitResolution === "function", "commitResolution exported");
}

// (7) Ambiguous match creates a candidate and still links the clinic workflow safely.
async function testPossibleMatchCreatesCandidateAndLinks() {
  const src = readFileSync(
    join(REPO_ROOT, "server/services/plexusIdentity/resolver.ts"),
    "utf8",
  );
  // The possible_match branch: (a) creates a new global patient +
  // membership so the clinic workflow proceeds unblocked, (b) records
  // one candidate row per matched signal in the review queue.
  assert.ok(
    /if\s*\(resolution\.outcome\s*===\s*"possible_match"\)/.test(src),
    "possible_match branch present",
  );
  assert.ok(
    /createMatchCandidate\(/.test(src),
    "possible_match branch enqueues match candidates",
  );
  // And the new global patient is created BEFORE the candidate loop:
  const createGlobalIdx = src.indexOf("createGlobalPatient({");
  const possibleIdx = src.indexOf('resolution.outcome === "possible_match"');
  assert.ok(createGlobalIdx > -1 && possibleIdx > -1 && createGlobalIdx < possibleIdx,
    "createGlobalPatient must run before the possible_match candidate loop so the clinic workflow gets its own global patient");
}

// (8) Name + DOB alone does not merge.
async function testNameDobAloneDoesNotMerge() {
  const src = readFileSync(
    join(REPO_ROOT, "server/services/plexusIdentity/resolver.ts"),
    "utf8",
  );
  // The name_dob signal only ever appears in the non-deterministic
  // section (possible_match). It must never appear inside the
  // definitive_match branch.
  const nameDobBlock = /matchedSignal:\s*\{\s*type:\s*"name_dob"/;
  assert.equal(
    nameDobBlock.test(src),
    false,
    "name_dob must NEVER be returned as a definitive_match signal",
  );
  // And it MUST appear as a possible_match signal.
  assert.ok(
    /type:\s*"name_dob"/.test(src),
    "name_dob must appear as a possible_match signal",
  );
}

// (9) Same-clinic MRN remains clinic/source scoped.
async function testClinicMrnIsClinicScoped() {
  const src = readFileSync(
    join(REPO_ROOT, "server/services/plexusIdentity/resolver.ts"),
    "utf8",
  );
  // The clinic_mrn definitive-match branch queries findMembershipByClinicMrn
  // with `clinicId: input.clinicId` — never a cross-clinic search.
  // Skip past the import declaration; find the call site.
  const idx = src.indexOf("findMembershipByClinicMrn({");
  assert.ok(idx > -1, "call site (with '{') must exist beyond the import line");
  const window = src.slice(idx, idx + 300);
  assert.ok(/clinicId:\s*input\.clinicId/.test(window),
    "clinic_mrn lookup must scope to input.clinicId");
  // The repo function itself must AND both clinicId and clinicMrn.
  const repoSrc = readFileSync(
    join(REPO_ROOT, "server/repositories/plexusIdentity.repo.ts"),
    "utf8",
  );
  const repoIdx = repoSrc.indexOf("findMembershipByClinicMrn");
  assert.ok(repoIdx > -1);
  const repoWindow = repoSrc.slice(repoIdx, repoIdx + 800);
  assert.ok(/eq\(patientClinicMemberships\.clinicId,\s*args\.clinicId\)/.test(repoWindow),
    "MRN lookup must AND clinic_id");
}

// (10) Every active screening-creation path calls the shared orchestrator
// rather than duplicating logic.
async function testAllIngestionRoutesUseSharedOrchestrator() {
  const targets: Array<[string, RegExp]> = [
    ["server/routes/batches.ts", /resolveAndLinkPlexusIdentityForScreening/],
    ["server/routes/plexusIqClinicalImport.ts", /resolveAndLinkPlexusIdentityForScreeningsBulk/],
    ["server/routes/patientDirectory.ts", /resolveAndLinkPlexusIdentityForScreening/],
  ];
  for (const [file, pattern] of targets) {
    const src = readFileSync(join(REPO_ROOT, file), "utf8");
    assert.ok(pattern.test(src), `${file} must call the shared orchestrator`);
    // And it must NOT call the resolver directly (would indicate duplicated logic):
    assert.equal(
      /resolveIdentity\s*\(/.test(src),
      false,
      `${file} must NOT call resolveIdentity directly — go through the orchestrator`,
    );
    assert.equal(
      /commitResolution\s*\(/.test(src),
      false,
      `${file} must NOT call commitResolution directly — go through the orchestrator`,
    );
  }
  // Sanity: the three-batches file references the orchestrator import 3× (single + 2× bulk).
  const batchesSrc = readFileSync(join(REPO_ROOT, "server/routes/batches.ts"), "utf8");
  const bulkCount = (batchesSrc.match(/resolveAndLinkPlexusIdentityForScreeningsBulk\(/g) ?? []).length;
  const singleCount = (batchesSrc.match(/resolveAndLinkPlexusIdentityForScreening\(/g) ?? []).length;
  assert.ok(bulkCount >= 2, `batches.ts must call bulk orchestrator at least twice (import-file, import-text); got ${bulkCount}`);
  assert.ok(singleCount >= 1, `batches.ts must call single orchestrator at least once (add patient); got ${singleCount}`);
}

// (11) Backfill apply logic would populate both screening links.
async function testBackfillWritesBothLinks() {
  const src = readFileSync(join(REPO_ROOT, "script/backfillPlexusIdentity.ts"), "utf8");
  // The apply-mode branch delegates to the shared orchestrator, which
  // updates BOTH screening FK columns (proven in test #5). Confirm the
  // backfill routes through that helper.
  assert.ok(
    /resolveAndLinkPlexusIdentityForScreening\(/.test(src),
    "backfill must call the shared orchestrator in apply mode",
  );
  assert.ok(
    /linkedMembershipId:\s*result\.patientClinicMembershipId/.test(src),
    "backfill plan must report the linked membership id",
  );
  assert.ok(
    /linkedGlobalPatientId:\s*result\.globalPlexusPatientId/.test(src),
    "backfill plan must report the linked global patient id",
  );
}

// (12) Backfill dry-run performs zero writes.
async function testBackfillDryRunZeroWrites() {
  const src = readFileSync(join(REPO_ROOT, "script/backfillPlexusIdentity.ts"), "utf8");
  // Dry-run branch calls resolveIdentity only (read-only), never the
  // orchestrator (which writes), and never db.update / db.insert.
  const dryRunSection = src.slice(src.indexOf("if (!apply)"), src.indexOf("// Apply mode"));
  assert.ok(/resolveIdentity\(/.test(dryRunSection), "dry-run uses read-only resolveIdentity");
  assert.equal(
    /resolveAndLinkPlexusIdentityForScreening\(/.test(dryRunSection),
    false,
    "dry-run must NOT invoke the writing orchestrator",
  );
  assert.equal(
    /db\.(?:insert|update|delete)/.test(dryRunSection),
    false,
    "dry-run must NOT invoke any mutating db operation",
  );
}

// (13) Missing tables with flags OFF do not break current workflows.
async function testMissingTableFlagsOffSwallow() {
  const repo = await import("../../server/repositories/plexusIdentity.repo");
  const flags = await import("../../server/lib/featureFlags");
  // Both flags default OFF at import time (asserted separately). We
  // simulate a missing-table error by patching db to throw 42P01 on
  // the first read. Instead of importing the real db, we call the
  // internal safeRead by proxy: exercising a read function that we
  // know goes through safeRead — findGlobalPatientByPlexusId. We
  // stub the drizzle chain by monkey-patching require cache.
  const dbMod = await import("../../server/db");
  const originalSelect = (dbMod.db as unknown as { select: unknown }).select;
  (dbMod.db as unknown as { select: () => unknown }).select = () => ({
    from: () => ({ where: () => ({ limit: async () => { const e = new Error("relation does not exist"); (e as { code?: string }).code = "42P01"; throw e; } }) }),
  });
  try {
    assert.equal(flags.featureFlags.plexusIdentityWrite, false);
    assert.equal(flags.featureFlags.plexusIdentityReview, false);
    const r = await repo.findGlobalPatientByPlexusId("PLX-TEST");
    assert.equal(r, null, "missing table with flags OFF must return null (preview safe)");
  } finally {
    (dbMod.db as unknown as { select: unknown }).select = originalSelect;
  }
}

// (14) Missing tables with write flag ON fail clearly instead of returning a false no-match.
async function testMissingTableFlagOnFailsClearly() {
  const repo = await import("../../server/repositories/plexusIdentity.repo");
  const flags = await import("../../server/lib/featureFlags");
  const dbMod = await import("../../server/db");
  const originalSelect = (dbMod.db as unknown as { select: unknown }).select;
  const originalWrite = flags.featureFlags.plexusIdentityWrite;
  (dbMod.db as unknown as { select: () => unknown }).select = () => ({
    from: () => ({ where: () => ({ limit: async () => { const e = new Error("relation does not exist"); (e as { code?: string }).code = "42P01"; throw e; } }) }),
  });
  (flags.featureFlags as unknown as { plexusIdentityWrite: boolean }).plexusIdentityWrite = true;
  try {
    await assert.rejects(
      () => repo.findGlobalPatientByPlexusId("PLX-TEST"),
      (err: Error & { code?: string }) => err.code === "PLEXUS_IDENTITY_MIGRATION_MISSING",
    );
  } finally {
    (dbMod.db as unknown as { select: unknown }).select = originalSelect;
    (flags.featureFlags as unknown as { plexusIdentityWrite: boolean }).plexusIdentityWrite = originalWrite;
  }
}

// (15) Clinic A cannot access Clinic B membership.
async function testClinicScopedMembershipLookup() {
  const src = readFileSync(
    join(REPO_ROOT, "server/repositories/plexusIdentity.repo.ts"),
    "utf8",
  );
  const idx = src.indexOf("findActiveMembership");
  assert.ok(idx > -1);
  const window = src.slice(idx, idx + 1200);
  // The WHERE clause must AND clinicId to prevent cross-clinic reads.
  assert.ok(
    /eq\(patientClinicMemberships\.clinicId,\s*args\.clinicId\)/.test(window),
    "findActiveMembership must AND clinic_id — no cross-clinic reads",
  );
  // And the global-patient read never joins clinic — it must NOT be
  // exposed to a clinic-facing route directly. Prove this via the
  // routes.ts check (test #19 in the original suite) already; here we
  // additionally verify no clinic route imports the repo directly.
  const routesFiles = [
    "server/routes/batches.ts",
    "server/routes/plexusIqClinicalImport.ts",
    "server/routes/patientDirectory.ts",
  ];
  for (const f of routesFiles) {
    const rsrc = readFileSync(join(REPO_ROOT, f), "utf8");
    assert.equal(
      /from\s+["']\.\.\/repositories\/plexusIdentity\.repo["']/.test(rsrc),
      false,
      `${f} must NOT import the repo directly — go through the orchestrator`,
    );
  }
}

// (16) Sensitive payer/Medicare raw identifiers remain disabled.
async function testSensitiveWriteRefused() {
  const repo = await import("../../server/repositories/plexusIdentity.repo");
  const flags = await import("../../server/lib/featureFlags");
  const original = flags.featureFlags.plexusIdentityWrite;
  (flags.featureFlags as unknown as { plexusIdentityWrite: boolean }).plexusIdentityWrite = true;
  try {
    await assert.rejects(
      () =>
        repo.createExternalIdentifier({
          globalPlexusPatientId: 1,
          identifierType: "payer_member_id",
          identifierValueEncrypted: "raw-payer-value-must-be-refused",
        }),
      (err: Error & { code?: string }) => err.code === "PLEXUS_IDENTITY_ENCRYPTION_UNRESOLVED",
    );
    await assert.rejects(
      () =>
        repo.createExternalIdentifier({
          globalPlexusPatientId: 1,
          identifierType: "medicare_identifier",
          identifierValueEncrypted: "raw-medicare-value-must-be-refused",
        }),
      (err: Error & { code?: string }) => err.code === "PLEXUS_IDENTITY_ENCRYPTION_UNRESOLVED",
    );
  } finally {
    (flags.featureFlags as unknown as { plexusIdentityWrite: boolean }).plexusIdentityWrite = original;
  }
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
  // ── Patch: 16 integration-contract tests ────────────────────────
  ["(1) drizzle screening has both link columns", testDrizzleScreeningHasLinkColumns],
  ["(2) migration has matching screening link columns + FK targets", testMigrationHasScreeningLinkColumns],
  ["(3) flag OFF orchestrator is a no-op", testFlagOffOrchestratorIsNoop],
  ["(4) flag ON routes through orchestration", testFlagOnRoutesThroughOrchestration],
  ["(5) orchestrator writes both screening FK columns", testOrchestratorWritesBothScreeningFks],
  ["(6) commit reuses existing membership", testCommitReusesExistingMembership],
  ["(7) possible_match creates candidate + still links clinic workflow", testPossibleMatchCreatesCandidateAndLinks],
  ["(8) name+DOB alone never becomes definitive match", testNameDobAloneDoesNotMerge],
  ["(9) clinic MRN lookup is clinic-scoped", testClinicMrnIsClinicScoped],
  ["(10) every active ingestion route uses shared orchestrator", testAllIngestionRoutesUseSharedOrchestrator],
  ["(11) backfill writes both screening links (via orchestrator)", testBackfillWritesBothLinks],
  ["(12) backfill dry-run performs zero writes", testBackfillDryRunZeroWrites],
  ["(13) missing table with flags OFF is swallowed (preview safe)", testMissingTableFlagsOffSwallow],
  ["(14) missing table with write flag ON fails clearly", testMissingTableFlagOnFailsClearly],
  ["(15) clinic-scoped membership lookup / no cross-clinic exposure", testClinicScopedMembershipLookup],
  ["(16) sensitive payer/Medicare raw writes remain disabled", testSensitiveWriteRefused],
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
