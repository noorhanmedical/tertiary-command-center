// Unit tests for the PUBLIC share hardening (production hardening):
//   • sliding-window rate limiting (access + stricter PIN attempts),
//   • uniform behavior regardless of token validity (no validity leak),
//   • optional PIN: requiresPin gate + bcrypt hash/compare round-trip,
//   • token access states still govern (revoked/expired/invalid).
// Pure / crypto only — no DB, no HTTP.
//
// Run: npx tsx tests/unit/callListShareHardening.test.ts

import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import {
  consumeShareRateLimit,
  __resetShareRateLimitsForTests,
  SHARE_ACCESS_MAX,
  SHARE_PIN_MAX,
} from "../../server/services/engagement/callListShareRateLimit";
import {
  requiresPin,
  resolveShareAccess,
  hashShareToken,
  mintShareToken,
} from "../../server/services/engagement/callListShareToken";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
async function checkAsync(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function main() {
  console.log("callListShareHardening:");

  // ── Rate limiting ─────────────────────────────────────────────────────────
  check("rate limit: allows up to max, then blocks within the window", () => {
    __resetShareRateLimitsForTests();
    const key = "share:1.2.3.4";
    for (let i = 0; i < SHARE_ACCESS_MAX; i++) {
      assert.equal(consumeShareRateLimit(key, SHARE_ACCESS_MAX, 60_000, 1_000), true, `req ${i}`);
    }
    // (max+1)th within the same window is blocked
    assert.equal(consumeShareRateLimit(key, SHARE_ACCESS_MAX, 60_000, 1_000), false);
  });

  check("rate limit: window slides — allowed again after it passes", () => {
    __resetShareRateLimitsForTests();
    const key = "share:9.9.9.9";
    assert.equal(consumeShareRateLimit(key, 2, 1_000, 0), true);
    assert.equal(consumeShareRateLimit(key, 2, 1_000, 0), true);
    assert.equal(consumeShareRateLimit(key, 2, 1_000, 0), false); // full
    assert.equal(consumeShareRateLimit(key, 2, 1_000, 2_000), true); // window passed
  });

  check("rate limit: PIN limit is stricter than access limit", () => {
    assert.ok(SHARE_PIN_MAX < SHARE_ACCESS_MAX, "PIN attempts must be stricter");
  });

  check("rate limit: keyed independently (no cross-key leakage / uniform per IP)", () => {
    __resetShareRateLimitsForTests();
    // Two different IPs get independent buckets — a valid vs invalid token from
    // different clients don't interfere; validity is never the bucket key.
    assert.equal(consumeShareRateLimit("share:a", 1, 60_000, 0), true);
    assert.equal(consumeShareRateLimit("share:a", 1, 60_000, 0), false);
    assert.equal(consumeShareRateLimit("share:b", 1, 60_000, 0), true);
  });

  // ── Optional PIN gate ───────────────────────────────────────────────────────
  check("requiresPin: only true when a non-empty hash is present", () => {
    assert.equal(requiresPin({ sharePinHash: null }), false);
    assert.equal(requiresPin({ sharePinHash: "" }), false);
    assert.equal(requiresPin({ sharePinHash: undefined }), false);
    assert.equal(requiresPin({ sharePinHash: "$2a$12$abc" }), true);
  });

  await checkAsync("PIN bcrypt round-trip: correct verifies, wrong rejects", async () => {
    const hash = await bcrypt.hash("4821", 12);
    assert.ok(hash && hash !== "4821", "PIN is hashed, never stored plaintext");
    assert.equal(await bcrypt.compare("4821", hash), true);
    assert.equal(await bcrypt.compare("0000", hash), false);
    assert.equal(await bcrypt.compare("", hash), false);
  });

  // ── Token access states still govern the surface ────────────────────────────
  check("token access: valid ok; revoked/expired/invalid all denied", () => {
    const { token, tokenHash } = mintShareToken();
    const now = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2026-01-02T00:00:00Z");
    const past = new Date("2025-12-31T00:00:00Z");
    // ok
    assert.equal(
      resolveShareAccess(token, { storedHash: tokenHash, expiresAt: future, revokedAt: null, status: "active" }, now),
      "ok",
    );
    // revoked (checked before expiry)
    assert.equal(
      resolveShareAccess(token, { storedHash: tokenHash, expiresAt: future, revokedAt: now, status: "active" }, now),
      "revoked",
    );
    // expired
    assert.equal(
      resolveShareAccess(token, { storedHash: tokenHash, expiresAt: past, revokedAt: null, status: "active" }, now),
      "expired",
    );
    // wrong token
    assert.equal(
      resolveShareAccess("not-the-token", { storedHash: tokenHash, expiresAt: future, revokedAt: null, status: "active" }, now),
      "invalid",
    );
  });

  check("regenerated token: the OLD token no longer resolves", () => {
    const first = mintShareToken();
    const second = mintShareToken(); // regenerate → new hash stored
    const now = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2026-01-02T00:00:00Z");
    // old token against the NEW stored hash → invalid
    assert.equal(
      resolveShareAccess(first.token, { storedHash: second.tokenHash, expiresAt: future, revokedAt: null, status: "active" }, now),
      "invalid",
    );
  });

  check("token hashing is deterministic + never equals plaintext", () => {
    const { token, tokenHash } = mintShareToken();
    assert.equal(hashShareToken(token), tokenHash);
    assert.notEqual(tokenHash, token);
    assert.equal(tokenHash.length, 64); // sha256 hex
  });

  console.log(`\ncallListShareHardening: ${passed} checks passed\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
