// Phase 4 — active-work CLAIM pure decision logic. DB-free, deterministic.
// (workClaimService imports server/db lazily; a dummy DATABASE_URL keeps the
// import graph happy — no connection is opened by these pure functions.)
// Run: npx tsx tests/unit/workClaims.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import {
  isClaimActive,
  patientLockKey,
  decideClaimForCallResult,
} from "../../server/services/engagement/workClaimService";

async function main() {
  const now = new Date("2026-09-06T12:00:00Z");
  const future = new Date(now.getTime() + 60_000);
  const past = new Date(now.getTime() - 60_000);

  // ── isClaimActive: by != null AND expires > now ───────────────────────────
  assert.equal(isClaimActive({ activeClaimBy: null, activeClaimExpiresAt: null }, now), false, "empty → inactive");
  assert.equal(isClaimActive({ activeClaimBy: 5, activeClaimExpiresAt: null }, now), false, "no expiry → inactive");
  assert.equal(isClaimActive({ activeClaimBy: 5, activeClaimExpiresAt: past }, now), false, "expired → inactive");
  assert.equal(isClaimActive({ activeClaimBy: 5, activeClaimExpiresAt: future }, now), true, "held + future → active");
  assert.equal(isClaimActive({ activeClaimBy: null, activeClaimExpiresAt: future }, now), false, "no holder → inactive");
  assert.equal(isClaimActive({ activeClaimBy: 5, activeClaimExpiresAt: future.toISOString() }, now), true, "string expiry coerced");
  assert.equal(isClaimActive({ activeClaimBy: 5, activeClaimExpiresAt: now }, now), false, "exactly-now → expired (strict >)");

  // ── patientLockKey: stable, case/space-insensitive, dob-sensitive ─────────
  const k1 = patientLockKey("John Doe", "1990-01-01");
  const k2 = patientLockKey("  john doe ", "1990-01-01");
  assert.deepEqual(k1, k2, "trim + lowercase → identical key");
  const k3 = patientLockKey("John Doe", "1991-02-02");
  assert.ok(k1[0] !== k3[0] || k1[1] !== k3[1], "different dob → different key");
  const kNull = patientLockKey("Jane Roe", null);
  assert.ok(Number.isInteger(kNull[0]) && Number.isInteger(kNull[1]), "null dob → valid int32 pair");
  const kNull2 = patientLockKey("jane roe", null);
  assert.deepEqual(kNull, kNull2, "null dob stable");

  // ── decideClaimForCallResult: the call-result stale/release decision ──────
  // No active claim → allow, nothing to release (pre-Phase-4 fast path).
  assert.deepEqual(
    decideClaimForCallResult({ activeClaimBy: null, activeClaimExpiresAt: null }, 1, false, now),
    { reject: false, heldBySubmitter: false, holderSchedulerId: null },
    "no claim → allow, no release",
  );
  // Expired claim → treated as no claim.
  {
    const d = decideClaimForCallResult({ activeClaimBy: 2, activeClaimExpiresAt: past }, 1, false, now);
    assert.equal(d.reject, false);
    assert.equal(d.heldBySubmitter, false);
  }
  // Held by the submitter → allow + release-on-success.
  assert.deepEqual(
    decideClaimForCallResult({ activeClaimBy: 1, activeClaimExpiresAt: future }, 1, false, now),
    { reject: false, heldBySubmitter: true, holderSchedulerId: 1 },
    "holder → allow + release",
  );
  // Held by ANOTHER scheduler, non-admin → REJECT (stale/concurrent).
  assert.deepEqual(
    decideClaimForCallResult({ activeClaimBy: 2, activeClaimExpiresAt: future }, 1, false, now),
    { reject: true, heldBySubmitter: false, holderSchedulerId: 2 },
    "stale submitter → reject",
  );
  // Admin override → allowed, and does NOT claim-release the other member's work.
  assert.deepEqual(
    decideClaimForCallResult({ activeClaimBy: 2, activeClaimExpiresAt: future }, 1, true, now),
    { reject: false, heldBySubmitter: false, holderSchedulerId: 2 },
    "admin bypass → allow, no release of other's claim",
  );
  // A submitter with no roster identity (null) cannot be the holder → reject.
  assert.equal(
    decideClaimForCallResult({ activeClaimBy: 2, activeClaimExpiresAt: future }, null, false, now).reject,
    true,
    "null submitter vs active claim → reject",
  );

  console.log("workClaims unit test: all checks passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
