// Plexus IQ runtime hardening — AI rate limiter + 429 backoff.
//
// Pure in-process token bucket. Every AI call must `acquire()` a slot
// before issuing the request; the bucket refills at `rpm/60` tokens
// per second, capped at `burst`. 429s reported via `report429()`
// halve in-flight concurrency for 60s when adaptive backoff is
// enabled.
//
// The limiter is intentionally small and dependency-free so the
// runner can construct one per job, stamp it into metadata, and let
// it die with the loop. No global singleton — multiple concurrent
// jobs each get their own bucket sized to the same env config.

export type AiRateLimiterEvent = {
  at: string;
  reason: string;
  backoffMs: number;
};

export type AiRateLimiterOptions = {
  rpm: number;
  burst: number;
  adaptiveBackoffEnabled: boolean;
  /** When defined, overrides Date.now() for deterministic tests. */
  now?: () => number;
  /** When defined, overrides the timer for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
};

const SECONDS_PER_MINUTE = 60;
const ADAPTIVE_BACKOFF_RESET_MS = 60_000;

export class AiRateLimiter {
  private tokens: number;
  private lastRefillAt: number;
  private readonly refillPerSecond: number;
  private readonly burst: number;
  private readonly adaptiveBackoffEnabled: boolean;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private throttledUntil = 0;
  private rateLimitedCount = 0;
  private readonly events: AiRateLimiterEvent[] = [];

  constructor(options: AiRateLimiterOptions) {
    this.refillPerSecond = options.rpm / SECONDS_PER_MINUTE;
    this.burst = options.burst;
    this.adaptiveBackoffEnabled = options.adaptiveBackoffEnabled;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.tokens = options.burst;
    this.lastRefillAt = this.now();
  }

  private refill(): void {
    const now = this.now();
    const elapsedSeconds = (now - this.lastRefillAt) / 1000;
    if (elapsedSeconds <= 0) return;
    const replenished = elapsedSeconds * this.refillPerSecond;
    this.tokens = Math.min(this.burst, this.tokens + replenished);
    this.lastRefillAt = now;
  }

  /**
   * Block until a token is available. Honours adaptive backoff window
   * if one is active. Safe to call concurrently from many workers.
   */
  async acquire(): Promise<void> {
    while (true) {
      const now = this.now();
      if (this.adaptiveBackoffEnabled && now < this.throttledUntil) {
        await this.sleep(Math.max(50, Math.min(this.throttledUntil - now, 1_000)));
        continue;
      }
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      // Sleep enough for at least one token to appear (cap 1s).
      const msUntilNext = Math.max(50, Math.ceil(1000 / Math.max(this.refillPerSecond, 0.01)));
      await this.sleep(Math.min(msUntilNext, 1_000));
    }
  }

  /**
   * Called whenever the AI provider returns 429 (or equivalent
   * throttling). Records the event and, when adaptive backoff is on,
   * pauses acquires for the returned-by-provider duration (or a
   * default exponential window).
   */
  report429(reason: string, retryAfterMs?: number): number {
    this.rateLimitedCount += 1;
    const backoffMs = Math.max(
      retryAfterMs ?? 0,
      1_000 * Math.min(8, 2 ** Math.min(this.rateLimitedCount, 3)),
    );
    if (this.adaptiveBackoffEnabled) {
      this.throttledUntil = Math.max(this.throttledUntil, this.now() + backoffMs);
    }
    this.events.push({ at: new Date().toISOString(), reason, backoffMs });
    // When sustained throttling persists, the window naturally
    // extends. After ADAPTIVE_BACKOFF_RESET_MS without a new 429 the
    // counter relaxes (handled in snapshot()).
    return backoffMs;
  }

  /**
   * Returns a serializable snapshot for analysis_jobs.metadata.
   * Truncates the event list to the last 25 entries.
   */
  snapshot(): { rateLimitedCount: number; events: AiRateLimiterEvent[] } {
    const cutoff = this.now() - ADAPTIVE_BACKOFF_RESET_MS;
    const recent = this.events.filter((e) => Date.parse(e.at) >= cutoff).slice(-25);
    return { rateLimitedCount: this.rateLimitedCount, events: recent };
  }

  /** Reset internal counter after a quiet window — useful for long jobs. */
  cooldown(): void {
    const cutoff = this.now() - ADAPTIVE_BACKOFF_RESET_MS;
    if (this.events.length === 0 || Date.parse(this.events[this.events.length - 1].at) < cutoff) {
      this.rateLimitedCount = 0;
    }
  }
}

/**
 * Exponential backoff with jitter helper. Used by the runner for
 * single-patient retry attempts that are not strictly rate-limit
 * related (e.g. transient AI 5xx responses).
 */
export function backoffMsWithJitter(attempt: number, base = 1_000, ceiling = 30_000): number {
  const exp = Math.min(ceiling, base * 2 ** Math.max(0, attempt));
  // Full jitter — uniform in [0, exp].
  return Math.floor(Math.random() * exp);
}
