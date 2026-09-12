// Task 3/6 — snapshot retention math (PURE). The DB-backed purge behaviors
// (PHI nulling, blob delete, idempotency, tenant-safety) are exercised in
// tests/acceptance/callListRetention.test.ts against a live DB.
//
// Run: DATABASE_URL='postgres://u:p@localhost:5432/x' npx tsx tests/unit/callListRetention.test.ts

import assert from "node:assert/strict";
import {
  SNAPSHOT_RETENTION_DAYS,
  computeSnapshotRetentionUntil,
} from "../../server/repositories/callListPackages.repo";
import { DEFAULT_SHARE_TTL_HOURS } from "../../server/services/engagement/callListShareToken";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("callListRetention:");

check("approved snapshot retention is 90 days", () => {
  assert.equal(SNAPSHOT_RETENTION_DAYS, 90);
});

check("computeSnapshotRetentionUntil = created_at + 90 days", () => {
  const created = new Date("2026-09-12T00:00:00.000Z");
  const until = computeSnapshotRetentionUntil(created);
  assert.equal(until.toISOString(), "2026-12-11T00:00:00.000Z");
  assert.equal(until.getTime() - created.getTime(), 90 * 24 * 60 * 60 * 1000);
});

check("snapshot retention (90d) is independent of share expiry (72h)", () => {
  const created = new Date("2026-09-12T00:00:00.000Z");
  const retention = computeSnapshotRetentionUntil(created);
  const shareExpiryMs = DEFAULT_SHARE_TTL_HOURS * 60 * 60 * 1000;
  const retentionMs = retention.getTime() - created.getTime();
  // 90 days is far longer than the 72h share window — expiring the link never
  // reaches the snapshot retention cutoff.
  assert.ok(retentionMs > shareExpiryMs);
  assert.equal(DEFAULT_SHARE_TTL_HOURS, 72);
});

console.log(`\ncallListRetention: ${passed} checks passed\n`);
