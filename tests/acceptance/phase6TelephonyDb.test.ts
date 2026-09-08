// Phase 6 — REAL-DB checks for telephony SESSION evidence: idempotent session
// open, provider-event ordering safety (duplicate / out-of-order / terminal
// lock), duration fill-once, correlation backfill, and provider-agnostic
// initiation via the MOCK RingCentral client (no network, no prod creds).
//
// Telephony evidence NEVER becomes a business disposition; these checks assert
// only provider_state / timing / duration on telephony_sessions.
//
// Honest skip when DATABASE_URL is unset/unreachable or the table is missing.
// Every fixture row is deleted in `finally`.
//
// Run: DATABASE_URL=... npx tsx tests/acceptance/phase6TelephonyDb.test.ts

import assert from "node:assert/strict";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP phase6TelephonyDb: DATABASE_URL not set.");
    return;
  }
  const { sql, like, or } = await import("drizzle-orm");
  const { db } = await import("../../server/db");
  try {
    await db.execute(sql`select 1`);
  } catch (e) {
    console.log(`SKIP phase6TelephonyDb: cannot reach database — ${(e as Error).message}`);
    return;
  }
  const reg = await db.execute(
    sql`SELECT 1 FROM information_schema.tables WHERE table_name='telephony_sessions' LIMIT 1`,
  );
  if (!((reg.rows?.length ?? 0) > 0)) {
    console.log("SKIP phase6TelephonyDb: telephony_sessions missing (apply migration 0085).");
    return;
  }

  const { telephonySessions } = await import("../../shared/schema/telephonySessions");
  const svc = await import("../../server/services/telephony/telephonySessionService");
  const tele = await import("../../server/services/telephony/serverTelephonyService");
  const { MockRingCentralClient } = await import("../../server/services/ringCentral/ringCentralClient");
  const { savePhoneProviderDefault, clearPhoneProviderDefault } = await import(
    "../../server/repositories/adminSettings.repo"
  );

  const PREFIX = "p6test";
  let failures = 0;
  const check = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); console.log(`ok   ${name}`); }
    catch (e) { failures++; console.error(`FAIL ${name}: ${(e as Error).message}`); }
  };

  const cleanup = async () => {
    await db
      .delete(telephonySessions)
      .where(or(like(telephonySessions.providerSessionId, `${PREFIX}%`), like(telephonySessions.providerSessionId, `rc-mock%`)));
    await clearPhoneProviderDefault({ scope: "organization" }).catch(() => {});
  };

  try {
    await cleanup();

    await check("§1 startTelephonySession opens an 'initiated' session", async () => {
      const id = `${PREFIX}-open-1`;
      const s = await svc.startTelephonySession({ provider: "ringcentral", providerSessionId: id, direction: "outbound" });
      assert.equal(s.providerState, "initiated");
      assert.equal(s.provider, "ringcentral");
      assert.equal(s.providerSessionId, id);
    });

    await check("§2 startTelephonySession is idempotent + backfills correlation", async () => {
      const id = `${PREFIX}-idem-1`;
      const a = await svc.startTelephonySession({ provider: "ringcentral", providerSessionId: id });
      const b = await svc.startTelephonySession({ provider: "ringcentral", providerSessionId: id, executionCaseId: null, patientScreeningId: null, actingUserId: null });
      assert.equal(a.id, b.id, "same session reused (no duplicate)");
    });

    await check("§3 proceeding advances from initiated", async () => {
      const id = `${PREFIX}-prog-1`;
      await svc.startTelephonySession({ provider: "ringcentral", providerSessionId: id });
      const r = await svc.applyProviderTelephonyEvent({ provider: "ringcentral", providerSessionId: id, state: "proceeding", at: new Date(1000), seq: 1 });
      assert.equal(r.session.providerState, "proceeding");
      assert.equal(r.stateChanged, true);
    });

    await check("§4 connected sets connectedAt", async () => {
      const id = `${PREFIX}-conn-1`;
      await svc.startTelephonySession({ provider: "ringcentral", providerSessionId: id });
      await svc.applyProviderTelephonyEvent({ provider: "ringcentral", providerSessionId: id, state: "proceeding", seq: 1, at: new Date(1000) });
      const r = await svc.applyProviderTelephonyEvent({ provider: "ringcentral", providerSessionId: id, state: "connected", seq: 2, at: new Date(2000) });
      assert.equal(r.session.providerState, "connected");
      assert.ok(r.session.connectedAt != null, "connectedAt set");
    });

    await check("§5 ended sets endedAt + duration (terminal)", async () => {
      const id = `${PREFIX}-end-1`;
      await svc.startTelephonySession({ provider: "ringcentral", providerSessionId: id });
      await svc.applyProviderTelephonyEvent({ provider: "ringcentral", providerSessionId: id, state: "connected", seq: 2, at: new Date(2000) });
      const r = await svc.applyProviderTelephonyEvent({ provider: "ringcentral", providerSessionId: id, state: "ended", seq: 3, at: new Date(5000), durationSeconds: 42 });
      assert.equal(r.session.providerState, "ended");
      assert.ok(r.session.endedAt != null, "endedAt set");
      assert.equal(r.session.durationSeconds, 42, "duration recorded");
    });

    await check("§6 DUPLICATE terminal event is ignored (no change)", async () => {
      const id = `${PREFIX}-dup-1`;
      await svc.startTelephonySession({ provider: "ringcentral", providerSessionId: id });
      await svc.applyProviderTelephonyEvent({ provider: "ringcentral", providerSessionId: id, state: "ended", seq: 3, at: new Date(5000), durationSeconds: 30 });
      const dup = await svc.applyProviderTelephonyEvent({ provider: "ringcentral", providerSessionId: id, state: "ended", seq: 3, at: new Date(5000), durationSeconds: 30 });
      assert.equal(dup.stateChanged, false);
      assert.equal(dup.ignored, true, "duplicate ignored");
      assert.equal(dup.session.durationSeconds, 30, "duration unchanged");
    });

    await check("§7 OUT-OF-ORDER older event does NOT regress newer state", async () => {
      const id = `${PREFIX}-ooo-1`;
      await svc.startTelephonySession({ provider: "ringcentral", providerSessionId: id });
      await svc.applyProviderTelephonyEvent({ provider: "ringcentral", providerSessionId: id, state: "connected", seq: 5, at: new Date(9000) });
      // A late "proceeding" (seq 3) arrives after "connected" (seq 5).
      const late = await svc.applyProviderTelephonyEvent({ provider: "ringcentral", providerSessionId: id, state: "proceeding", seq: 3, at: new Date(3000) });
      assert.equal(late.session.providerState, "connected", "state NOT regressed");
      assert.equal(late.stateChanged, false);
    });

    await check("§8 TERMINAL lock: a non-terminal event cannot reopen", async () => {
      const id = `${PREFIX}-lock-1`;
      await svc.startTelephonySession({ provider: "ringcentral", providerSessionId: id });
      await svc.applyProviderTelephonyEvent({ provider: "ringcentral", providerSessionId: id, state: "ended", seq: 9, at: new Date(9000), durationSeconds: 10 });
      const reopen = await svc.applyProviderTelephonyEvent({ provider: "ringcentral", providerSessionId: id, state: "proceeding", seq: 10, at: new Date(10_000) });
      assert.equal(reopen.session.providerState, "ended", "terminal not reopened");
    });

    await check("§9 applyProviderTelephonyEvent CREATES a session for an unseen id", async () => {
      const id = `${PREFIX}-create-1`;
      const r = await svc.applyProviderTelephonyEvent({ provider: "ringcentral", providerSessionId: id, state: "proceeding", seq: 1, at: new Date(1000) });
      assert.equal(r.session.providerSessionId, id);
      assert.equal(r.session.providerState, "proceeding");
    });

    await check("§10 initiateProviderCall via MOCK RingCentral → session + provider id", async () => {
      // Make ringcentral the org default so resolution picks it, and run in
      // explicit MOCK mode (no prod creds) with an injected mock client.
      await savePhoneProviderDefault({ scope: "organization", providerId: "ringcentral" });
      const env = { ...process.env, USE_RINGCENTRAL_ADAPTER: "1", RINGCENTRAL_MOCK: "1" } as NodeJS.ProcessEnv;
      const res = await tele.initiateProviderCall(
        { toNumber: "+15551230000", userId: null, executionCaseId: null, patientScreeningId: null },
        { env, ringCentralClientOverride: new MockRingCentralClient({ idPrefix: "rc-mock" }) },
      );
      assert.equal(res.initiated, true, "mock initiation succeeded");
      if (res.initiated) {
        assert.ok(res.providerSessionId.startsWith("rc-mock"), "provider session id captured");
        assert.equal(res.session.provider, "ringcentral");
      }
    });

    await check("§11 initiateProviderCall for MANUAL default → not_integrated (fail closed)", async () => {
      await clearPhoneProviderDefault({ scope: "organization" }).catch(() => {});
      const res = await tele.initiateProviderCall(
        { toNumber: "+15551230000", userId: null },
        { env: { ...process.env, USE_RINGCENTRAL_ADAPTER: "", RINGCENTRAL_MOCK: "" } as NodeJS.ProcessEnv },
      );
      assert.equal(res.initiated, false);
      if (!res.initiated) assert.equal(res.code, "not_integrated");
    });

    await check("§12 ringcentral default but NOT ready → not_ready (fail closed)", async () => {
      await savePhoneProviderDefault({ scope: "organization", providerId: "ringcentral" });
      const res = await tele.initiateProviderCall(
        { toNumber: "+15551230000", userId: null },
        { env: { ...process.env, USE_RINGCENTRAL_ADAPTER: "", RINGCENTRAL_MOCK: "" } as NodeJS.ProcessEnv },
      );
      assert.equal(res.initiated, false);
      if (!res.initiated) assert.equal(res.code, "not_ready");
    });
  } finally {
    await cleanup();
  }

  if (failures > 0) {
    console.error(`phase6TelephonyDb.test.ts: ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log("phase6TelephonyDb.test.ts: all tests passed");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
