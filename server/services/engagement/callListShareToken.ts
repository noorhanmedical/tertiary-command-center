// Secure share-token service for Engagement call-list packages.
//
// Trust model (approved): the share URL itself is the credential — a
// cryptographically random 256-bit bearer token. Only its sha256 HASH is
// stored server-side; the plaintext is returned exactly once at mint /
// regenerate. Default access window is 72 hours. Managers can extend,
// regenerate (invalidates the old token immediately), and revoke (effective
// immediately). No PIN by default. No PHI in the token.
//
// This module is PURE (crypto only, no DB) so it is unit-testable and reused
// by both the package repository (Task 2) and the public share endpoint
// (Task 8), which is the single place that maps a non-OK access state to a
// UNIFORM external response (never revealing whether another package exists).

import { randomBytes, createHash, timingSafeEqual } from "crypto";

/** 32 bytes = 256-bit token. Encoded url-safe (base64url, no padding). */
export const SHARE_TOKEN_BYTES = 32;
/** Default share-access window (approved): 72 hours. */
export const DEFAULT_SHARE_TTL_HOURS = 72;

export type MintedShareToken = {
  /** Plaintext bearer token — returned to the manager ONCE, never persisted. */
  token: string;
  /** sha256 hex hash — the ONLY value stored server-side. */
  tokenHash: string;
};

/** sha256 hex of a token string. The stored + lookup form. */
export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Mint a fresh random bearer token + its hash. */
export function mintShareToken(): MintedShareToken {
  const token = randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashShareToken(token) };
}

/** Constant-time comparison of a presented token against a stored hash. */
export function shareTokenMatches(
  presentedToken: string,
  storedHash: string | null | undefined,
): boolean {
  if (!presentedToken || !storedHash) return false;
  const presentedHash = hashShareToken(presentedToken);
  // Both are 64-char hex (sha256); equal length makes timingSafeEqual safe.
  if (presentedHash.length !== storedHash.length) return false;
  try {
    return timingSafeEqual(Buffer.from(presentedHash), Buffer.from(storedHash));
  } catch {
    return false;
  }
}

/** Default share expiry = now + 72h. */
export function defaultShareExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + DEFAULT_SHARE_TTL_HOURS * 60 * 60 * 1000);
}

/** Extend an expiry by N hours from `now` (never shortens below current). */
export function extendShareExpiry(
  currentExpiry: Date | null,
  hours: number,
  now: Date = new Date(),
): Date {
  const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
  const extended = new Date(base.getTime() + Math.max(0, hours) * 60 * 60 * 1000);
  return extended;
}

// ─── Access resolution ──────────────────────────────────────────────────────
// The precise state is for INTERNAL use (logging/audit). The public endpoint
// must collapse every non-"ok" state into ONE uniform external response so a
// caller cannot distinguish revoked / expired / unknown / wrong-token.
export type ShareAccessState = "ok" | "invalid" | "expired" | "revoked";

export type ShareAccessInput = {
  /** Stored token hash for the candidate package (null when never minted). */
  storedHash: string | null | undefined;
  expiresAt: Date | null | undefined;
  revokedAt: Date | null | undefined;
  /** Package lifecycle status ("active" | "archived" | "cancelled"). */
  status: string | null | undefined;
};

/** Resolve whether a presented token grants access to a package snapshot.
 *  Revocation and non-active lifecycle deny even before expiry. */
export function resolveShareAccess(
  presentedToken: string | null | undefined,
  pkg: ShareAccessInput,
  now: Date = new Date(),
): ShareAccessState {
  if (!presentedToken || !shareTokenMatches(presentedToken, pkg.storedHash)) {
    return "invalid";
  }
  if (pkg.revokedAt != null) return "revoked";
  if ((pkg.status ?? "active") !== "active") return "revoked";
  if (pkg.expiresAt != null && pkg.expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }
  return "ok";
}
