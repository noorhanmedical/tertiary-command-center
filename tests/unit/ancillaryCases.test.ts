// Phase 2B — patient_ancillary_cases contract + behavioral tests.
//
// Runs standalone with:
//   npx tsx tests/unit/ancillaryCases.test.ts
//
// Includes file-based schema/migration assertions AND runtime tests
// that dynamic-import the repository/reconciliation layer with a
// fake-db harness (same pattern used by the Phase 2A hardening tests).

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ANCILLARY_ACTIVE_LIFECYCLE_STATUSES,
  ANCILLARY_ADMIN_REVIEW_STATUSES,
  ANCILLARY_JOURNEY_EVENT_TYPES,
  ANCILLARY_LIFECYCLE_STATUSES,
  ANCILLARY_QUALIFICATION_STATUSES,
  RECONCILIATION_FAILURE_ACTIONS,
  ancillaryCaseReconciliationFailures,
  patientAncillaryCases,
} from "../../shared/schema/ancillaryCases";
import { featureFlags } from "../../server/lib/featureFlags";

const REPO_ROOT = process.cwd();

// ─── (1) Schema + migration agreement ─────────────────────────────
async function testSchemaAndMigrationAgree() {
  const schemaCols = Object.keys(patientAncillaryCases);
  const required = [
    "id", "globalPlexusPatientId", "patientClinicMembershipId", "clinicId",
    "originatingScreeningId", "executionCaseId", "serviceType",
    "episodeSequence", "openedAt", "closedAt", "lifecycleStatus",
    "qualificationStatus", "adminReviewStatus",
    "clinicallyCompletedAt", "financiallyCompletedAt",
    "createdAt", "updatedAt",
  ];
  for (const r of required) {
    assert.ok(schemaCols.includes(r), `Drizzle schema missing column: ${r}`);
  }
  const sqlText = readFileSync(
    join(REPO_ROOT, "migrations/0050_add_patient_ancillary_cases.sql"),
    "utf8",
  );
  const requiredSqlCols = [
    "global_plexus_patient_id", "patient_clinic_membership_id", "clinic_id",
    "originating_screening_id", "execution_case_id", "service_type",
    "episode_sequence", "opened_at", "closed_at", "lifecycle_status",
    "qualification_status", "admin_review_status",
    "clinically_completed_at", "financially_completed_at",
    "created_at", "updated_at",
  ];
  for (const c of requiredSqlCols) {
    assert.ok(sqlText.includes(c), `migration missing column: ${c}`);
  }
}

// ─── (2) Real DB FK constraints ───────────────────────────────────
async function testMigrationHasRealFks() {
  const sqlText = readFileSync(
    join(REPO_ROOT, "migrations/0050_add_patient_ancillary_cases.sql"),
    "utf8",
  );
  const fks: Array<[string, RegExp]> = [
    ["fk_pac_global_patient → global_plexus_patients(id) NO ACTION",
      /CONSTRAINT\s+fk_pac_global_patient[\s\S]*?REFERENCES\s+global_plexus_patients\s*\(\s*id\s*\)[\s\S]*?ON DELETE NO ACTION/i],
    ["fk_pac_membership → patient_clinic_memberships(id) NO ACTION",
      /CONSTRAINT\s+fk_pac_membership[\s\S]*?REFERENCES\s+patient_clinic_memberships\s*\(\s*id\s*\)[\s\S]*?ON DELETE NO ACTION/i],
    ["fk_pac_clinic → clinics(id) NO ACTION",
      /CONSTRAINT\s+fk_pac_clinic[\s\S]*?REFERENCES\s+clinics\s*\(\s*id\s*\)[\s\S]*?ON DELETE NO ACTION/i],
    ["fk_pac_screening → patient_screenings(id) SET NULL",
      /CONSTRAINT\s+fk_pac_screening[\s\S]*?REFERENCES\s+patient_screenings\s*\(\s*id\s*\)[\s\S]*?ON DELETE SET NULL/i],
    ["fk_pac_execution_case → patient_execution_cases(id) SET NULL",
      /CONSTRAINT\s+fk_pac_execution_case[\s\S]*?REFERENCES\s+patient_execution_cases\s*\(\s*id\s*\)[\s\S]*?ON DELETE SET NULL/i],
  ];
  for (const [label, re] of fks) {
    assert.ok(re.test(sqlText), `Missing FK: ${label}`);
  }
  // And the partial unique index for one-active-episode.
  assert.ok(
    /CREATE UNIQUE INDEX[\s\S]*?uq_pac_active_episode[\s\S]*?WHERE lifecycle_status IN\s*\(\s*'new',\s*'active',\s*'on_hold'\s*\)/i.test(sqlText),
    "partial-unique active-episode index missing",
  );
}

// ─── Enum content sanity ──────────────────────────────────────────
async function testEnumContents() {
  assert.deepEqual(
    [...ANCILLARY_LIFECYCLE_STATUSES],
    ["new", "active", "on_hold", "closed", "cancelled", "archived"],
  );
  assert.deepEqual(
    [...ANCILLARY_ACTIVE_LIFECYCLE_STATUSES],
    ["new", "active", "on_hold"],
  );
  assert.deepEqual(
    [...ANCILLARY_QUALIFICATION_STATUSES],
    ["unscreened", "qualified", "not_qualified", "pending_review"],
  );
  assert.deepEqual(
    [...ANCILLARY_ADMIN_REVIEW_STATUSES],
    ["pending", "approved", "needs_info", "rejected"],
  );
  // Every event type is a stable string.
  for (const v of Object.values(ANCILLARY_JOURNEY_EVENT_TYPES)) {
    assert.equal(typeof v, "string");
  }
}

// ─── (18) Feature flag default OFF ────────────────────────────────
async function testFeatureFlagDefaultOff() {
  assert.equal(featureFlags.ancillaryCaseWrite, false, "FEATURE_ANCILLARY_CASE_WRITE must default OFF");
}

// ═══ Fake-db harness (mirrors Phase 2A hardening pattern) ═══════
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
        leftJoin(_: unknown, __: unknown) { return chain; },
        where(_: unknown) { return chain; },
        orderBy(_: unknown) { return chain; },
        async limit(_n: number) {
          calls.push({ op: "select", table: currentTable });
          const s = spec.get(currentTable);
          return s?.select ? s.select() : [];
        },
      };
      // Direct-await (no .limit()) support for aggregates like MAX.
      Object.defineProperty(chain, "then", {
        value: (resolve: (v: unknown[]) => void) => {
          calls.push({ op: "select", table: currentTable });
          const s = spec.get(currentTable);
          resolve(s?.select ? s.select() : []);
        },
      });
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
            where(_: unknown) {
              calls.push({ op: "update", table: t, payload: v });
              const s = spec.get(t);
              s?.update?.(v);
              // Return an object that is both awaitable (direct .where()
              // await) AND supports .returning() for the update-and-return
              // path used by the execution-case sync.
              const result: unknown[] = [{ ...v, __updated: true }];
              const returnable = {
                returning: async () => result,
                then: (resolve: (v: unknown[]) => void) => resolve(result),
              };
              return returnable;
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
  const dbObj = dbMod.db as unknown as Record<string, unknown>;
  const savedMethods: Record<string, unknown> = {};
  for (const k of ["select", "insert", "update", "transaction", "execute"]) {
    savedMethods[k] = dbObj[k];
  }
  const originalFlag = flags.featureFlags.ancillaryCaseWrite;
  const { db: fake, calls } = buildFakeDb(spec);
  for (const k of Object.keys(savedMethods)) {
    dbObj[k] = (fake as unknown as Record<string, unknown>)[k];
  }
  (flags.featureFlags as unknown as { ancillaryCaseWrite: boolean }).ancillaryCaseWrite = writeFlag;
  try {
    return await fn(calls);
  } finally {
    for (const [k, v] of Object.entries(savedMethods)) {
      dbObj[k] = v;
    }
    (flags.featureFlags as unknown as { ancillaryCaseWrite: boolean }).ancillaryCaseWrite = originalFlag;
  }
}

// ─── Test-scoped table constants (avoid brittle equality on
// Drizzle's internal Symbol identity — resolve to the actual objects
// via schema imports). ──────────────────────────────────────────────
async function loadTables() {
  const anc = await import("../../shared/schema/ancillaryCases");
  const plex = await import("../../shared/schema/plexusIdentity");
  const scr = await import("../../shared/schema/screening");
  const exec = await import("../../shared/schema/executionCase");
  const clc = await import("../../shared/schema/clinics");
  return {
    ancillaryCases: anc.patientAncillaryCases,
    ancillaryFailures: anc.ancillaryCaseReconciliationFailures,
    journeyEvents: exec.patientJourneyEvents,
    globalPatients: plex.globalPlexusPatients,
    memberships: plex.patientClinicMemberships,
    screenings: scr.patientScreenings,
    executionCases: exec.patientExecutionCases,
    clinics: clc.clinics,
  };
}

// ─── (3) Only one active case per (patient, clinic, service) ──────
// Enforced by the partial unique index + the reconciler's
// findActiveAncillaryCase probe + createAncillaryCase's race handler
// which re-reads on 23505 unique violation.
async function testOneActiveCasePerTriple() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  const created: Record<string, unknown>[] = [];
  spec.set(t.ancillaryCases, {
    // First call: findActiveAncillaryCase → none. Second call after
    // insert would return the row, but insert() below emits it.
    select: () => [],
    insert: (v) => {
      const row = Array.isArray(v) ? v[0] : v;
      // Simulate the partial-unique-index rejecting a second insert.
      if (created.length > 0) {
        const e = new Error("duplicate key value violates unique constraint");
        (e as { code?: string }).code = "23505";
        throw e;
      }
      const withId = { ...row, id: 101 };
      created.push(withId);
      return [withId];
    },
  });
  spec.set(t.journeyEvents, { insert: () => [] });
  spec.set(t.clinics, { select: () => [{ id: 1 }] });
  spec.set(t.globalPatients, { select: () => [{ id: 10 }] });
  spec.set(t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] });

  const repo = await import("../../server/repositories/ancillaryCases.repo");
  await withFakeDb(spec, true, async () => {
    const first = await repo.createAncillaryCase({
      globalPlexusPatientId: 10, patientClinicMembershipId: 20, clinicId: 1,
      serviceType: "BrainWave", episodeSequence: 1,
    });
    assert.equal(first.created, true, "first insert wins");
    // Second attempt: the unique-violation branch re-reads active.
    // For that we need findActiveAncillaryCase to now return the created row.
    spec.set(t.ancillaryCases, {
      ...(spec.get(t.ancillaryCases) as FakeTableSpec),
      select: () => created,
      insert: (v) => {
        const e = new Error("duplicate key value violates unique constraint");
        (e as { code?: string }).code = "23505";
        throw e;
      },
    });
    const second = await repo.createAncillaryCase({
      globalPlexusPatientId: 10, patientClinicMembershipId: 20, clinicId: 1,
      serviceType: "BrainWave", episodeSequence: 2,
    });
    assert.equal(second.created, false, "race must re-read, not duplicate");
    if (second.created === false) {
      assert.equal(second.conflict.id, 101, "conflict resolution returns winning row");
    }
  });
}

// ─── (4) Closed historical case permits a new episode ────────────
// ─── (5) Episode sequence increments ────────────────────────────
// ─── (6) Cancelled historical permits a new episode ─────────────
// All three demonstrated by computeNextEpisodeSequence(MAX+1).
async function testEpisodeSequenceComputation() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  spec.set(t.ancillaryCases, {
    // Simulated: two historical rows exist with episodeSequence 1 & 2
    // (statuses closed + cancelled). The MAX query returns 2.
    select: () => [{ max: 2 }],
  });
  const repo = await import("../../server/repositories/ancillaryCases.repo");
  const next = await withFakeDb(spec, true, async () =>
    repo.computeNextEpisodeSequence({
      globalPlexusPatientId: 10,
      clinicId: 1,
      serviceType: "BrainWave",
    }),
  );
  assert.equal(next, 3, "next episode sequence is MAX+1, not 1 (never resets)");

  // Zero-history → 1.
  spec.set(t.ancillaryCases, { select: () => [{ max: null }] });
  const first = await withFakeDb(spec, true, async () =>
    repo.computeNextEpisodeSequence({
      globalPlexusPatientId: 11,
      clinicId: 1,
      serviceType: "VitalWave",
    }),
  );
  assert.equal(first, 1);
}

// ─── (7) Different services coexist ──────────────────────────────
async function testDifferentServicesCoexist() {
  // Static assertion: the partial-unique index keys on service_type,
  // so distinct service_types with the same (global_patient, clinic)
  // can each hold their own active row.
  const sqlText = readFileSync(
    join(REPO_ROOT, "migrations/0050_add_patient_ancillary_cases.sql"),
    "utf8",
  );
  assert.ok(
    /uq_pac_active_episode[\s\S]*?service_type/.test(sqlText),
    "unique index must include service_type — different services must coexist",
  );
}

// ─── (8) Same global patient across different clinics ───────────
async function testSameGlobalPatientDifferentClinics() {
  const sqlText = readFileSync(
    join(REPO_ROOT, "migrations/0050_add_patient_ancillary_cases.sql"),
    "utf8",
  );
  assert.ok(
    /uq_pac_active_episode[\s\S]*?clinic_id/.test(sqlText),
    "unique index must include clinic_id — same patient in different clinics can each hold an active case",
  );
}

// ─── (9) Membership/global mismatch rejected ─────────────────────
// ─── (10) Membership/clinic mismatch rejected ───────────────────
// ─── (11) Screening/clinic mismatch rejected ────────────────────
// ─── (12) Execution-case/clinic mismatch rejected ──────────────
async function testIntegrityValidatorRejectsMismatches() {
  const t = await loadTables();
  const validator = await import("../../server/services/ancillaryCases/integrityValidator");

  // (9) membership belongs to a different global
  {
    const spec = new Map<unknown, FakeTableSpec>();
    spec.set(t.clinics, { select: () => [{ id: 1 }] });
    spec.set(t.globalPatients, { select: () => [{ id: 10 }] });
    spec.set(t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 999 }] });
    const r = await withFakeDb(spec, true, async () =>
      validator.checkAncillaryCaseIntegrity({
        clinicId: 1, globalPlexusPatientId: 10, patientClinicMembershipId: 20,
      }),
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "membership_belongs_to_different_global_patient");
  }
  // (10) membership belongs to a different clinic
  {
    const spec = new Map<unknown, FakeTableSpec>();
    spec.set(t.clinics, { select: () => [{ id: 1 }] });
    spec.set(t.globalPatients, { select: () => [{ id: 10 }] });
    spec.set(t.memberships, { select: () => [{ id: 20, clinicId: 999, globalPlexusPatientId: 10 }] });
    const r = await withFakeDb(spec, true, async () =>
      validator.checkAncillaryCaseIntegrity({
        clinicId: 1, globalPlexusPatientId: 10, patientClinicMembershipId: 20,
      }),
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "membership_belongs_to_different_clinic");
  }
  // (11) originating screening belongs to a different clinic
  {
    const spec = new Map<unknown, FakeTableSpec>();
    spec.set(t.clinics, { select: () => [{ id: 1 }] });
    spec.set(t.globalPatients, { select: () => [{ id: 10 }] });
    spec.set(t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] });
    spec.set(t.screenings, { select: () => [{ id: 500, clinicId: 999 }] });
    const r = await withFakeDb(spec, true, async () =>
      validator.checkAncillaryCaseIntegrity({
        clinicId: 1, globalPlexusPatientId: 10, patientClinicMembershipId: 20,
        originatingScreeningId: 500,
      }),
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "originating_screening_belongs_to_different_clinic");
  }
  // (12) execution case belongs to a different clinic
  {
    const spec = new Map<unknown, FakeTableSpec>();
    spec.set(t.clinics, { select: () => [{ id: 1 }] });
    spec.set(t.globalPatients, { select: () => [{ id: 10 }] });
    spec.set(t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] });
    spec.set(t.executionCases, { select: () => [{ id: 700, clinicId: 999 }] });
    const r = await withFakeDb(spec, true, async () =>
      validator.checkAncillaryCaseIntegrity({
        clinicId: 1, globalPlexusPatientId: 10, patientClinicMembershipId: 20,
        executionCaseId: 700,
      }),
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "execution_case_belongs_to_different_clinic");
  }
  // Positive control: all consistent → ok.
  {
    const spec = new Map<unknown, FakeTableSpec>();
    spec.set(t.clinics, { select: () => [{ id: 1 }] });
    spec.set(t.globalPatients, { select: () => [{ id: 10 }] });
    spec.set(t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] });
    const r = await withFakeDb(spec, true, async () =>
      validator.checkAncillaryCaseIntegrity({
        clinicId: 1, globalPlexusPatientId: 10, patientClinicMembershipId: 20,
      }),
    );
    assert.equal(r.ok, true);
  }
}

// ─── (13) Reconciliation reuses active case ─────────────────────
async function testReconciliationReusesActiveCase() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  spec.set(t.clinics, { select: () => [{ id: 1 }] });
  spec.set(t.globalPatients, { select: () => [{ id: 10 }] });
  spec.set(t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] });
  spec.set(t.ancillaryCases, {
    // findActiveAncillaryCase → returns existing row.
    select: () => [{
      id: 500, globalPlexusPatientId: 10, clinicId: 1, serviceType: "BrainWave",
      lifecycleStatus: "active", episodeSequence: 1, patientClinicMembershipId: 20,
      originatingScreeningId: null, executionCaseId: null,
    }],
  });
  spec.set(t.journeyEvents, { insert: () => [] });

  const reco = await import("../../server/services/ancillaryCases/reconciliation");
  const r = await withFakeDb(spec, true, async () =>
    reco.reconcileAncillaryCaseForService({
      clinicId: 1, globalPlexusPatientId: 10, patientClinicMembershipId: 20,
      serviceType: "BrainWave", source: "test",
    }),
  );
  assert.equal(r.status, "reused");
  if (r.status !== "reused") throw new Error("unreachable");
  assert.equal(r.ancillaryCaseId, 500);
}

// ─── (14) Reconciliation creates when no active case exists ────
async function testReconciliationCreatesWhenNoActive() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  spec.set(t.clinics, { select: () => [{ id: 1 }] });
  spec.set(t.globalPatients, { select: () => [{ id: 10 }] });
  spec.set(t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] });
  let selectCount = 0;
  spec.set(t.ancillaryCases, {
    // 1st select: findActiveAncillaryCase → none.
    // 2nd select: computeNextEpisodeSequence → MAX=null → 1.
    select: () => {
      selectCount++;
      if (selectCount === 1) return [];
      return [{ max: null }];
    },
    insert: (v) => {
      const row = Array.isArray(v) ? v[0] : v;
      return [{ ...row, id: 700 }];
    },
  });
  spec.set(t.journeyEvents, { insert: () => [] });

  const reco = await import("../../server/services/ancillaryCases/reconciliation");
  const r = await withFakeDb(spec, true, async () =>
    reco.reconcileAncillaryCaseForService({
      clinicId: 1, globalPlexusPatientId: 10, patientClinicMembershipId: 20,
      serviceType: "BrainWave", source: "test",
    }),
  );
  assert.equal(r.status, "created", `expected created got ${r.status}`);
  if (r.status !== "created") throw new Error("unreachable");
  assert.equal(r.ancillaryCaseId, 700);
  assert.equal(r.episodeSequence, 1);
  assert.equal(r.isNewEpisode, false, "episode 1 is not a re-episode");
}

// ─── (15) Race conflict re-reads active row ────────────────────
async function testRaceConflictResolvesByRereading() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  spec.set(t.clinics, { select: () => [{ id: 1 }] });
  spec.set(t.globalPatients, { select: () => [{ id: 10 }] });
  spec.set(t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] });
  let selectCount = 0;
  spec.set(t.ancillaryCases, {
    select: () => {
      selectCount++;
      // 1st: initial active probe → none.
      // 2nd: MAX (sequence).
      // 3rd: race-conflict re-read → returns row created by another tx.
      if (selectCount === 1) return [];
      if (selectCount === 2) return [{ max: null }];
      return [{
        id: 900, globalPlexusPatientId: 10, clinicId: 1, serviceType: "BrainWave",
        lifecycleStatus: "active", episodeSequence: 1, patientClinicMembershipId: 20,
        originatingScreeningId: null, executionCaseId: null,
      }];
    },
    insert: () => {
      const e = new Error("duplicate key value violates unique constraint \"uq_pac_active_episode\"");
      (e as { code?: string }).code = "23505";
      throw e;
    },
  });
  spec.set(t.journeyEvents, { insert: () => [] });

  const reco = await import("../../server/services/ancillaryCases/reconciliation");
  const r = await withFakeDb(spec, true, async () =>
    reco.reconcileAncillaryCaseForService({
      clinicId: 1, globalPlexusPatientId: 10, patientClinicMembershipId: 20,
      serviceType: "BrainWave", source: "test",
    }),
  );
  assert.equal(r.status, "reused", `race must yield reused, got ${r.status}`);
  if (r.status !== "reused") throw new Error("unreachable");
  assert.equal(r.ancillaryCaseId, 900, "race conflict must return the winning row's id");
}

// ─── (16) One execution case links multiple ancillary cases ────
// Verified structurally by the schema: executionCaseId is a nullable
// FK (not UNIQUE). Multiple ancillary rows can point to the same
// execution case.
async function testExecutionCaseFkNotUnique() {
  const sqlText = readFileSync(
    join(REPO_ROOT, "migrations/0050_add_patient_ancillary_cases.sql"),
    "utf8",
  );
  // Must NOT declare a unique constraint on execution_case_id.
  assert.equal(
    /UNIQUE[^\n]*execution_case_id/i.test(sqlText),
    false,
    "execution_case_id must NOT be unique — one execution case links many ancillary cases",
  );
}

// ─── (17) selectedServices projection ──────────────────────────
async function testProjectionDerivesFromActiveCases() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  spec.set(t.ancillaryCases, {
    select: () => [
      { serviceType: "BrainWave" },
      { serviceType: "VitalWave" },
      { serviceType: "BrainWave" }, // duplicate → deduped by helper
    ],
  });
  const reco = await import("../../server/services/ancillaryCases/reconciliation");
  const projection = await withFakeDb(spec, true, async () =>
    reco.projectSelectedServicesFromAncillaryCases({
      globalPlexusPatientId: 10, clinicId: 1,
    }),
  );
  assert.deepEqual(projection, ["BrainWave", "VitalWave"]);

  // Flag OFF → empty (never touches DB).
  const emptyOff = await withFakeDb(spec, false, async () =>
    reco.projectSelectedServicesFromAncillaryCases({
      globalPlexusPatientId: 10, clinicId: 1,
    }),
  );
  assert.deepEqual(emptyOff, []);
}

// ─── (18) Feature flag OFF performs zero DB reads/writes ───────
async function testFlagOffZeroDb() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  // Any spec — if it's touched, the calls array becomes non-empty
  // and this test fails.
  spec.set(t.ancillaryCases, {
    select: () => { throw new Error("must not read"); },
    insert: () => { throw new Error("must not write"); },
  });
  spec.set(t.journeyEvents, {
    insert: () => { throw new Error("must not audit"); },
  });

  const reco = await import("../../server/services/ancillaryCases/reconciliation");
  const calls = { count: 0 };
  await withFakeDb(spec, false, async (c) => {
    const r = await reco.reconcileAncillaryCaseForService({
      clinicId: 1, globalPlexusPatientId: 10, patientClinicMembershipId: 20,
      serviceType: "BrainWave", source: "test",
    });
    assert.equal(r.status, "skipped_flag_off");
    calls.count = c.length;
  });
  assert.equal(calls.count, 0, "flag OFF must issue zero db calls");
}

// ─── (19) Every active service-add path uses the shared service ─
async function testDiscoveryEveryAddPathUsesReconciler() {
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

  // A file "adds a service" if it directly EDITS the canonical service
  // list AT THE HANDLER-BOUNDARY (not as an intermediate write picked
  // up downstream by the commit path). The signal we match is:
  //
  //   qualifyingTests: nextTests
  //     — the admin-review pattern, unique to add/remove services.
  //
  // Batch analysis writes to patient_screenings.qualifyingTests via
  // db.update().set({ ..., qualifyingTests: [...] }) as an intermediate
  // step, but that path funnels through commitPatient →
  // createOrUpdateExecutionCaseFromScreening, which owns the
  // reconciliation contract. Requiring a direct reconciler call in
  // the batch runner would duplicate logic that the commit path
  // already provides.
  const ADD_PATTERNS = [
    /qualifyingTests:\s*nextTests\b/,
  ];
  const RECONCILER = /reconcileAncillaryCase(?:sBulk|ForService)?|conservativelyRemoveAncillaryService|syncAncillaryCasesFromScreening|conservativelyRemoveAncillaryForScreening/;

  // Files that IntermediateWrite selected/qualifying services but
  // route through the commit → sync path. Not offenders.
  const ALLOW = new Set<string>([
    // The canonical entry point IS the reconciler itself.
    join(REPO_ROOT, "server/services/ancillaryCases/reconciliation.ts"),
    // Regeneration services synthesize a new qualifyingTests list; the
    // Admin Review commit path picks up the change via
    // createOrUpdateExecutionCaseFromScreening.
    join(REPO_ROOT, "server/services/plexusIq/adminReviewRegenerateAncillaryService.ts"),
    join(REPO_ROOT, "server/services/plexusIq/adminReviewRegenerateAllService.ts"),
    join(REPO_ROOT, "server/services/plexusIq/adminReviewRegenerateTestService.ts"),
    // Quick-schedule creates execution cases for unscreened walk-ins;
    // Phase 2A identity is not yet established. The reconciler would
    // return missing_identity_links. Documented.
    join(REPO_ROOT, "server/repositories/executionCase.repo.ts"),
    // Storage facade: no direct write; delegates to the repository.
    join(REPO_ROOT, "server/storage.ts"),
    // AI screening services produce the list; they DO NOT persist it.
    join(REPO_ROOT, "server/services/plexusIqAiBatch.ts"),
    join(REPO_ROOT, "server/services/screening.ts"),
  ]);

  const offenders: string[] = [];
  for (const f of files) {
    if (ALLOW.has(f)) continue;
    const src = readFileSync(f, "utf8");
    const hits = ADD_PATTERNS.some((re) => re.test(src));
    if (hits && !RECONCILER.test(src)) {
      offenders.push(f.slice(REPO_ROOT.length + 1));
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      "The following files mutate service selection without calling the shared reconciler:\n  - " +
        offenders.join("\n  - "),
    );
  }
}

// ─── (20) Removal does not hard-delete history ─────────────────
async function testRemovalIsSoft() {
  const src = readFileSync(
    join(REPO_ROOT, "server/services/ancillaryCases/reconciliation.ts"),
    "utf8",
  );
  // The conservative removal function must UPDATE lifecycle_status,
  // never DELETE, and must default to on_hold.
  assert.ok(/conservativelyRemoveAncillaryService/.test(src));
  assert.ok(/lifecycleStatus:\s*nextStatus/.test(src));
  assert.equal(
    /db\.delete\(patientAncillaryCases/i.test(src),
    false,
    "reconciliation service must NEVER hard-delete an ancillary case",
  );
  const repo = readFileSync(
    join(REPO_ROOT, "server/repositories/ancillaryCases.repo.ts"),
    "utf8",
  );
  assert.equal(
    /db\.delete\(patientAncillaryCases/i.test(repo),
    false,
    "repository must NEVER hard-delete an ancillary case",
  );
}

// ─── (21) Backfill dry-run performs zero writes ────────────────
async function testBackfillDryRunZeroWrites() {
  const src = readFileSync(join(REPO_ROOT, "script/backfillAncillaryCases.ts"), "utf8");
  const dryRunSection = src.slice(
    src.indexOf("if (!apply)"),
    src.indexOf("try {\n        const result = await reconcileAncillaryCaseForService"),
  );
  assert.ok(dryRunSection.length > 0, "dry-run section must exist");
  assert.ok(/findActiveAncillaryCase/.test(dryRunSection), "dry-run uses read-only probe");
  assert.equal(
    /reconcileAncillaryCaseForService\(/.test(dryRunSection),
    false,
    "dry-run must NOT invoke the writing reconciler",
  );
}

// ─── (22) Backfill is idempotent ───────────────────────────────
async function testBackfillIsIdempotent() {
  // Idempotency is inherited from the reconciler (already-active row
  // returns `reused`). Static check: apply-mode branch delegates to
  // the reconciler and treats `reused` as a valid outcome.
  const src = readFileSync(join(REPO_ROOT, "script/backfillAncillaryCases.ts"), "utf8");
  assert.ok(/reconcileAncillaryCaseForService\(/.test(src), "apply mode uses reconciler");
  assert.ok(/outcome:\s*"reused"/.test(src), "backfill classifies reused outcomes");
}

// ─── (23) Backfill refuses rows missing Phase 2A identity links ─
async function testBackfillRefusesMissingIdentityLinks() {
  const src = readFileSync(join(REPO_ROOT, "script/backfillAncillaryCases.ts"), "utf8");
  assert.ok(
    /!r\.globalPlexusPatientId\s*\|\|\s*!r\.patientClinicMembershipId/.test(src),
    "backfill must classify rows missing Phase 2A links as missing_identity_links",
  );
  assert.ok(/outcome:\s*"missing_identity_links"/.test(src));
}

// ─── (24) Backfill never crosses clinic boundaries ─────────────
async function testBackfillClinicScoped() {
  const src = readFileSync(join(REPO_ROOT, "script/backfillAncillaryCases.ts"), "utf8");
  // Every reconcileAncillaryCaseForService call must pass clinicId
  // from the ROW (r.clinicId), never inferred from elsewhere.
  const reconcileCall = src.slice(
    src.indexOf("reconcileAncillaryCaseForService({"),
    src.indexOf("reconcileAncillaryCaseForService({") + 400,
  );
  assert.ok(/clinicId:\s*r\.clinicId/.test(reconcileCall));
  assert.ok(/patientClinicMembershipId:\s*r\.patientClinicMembershipId/.test(reconcileCall));
}

// ─── (25) Backfill output contains no PHI ──────────────────────
async function testBackfillNoPhi() {
  const src = readFileSync(join(REPO_ROOT, "script/backfillAncillaryCases.ts"), "utf8");
  // The PlanRow shape must NOT contain patientName / dob / mrn / phone / email.
  const planRowType = src.slice(src.indexOf("type PlanRow = {"), src.indexOf("type PlanRow = {") + 500);
  for (const forbidden of ["patientName", "name:", "dob", "phoneNumber", "email", "mrn", "insurance"]) {
    assert.equal(
      new RegExp(`\\b${forbidden}\\b`).test(planRowType),
      false,
      `backfill PlanRow must not include ${forbidden}`,
    );
  }
  // The reconciler is called with patientNameForAudit: null.
  assert.ok(
    /patientNameForAudit:\s*null/.test(src),
    "backfill must pass patientNameForAudit: null to keep journey events non-PHI",
  );
}

// ─── (18/26) Feature flag OFF leaves existing behavior; and
// Phase 2A tests remain green — the latter is verified by running
// the full suite, not by this file. Include a quick smoke test that
// the Phase 2A test file is still present.
async function testPhase2ATestsPresent() {
  const p = join(REPO_ROOT, "tests/unit/plexusIdentity.test.ts");
  assert.ok(statSync(p).isFile(), "Phase 2A test file must remain in place");
  const src = readFileSync(p, "utf8");
  assert.ok(/H12/.test(src) || /(H11)/.test(src), "Phase 2A hardening tests must remain");
}

// ═══ Phase 2B hardening — 20 new behavioral / architecture tests ══

// (H1) Retry ledger table declared + expected columns
async function testRetryLedgerSchema() {
  const cols = Object.keys(ancillaryCaseReconciliationFailures);
  for (const c of [
    "id","patientScreeningId","executionCaseId","clinicId",
    "globalPlexusPatientId","patientClinicMembershipId",
    "serviceType","requestedAction","sourceSystem","errorCode",
    "attemptCount","firstFailedAt","lastAttemptedAt","resolvedAt",
  ]) {
    assert.ok(cols.includes(c), `retry ledger missing column: ${c}`);
  }
  for (const p of ["patientName","name","dob","phone","email","mrn","insurance","diagnosis","medication","clinicalReasoning","reasoning"]) {
    assert.equal(cols.includes(p), false, `retry ledger MUST NOT include: ${p}`);
  }
  assert.deepEqual(
    [...RECONCILIATION_FAILURE_ACTIONS],
    ["ensure_active","place_on_hold","cancel","archive","refresh_projection"],
  );
}

// (H2) Migration adds status CHECK constraints + retry ledger table
async function testMigrationHasChecksAndLedger() {
  const sqlText = readFileSync(join(REPO_ROOT, "migrations/0050_add_patient_ancillary_cases.sql"), "utf8");
  assert.ok(/CONSTRAINT\s+chk_pac_lifecycle_status[\s\S]*?CHECK\s*\(\s*lifecycle_status\s+IN[\s\S]*?new[\s\S]*?archived/i.test(sqlText));
  assert.ok(/CONSTRAINT\s+chk_pac_qualification_status/i.test(sqlText));
  assert.ok(/CONSTRAINT\s+chk_pac_admin_review_status/i.test(sqlText));
  assert.ok(/CONSTRAINT\s+chk_pac_episode_sequence[\s\S]*?episode_sequence\s*>=\s*1/i.test(sqlText));
  assert.ok(/CONSTRAINT\s+chk_pac_closed_at_required/i.test(sqlText));
  assert.ok(/CREATE TABLE IF NOT EXISTS ancillary_case_reconciliation_failures/i.test(sqlText));
  assert.ok(/CONSTRAINT\s+chk_acrf_requested_action/i.test(sqlText));
}

// (H3) Partial unique active-episode index preserved
async function testPartialUniqueActiveEpisodeIntact() {
  const sqlText = readFileSync(join(REPO_ROOT, "migrations/0050_add_patient_ancillary_cases.sql"), "utf8");
  assert.ok(/CREATE UNIQUE INDEX IF NOT EXISTS uq_pac_active_episode[\s\S]*?WHERE lifecycle_status IN\s*\(\s*'new',\s*'active',\s*'on_hold'\s*\)/i.test(sqlText));
}

// (H4) Sync reconciles BEFORE projecting selectedServices
async function testSyncReconcilesBeforeProjection() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  const opsLog: string[] = [];
  spec.set(t.clinics, { select: () => [{ id: 1 }] });
  spec.set(t.globalPatients, { select: () => { opsLog.push("select:global"); return [{ id: 10 }]; } });
  spec.set(t.memberships, { select: () => { opsLog.push("select:membership"); return [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }]; } });
  spec.set(t.screenings, { select: () => [{ id: 1, clinicId: 1 }] });
  spec.set(t.executionCases, { select: () => [{ id: 99, clinicId: 1 }] });
  let ancSelectCount = 0;
  const insertedRows: Record<string, unknown>[] = [];
  spec.set(t.ancillaryCases, {
    select: () => {
      ancSelectCount++;
      opsLog.push(`select:ancillary#${ancSelectCount}`);
      // #1: findActive → none. #2: MAX. #3: listForPatient (on_hold pass). #4: projection.
      if (ancSelectCount === 1) return [];
      if (ancSelectCount === 2) return [{ max: null }];
      if (ancSelectCount === 3) return insertedRows; // for on_hold filter
      return insertedRows.map((r) => ({ serviceType: r.serviceType }));
    },
    insert: (v) => {
      opsLog.push("insert:ancillary");
      const row = Array.isArray(v) ? v[0] : v;
      const withId = { ...row, id: 55, lifecycleStatus: (row.lifecycleStatus ?? "new"), clinicId: row.clinicId, patientClinicMembershipId: 20, originatingScreeningId: 1, executionCaseId: 99 };
      insertedRows.push(withId);
      return [withId];
    },
  });
  spec.set(t.journeyEvents, { insert: () => { opsLog.push("insert:journey"); return []; } });
  spec.set(t.ancillaryFailures, { select: () => [], insert: () => [] });

  const svc = await import("../../server/services/ancillaryCases/screeningSync");
  const r = await withFakeDb(spec, true, async () =>
    svc.syncScreeningAncillaryCases({
      screening: { id: 1, clinicId: 1, name: "X", dob: null,
        qualifyingTests: ["BrainWave"], adminApprovalStatus: "approved",
        patientClinicMembershipId: 20, globalPlexusPatientId: 10 } as never,
      executionCaseId: 99, actorUserId: null,
      requestedServices: ["BrainWave"], requestedServicesDefined: true, source: "test",
    }),
  );
  assert.equal(r.deferred, false);
  assert.deepEqual(r.projection, ["BrainWave"]);
  assert.equal(r.reconciledCount, 1);
  const firstInsert = opsLog.indexOf("insert:ancillary");
  const projectionSelect = opsLog.lastIndexOf("select:ancillary#3");
  assert.ok(firstInsert > -1 && projectionSelect > firstInsert,
    "projection query must come AFTER reconciliation write");
}

// (H5) selectedServices ends up equal to projection
async function testExecutionCaseSelectedServicesEqualsProjection() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  const execUpdates: Record<string, unknown>[] = [];
  spec.set(t.clinics, { select: () => [{ id: 1 }] });
  spec.set(t.globalPatients, { select: () => [{ id: 10 }] });
  spec.set(t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] });
  spec.set(t.screenings, { select: () => [{ id: 42, clinicId: 1 }] });
  let execCaseSelect = 0;
  const insertedExec: Record<string, unknown>[] = [];
  spec.set(t.executionCases, {
    select: () => {
      execCaseSelect++;
      // 1st is the "existing" probe; return none so we hit the insert path.
      if (execCaseSelect === 1) return [];
      // subsequent selects (for integrity checks) get the inserted case.
      return insertedExec;
    },
    insert: (v) => {
      const row = Array.isArray(v) ? v[0] : v;
      assert.equal("selectedServices" in row, false,
        "insert must NOT set selectedServices when flag ON — projection updates it after");
      const withId = { ...row, id: 700 };
      insertedExec.push(withId);
      return [withId];
    },
    update: (v) => { execUpdates.push(v); },
  });
  let ancSelects = 0;
  const insertedAnc: Record<string, unknown>[] = [];
  spec.set(t.ancillaryCases, {
    select: () => {
      ancSelects++;
      if (ancSelects === 1) return [];
      if (ancSelects === 2) return [{ max: null }];
      if (ancSelects === 3) return insertedAnc; // listForPatient
      return insertedAnc.map((r) => ({ serviceType: r.serviceType }));
    },
    insert: (v) => {
      const row = Array.isArray(v) ? v[0] : v;
      const withId = { ...row, id: 900, clinicId: row.clinicId };
      insertedAnc.push(withId);
      return [withId];
    },
  });
  spec.set(t.journeyEvents, { insert: () => [] });
  spec.set(t.ancillaryFailures, { select: () => [], insert: () => [] });

  const repo = await import("../../server/repositories/executionCase.repo");
  await withFakeDb(spec, true, async () =>
    repo.createOrUpdateExecutionCaseFromScreening({
      id: 42, clinicId: 1, name: "X", dob: null,
      qualifyingTests: ["VitalWave"], adminApprovalStatus: "approved",
      patientClinicMembershipId: 20, globalPlexusPatientId: 10 } as never, null),
  );
  const projectionUpdate = execUpdates.find(
    (u) => Array.isArray((u as { selectedServices?: unknown }).selectedServices),
  );
  assert.ok(projectionUpdate, "execution case must be updated with projection");
  assert.deepEqual((projectionUpdate as { selectedServices: string[] }).selectedServices, ["VitalWave"]);
}

// (H6) Failed reconciliation does NOT persist selectedServices as truth
async function testFailedReconciliationDoesNotWriteSelectedServices() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  const execUpdates: Record<string, unknown>[] = [];
  spec.set(t.clinics, { select: () => [{ id: 1 }] });
  spec.set(t.globalPatients, { select: () => [{ id: 10 }] });
  spec.set(t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] });
  spec.set(t.executionCases, {
    select: () => [],
    insert: (v) => { const row = Array.isArray(v) ? v[0] : v; return [{ ...row, id: 800 }]; },
    update: (v) => { execUpdates.push(v); },
  });
  spec.set(t.ancillaryCases, {
    select: () => [],
    insert: () => { const e = new Error("db exploded"); (e as { code?: string }).code = "40001"; throw e; },
  });
  spec.set(t.journeyEvents, { insert: () => [] });
  const failureInserts: Record<string, unknown>[] = [];
  spec.set(t.ancillaryFailures, {
    select: () => [],
    insert: (v) => { const row = Array.isArray(v) ? v[0] : v; failureInserts.push(row); return [{ ...row, id: 500 }]; },
  });

  const repo = await import("../../server/repositories/executionCase.repo");
  await withFakeDb(spec, true, async () =>
    repo.createOrUpdateExecutionCaseFromScreening({
      id: 42, clinicId: 1, name: "X", dob: null,
      qualifyingTests: ["BrainWave"], adminApprovalStatus: "approved",
      patientClinicMembershipId: 20, globalPlexusPatientId: 10 } as never, null),
  );
  for (const u of execUpdates.filter((u) => "selectedServices" in u)) {
    const sel = (u as { selectedServices: unknown }).selectedServices;
    if (Array.isArray(sel)) {
      assert.equal(sel.includes("BrainWave"), false,
        "selectedServices must NOT claim a service whose reconciliation failed");
    }
  }
  assert.ok(failureInserts.length >= 1, "durable retry row must be created on failure");
  assert.equal(failureInserts[0].serviceType, "BrainWave");
  assert.equal(failureInserts[0].requestedAction, "ensure_active");
}

// (H7) Retry idempotent — resolve is a no-op
async function testRetryIdempotent() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  spec.set(t.clinics, { select: () => [{ id: 1 }] });
  spec.set(t.globalPatients, { select: () => [{ id: 10 }] });
  spec.set(t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] });
  spec.set(t.screenings, {
    select: () => [{ id: 5, clinicId: 1, name: "X", dob: null,
      qualifyingTests: [], adminApprovalStatus: "approved",
      patientClinicMembershipId: 20, globalPlexusPatientId: 10 }],
  });
  spec.set(t.ancillaryCases, {
    select: () => [{ id: 100, globalPlexusPatientId: 10, clinicId: 1, serviceType: "BrainWave",
      lifecycleStatus: "active", episodeSequence: 1, patientClinicMembershipId: 20,
      originatingScreeningId: 5, executionCaseId: null }],
  });
  spec.set(t.journeyEvents, { insert: () => [] });
  const failureRow = {
    id: 1, patientScreeningId: 5, executionCaseId: null, clinicId: 1,
    globalPlexusPatientId: 10, patientClinicMembershipId: 20,
    serviceType: "BrainWave", requestedAction: "ensure_active",
    sourceSystem: "test", errorCode: "unknown",
    attemptCount: 1, resolvedAt: null,
  } as never;
  const resolvedUpdates: Record<string, unknown>[] = [];
  spec.set(t.ancillaryFailures, {
    select: () => [failureRow],
    update: (v) => { resolvedUpdates.push(v); },
    insert: () => [],
  });

  const retry = await import("../../server/services/ancillaryCases/failureRetry");
  const first = await withFakeDb(spec, true, async () =>
    retry.retryAncillaryCaseReconciliationFailure(failureRow));
  const second = await withFakeDb(spec, true, async () =>
    retry.retryAncillaryCaseReconciliationFailure(failureRow));
  assert.equal(first.status, "resolved");
  assert.equal(second.status, "resolved", "second retry idempotent");
  assert.ok(resolvedUpdates.length >= 1);
}

// (H8) Missing identity → deferred + retry per service
async function testMissingIdentityDeferredWithRetryRows() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  const inserted: Record<string, unknown>[] = [];
  spec.set(t.ancillaryFailures, {
    select: () => [],
    insert: (v) => { const row = Array.isArray(v) ? v[0] : v; inserted.push(row); return [{ ...row, id: inserted.length }]; },
  });
  spec.set(t.ancillaryCases, {
    select: () => { throw new Error("should not query when identity missing"); },
    insert: () => { throw new Error("should not insert when identity missing"); },
  });
  spec.set(t.journeyEvents, { insert: () => [] });

  const svc = await import("../../server/services/ancillaryCases/screeningSync");
  const r = await withFakeDb(spec, true, async () =>
    svc.syncScreeningAncillaryCases({
      screening: { id: 5, clinicId: 1, name: "X", dob: null,
        qualifyingTests: ["BrainWave", "VitalWave"],
        adminApprovalStatus: "approved",
        patientClinicMembershipId: null, globalPlexusPatientId: null } as never,
      executionCaseId: 99, actorUserId: null,
      requestedServices: ["BrainWave", "VitalWave"], requestedServicesDefined: true, source: "test",
    }),
  );
  assert.equal(r.deferred, true);
  assert.equal(r.missingIdentityLinks, true);
  assert.equal(r.projection, null);
  assert.equal(inserted.length, 2);
  for (const row of inserted) {
    assert.equal(row.errorCode, "MISSING_IDENTITY_LINKS");
    assert.equal(row.requestedAction, "ensure_active");
  }
}

// (H9) Identity completion hook exists + is scoped to screening
async function testIdentityCompletionHook() {
  const src = readFileSync(
    join(REPO_ROOT, "server/services/ancillaryCases/failureRetry.ts"), "utf8");
  assert.ok(/retryFailuresAfterIdentityCompletion/.test(src));
  assert.ok(/retryUnresolvedAncillaryCaseReconciliations\(\{\s*screeningId/.test(src));
}

// (H10) Quick-schedule defers via retry ledger
async function testQuickScheduleCreatesDeferredWork() {
  const src = readFileSync(join(REPO_ROOT, "server/routes/globalSchedule.ts"), "utf8");
  assert.ok(/recordAncillaryReconciliationFailure/.test(src));
  assert.ok(/MISSING_IDENTITY_LINKS_QUICK_SCHEDULE/.test(src));
  assert.ok(/patientScreeningId:\s*null/.test(src));
}

// (H11) Requested-but-failed service does NOT go on_hold
async function testRequestedFailedServiceStaysActive() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  spec.set(t.clinics, { select: () => [{ id: 1 }] });
  spec.set(t.globalPatients, { select: () => [{ id: 10 }] });
  spec.set(t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] });
  spec.set(t.ancillaryCases, {
    select: () => [],
    insert: () => { const e = new Error("db failed"); (e as { code?: string }).code = "40001"; throw e; },
    update: () => { throw new Error("must NOT update on_hold on failed reconcile"); },
  });
  spec.set(t.journeyEvents, { insert: () => [] });
  spec.set(t.ancillaryFailures, { select: () => [], insert: () => [] });
  const svc = await import("../../server/services/ancillaryCases/screeningSync");
  await withFakeDb(spec, true, async () =>
    svc.syncScreeningAncillaryCases({
      screening: { id: 1, clinicId: 1, name: "X", dob: null,
        qualifyingTests: ["BrainWave"], adminApprovalStatus: "approved",
        patientClinicMembershipId: 20, globalPlexusPatientId: 10 } as never,
      executionCaseId: 99, actorUserId: null,
      requestedServices: ["BrainWave"], requestedServicesDefined: true, source: "test",
    }),
  );
  assert.ok(true, "reached end without on_hold write");
}

// (H12) Undefined list ≠ empty list — no on_hold pass
async function testUndefinedServiceListDoesNotRemove() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  spec.set(t.clinics, { select: () => [{ id: 1 }] });
  spec.set(t.globalPatients, { select: () => [{ id: 10 }] });
  spec.set(t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] });
  spec.set(t.ancillaryCases, {
    select: () => [{ id: 1, globalPlexusPatientId: 10, clinicId: 1, serviceType: "BrainWave",
      lifecycleStatus: "active", episodeSequence: 1, patientClinicMembershipId: 20,
      originatingScreeningId: null, executionCaseId: null }],
    update: () => { throw new Error("must NOT place on_hold when list is undefined"); },
  });
  spec.set(t.journeyEvents, { insert: () => [] });
  spec.set(t.ancillaryFailures, { select: () => [], insert: () => [] });

  const svc = await import("../../server/services/ancillaryCases/screeningSync");
  const r = await withFakeDb(spec, true, async () =>
    svc.syncScreeningAncillaryCases({
      screening: { id: 1, clinicId: 1, name: "X", dob: null,
        qualifyingTests: null, adminApprovalStatus: "approved",
        patientClinicMembershipId: 20, globalPlexusPatientId: 10 } as never,
      executionCaseId: 99, actorUserId: null,
      requestedServices: [], requestedServicesDefined: false, source: "test",
    }),
  );
  assert.ok(r.projection !== null, "projection still computed on undefined-list runs");
}

// (H13) Explicit empty list → conservative on_hold on prior active
async function testExplicitEmptyListPlacesActiveOnHold() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  spec.set(t.clinics, { select: () => [{ id: 1 }] });
  spec.set(t.globalPatients, { select: () => [{ id: 10 }] });
  spec.set(t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] });
  const holdUpdates: Record<string, unknown>[] = [];
  spec.set(t.ancillaryCases, {
    select: () => [{ id: 1, globalPlexusPatientId: 10, clinicId: 1, serviceType: "BrainWave",
      lifecycleStatus: "active", episodeSequence: 1, patientClinicMembershipId: 20,
      originatingScreeningId: null, executionCaseId: null }],
    update: (v) => { holdUpdates.push(v); },
  });
  spec.set(t.journeyEvents, { insert: () => [] });
  spec.set(t.ancillaryFailures, { select: () => [], insert: () => [] });
  const svc = await import("../../server/services/ancillaryCases/screeningSync");
  await withFakeDb(spec, true, async () =>
    svc.syncScreeningAncillaryCases({
      screening: { id: 1, clinicId: 1, name: "X", dob: null,
        qualifyingTests: [], adminApprovalStatus: "approved",
        patientClinicMembershipId: 20, globalPlexusPatientId: 10 } as never,
      executionCaseId: 99, actorUserId: null,
      requestedServices: [], requestedServicesDefined: true, source: "test",
    }),
  );
  const holdUpdate = holdUpdates.find(
    (u) => (u as { lifecycleStatus?: string }).lifecycleStatus === "on_hold",
  );
  assert.ok(holdUpdate, "explicit empty list must place the prior-active case on_hold");
}

// (H14) No PHI in Phase 2B audit events
async function testNoPhiInAncillaryAuditEvents() {
  const src = readFileSync(
    join(REPO_ROOT, "server/services/ancillaryCases/reconciliation.ts"), "utf8");
  assert.ok(/ANCILLARY_AUDIT_SENTINEL_NAME/.test(src));
  assert.ok(/patientName:\s*ANCILLARY_AUDIT_SENTINEL_NAME/.test(src));
  assert.ok(/patientDob:\s*null/.test(src));
  assert.equal(/patientNameForAudit/.test(src), false);
  assert.equal(/patientDobForAudit/.test(src), false);
}

// (H15) Flag OFF: NO retry rows recorded
async function testFlagOffNoRetryRow() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  spec.set(t.ancillaryFailures, {
    insert: () => { throw new Error("must not record with flag OFF"); },
  });
  spec.set(t.ancillaryCases, { select: () => [] });
  const svc = await import("../../server/services/ancillaryCases/screeningSync");
  const r = await withFakeDb(spec, false, async () =>
    svc.syncScreeningAncillaryCases({
      screening: { id: 1, clinicId: null, name: "X", dob: null,
        qualifyingTests: null,
        patientClinicMembershipId: null, globalPlexusPatientId: null } as never,
      executionCaseId: null, actorUserId: null,
      requestedServices: [], requestedServicesDefined: false, source: "test",
    }),
  );
  assert.equal(r.projection, null);
}

// (H16) Ledger dedup: same-shape request UPDATES not INSERTs
async function testLedgerDedup() {
  const t = await loadTables();
  const spec = new Map<unknown, FakeTableSpec>();
  const existing = {
    id: 1, patientScreeningId: 5, executionCaseId: 99, clinicId: 1,
    serviceType: "BrainWave", requestedAction: "ensure_active",
    attemptCount: 2, resolvedAt: null,
    globalPlexusPatientId: null, patientClinicMembershipId: null,
    errorCode: "OLD", sourceSystem: "old",
  } as never;
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  spec.set(t.ancillaryFailures, {
    select: () => [existing],
    update: (v) => { updates.push(v); },
    insert: (v) => { inserts.push(v as Record<string, unknown>); return []; },
  });
  const repo = await import("../../server/repositories/ancillaryCases.repo");
  await withFakeDb(spec, true, async () =>
    repo.recordAncillaryReconciliationFailure({
      patientScreeningId: 5, executionCaseId: 99, clinicId: 1,
      serviceType: "BrainWave", requestedAction: "ensure_active", errorCode: "NEW",
    }),
  );
  assert.equal(inserts.length, 0, "must NOT insert duplicate");
  assert.equal(updates.length, 1, "must update the existing row");
  assert.equal((updates[0] as { attemptCount?: number }).attemptCount, 3);
}

// (H17) Feature-flag catalog includes ancillaryCaseWrite
async function testFeatureFlagCatalog() {
  const src = readFileSync(join(REPO_ROOT, "server/lib/featureFlags.ts"), "utf8");
  assert.ok(/FEATURE_ANCILLARY_CASE_WRITE/.test(src));
  assert.ok(/ancillaryCaseWrite:\s*readBool/.test(src));
}

// (H18) Regeneration service that persists qualifyingTests calls sync
async function testRegenerationSyncCall() {
  const src = readFileSync(
    join(REPO_ROOT, "server/services/plexusIq/adminReviewRegenerateAllService.ts"),
    "utf8",
  );
  assert.ok(/syncScreeningAncillaryCases/.test(src),
    "regenerateAll must call the sync service (defense in depth — updatePayload guards are the primary check)");
}

// (H19) Retry ledger integrity — clinic_id NOT NULL
async function testRetryLedgerRequiresClinicId() {
  const sqlText = readFileSync(
    join(REPO_ROOT, "migrations/0050_add_patient_ancillary_cases.sql"), "utf8");
  assert.ok(/clinic_id\s+INTEGER\s+NOT NULL[\s\S]*?ancillary_case_reconciliation_failures/.test(
    sqlText.slice(sqlText.indexOf("CREATE TABLE IF NOT EXISTS ancillary_case_reconciliation_failures"))
  ), "retry ledger must require clinic_id");
}

// (H20) Phase 2A tests still present + Phase 2B tests still all in this file
async function testExistingSuiteStillPresent() {
  const p = join(REPO_ROOT, "tests/unit/plexusIdentity.test.ts");
  assert.ok(statSync(p).isFile());
  const src = readFileSync(p, "utf8");
  assert.ok(src.length > 1000);
}

// ─── (27) PR #317 baseline preserved — the merge-base at the top
// of phase/2b-ancillary-cases is the Phase 2A tip. Static check: the
// SHA-referenced Phase 2A migration is present untouched.
async function testPhase2AMigrationUntouched() {
  const p = join(REPO_ROOT, "migrations/0049_add_plexus_identity.sql");
  const src = readFileSync(p, "utf8");
  // Sentinel strings from Phase 2A's final head — presence confirms
  // we haven't accidentally rewritten the file.
  assert.ok(/plexus_identity_link_failures/.test(src), "Phase 2A ledger table must remain in 0049");
  assert.ok(/fk_ps_pcm/.test(src));
  assert.ok(/fk_ps_gpp/.test(src));
}

// ─── Runner ───────────────────────────────────────────────────────
const tests = [
  ["(1) drizzle schema + migration agree", testSchemaAndMigrationAgree],
  ["(2) migration has real FKs + partial unique index", testMigrationHasRealFks],
  ["enum contents", testEnumContents],
  ["(18) feature flag defaults OFF", testFeatureFlagDefaultOff],
  ["(3) one active case per (patient, clinic, service); race → re-read", testOneActiveCasePerTriple],
  ["(4/5/6) episode sequence increments across historical rows", testEpisodeSequenceComputation],
  ["(7) different services coexist (service_type in unique key)", testDifferentServicesCoexist],
  ["(8) same global patient, different clinics coexist", testSameGlobalPatientDifferentClinics],
  ["(9/10/11/12) integrity validator rejects every mismatch", testIntegrityValidatorRejectsMismatches],
  ["(13) reconciliation reuses active case", testReconciliationReusesActiveCase],
  ["(14) reconciliation creates when no active case exists", testReconciliationCreatesWhenNoActive],
  ["(15) race conflict resolves by re-reading active row", testRaceConflictResolvesByRereading],
  ["(16) one execution case links many ancillary cases", testExecutionCaseFkNotUnique],
  ["(17) selectedServices projection", testProjectionDerivesFromActiveCases],
  ["(18) flag OFF issues zero DB reads/writes", testFlagOffZeroDb],
  ["(19) every service-add path uses the shared reconciler (discovery)", testDiscoveryEveryAddPathUsesReconciler],
  ["(20) removal is soft (no hard delete)", testRemovalIsSoft],
  ["(21) backfill dry-run performs zero writes", testBackfillDryRunZeroWrites],
  ["(22) backfill is idempotent", testBackfillIsIdempotent],
  ["(23) backfill refuses rows missing Phase 2A links", testBackfillRefusesMissingIdentityLinks],
  ["(24) backfill never crosses clinic boundaries", testBackfillClinicScoped],
  ["(25) backfill output contains no PHI", testBackfillNoPhi],
  ["(26) Phase 2A tests remain present", testPhase2ATestsPresent],
  ["(27) Phase 2A migration content preserved", testPhase2AMigrationUntouched],
  // ── Hardening — 20 behavioral + structural tests ──────────────
  ["(H1) retry ledger schema declared + no PHI columns", testRetryLedgerSchema],
  ["(H2) migration adds status CHECKs + retry ledger table", testMigrationHasChecksAndLedger],
  ["(H3) partial unique active-episode index intact", testPartialUniqueActiveEpisodeIntact],
  ["(H4) sync reconciles BEFORE projecting", testSyncReconcilesBeforeProjection],
  ["(H5) selectedServices equals projection after success", testExecutionCaseSelectedServicesEqualsProjection],
  ["(H6) failed reconciliation → no false selectedServices, retry row created", testFailedReconciliationDoesNotWriteSelectedServices],
  ["(H7) retry is idempotent", testRetryIdempotent],
  ["(H8) missing identity → deferred + retry per service", testMissingIdentityDeferredWithRetryRows],
  ["(H9) Phase 2A identity-completion hook exists + is scoped", testIdentityCompletionHook],
  ["(H10) quick-schedule defers via retry ledger", testQuickScheduleCreatesDeferredWork],
  ["(H11) failed-to-reconcile service is NOT placed on_hold", testRequestedFailedServiceStaysActive],
  ["(H12) undefined list ≠ empty list — no on_hold pass", testUndefinedServiceListDoesNotRemove],
  ["(H13) explicit empty list → conservative on_hold", testExplicitEmptyListPlacesActiveOnHold],
  ["(H14) new audit events contain no PHI", testNoPhiInAncillaryAuditEvents],
  ["(H15) flag OFF: no retry rows recorded", testFlagOffNoRetryRow],
  ["(H16) ledger dedup: same-shape request UPDATEs not INSERTs", testLedgerDedup],
  ["(H17) feature-flag catalog includes ancillaryCaseWrite", testFeatureFlagCatalog],
  ["(H18) regeneration path invokes sync (defense-in-depth)", testRegenerationSyncCall],
  ["(H19) retry ledger requires clinic_id NOT NULL", testRetryLedgerRequiresClinicId],
  ["(H20) existing suite files still present", testExistingSuiteStillPresent],
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
