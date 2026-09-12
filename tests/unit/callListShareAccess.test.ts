// Task 8 — secure share ACCESS contract (public endpoint behavior).
//
// The public endpoint resolves a package strictly via token-hash lookup +
// resolveShareAccess, and collapses every non-"ok" state (invalid / expired /
// revoked / feature-off) into a UNIFORM outcome so a caller cannot tell whether
// another package exists. This locks the resolution logic used by the route's
// resolveSharePackage() and the uniform-404 mapping.
//
// Run: DATABASE_URL='postgres://u:p@localhost:5432/x' npx tsx tests/unit/callListShareAccess.test.ts

import assert from "node:assert/strict";
import {
  mintShareToken,
  hashShareToken,
  resolveShareAccess,
  defaultShareExpiry,
} from "../../server/services/engagement/callListShareToken";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Mirror of the route's resolveSharePackage → "grant | uniform-deny" decision,
// exercised against fabricated stored package rows (no DB).
function grantsAccess(
  presentedToken: string,
  storedPkg: {
    shareTokenHash: string | null;
    shareExpiresAt: Date | null;
    shareRevokedAt: Date | null;
    status: string;
  } | null,
  featureOn: boolean,
  now: Date,
): boolean {
  if (!featureOn) return false; // feature-off → uniform deny
  if (!storedPkg) return false; // unknown token → uniform deny
  return (
    resolveShareAccess(
      presentedToken,
      {
        storedHash: storedPkg.shareTokenHash,
        expiresAt: storedPkg.shareExpiresAt,
        revokedAt: storedPkg.shareRevokedAt,
        status: storedPkg.status,
      },
      now,
    ) === "ok"
  );
}

console.log("callListShareAccess:");

const now = new Date("2026-09-12T00:00:00.000Z");

check("valid token on active unexpired package grants access", () => {
  const { token, tokenHash } = mintShareToken();
  const pkg = { shareTokenHash: tokenHash, shareExpiresAt: defaultShareExpiry(now), shareRevokedAt: null, status: "active" };
  assert.equal(grantsAccess(token, pkg, true, now), true);
});

check("unknown token (hash miss) → deny (uniform)", () => {
  const { token } = mintShareToken();
  // Simulate lookup miss: server would find no package by hash.
  assert.equal(grantsAccess(token, null, true, now), false);
});

check("revoked package → deny even if unexpired", () => {
  const { token, tokenHash } = mintShareToken();
  const pkg = { shareTokenHash: tokenHash, shareExpiresAt: defaultShareExpiry(now), shareRevokedAt: now, status: "active" };
  assert.equal(grantsAccess(token, pkg, true, now), false);
});

check("expired package → deny", () => {
  const { token, tokenHash } = mintShareToken();
  const pkg = { shareTokenHash: tokenHash, shareExpiresAt: new Date("2026-09-11T00:00:00.000Z"), shareRevokedAt: null, status: "active" };
  assert.equal(grantsAccess(token, pkg, true, now), false);
});

check("regenerated token: OLD token no longer grants (hash replaced)", () => {
  const first = mintShareToken();
  const second = mintShareToken(); // regeneration stored a new hash
  const pkg = { shareTokenHash: second.tokenHash, shareExpiresAt: defaultShareExpiry(now), shareRevokedAt: null, status: "active" };
  assert.equal(grantsAccess(first.token, pkg, true, now), false);
  assert.equal(grantsAccess(second.token, pkg, true, now), true);
});

check("feature OFF → deny (indistinguishable from invalid)", () => {
  const { token, tokenHash } = mintShareToken();
  const pkg = { shareTokenHash: tokenHash, shareExpiresAt: defaultShareExpiry(now), shareRevokedAt: null, status: "active" };
  assert.equal(grantsAccess(token, pkg, false, now), false);
});

check("hashShareToken is what the route looks up by (deterministic)", () => {
  const { token, tokenHash } = mintShareToken();
  assert.equal(hashShareToken(token), tokenHash);
});

console.log(`\ncallListShareAccess: ${passed} checks passed\n`);
