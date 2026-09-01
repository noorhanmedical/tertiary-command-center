// Phase 2D — canonical ancillary appointment domain-service behavior.
//
// Behavioral tests over an injected fake-db harness (same pattern as
// tests/unit/ancillaryCases.test.ts). No real database is touched; the
// db singleton's methods are swapped for a recording fake and
// FEATURE_CANONICAL_APPOINTMENT is toggled per test.
//
// Run standalone with:
//   npx tsx tests/unit/canonicalAppointmentsService.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";

// ─── Fake-db harness ─────────────────────────────────────────────
type TableSpec = {
  select?: () => unknown[];
  onInsert?: (v: Record<string, unknown>) => unknown[];
  onUpdate?: (v: Record<string, unknown>) => unknown[];
};
type Call = { op: string; table: unknown; payload?: unknown };

function buildFakeDb(spec: Map<unknown, TableSpec>) {
  const calls: Call[] = [];

  function selectResult(t: unknown): unknown[] {
    calls.push({ op: "select", table: t });
    const s = spec.get(t);
    return s?.select ? s.select() : [];
  }

  const fake = {
    select(_cols?: unknown) {
      let t: unknown = null;
      const chain: Record<string, unknown> = {
        from(x: unknown) { t = x; return chain; },
        leftJoin() { return chain; },
        innerJoin() { return chain; },
        where() { return chain; },
        orderBy() { return chain; },
        limit(_n: number) { return Promise.resolve(selectResult(t)); },
        then(res: (v: unknown[]) => void, rej?: (e: unknown) => void) {
          Promise.resolve()
            .then(() => selectResult(t))
            .then(res, rej);
        },
      };
      return chain;
    },
    insert(t: unknown) {
      return {
        values(v: Record<string, unknown>) {
          calls.push({ op: "insert", table: t, payload: v });
          const s = spec.get(t);
          const settle = () =>
            new Promise<unknown[]>((resolve, reject) => {
              try {
                resolve(s?.onInsert ? s.onInsert(v) : [v]);
              } catch (e) {
                reject(e);
              }
            });
          return {
            returning: () => settle(),
            then: (res: (v: unknown[]) => void, rej?: (e: unknown) => void) =>
              settle().then(res, rej),
          };
        },
      };
    },
    update(t: unknown) {
      return {
        set(v: Record<string, unknown>) {
          return {
            where() {
              calls.push({ op: "update", table: t, payload: v });
              const s = spec.get(t);
              const settle = () =>
                new Promise<unknown[]>((resolve, reject) => {
                  try {
                    resolve(s?.onUpdate ? s.onUpdate(v) : [{ ...v }]);
                  } catch (e) {
                    reject(e);
                  }
                });
              return {
                returning: () => settle(),
                then: (res: (v: unknown[]) => void, rej?: (e: unknown) => void) =>
                  settle().then(res, rej),
              };
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

async function runWithDb<T>(
  spec: Map<unknown, TableSpec>,
  flag: boolean,
  fn: (calls: Call[]) => Promise<T>,
): Promise<T> {
  const dbMod = await import("../../server/db");
  const flags = await import("../../server/lib/featureFlags");
  const dbObj = dbMod.db as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  for (const k of ["select", "insert", "update", "transaction", "execute"]) {
    saved[k] = dbObj[k];
  }
  const savedFlag = (flags.featureFlags as unknown as { canonicalAppointment: boolean }).canonicalAppointment;
  const { db: fake, calls } = buildFakeDb(spec);
  for (const k of Object.keys(saved)) {
    dbObj[k] = (fake as unknown as Record<string, unknown>)[k];
  }
  (flags.featureFlags as unknown as { canonicalAppointment: boolean }).canonicalAppointment = flag;
  try {
    return await fn(calls);
  } finally {
    for (const [k, v] of Object.entries(saved)) dbObj[k] = v;
    (flags.featureFlags as unknown as { canonicalAppointment: boolean }).canonicalAppointment = savedFlag;
  }
}

async function loadTables() {
  const anc = await import("../../shared/schema/ancillaryCases");
  const scr = await import("../../shared/schema/screening");
  const exec = await import("../../shared/schema/executionCase");
  const gse = await import("../../shared/schema/globalSchedule");
  const canon = await import("../../shared/schema/canonicalAppointments");
  return {
    ancillaryCases: anc.patientAncillaryCases,
    screenings: scr.patientScreenings,
    executionCases: exec.patientExecutionCases,
    journeyEvents: exec.patientJourneyEvents,
    gse: gse.globalScheduleEvents,
    carf: canon.canonicalAppointmentReconciliationFailures,
  };
}

const svcMod = () => import("../../server/services/canonicalAppointments/canonicalAppointmentService");
const repoMod = () => import("../../server/repositories/canonicalAppointments.repo");

const START = new Date("2026-02-01T10:00:00Z");
function baseCase(overrides: Record<string, unknown> = {}) {
  return {
    id: 5, clinicId: 1, serviceType: "EchoWave",
    originatingScreeningId: null, executionCaseId: null, ...overrides,
  };
}
function scheduledEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 100, clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment",
    serviceType: "EchoWave", status: "scheduled", patientScreeningId: null,
    executionCaseId: null, patientName: null, patientDob: null, facilityId: null, ...overrides,
  };
}

function specOf(entries: Array<[unknown, TableSpec]>): Map<unknown, TableSpec> {
  return new Map(entries);
}
function countOps(calls: Call[], op: string, table?: unknown): number {
  return calls.filter((c) => c.op === op && (table === undefined || c.table === table)).length;
}

// ─── (1) Create ancillary_appointment ────────────────────────────
async function testCreateAncillaryAppointment() {
  const t = await loadTables();
  const svc = await svcMod();
  const spec = specOf([
    [t.ancillaryCases, { select: () => [baseCase()] }],
    [t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: 100 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.carf, {}],
  ]);
  const res = await runWithDb(spec, true, async () =>
    svc.createCanonicalAncillaryAppointment({
      clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment",
      startsAt: START, source: "test",
    }),
  );
  assert.equal(res.status, "created");
  if (res.status === "created") assert.equal(res.event.id, 100);
}

// ─── (2) Create same_day_add ─────────────────────────────────────
async function testCreateSameDayAdd() {
  const t = await loadTables();
  const svc = await svcMod();
  const spec = specOf([
    [t.ancillaryCases, { select: () => [baseCase()] }],
    [t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: 101 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.carf, {}],
  ]);
  const res = await runWithDb(spec, true, async () =>
    svc.createCanonicalAncillaryAppointment({
      clinicId: 1, ancillaryCaseId: 5, eventType: "same_day_add",
      startsAt: START, source: "test",
    }),
  );
  assert.equal(res.status, "created");
  if (res.status === "created") assert.equal(res.event.eventType, "same_day_add");
}

// ─── (3) Refuse doctor_visit ─────────────────────────────────────
async function testRefuseDoctorVisit() {
  const t = await loadTables();
  const svc = await svcMod();
  const spec = specOf([[t.ancillaryCases, { select: () => [baseCase()] }]]);
  const res = await runWithDb(spec, true, async (calls) => {
    const r = await svc.createCanonicalAncillaryAppointment({
      clinicId: 1, ancillaryCaseId: 5, eventType: "doctor_visit" as never,
      startsAt: START, source: "test",
    });
    assert.equal(countOps(calls, "insert"), 0, "doctor_visit must not write");
    return r;
  });
  assert.equal(res.status, "invalid_event_type");
}

// ─── (4) Reuse active appointment ────────────────────────────────
async function testReuseActive() {
  const t = await loadTables();
  const svc = await svcMod();
  const spec = specOf([
    [t.ancillaryCases, { select: () => [baseCase()] }],
    [t.gse, { select: () => [scheduledEvent()] }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  const res = await runWithDb(spec, true, async (calls) => {
    const r = await svc.createCanonicalAncillaryAppointment({
      clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment",
      startsAt: START, source: "test",
    });
    assert.equal(countOps(calls, "insert", t.gse), 0, "reuse must not insert a new event");
    return r;
  });
  assert.equal(res.status, "reused");
  if (res.status === "reused") assert.equal(res.event.id, 100);
}

// ─── (5) Unique race rereads winner ──────────────────────────────
async function testUniqueRaceRereadsWinner() {
  const t = await loadTables();
  const svc = await svcMod();
  let gseSelects = 0;
  const spec = specOf([
    [t.ancillaryCases, { select: () => [baseCase()] }],
    [t.gse, {
      select: () => (gseSelects++ === 0 ? [] : [scheduledEvent({ id: 999 })]),
      onInsert: () => {
        const e = new Error("duplicate key value violates unique constraint") as Error & { code?: string };
        e.code = "23505";
        throw e;
      },
    }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  const res = await runWithDb(spec, true, async () =>
    svc.createCanonicalAncillaryAppointment({
      clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment",
      startsAt: START, source: "test",
    }),
  );
  assert.equal(res.status, "reused", "race must resolve to the winning row");
  if (res.status === "reused") assert.equal(res.event.id, 999);
}

// ─── (6) Different cases schedule independently ──────────────────
async function testDifferentCasesIndependent() {
  const t = await loadTables();
  const svc = await svcMod();
  async function createForCase(caseId: number, evtId: number) {
    const spec = specOf([
      [t.ancillaryCases, { select: () => [baseCase({ id: caseId })] }],
      [t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: evtId }] }],
      [t.journeyEvents, { onInsert: () => [] }],
      [t.carf, {}],
    ]);
    return runWithDb(spec, true, async () =>
      svc.createCanonicalAncillaryAppointment({
        clinicId: 1, ancillaryCaseId: caseId, eventType: "ancillary_appointment",
        startsAt: START, source: "test",
      }),
    );
  }
  const a = await createForCase(5, 100);
  const b = await createForCase(6, 200);
  assert.equal(a.status, "created");
  assert.equal(b.status, "created");
  if (a.status === "created" && b.status === "created") {
    assert.notEqual(a.event.id, b.event.id, "distinct cases produce distinct events");
  }
}

// ─── (7) Clinic mismatch rejected ────────────────────────────────
async function testClinicMismatch() {
  const t = await loadTables();
  const svc = await svcMod();
  const spec = specOf([[t.ancillaryCases, { select: () => [baseCase({ clinicId: 2 })] }]]);
  const res = await runWithDb(spec, true, async (calls) => {
    const r = await svc.createCanonicalAncillaryAppointment({
      clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment",
      startsAt: START, source: "test",
    });
    assert.equal(countOps(calls, "insert", t.gse), 0, "cross-clinic must not write");
    return r;
  });
  assert.equal(res.status, "cross_clinic_denied");
}

// ─── (8) Service mismatch rejected ───────────────────────────────
async function testServiceMismatch() {
  const t = await loadTables();
  const svc = await svcMod();
  const spec = specOf([[t.ancillaryCases, { select: () => [baseCase({ serviceType: "EchoWave" })] }]]);
  const res = await runWithDb(spec, true, async (calls) => {
    const r = await svc.createCanonicalAncillaryAppointment({
      clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment",
      serviceType: "SleepWave", startsAt: START, source: "test",
    });
    assert.equal(countOps(calls, "insert", t.gse), 0, "service mismatch must not write");
    return r;
  });
  assert.equal(res.status, "service_type_mismatch");
}

// ─── (9) Screening-clinic mismatch rejected ──────────────────────
async function testScreeningClinicMismatch() {
  const t = await loadTables();
  const svc = await svcMod();
  const spec = specOf([
    [t.ancillaryCases, { select: () => [baseCase({ originatingScreeningId: 77 })] }],
    [t.screenings, { select: () => [{ id: 77, clinicId: 2, name: "x", dob: null, facility: null }] }],
  ]);
  const res = await runWithDb(spec, true, async (calls) => {
    const r = await svc.createCanonicalAncillaryAppointment({
      clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment",
      startsAt: START, source: "test",
    });
    assert.equal(countOps(calls, "insert", t.gse), 0);
    return r;
  });
  assert.equal(res.status, "cross_clinic_denied");
}

// ─── (10) Execution-case-clinic mismatch rejected ────────────────
async function testExecutionCaseClinicMismatch() {
  const t = await loadTables();
  const svc = await svcMod();
  const spec = specOf([
    [t.ancillaryCases, { select: () => [baseCase({ executionCaseId: 88 })] }],
    [t.executionCases, { select: () => [{ id: 88, clinicId: 2 }] }],
  ]);
  const res = await runWithDb(spec, true, async () =>
    svc.createCanonicalAncillaryAppointment({
      clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment",
      startsAt: START, source: "test",
    }),
  );
  assert.equal(res.status, "cross_clinic_denied");
}

// ─── (11) Complete scheduled event ───────────────────────────────
async function testCompleteScheduled() {
  const t = await loadTables();
  const svc = await svcMod();
  const spec = specOf([
    [t.gse, {
      select: () => [scheduledEvent()],
      onUpdate: (v) => [{ ...scheduledEvent(), ...v }],
    }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  const res = await runWithDb(spec, true, async () =>
    svc.completeCanonicalAppointment({ eventId: 100, clinicId: 1, source: "test" }),
  );
  assert.equal(res.status, "completed");
  if (res.status === "completed") assert.equal(res.event.status, "completed");
}

// ─── (12) Cancel requires reason ─────────────────────────────────
async function testCancelRequiresReason() {
  const t = await loadTables();
  const svc = await svcMod();
  const spec = specOf([[t.gse, { select: () => [scheduledEvent()] }]]);
  const missing = await runWithDb(spec, true, async (calls) => {
    const r = await svc.cancelCanonicalAppointment({ eventId: 100, clinicId: 1, source: "test", reason: "  " });
    assert.equal(countOps(calls, "update", t.gse), 0, "no reason → no state change");
    return r;
  });
  assert.equal(missing.status, "reason_required");
  // With a reason it cancels.
  const spec2 = specOf([
    [t.gse, { select: () => [scheduledEvent()], onUpdate: (v) => [{ ...scheduledEvent(), ...v }] }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  const ok = await runWithDb(spec2, true, async () =>
    svc.cancelCanonicalAppointment({ eventId: 100, clinicId: 1, source: "test", reason: "patient request" }),
  );
  assert.equal(ok.status, "cancelled");
}

// ─── (13) No-show requires reason ────────────────────────────────
async function testNoShowRequiresReason() {
  const t = await loadTables();
  const svc = await svcMod();
  const spec = specOf([[t.gse, { select: () => [scheduledEvent()] }]]);
  const missing = await runWithDb(spec, true, async (calls) => {
    const r = await svc.noShowCanonicalAppointment({ eventId: 100, clinicId: 1, source: "test", reason: "" });
    assert.equal(countOps(calls, "update", t.gse), 0);
    return r;
  });
  assert.equal(missing.status, "reason_required");
}

// ─── (14/15/16) Reschedule preserves prior, links parent, one active ─
async function testReschedule() {
  const t = await loadTables();
  const svc = await svcMod();
  const prior = scheduledEvent({ id: 100 });
  const spec = specOf([
    [t.gse, {
      select: () => [prior],
      onUpdate: (v) => [{ ...prior, ...v }], // prior → rescheduled
      onInsert: (v) => [{ ...v, id: 200 }],  // new scheduled event
    }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  const res = await runWithDb(spec, true, async () =>
    svc.rescheduleCanonicalAppointment({
      eventId: 100, clinicId: 1, source: "test", newStartsAt: new Date("2026-03-01T09:00:00Z"),
    }),
  );
  assert.equal(res.status, "rescheduled");
  if (res.status === "rescheduled") {
    // (14) prior preserved as historical 'rescheduled'
    assert.equal(res.prior?.status, "rescheduled");
    assert.equal(res.prior?.id, 100);
    // (15) new event points back to prior
    assert.equal(res.next.parentEventId, 100);
    assert.equal(res.next.id, 200);
    // (16) only the new event is 'scheduled' (active)
    assert.equal(res.next.status, "scheduled");
    assert.equal(res.next.ancillaryCaseId, 5, "case preserved");
    assert.equal(res.next.serviceType, "EchoWave", "service preserved");
    assert.equal(res.next.clinicId, 1, "clinic preserved");
  }
}

// ─── (17) Invalid transition rejected ────────────────────────────
async function testInvalidTransition() {
  const t = await loadTables();
  const svc = await svcMod();
  const spec = specOf([[t.gse, { select: () => [scheduledEvent({ status: "completed" })] }]]);
  const res = await runWithDb(spec, true, async (calls) => {
    const r = await svc.completeCanonicalAppointment({ eventId: 100, clinicId: 1, source: "test" });
    assert.equal(countOps(calls, "update", t.gse), 0, "non-scheduled event must not transition");
    return r;
  });
  assert.equal(res.status, "invalid_transition");
}

// ─── (18) Scheduling failure creates retry work ──────────────────
async function testSchedulingFailureCreatesRetry() {
  const t = await loadTables();
  const svc = await svcMod();
  const spec = specOf([
    [t.ancillaryCases, { select: () => [baseCase()] }],
    [t.gse, {
      select: () => [],
      onInsert: () => {
        const e = new Error("connection lost") as Error & { code?: string };
        e.code = "08006";
        throw e;
      },
    }],
    [t.carf, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  await runWithDb(spec, true, async (calls) => {
    await assert.rejects(
      svc.createCanonicalAncillaryAppointment({
        clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment",
        startsAt: START, source: "test",
      }),
      "scheduling failure must not be swallowed",
    );
    assert.equal(countOps(calls, "insert", t.carf), 1, "a durable retry row must be recorded");
  });
}

// ─── (19) Retry recording is idempotent ──────────────────────────
async function testRetryIdempotent() {
  const t = await loadTables();
  const repo = await repoMod();
  let carfSelects = 0;
  const existing = {
    id: 1, clinicId: 1, ancillaryCaseId: 5, requestedAction: "create",
    attemptCount: 1, errorCode: "x", sourceSystem: "test", resolvedAt: null,
  };
  const spec = specOf([
    [t.carf, {
      select: () => (carfSelects++ === 0 ? [] : [existing]),
      onInsert: (v) => [{ ...v, id: 1 }],
      onUpdate: (v) => [{ ...existing, ...v }],
    }],
  ]);
  await runWithDb(spec, true, async (calls) => {
    await repo.recordCanonicalAppointmentFailure({
      clinicId: 1, ancillaryCaseId: 5, requestedAction: "create", sourceSystem: "test", errorCode: "x",
    });
    await repo.recordCanonicalAppointmentFailure({
      clinicId: 1, ancillaryCaseId: 5, requestedAction: "create", sourceSystem: "test", errorCode: "y",
    });
    assert.equal(countOps(calls, "insert", t.carf), 1, "second identical failure must not insert a new row");
    assert.equal(countOps(calls, "update", t.carf), 1, "second identical failure must bump the existing row");
  });
}

// ─── (20) Feature OFF performs zero canonical reads/writes ────────
async function testFlagOffZeroCanonicalIo() {
  const t = await loadTables();
  const svc = await svcMod();
  const spec = specOf([
    [t.ancillaryCases, { select: () => [baseCase()] }],
    [t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  await runWithDb(spec, false, async (calls) => {
    const create = await svc.createCanonicalAncillaryAppointment({
      clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment",
      startsAt: START, source: "test",
    });
    assert.equal(create.status, "skipped_flag_off");
    const complete = await svc.completeCanonicalAppointment({ eventId: 100, clinicId: 1, source: "test" });
    assert.equal(complete.status, "skipped_flag_off");
    const elig = await svc.isOrderNoteAppointmentEligible({ ancillaryCaseId: 5 });
    assert.equal(elig.eligible, false);
    assert.equal(countOps(calls, "select"), 0, "flag OFF must issue zero reads");
    assert.equal(countOps(calls, "insert"), 0, "flag OFF must issue zero writes");
    assert.equal(countOps(calls, "update"), 0, "flag OFF must issue zero writes");
  });
}

// ─── (21) Order Note appointment eligibility rules ───────────────
async function testOrderNoteEligibility() {
  const t = await loadTables();
  const svc = await svcMod();
  async function evalEligibility(events: unknown[]) {
    const spec = specOf([
      [t.ancillaryCases, { select: () => [{ id: 5, serviceType: "EchoWave" }] }],
      [t.gse, { select: () => events }],
    ]);
    return runWithDb(spec, true, async () => svc.isOrderNoteAppointmentEligible({ ancillaryCaseId: 5 }));
  }
  // scheduled ancillary_appointment qualifies
  assert.equal((await evalEligibility([scheduledEvent()])).eligible, true);
  // completed ancillary_appointment qualifies
  assert.equal((await evalEligibility([scheduledEvent({ status: "completed" })])).eligible, true);
  // completed same_day_add qualifies
  assert.equal((await evalEligibility([scheduledEvent({ eventType: "same_day_add", status: "completed" })])).eligible, true);
  // cancelled never qualifies
  assert.equal((await evalEligibility([scheduledEvent({ status: "cancelled" })])).eligible, false);
  // no_show never qualifies
  assert.equal((await evalEligibility([scheduledEvent({ status: "no_show" })])).eligible, false);
  // rescheduled prior never qualifies
  assert.equal((await evalEligibility([scheduledEvent({ status: "rescheduled" })])).eligible, false);
  // doctor_visit never qualifies (listCanonical filters it out entirely → no matching event)
  assert.equal((await evalEligibility([scheduledEvent({ eventType: "doctor_visit" })])).eligible, false);
  // wrong service type never qualifies
  const wrongSvc = await evalEligibility([scheduledEvent({ serviceType: "SleepWave" })]);
  assert.equal(wrongSvc.eligible, false);
  if (!wrongSvc.eligible) assert.equal(wrongSvc.reason, "service_type_mismatch");
}

// ─── (22) Audit metadata contains no PHI ─────────────────────────
async function testAuditNoPhi() {
  const t = await loadTables();
  const svc = await svcMod();
  let journeyPayload: Record<string, unknown> | null = null;
  const spec = specOf([
    [t.ancillaryCases, { select: () => [baseCase()] }],
    [t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: 100 }] }],
    [t.journeyEvents, {
      onInsert: (v) => { journeyPayload = v; return []; },
    }],
    [t.carf, {}],
  ]);
  await runWithDb(spec, true, async () =>
    svc.createCanonicalAncillaryAppointment({
      clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment",
      startsAt: START, source: "test", actorUserId: "user-1",
    }),
  );
  assert.ok(journeyPayload, "a journey/audit event should be written");
  const p = journeyPayload as Record<string, unknown>;
  // Sentinel name, no DOB.
  assert.equal(p.patientName, "[canonical_appointment_audit]");
  assert.equal(p.patientDob, null);
  // Metadata carries only ids/codes — scan for forbidden PHI tokens.
  const blob = JSON.stringify(p.metadata ?? {}).toLowerCase();
  for (const forbidden of ["patient_name", "\"name\"", "dob", "mrn", "phone", "insurance", "diagnosis", "medication", "reasoning"]) {
    assert.ok(!blob.includes(forbidden), `audit metadata must not contain PHI token: ${forbidden}`);
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) create ancillary_appointment", testCreateAncillaryAppointment],
  ["(2) create same_day_add", testCreateSameDayAdd],
  ["(3) refuse doctor_visit", testRefuseDoctorVisit],
  ["(4) reuse active appointment", testReuseActive],
  ["(5) unique race rereads winner", testUniqueRaceRereadsWinner],
  ["(6) different cases schedule independently", testDifferentCasesIndependent],
  ["(7) clinic mismatch rejected", testClinicMismatch],
  ["(8) service mismatch rejected", testServiceMismatch],
  ["(9) screening-clinic mismatch rejected", testScreeningClinicMismatch],
  ["(10) execution-case-clinic mismatch rejected", testExecutionCaseClinicMismatch],
  ["(11) complete scheduled event", testCompleteScheduled],
  ["(12) cancel requires reason", testCancelRequiresReason],
  ["(13) no-show requires reason", testNoShowRequiresReason],
  ["(14-16) reschedule preserves prior + links parent + one active", testReschedule],
  ["(17) invalid transition rejected", testInvalidTransition],
  ["(18) scheduling failure creates retry work", testSchedulingFailureCreatesRetry],
  ["(19) retry recording is idempotent", testRetryIdempotent],
  ["(20) feature OFF performs zero canonical reads/writes", testFlagOffZeroCanonicalIo],
  ["(21) Order Note appointment eligibility rules", testOrderNoteEligibility],
  ["(22) audit metadata contains no PHI", testAuditNoPhi],
];

async function run() {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok  ${name}`);
    } catch (e) {
      failed++;
      console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${tests.length} tests passed`);
}

run();
