// Login brute-force throttling — time-bound, no permanent lockout.
//
// Rules (HIPAA auth hygiene):
//   - Throttle repeated FAILED login attempts from the same client key.
//   - Time-bound only — a legitimate clinician is never permanently locked out;
//     the throttle window auto-expires.
//   - Keyed primarily by client IP so it does NOT disclose whether an account
//     exists (no account enumeration); the response is generic.
//   - A successful login clears the counter for that key.
//   - Emits PHI-safe structural security events only (no username, no password,
//     no session id).
//
// Storage: in-memory per-process. Adequate for a single-task staging service.
// NOTE (prod): for multi-task/HA, move this to a shared store (e.g. Redis or a
// DB table) so throttling is enforced across instances. Documented, not a
// blocker for staging.

import type { Request, Response, NextFunction } from "express";

const WINDOW_MS = 15 * 60 * 1000; // rolling window for counting failures
const MAX_FAILURES = 8; // failures within window before throttling
const BLOCK_MS = 15 * 60 * 1000; // throttle duration once tripped (time-bound)

type Entry = { failures: number[]; blockedUntil: number };
const attempts = new Map<string, Entry>();

function clientKey(req: Request): string {
  // req.ip honors `trust proxy` (set in server/index.ts) so it reflects the
  // real client behind the ALB. Fall back to socket address.
  return (req.ip || req.socket.remoteAddress || "unknown").toString();
}

function prune(entry: Entry, now: number): void {
  entry.failures = entry.failures.filter((t) => now - t < WINDOW_MS);
}

function safeLog(event: string, key: string): void {
  // Structural only; key is an IP (operational, not clinical PHI).
  console.warn(
    JSON.stringify({ source: "auth_throttle", event, client: key }),
  );
}

/** Pre-handler guard: block when the client is currently throttled. */
export function loginRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const key = clientKey(req);
  const now = Date.now();
  const entry = attempts.get(key);
  if (entry && entry.blockedUntil > now) {
    const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    safeLog("blocked", key);
    // Generic message — same style as a bad credential; no enumeration.
    res.status(429).json({ error: "Too many attempts. Please try again later." });
    return;
  }
  next();
}

/** Record the outcome of a login attempt. Call from the login handler. */
export function noteLoginResult(req: Request, success: boolean): void {
  const key = clientKey(req);
  const now = Date.now();
  if (success) {
    attempts.delete(key); // clear on success
    return;
  }
  const entry = attempts.get(key) ?? { failures: [], blockedUntil: 0 };
  prune(entry, now);
  entry.failures.push(now);
  if (entry.failures.length >= MAX_FAILURES) {
    entry.blockedUntil = now + BLOCK_MS;
    entry.failures = [];
    safeLog("throttle_engaged", key);
  }
  attempts.set(key, entry);
}

/** Test/ops helper: current throttle state for a key (no PHI). */
export function _loginThrottleState(key: string): Entry | undefined {
  return attempts.get(key);
}
