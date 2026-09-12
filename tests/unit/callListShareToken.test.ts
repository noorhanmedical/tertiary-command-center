// Unit tests for the secure call-list share-token service (Task 2).
//
// Pure crypto — no DB. Verifies token entropy/shape, hash-only storage,
// constant-time match, default 72h expiry, extension, and access resolution
// (invalid / expired / revoked / ok). The public endpoint (Task 8) collapses
// every non-"ok" state into a uniform external response — these tests assert
// the internal precise state the endpoint maps from.
//
// Run: DATABASE_URL='postgres://u:p@localhost:5432/x' npx tsx tests/unit/callListShareToken.test.ts

import assert from "node:assert/strict";
import {
  mintShareToken,
  hashShareToken,
  shareTokenMatches,
  defaultShareExpiry,
  extendShareExpiry,
  resolveShareAccess,
  DEFAULT_SHARE_TTL_HOURS,
} from "../../server/services/engagement/callListShareToken";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("callListShareToken:");

check("mint returns a high-entropy url-safe token + sha256 hex hash", () => {
  const { token, tokenHash } = mintShareToken();
  // base64url of 32 bytes → 43 chars, url-safe alphabet only, no padding.
  assert.ok(token.length >= 43, "token too short");
  assert.match(token, /^[A-Za-z0-9_-]+$/, "token must be url-safe (no PHI, no +/=)");
  assert.match(tokenHash, /^[0-9a-f]{64}$/, "hash must be sha256 hex");
  assert.equal(hashShareToken(token), tokenHash, "hash must be deterministic");
});

check("two mints are distinct (random)", () => {
  const a = mintShareToken();
  const b = mintShareToken();
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.tokenHash, b.tokenHash);
});

check("shareTokenMatches: correct token matches stored hash; wrong does not", () => {
  const { token, tokenHash } = mintShareToken();
  assert.equal(shareTokenMatches(token, tokenHash), true);
  assert.equal(shareTokenMatches("wrong-token", tokenHash), false);
  assert.equal(shareTokenMatches(token, null), false);
  assert.equal(shareTokenMatches("", tokenHash), false);
});

check("defaultShareExpiry is now + 72h", () => {
  const now = new Date("2026-09-12T00:00:00.000Z");
  const exp = defaultShareExpiry(now);
  assert.equal(exp.getTime() - now.getTime(), DEFAULT_SHARE_TTL_HOURS * 3600 * 1000);
  assert.equal(exp.toISOString(), "2026-09-15T00:00:00.000Z");
});

check("extendShareExpiry extends from later of now/current, never shortens", () => {
  const now = new Date("2026-09-12T00:00:00.000Z");
  const future = new Date("2026-09-14T00:00:00.000Z");
  // current in the future → extend from current.
  assert.equal(
    extendShareExpiry(future, 24, now).toISOString(),
    "2026-09-15T00:00:00.000Z",
  );
  // already-expired current → extend from now.
  const past = new Date("2026-09-10T00:00:00.000Z");
  assert.equal(
    extendShareExpiry(past, 24, now).toISOString(),
    "2026-09-13T00:00:00.000Z",
  );
  // null current → extend from now.
  assert.equal(
    extendShareExpiry(null, 48, now).toISOString(),
    "2026-09-14T00:00:00.000Z",
  );
});

check("resolveShareAccess — ok when token valid, active, unexpired", () => {
  const now = new Date("2026-09-12T00:00:00.000Z");
  const { token, tokenHash } = mintShareToken();
  const state = resolveShareAccess(
    token,
    { storedHash: tokenHash, expiresAt: defaultShareExpiry(now), revokedAt: null, status: "active" },
    now,
  );
  assert.equal(state, "ok");
});

check("resolveShareAccess — invalid for wrong/missing token", () => {
  const now = new Date("2026-09-12T00:00:00.000Z");
  const { tokenHash } = mintShareToken();
  const base = { storedHash: tokenHash, expiresAt: defaultShareExpiry(now), revokedAt: null, status: "active" };
  assert.equal(resolveShareAccess("nope", base, now), "invalid");
  assert.equal(resolveShareAccess(null, base, now), "invalid");
  assert.equal(resolveShareAccess(undefined, base, now), "invalid");
});

check("resolveShareAccess — revoked (revokedAt or non-active) beats expiry", () => {
  const now = new Date("2026-09-12T00:00:00.000Z");
  const { token, tokenHash } = mintShareToken();
  assert.equal(
    resolveShareAccess(
      token,
      { storedHash: tokenHash, expiresAt: defaultShareExpiry(now), revokedAt: now, status: "active" },
      now,
    ),
    "revoked",
  );
  assert.equal(
    resolveShareAccess(
      token,
      { storedHash: tokenHash, expiresAt: defaultShareExpiry(now), revokedAt: null, status: "cancelled" },
      now,
    ),
    "revoked",
  );
});

check("resolveShareAccess — expired when past the window", () => {
  const now = new Date("2026-09-12T00:00:00.000Z");
  const { token, tokenHash } = mintShareToken();
  const state = resolveShareAccess(
    token,
    {
      storedHash: tokenHash,
      expiresAt: new Date("2026-09-11T00:00:00.000Z"),
      revokedAt: null,
      status: "active",
    },
    now,
  );
  assert.equal(state, "expired");
});

check("regenerated token: old token no longer matches new hash", () => {
  const first = mintShareToken();
  const second = mintShareToken(); // simulate regeneration → new stored hash
  assert.equal(shareTokenMatches(first.token, second.tokenHash), false);
  assert.equal(shareTokenMatches(second.token, second.tokenHash), true);
});

console.log(`\ncallListShareToken: ${passed} checks passed\n`);
