// In-process sliding-window rate limiter for the PUBLIC Engagement call-list
// share surface. Reuses the platform's established hand-rolled bucket pattern
// (see server/services/messaging/messagingService.ts) rather than introducing
// a new rate-limit framework — express-rate-limit is NOT a dependency.
//
// Two independent limits are exposed:
//   • SHARE_ACCESS_* — throttles token-resolution reads (GET /:token, /pdf,
//     and POST /verify-pin) keyed by client IP. Applied BEFORE the token is
//     resolved so a valid and an invalid token are throttled identically —
//     the 429 never leaks whether a token exists.
//   • SHARE_PIN_* — a stricter limit on PIN attempts, keyed by token-hash+IP,
//     so a bearer-token holder cannot brute-force a package PIN.
//
// Buckets are per-process (best-effort). Behind the ALB the app trusts the
// first hop (app.set("trust proxy", 1)), so req.ip is the real client IP.

type Timestamps = number[];

const buckets = new Map<string, Timestamps>();

/** Public share ACCESS limit (token reads). Generous but bounds scraping. */
export const SHARE_ACCESS_MAX = 30;
export const SHARE_ACCESS_WINDOW_MS = 60_000;

/** PIN-attempt limit (per token-hash + IP). Strict — anti-brute-force. */
export const SHARE_PIN_MAX = 5;
export const SHARE_PIN_WINDOW_MS = 60_000;

/**
 * Consume one token from the sliding window for `key`. Returns true when the
 * request is ALLOWED (and records it), false when the limit is exceeded. Pure
 * given `now` (injectable for tests).
 */
export function consumeShareRateLimit(
  key: string,
  max: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  const fresh = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (fresh.length >= max) {
    buckets.set(key, fresh);
    return false;
  }
  fresh.push(now);
  buckets.set(key, fresh);
  return true;
}

/** Test-only: clear all buckets between cases. */
export function __resetShareRateLimitsForTests(): void {
  buckets.clear();
}
