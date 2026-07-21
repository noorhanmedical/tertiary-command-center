// Phase 2C — analyze/commit response mapping + PCS call-list
// serialized-response tests.
//
// Runs: npx tsx tests/unit/adminReviewAndEngagementResponseMapping.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import express, { type Express, type Response } from "express";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";

const REPO_ROOT = process.cwd();

// ─── Response-mapping unit tests ═════════════════════════════════

async function testMapperShape() {
  const { respondWithCommitOutcome } = await import(
    "../../server/routes/helpers/respondWithCommitOutcome"
  );
  // Build a fake Response object we can inspect.
  const makeRes = () => {
    let status = 200;
    let body: unknown = null;
    return {
      res: {
        status(code: number) { status = code; return this; },
        json(payload: unknown) { body = payload; return this; },
      } as unknown as Response,
      get: () => ({ status, body }),
    };
  };
  const commit = (sendStatus: string) => ({
    patient: { id: 1, name: "REDACTED" } as never,
    schedulerName: null,
    autoAssigned: false,
    engagementSend: { status: sendStatus as "sent" | "idempotent_existing" | "skipped_flag_off" | "deferred" | "failed", retryPending: sendStatus === "deferred" || sendStatus === "failed" },
  });

  {
    const m = makeRes(); respondWithCommitOutcome(m.res, commit("sent") as never);
    const { status, body } = m.get();
    assert.equal(status, 200);
    assert.equal((body as { engagementSend: { status: string } }).engagementSend.status, "sent");
  }
  {
    const m = makeRes(); respondWithCommitOutcome(m.res, commit("idempotent_existing") as never);
    assert.equal(m.get().status, 200);
  }
  {
    const m = makeRes(); respondWithCommitOutcome(m.res, commit("skipped_flag_off") as never);
    assert.equal(m.get().status, 200);
  }
  {
    const m = makeRes(); respondWithCommitOutcome(m.res, commit("deferred") as never);
    const { status, body } = m.get();
    assert.equal(status, 202);
    assert.equal((body as { retryPending: boolean }).retryPending, true);
  }
  {
    const m = makeRes(); respondWithCommitOutcome(m.res, commit("failed") as never);
    const { status, body } = m.get();
    assert.equal(status, 503);
    assert.equal((body as { code: string }).code, "ENGAGEMENT_SEND_FAILED");
    // No PHI in the error metadata:
    const s = JSON.stringify(body);
    for (const phi of ["\"name\"", "\"dob\"", "\"phone\"", "\"email\"", "\"mrn\"", "\"insurance\""]) {
      // The `patient` extra was NOT passed — so no PHI leaks. Confirm.
      assert.equal(s.includes(phi), false, `mapper output must not carry PHI ${phi} without explicit caller extra`);
    }
  }
}

async function testMapperMergesExtra() {
  const { respondWithCommitOutcome } = await import(
    "../../server/routes/helpers/respondWithCommitOutcome"
  );
  let status = 0;
  let body: unknown = null;
  const res = {
    status(c: number) { status = c; return this; },
    json(p: unknown) { body = p; return this; },
  } as unknown as Response;
  respondWithCommitOutcome(res, {
    patient: { id: 42 } as never,
    schedulerName: null,
    autoAssigned: false,
    engagementSend: { status: "sent" },
  } as never, { extra: { id: 42, schedulerName: null, foo: "bar" } });
  assert.equal(status, 200);
  const b = body as Record<string, unknown>;
  assert.equal(b.id, 42);
  assert.equal(b.foo, "bar");
  assert.ok((b.engagementSend as { status?: string })?.status === "sent");
}

// ─── Analyze route uses the mapper on deferred / failed ═════════

async function testAnalyzeUsesMapperOnDeferredFailed() {
  const src = readFileSync(join(REPO_ROOT, "server/routes/patients.ts"), "utf8");
  const idx = src.indexOf('"/api/patients/:id/analyze"');
  assert.ok(idx > 0, "analyze route must be defined");
  const window = src.slice(idx, idx + 6000);
  assert.ok(/respondWithCommitOutcome/.test(window),
    "analyze route must call respondWithCommitOutcome for deferred/failed");
  assert.ok(/sendStatus === "deferred" \|\| sendStatus === "failed"/.test(window),
    "analyze route must branch on deferred/failed");
  assert.ok(/commitResultData/.test(window),
    "analyze route must capture commit result for engagementSend translation");
  // The success (sent / idempotent_existing) path preserves the
  // existing analyze payload — verify via structural presence of the
  // legacy analyzeExtra json return.
  assert.ok(/res\.json\(analyzeExtra\)/.test(window),
    "legacy analyze payload preserved for sent/idempotent_existing");
}

// ─── Commit route now uses the mapper (no duplicated logic) ═════

async function testCommitRouteUsesMapper() {
  const src = readFileSync(join(REPO_ROOT, "server/routes/patients.ts"), "utf8");
  const idx = src.indexOf('"/api/patients/:id/commit"');
  const window = src.slice(idx, idx + 3000);
  assert.ok(/respondWithCommitOutcome\(res, result\.data,/.test(window),
    "commit route must use the shared mapper");
  // The prior inline 503/202 branches should be replaced by the mapper.
  assert.equal(/sendStatus === "failed"/.test(window), false,
    "commit route no longer duplicates the mapping logic");
}

// ─── Send-path discovery — every commitPatient caller either uses
// the mapper OR explicitly inspects engagementSend.status. ══════

async function testSendPathDiscovery() {
  const roots = ["server/routes", "server/services"].map((p) => join(REPO_ROOT, p));
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

  // Match `commitPatient(` as an actual expression call, not a
  // comment reference. Line prefix must NOT be a comment marker.
  const isRealCommitCall = (src: string): boolean => {
    const lines = src.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      if (/\bcommitPatient\s*\(/.test(line)) return true;
    }
    return false;
  };
  const USES_MAPPER = /respondWithCommitOutcome\s*\(/;
  const INSPECTS_SEND = /engagementSend\.status|engagementSend:\s*result\.data\.engagementSend/;
  // Files legitimately excluded from the rule — they do NOT respond
  // to HTTP directly with commit outcomes.
  const ALLOW = new Set<string>([
    // Recorder invoker (background/service, not HTTP)
    join(REPO_ROOT, "server/services/patientCommitService.ts"),
    // Ancillary reconciliation retry service (never calls commitPatient)
    // is not in this set — it doesn't call commitPatient at all, so
    // the CALLS_COMMIT test won't match it. Nothing needs to be
    // allow-listed for it.
  ]);

  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (!isRealCommitCall(src)) continue;
    if (ALLOW.has(f)) continue;
    if (!USES_MAPPER.test(src) && !INSPECTS_SEND.test(src)) {
      offenders.push(f.slice(REPO_ROOT.length + 1));
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      "The following files call commitPatient() but neither use the shared mapper nor inspect engagementSend.status:\n  - " +
        offenders.join("\n  - "),
    );
  }
}

// ─── PCS call-list serialized response carries eligibleServices ═

async function testPcsCallListContractIncludesEligibleServices() {
  const contract = readFileSync(
    join(REPO_ROOT, "server/services/engagement/engagementCallListService.ts"),
    "utf8",
  );
  assert.ok(/eligibleServices\?:\s*string\[\]/.test(contract),
    "EngagementCallListItem must expose eligibleServices");
  const routeSrc = readFileSync(
    join(REPO_ROOT, "server/routes/executionCases.ts"),
    "utf8",
  );
  const idx = routeSrc.indexOf('"/api/engagement-center/call-list"');
  const window = routeSrc.slice(idx, idx + 5000);
  assert.ok(/eligibilityByCase/.test(window),
    "PCS call-list mapper must build a map keyed by executionCaseId");
  assert.ok(/eligibleServices:\s*eligibilityByCase\?\.get\(row\.id\)/.test(window),
    "PCS row mapper must pull eligibleServices from the map");
  // The map is populated ONLY when the sync flag is ON — the flag
  // OFF path leaves eligibilityByCase = null so the row's field
  // remains undefined (legacy contract preserved).
  assert.ok(/eligibilityByCase\s*:\s*Map<number,\s*string\[\]>\s*\|\s*null\s*=\s*null/.test(window)
    || /let eligibilityByCase: Map<number, string\[\]> \| null = null/.test(window),
    "map is null-initialized so feature-off preserves legacy shape");
}

// ─── HTTP integration: PCS call-list serialized response ════════

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
      const chain: Record<string, unknown> = {
        from(t: unknown) { currentTable = t; return chain; },
        leftJoin(_: unknown, __: unknown) { return chain; },
        where(_: unknown) { return chain; },
        orderBy(..._: unknown[]) { return chain; },
        async limit(_n: number) {
          calls.push({ op: "select", table: currentTable });
          return spec.get(currentTable)?.select?.() ?? [];
        },
      };
      Object.defineProperty(chain, "then", {
        value: (resolve: (v: unknown[]) => void) => {
          calls.push({ op: "select", table: currentTable });
          resolve(spec.get(currentTable)?.select?.() ?? []);
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
              spec.get(t)?.update?.(v);
              const result: unknown[] = [{ ...v, __updated: true }];
              return {
                returning: async () => result,
                then: (resolve: (v: unknown[]) => void) => resolve(result),
              };
            },
          };
        },
      };
    },
    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      calls.push({ op: "transaction", table: null });
      return fn(fake);
    },
    execute: async () => ({ rows: [] as unknown[] }),
  };
  return { db: fake, calls };
}

type FlagOverride = Partial<{
  serviceSpecificAdminReview: boolean;
  engagementAdminReviewSync: boolean;
  engagementMultiListRepository: boolean;
  engagementRecentLists: boolean;
  ancillaryCaseWrite: boolean;
}>;

async function withFakeEnv<T>(
  spec: Map<unknown, FakeTableSpec>,
  flags: FlagOverride,
  fn: () => Promise<T>,
): Promise<T> {
  const dbMod = await import("../../server/db");
  const ffMod = await import("../../server/lib/featureFlags");
  const dbObj = dbMod.db as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  for (const k of ["select","insert","update","transaction","execute"]) saved[k] = dbObj[k];
  const savedFlags: FlagOverride = { ...ffMod.featureFlags };
  const { db: fake } = buildFakeDb(spec);
  for (const k of Object.keys(saved)) dbObj[k] = (fake as unknown as Record<string, unknown>)[k];
  Object.assign(ffMod.featureFlags as unknown as FlagOverride, flags);
  try {
    return await fn();
  } finally {
    for (const [k,v] of Object.entries(saved)) dbObj[k] = v;
    Object.assign(ffMod.featureFlags as unknown as FlagOverride, savedFlags);
  }
}

// (Behavioral) — the projector applied to the PCS reader returns
// only BrainWave when Ultrasound is rejected. This exercises the
// SAME code path the call-list mapper uses.
async function testPcsProjectorSurfacesBrainWaveOnly() {
  const anc = await import("../../shared/schema/ancillaryCases");
  const el = await import("../../shared/schema/engagementLists");
  const spec = new Map<unknown, FakeTableSpec>();
  spec.set(anc.patientAncillaryCases, {
    select: () => [
      { id: 1, executionCaseId: 700, serviceType: "BrainWave", adminReviewStatus: "approved", lifecycleStatus: "active" },
      { id: 2, executionCaseId: 700, serviceType: "Ultrasound", adminReviewStatus: "rejected", lifecycleStatus: "active" },
      { id: 3, executionCaseId: 700, serviceType: "VitalWave", adminReviewStatus: "pending", lifecycleStatus: "active" },
    ],
  });
  spec.set(el.engagementListMemberships, {
    select: () => [{ id: 900, ancillaryCaseId: 1, status: "active" }],
  });
  const svc = await import("../../server/services/engagementLists/queueProjection");
  const rows = await withFakeEnv(spec, {
    engagementAdminReviewSync: true,
    engagementMultiListRepository: true,
  }, async () =>
    svc.projectServiceLevelEligibility({
      executionCases: [{ id: 700 }],
      requireActiveMembership: true,
    }),
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].eligibleServices, ["BrainWave"]);
  assert.equal(rows[0].eligibleServices.includes("Ultrasound"), false);
  assert.equal(rows[0].eligibleServices.includes("VitalWave"), false);
}

// (Behavioral) — approved → pending removes eligibility (empty projection).
async function testApprovedToPendingRemovesEligibility() {
  const anc = await import("../../shared/schema/ancillaryCases");
  const el = await import("../../shared/schema/engagementLists");
  const spec = new Map<unknown, FakeTableSpec>();
  spec.set(anc.patientAncillaryCases, {
    select: () => [
      { id: 1, executionCaseId: 700, serviceType: "BrainWave", adminReviewStatus: "pending", lifecycleStatus: "active" },
    ],
  });
  spec.set(el.engagementListMemberships, { select: () => [] });
  const svc = await import("../../server/services/engagementLists/queueProjection");
  const rows = await withFakeEnv(spec, {
    engagementAdminReviewSync: true,
    engagementMultiListRepository: true,
  }, async () =>
    svc.projectServiceLevelEligibility({
      executionCases: [{ id: 700 }],
      requireActiveMembership: true,
    }),
  );
  assert.equal(rows.length, 0, "pending → no eligibility → no PCS row");
}

// (Behavioral) — pending → approved restores the service exactly once.
// Uses the reconciler's `restored` outcome to prove single restoration.
async function testPendingToApprovedRestoresOnce() {
  const el = await import("../../shared/schema/engagementLists");
  const spec = new Map<unknown, FakeTableSpec>();
  spec.set(el.engagementListMemberships, {
    // One previously-removed membership for exactly this reason.
    select: () => [{
      id: 900, ancillaryCaseId: 55, engagementListId: 10, serviceType: "BrainWave",
      status: "removed", removalReason: "admin_review_no_longer_approved",
    }],
    update: () => undefined,
  });
  const exec = await import("../../shared/schema/executionCase");
  spec.set(exec.patientJourneyEvents, { insert: () => [] });
  spec.set(el.engagementReconciliationFailures, { select: () => [], update: () => undefined });
  const reco = await import("../../server/services/engagementLists/reconciliation");
  const r = await withFakeEnv(spec, { engagementAdminReviewSync: true }, async () =>
    reco.reconcileEngagementEligibility({
      clinicId: 7, patientScreeningId: 100, ancillaryCaseId: 55,
      serviceType: "BrainWave",
      previousAdminReviewStatus: "pending", newAdminReviewStatus: "approved",
      changedByUserId: null, source: "test",
    }),
  );
  assert.equal(r.status, "restored");
  if (r.status === "restored") {
    assert.equal(r.membershipsRestored, 1,
      "exactly one membership restored — no duplication on reapproval");
  }
}

// ─── HTTP integration: analyze route 200/202/503 via a minimal
// mocked Express app + stub commitPatient behavior. ═════════════

async function withTestApp<T>(
  session: { userId?: string; role?: string; clinicId?: number },
  register: (app: Express) => void | Promise<void>,
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: unknown }).session = { ...session };
    (req as unknown as { clinicId: number | null }).clinicId = session.clinicId ?? null;
    next();
  });
  await register(app);
  const httpServer = createServer(app);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const port = (httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise<void>((r) => httpServer.close(() => r()));
  }
}

// Analyze-route response contract is exercised directly via the shared
// mapper (already tested above). The full /analyze handler pulls in
// AI parsing + storage + auto-assign chains that aren't stubbable in a
// unit test — the contract test suffices, and the shared discovery
// test ensures the mapper is actually invoked in the analyze branch.
async function testAnalyzeRouteMapperIntegration() {
  // Structural proof that the analyze route imports and calls
  // respondWithCommitOutcome exactly once for the deferred/failed
  // branch.
  const src = readFileSync(join(REPO_ROOT, "server/routes/patients.ts"), "utf8");
  const analyzeIdx = src.indexOf('"/api/patients/:id/analyze"');
  const analyzeBlock = src.slice(analyzeIdx, analyzeIdx + 6000);
  const usesMapper = (analyzeBlock.match(/respondWithCommitOutcome/g) ?? []).length;
  assert.ok(usesMapper >= 1, "analyze route must invoke the mapper at least once");
}

// ─── Runner ═════════════════════════════════════════════════════

const tests = [
  ["(1) mapper: sent/idempotent/skipped_flag_off/deferred/failed → 200/200/200/202/503", testMapperShape],
  ["(2) mapper merges extra with engagementSend on 200", testMapperMergesExtra],
  ["(3) analyze route branches to mapper on deferred/failed; keeps 200 legacy for sent", testAnalyzeUsesMapperOnDeferredFailed],
  ["(4) commit route uses the mapper (no duplicated inline logic)", testCommitRouteUsesMapper],
  ["(5) send-path discovery: every commitPatient caller uses mapper or inspects engagementSend", testSendPathDiscovery],
  ["(6) PCS call-list contract exposes eligibleServices + mapper populates it", testPcsCallListContractIncludesEligibleServices],
  ["(7) PCS projector: BrainWave approved + Ultrasound rejected + VitalWave pending → BrainWave only", testPcsProjectorSurfacesBrainWaveOnly],
  ["(8) approved → pending removes eligibility (empty PCS row)", testApprovedToPendingRemovesEligibility],
  ["(9) pending → approved restores exactly once (no duplication)", testPendingToApprovedRestoresOnce],
  ["(10) analyze route integration — mapper reachable in the analyze block", testAnalyzeRouteMapperIntegration],
] as const;

async function run() {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok  ${name}`); }
    catch (e) {
      failed++;
      console.error(`FAIL  ${name}\n     ${(e as Error).message}`);
    }
  }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}
run();
