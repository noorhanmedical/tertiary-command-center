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

// ═══ Phase 2A hardening — behavioral, discovery, and FK tests ══════

/**
 * Tiny fake-db builder. Simulates the drizzle chain shapes we use:
 *   db.select().from(t).where(x).limit(n)
 *   db.select().from(t).where(x).orderBy(y).limit(n)
 *   db.insert(t).values(v).returning()
 *   db.update(t).set(v).where(x)
 *   db.transaction(fn)  — runs fn immediately (no real tx boundary).
 *
 * The `tables` map keys are the Drizzle table objects. Each value is
 * an array acting as the "current rows". Insert appends; update
 * mutates matching rows (best-effort). Select filters are ignored —
 * the test-side handler determines what to return based on the table.
 */
type FakeTableSpec = {
  select?: () => unknown[];
  insert?: (values: Record<string, unknown> | Record<string, unknown>[]) => unknown[];
  update?: (values: Record<string, unknown>) => void;
};
function buildFakeDb(spec: Map<unknown, FakeTableSpec>) {
  const calls: Array<{ op: string; table: unknown; payload?: unknown }> = [];
  const fake = {
    select() {
      let currentTable: unknown = null;
      const chain = {
        from(t: unknown) { currentTable = t; return chain; },
        where(_: unknown) { return chain; },
        orderBy(_: unknown) { return chain; },
        async limit(_n: number) {
          calls.push({ op: "select", table: currentTable });
          const s = spec.get(currentTable);
          if (!s?.select) return [];
          return s.select();
        },
      };
      return chain;
    },
    insert(t: unknown) {
      return {
        values(v: Record<string, unknown> | Record<string, unknown>[]) {
          return {
            async returning() {
              calls.push({ op: "insert", table: t, payload: v });
              const s = spec.get(t);
              if (!s?.insert) return Array.isArray(v) ? v : [v];
              return s.insert(v);
            },
          };
        },
      };
    },
    update(t: unknown) {
      return {
        set(v: Record<string, unknown>) {
          return {
            async where(_: unknown) {
              calls.push({ op: "update", table: t, payload: v });
              const s = spec.get(t);
              s?.update?.(v);
            },
          };
        },
      };
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      calls.push({ op: "transaction", table: null });
      return fn();
    },
    execute: async () => undefined,
  };
  return { db: fake, calls };
}

async function withFakeDb<T>(
  spec: Map<unknown, FakeTableSpec>,
  writeFlag: boolean,
  fn: (calls: Array<{ op: string; table: unknown; payload?: unknown }>) => Promise<T>,
): Promise<T> {
  const dbMod = await import("../../server/db");
  const flags = await import("../../server/lib/featureFlags");
  // ESM exports are read-only bindings — we can't reassign `db` itself,
  // but we CAN mutate its methods. Snapshot and restore each method.
  const dbObj = dbMod.db as unknown as Record<string, unknown>;
  const savedMethods: Record<string, unknown> = {};
  for (const k of ["select", "insert", "update", "transaction", "execute"]) {
    savedMethods[k] = dbObj[k];
  }
  const originalFlag = flags.featureFlags.plexusIdentityWrite;
  const { db: fake, calls } = buildFakeDb(spec);
  for (const k of Object.keys(savedMethods)) {
    dbObj[k] = (fake as unknown as Record<string, unknown>)[k];
  }
  (flags.featureFlags as unknown as { plexusIdentityWrite: boolean }).plexusIdentityWrite = writeFlag;
  try {
    return await fn(calls);
  } finally {
    for (const [k, v] of Object.entries(savedMethods)) {
      dbObj[k] = v;
    }
    (flags.featureFlags as unknown as { plexusIdentityWrite: boolean }).plexusIdentityWrite = originalFlag;
  }
}

// (H1) Behavioral — successful orchestration commits GP + membership + both FKs.
async function testBehavioralSuccessfulOrchestration() {
  const schema = await import("../../shared/schema/plexusIdentity");
  const screening = await import("../../shared/schema/screening");

  // Simulate a fresh empty registry. resolveIdentity → no_match →
  // commitResolution creates GP + membership + updates screening.
  const spec = new Map<unknown, FakeTableSpec>();
  const insertedGlobals: Record<string, unknown>[] = [];
  const insertedMemberships: Record<string, unknown>[] = [];
  const updatedScreenings: Record<string, unknown>[] = [];

  spec.set(schema.globalPlexusPatients, {
    select: () => [],
    insert: (v) => {
      const row = Array.isArray(v) ? v[0] : v;
      const withId = { ...row, id: 111 } as Record<string, unknown>;
      insertedGlobals.push(withId);
      return [withId];
    },
  });
  spec.set(schema.patientClinicMemberships, {
    select: () => [],
    insert: (v) => {
      const row = Array.isArray(v) ? v[0] : v;
      const withId = { ...row, id: 222 } as Record<string, unknown>;
      insertedMemberships.push(withId);
      return [withId];
    },
  });
  spec.set(schema.patientExternalIdentifiers, { select: () => [] });
  spec.set(schema.plexusIdAliases, { select: () => [] });
  spec.set(screening.patientScreenings, {
    update: (v) => { updatedScreenings.push(v); },
  });

  const orchestration = await import("../../server/services/plexusIdentity/screeningIntegration");
  const r = await withFakeDb(spec, true, async () => {
    return orchestration.resolveAndLinkPlexusIdentityForScreening({
      screeningId: 999,
      clinicId: 42,
      sourceSystem: "test",
      demographics: { displayName: "Grace Hopper", dob: "1906-12-09" },
    });
  });

  assert.equal(r.status, "linked", "status must be linked");
  if (r.status !== "linked") throw new Error("unreachable");
  assert.equal(r.globalPlexusPatientId, 111);
  assert.equal(r.patientClinicMembershipId, 222);
  assert.equal(r.isNewGlobal, true);
  assert.equal(r.isNewMembership, true);
  assert.equal(insertedGlobals.length, 1, "one global patient inserted");
  assert.equal(insertedMemberships.length, 1, "one membership inserted");
  assert.equal(updatedScreenings.length, 1, "screening updated exactly once");
  const upd = updatedScreenings[0];
  assert.equal(upd.patientClinicMembershipId, 222, "FK 1 set");
  assert.equal(upd.globalPlexusPatientId, 111, "FK 2 set");
}

// (H2) Behavioral — existing GP + membership are reused via clinic-MRN match.
async function testBehavioralReusesExistingGpAndMembership() {
  const schema = await import("../../shared/schema/plexusIdentity");
  const screening = await import("../../shared/schema/screening");

  const spec = new Map<unknown, FakeTableSpec>();
  const insertedGlobals: unknown[] = [];
  const insertedMemberships: unknown[] = [];
  const updatedScreenings: Record<string, unknown>[] = [];

  spec.set(schema.globalPlexusPatients, {
    // findGlobalPatientById(500) → return the existing GP.
    // This select is called both from the resolver AND from ensureMembership.
    select: () => [{ id: 500, plexusId: "PLX-EXISTING-XXXXXXXXXXXXXXXXXXXXXXXXXXXX" }],
    insert: (v) => { insertedGlobals.push(v); return [v as Record<string, unknown>]; },
  });
  spec.set(schema.patientClinicMemberships, {
    // findMembershipByClinicMrn → existing membership (definitive_match).
    // Then ensureMembership.findActiveMembership → same membership.
    select: () => [{ id: 777, globalPlexusPatientId: 500, clinicId: 42, membershipStatus: "active" }],
    insert: (v) => { insertedMemberships.push(v); return [v as Record<string, unknown>]; },
  });
  spec.set(schema.patientExternalIdentifiers, { select: () => [] });
  spec.set(schema.plexusIdAliases, { select: () => [] });
  spec.set(screening.patientScreenings, {
    update: (v) => { updatedScreenings.push(v); },
  });

  const orchestration = await import("../../server/services/plexusIdentity/screeningIntegration");
  const r = await withFakeDb(spec, true, async () => {
    return orchestration.resolveAndLinkPlexusIdentityForScreening({
      screeningId: 999,
      clinicId: 42,
      sourceSystem: "test",
      // Provide a clinic MRN so the resolver hits the definitive_match
      // branch (clinic_mrn) and reuses the existing GP + membership
      // instead of creating a new pair.
      clinicMrn: "MRN-EXISTING-001",
      demographics: { displayName: "X", dob: "1990-01-01" },
    });
  });

  assert.equal(r.status, "linked", `expected linked, got ${r.status}`);
  if (r.status !== "linked") throw new Error("unreachable");
  assert.equal(insertedGlobals.length, 0, "must NOT insert a new global patient");
  assert.equal(insertedMemberships.length, 0, "must NOT insert a duplicate membership");
  assert.equal(r.globalPlexusPatientId, 500, "must reuse existing GP");
  assert.equal(r.patientClinicMembershipId, 777, "must reuse existing membership");
  assert.equal(r.isNewGlobal, false);
  assert.equal(r.isNewMembership, false);
  assert.equal(updatedScreenings.length, 1, "screening FKs still updated");
}

// (H3) Behavioral — ambiguous match: provisional identity + candidate + safe link.
async function testBehavioralAmbiguousCreatesCandidateAndLinks() {
  const schema = await import("../../shared/schema/plexusIdentity");
  const screening = await import("../../shared/schema/screening");

  // Setup: findExternalIdentifiersByMatchValue returns hits pointing
  // at existing global id=888 → possible_match. commitResolution then
  // creates a new global + membership + candidate row.
  const spec = new Map<unknown, FakeTableSpec>();
  let selectCount = 0;
  spec.set(schema.globalPlexusPatients, {
    select: () => {
      selectCount++;
      // 1st call: findGlobalPatientByPlexusId(priorPlexusId=null) → skipped by caller
      // 2nd+: findGlobalPatientById(888) for the possible-match candidate lookup
      // Final: also serves the new-global INSERT path
      if (selectCount === 1) return [{ id: 888, plexusId: "PLX-EXISTING-YYYYYYYYYYYYYYYYYYYYYYYYYYYY" }];
      return [];
    },
    insert: (v) => { const row = Array.isArray(v) ? v[0] : v; return [{ ...row, id: 999 }]; },
  });
  spec.set(schema.patientClinicMemberships, {
    select: () => [],
    insert: (v) => { const row = Array.isArray(v) ? v[0] : v; return [{ ...row, id: 1001 }]; },
  });
  spec.set(schema.patientExternalIdentifiers, {
    select: () => [{ globalPlexusPatientId: 888 }],
  });
  spec.set(schema.plexusIdAliases, { select: () => [] });
  const candidateInserts: unknown[] = [];
  spec.set(schema.patientIdentityMatchCandidates, {
    insert: (v) => {
      const row = Array.isArray(v) ? v[0] : v;
      const withId = { ...row, id: 2002 };
      candidateInserts.push(withId);
      return [withId];
    },
  });
  const updated: Record<string, unknown>[] = [];
  spec.set(screening.patientScreenings, { update: (v) => { updated.push(v); } });

  const orchestration = await import("../../server/services/plexusIdentity/screeningIntegration");
  const r = await withFakeDb(spec, true, async () => {
    return orchestration.resolveAndLinkPlexusIdentityForScreening({
      screeningId: 4242,
      clinicId: 7,
      sourceSystem: "test",
      demographics: {
        displayName: "Ada",
        dob: "1815-12-10",
        phone: "555-1234567890",
      },
    });
  });

  assert.equal(r.status, "linked");
  if (r.status !== "linked") throw new Error("unreachable");
  // Ambiguous match must NOT auto-merge — the new global is 999.
  assert.equal(r.globalPlexusPatientId, 999, "must create a NEW global patient for the incoming screening");
  assert.equal(r.patientClinicMembershipId, 1001, "must create a NEW membership");
  assert.ok(candidateInserts.length >= 1, "must enqueue at least one match candidate for Plexus review");
  assert.ok(r.queuedCandidateIds.includes(2002), "candidate id must be reported to the caller");
  assert.equal(updated.length, 1, "screening still gets both FKs — clinic workflow unblocked");
}

// (H4) Behavioral — orchestrator commit failure does NOT falsely report success.
async function testBehavioralCommitFailureNoFalseSuccess() {
  const schema = await import("../../shared/schema/plexusIdentity");
  const spec = new Map<unknown, FakeTableSpec>();
  spec.set(schema.globalPlexusPatients, {
    select: () => [],
    insert: () => { const e = new Error("simulated postgres failure"); (e as { code?: string }).code = "40001"; throw e; },
  });
  spec.set(schema.patientClinicMemberships, { select: () => [] });
  spec.set(schema.patientExternalIdentifiers, { select: () => [] });
  spec.set(schema.plexusIdAliases, { select: () => [] });

  const orchestration = await import("../../server/services/plexusIdentity/screeningIntegration");
  await withFakeDb(spec, true, async () => {
    await assert.rejects(
      () => orchestration.resolveAndLinkPlexusIdentityForScreening({
        screeningId: 1,
        clinicId: 1,
        sourceSystem: "test",
        demographics: { displayName: "X" },
      }),
      /simulated postgres failure/,
      "orchestrator MUST propagate the failure — never return { status: 'linked' } on error",
    );
  });
}

// (H5) Behavioral — a route-level failure produces a durable retry record.
async function testBehavioralRouteFailureCreatesLedgerRow() {
  const schema = await import("../../shared/schema/plexusIdentity");
  const spec = new Map<unknown, FakeTableSpec>();
  const ledgerInserts: Record<string, unknown>[] = [];
  spec.set(schema.plexusIdentityLinkFailures, {
    select: () => [],
    insert: (v) => {
      const row = Array.isArray(v) ? v[0] : v;
      const withId = { ...row, id: 42 };
      ledgerInserts.push(withId);
      return [withId];
    },
  });

  const orchestration = await import("../../server/services/plexusIdentity/screeningIntegration");
  await withFakeDb(spec, true, async () => {
    await orchestration.recordScreeningIdentityLinkFailure({
      screeningId: 500,
      clinicId: 10,
      sourceSystem: "batch_add_patient",
      errorCode: "PLEXUS_IDENTITY_MIGRATION_MISSING",
    });
  });

  assert.equal(ledgerInserts.length, 1, "must insert exactly one ledger row");
  const row = ledgerInserts[0];
  assert.equal(row.patientScreeningId, 500);
  assert.equal(row.clinicId, 10);
  assert.equal(row.sourceSystem, "batch_add_patient");
  assert.equal(row.errorCode, "PLEXUS_IDENTITY_MIGRATION_MISSING");
  // No PHI fields.
  for (const k of ["name", "dob", "phone", "email", "mrn", "insurance"]) {
    assert.equal(k in row, false, `ledger row must not contain ${k}`);
  }
}

// (H6) Behavioral — reconciliation repairs an unlinked screening idempotently.
async function testBehavioralReconciliationRepairsUnlinked() {
  const schema = await import("../../shared/schema/plexusIdentity");
  const screening = await import("../../shared/schema/screening");

  const spec = new Map<unknown, FakeTableSpec>();
  let scrCall = 0;
  spec.set(screening.patientScreenings, {
    // First select from reconciliation: read the screening row.
    // Both FK columns null → Case C (full resolve + link).
    select: () => {
      scrCall++;
      if (scrCall === 1) return [{
        id: 777, clinicId: 8, name: "X", dob: "1970-01-01",
        phone: null, email: null,
        patientClinicMembershipId: null, globalPlexusPatientId: null,
      }];
      return [];
    },
    update: () => undefined,
  });
  spec.set(schema.globalPlexusPatients, {
    select: () => [],
    insert: (v) => { const row = Array.isArray(v) ? v[0] : v; return [{ ...row, id: 3001 }]; },
  });
  spec.set(schema.patientClinicMemberships, {
    select: () => [],
    insert: (v) => { const row = Array.isArray(v) ? v[0] : v; return [{ ...row, id: 4001 }]; },
  });
  spec.set(schema.patientExternalIdentifiers, { select: () => [] });
  spec.set(schema.plexusIdAliases, { select: () => [] });
  spec.set(schema.plexusIdentityLinkFailures, {
    select: () => [],
    insert: (v) => [v as Record<string, unknown>],
    update: () => undefined,
  });

  const reco = await import("../../server/services/plexusIdentity/reconciliation");
  const r = await withFakeDb(spec, true, async () => {
    return reco.reconcilePlexusIdentityForScreening(777, 8);
  });
  assert.equal(r.status, "linked", `expected linked, got ${r.status}`);
  if (r.status !== "linked") throw new Error("unreachable");
  assert.equal(r.patientClinicMembershipId, 4001);
  assert.equal(r.globalPlexusPatientId, 3001);
}

// (H7) Behavioral — reconciliation refuses conflicting partial linkage.
async function testBehavioralReconciliationRefusesConflict() {
  const schema = await import("../../shared/schema/plexusIdentity");
  const screening = await import("../../shared/schema/screening");

  const spec = new Map<unknown, FakeTableSpec>();
  spec.set(screening.patientScreenings, {
    // Screening has membership FK set (999) but global FK is null →
    // one-only partial state → conflict.
    select: () => [{
      id: 55, clinicId: 8, name: "X", dob: null,
      phone: null, email: null,
      patientClinicMembershipId: 999, globalPlexusPatientId: null,
    }],
  });
  // findActiveMembership called with globalPlexusPatientId=0 (hasGlobal=false).
  spec.set(schema.patientClinicMemberships, { select: () => [] });

  const reco = await import("../../server/services/plexusIdentity/reconciliation");
  const r = await withFakeDb(spec, true, async () => {
    return reco.reconcilePlexusIdentityForScreening(55, 8);
  });
  assert.equal(r.status, "conflict", `expected conflict, got ${r.status}`);
  if (r.status !== "conflict") throw new Error("unreachable");
  assert.ok(
    r.reason === "membership_belongs_to_different_clinic" ||
      r.reason === "global_patient_missing_from_registry",
    `unexpected conflict reason: ${r.reason}`,
  );
}

// (H8) Reconciliation returns the idempotent already_linked status when both FKs are consistent.
async function testBehavioralReconciliationIdempotent() {
  const schema = await import("../../shared/schema/plexusIdentity");
  const screening = await import("../../shared/schema/screening");

  const spec = new Map<unknown, FakeTableSpec>();
  spec.set(screening.patientScreenings, {
    select: () => [{
      id: 100, clinicId: 3, name: "X", dob: null,
      phone: null, email: null,
      patientClinicMembershipId: 5, globalPlexusPatientId: 6,
    }],
  });
  spec.set(schema.patientClinicMemberships, {
    // findActiveMembership must return the same id (5) so the
    // consistency check passes.
    select: () => [{ id: 5, globalPlexusPatientId: 6, clinicId: 3, membershipStatus: "active" }],
  });
  spec.set(schema.globalPlexusPatients, {
    // findGlobalPatientById(6) → return a row so the check succeeds.
    select: () => [{ id: 6, plexusId: "PLX-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" }],
  });
  spec.set(schema.plexusIdentityLinkFailures, {
    select: () => [],
    update: () => undefined,
  });

  const reco = await import("../../server/services/plexusIdentity/reconciliation");
  const r = await withFakeDb(spec, true, async () => {
    return reco.reconcilePlexusIdentityForScreening(100, 3);
  });
  assert.equal(r.status, "already_linked_consistent", `expected already_linked_consistent, got ${r.status}`);
}

// (H9) Migration contains real FK constraints with ON DELETE SET NULL.
async function testMigrationHasRealFkConstraints() {
  const sqlText = readFileSync(join(REPO_ROOT, "migrations/0049_add_plexus_identity.sql"), "utf8");
  // fk_ps_pcm: patient_clinic_membership_id → patient_clinic_memberships(id) ON DELETE SET NULL NOT VALID
  const pcmRe = /CONSTRAINT\s+fk_ps_pcm[\s\S]*?FOREIGN KEY\s*\(\s*patient_clinic_membership_id\s*\)[\s\S]*?REFERENCES\s+patient_clinic_memberships\s*\(\s*id\s*\)[\s\S]*?ON DELETE SET NULL[\s\S]*?NOT VALID/i;
  const gppRe = /CONSTRAINT\s+fk_ps_gpp[\s\S]*?FOREIGN KEY\s*\(\s*global_plexus_patient_id\s*\)[\s\S]*?REFERENCES\s+global_plexus_patients\s*\(\s*id\s*\)[\s\S]*?ON DELETE SET NULL[\s\S]*?NOT VALID/i;
  assert.ok(pcmRe.test(sqlText), "fk_ps_pcm constraint with ON DELETE SET NULL NOT VALID must be present");
  assert.ok(gppRe.test(sqlText), "fk_ps_gpp constraint with ON DELETE SET NULL NOT VALID must be present");
  // And no VALIDATE CONSTRAINT executed in this migration.
  assert.equal(
    /^[^-]*VALIDATE\s+CONSTRAINT/im.test(sqlText.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")),
    false,
    "migration must NOT VALIDATE CONSTRAINT — that is a deployment-time follow-up",
  );
}

// (H10) Migration adds the durable retry ledger table.
async function testMigrationHasRetryLedgerTable() {
  const sqlText = readFileSync(join(REPO_ROOT, "migrations/0049_add_plexus_identity.sql"), "utf8");
  assert.ok(/CREATE TABLE IF NOT EXISTS plexus_identity_link_failures/.test(sqlText));
  assert.ok(/uq_pilf_unresolved_per_screening/.test(sqlText), "partial-unique index on unresolved failures must exist");
}

// (H11) Architecture discovery — every file that inserts patient_screenings
// (except allow-listed) must import the shared orchestrator.
async function testDiscoveryEveryInserterUsesOrchestrator() {
  // Walk server/routes and server/services + server/repositories for any
  // file containing `db.insert(patientScreenings` or `storage.createPatientScreening`.
  const { readdirSync, statSync } = await import("node:fs");
  const roots = ["server/routes", "server/services", "server/repositories"].map((r) => join(REPO_ROOT, r));
  const files: string[] = [];
  const walk = (p: string) => {
    for (const entry of readdirSync(p)) {
      const abs = join(p, entry);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (abs.endsWith(".ts")) files.push(abs);
    }
  };
  for (const r of roots) walk(r);

  const INSERTS = /db\.insert\s*\(\s*patientScreenings\b|storage\.createPatientScreening\b|screeningRepository\.createScreening\b/;
  const ORCHESTRATOR = /resolveAndLinkPlexusIdentityForScreening(?:sBulk)?\b/;

  // Allow-list of files that MAY insert without calling the orchestrator.
  const ALLOW = new Set<string>([
    // Canonical repo insert — the orchestrator is called by the route layer,
    // not the repo. Also the service-layer helper called only from the
    // patient-directory route (which itself calls the orchestrator).
    join(REPO_ROOT, "server/repositories/screening.repo.ts"),
    join(REPO_ROOT, "server/storage.ts"),
    join(REPO_ROOT, "server/services/patientDirectory/patientDirectoryWriter.ts"),
    // Admin test fixture — synthetic isTest=true patients. Explicitly excluded.
    join(REPO_ROOT, "server/routes/testFixture.ts"),
  ]);

  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (INSERTS.test(src) && !ORCHESTRATOR.test(src) && !ALLOW.has(f)) {
      offenders.push(f.slice(REPO_ROOT.length + 1));
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      "The following files insert patient_screenings without calling the shared orchestrator:\n  - " +
        offenders.join("\n  - ") +
        "\nEither wire resolveAndLinkPlexusIdentityForScreening[Bulk] or add the file to the ALLOW list with justification.",
    );
  }
}

// (H12) The failure-ledger row shape excludes every PHI field name.
async function testLedgerSchemaNoPhi() {
  const { plexusIdentityLinkFailures } = await import("../../shared/schema/plexusIdentity");
  const cols = Object.keys(plexusIdentityLinkFailures);
  const forbidden = ["name", "displayName", "dob", "phone", "email", "mrn", "insurance", "diagnosis", "medication"];
  for (const p of forbidden) {
    assert.equal(cols.includes(p), false, `ledger MUST NOT include column: ${p}`);
  }
  // Required non-PHI operational fields.
  for (const need of ["patientScreeningId", "clinicId", "sourceSystem", "errorCode", "attemptCount", "firstFailedAt", "lastAttemptedAt", "resolvedAt"]) {
    assert.ok(cols.includes(need), `ledger MUST include: ${need}`);
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
  // ── Hardening — behavioral, discovery, FK ───────────────────────
  ["(H1) behavioral: successful orchestration commits GP+membership+both FKs", testBehavioralSuccessfulOrchestration],
  ["(H2) behavioral: existing GP + membership reused", testBehavioralReusesExistingGpAndMembership],
  ["(H3) behavioral: ambiguous match → provisional + candidate + linked", testBehavioralAmbiguousCreatesCandidateAndLinks],
  ["(H4) behavioral: commit failure does NOT produce false success", testBehavioralCommitFailureNoFalseSuccess],
  ["(H5) behavioral: route failure creates durable ledger row (no PHI)", testBehavioralRouteFailureCreatesLedgerRow],
  ["(H6) behavioral: reconciliation repairs unlinked screening", testBehavioralReconciliationRepairsUnlinked],
  ["(H7) behavioral: reconciliation refuses conflicting partial linkage", testBehavioralReconciliationRefusesConflict],
  ["(H8) behavioral: reconciliation idempotent when already-linked", testBehavioralReconciliationIdempotent],
  ["(H9) migration has real FK constraints (NOT VALID + ON DELETE SET NULL)", testMigrationHasRealFkConstraints],
  ["(H10) migration adds durable retry ledger table", testMigrationHasRetryLedgerTable],
  ["(H11) discovery: every screening-inserter uses the shared orchestrator", testDiscoveryEveryInserterUsesOrchestrator],
  ["(H12) ledger schema excludes PHI fields", testLedgerSchemaNoPhi],
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
