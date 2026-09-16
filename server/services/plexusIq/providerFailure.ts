/**
 * Centralized Plexus IQ provider-failure classification + a process-local
 * billing-exhaustion circuit breaker.
 *
 * WHY CENTRALIZE (§17): provider errors arrive as arbitrary strings/status
 * codes. Parsing them ad-hoc in multiple callers drifts. This is the ONE place
 * that maps a raw error → a stable category + retryable flag + user-safe text.
 *
 * WHY A BREAKER (§18): a `429 "no credits remaining"` is BILLING exhaustion,
 * not transient rate limiting. Without a breaker the runner burns the rest of
 * the cohort into identical billing errors. When broad billing exhaustion is
 * detected the runner trips this breaker and STOPS scheduling new provider
 * work, leaving untouched rows as draft/pending and completed rows intact.
 */

export type ProviderFailureCategory =
  | "billing_quota_exhausted"
  | "rate_limited"
  | "connection_error"
  | "context_too_large"
  | "context_too_large_after_compaction"
  | "provider_400_other"
  | "provider_5xx"
  | "unknown_provider_error";

export type ProviderFailureClassification = {
  category: ProviderFailureCategory;
  /** Whether a failed-only retry could plausibly succeed later. */
  retryable: boolean;
  /** Whether this indicates the account is out of credits/quota (breaker trip). */
  isBillingExhaustion: boolean;
  /** Concise, non-sensitive message safe for operator UI. Never contains keys. */
  userMessage: string;
};

function extract(err: unknown): { status?: number; message: string; code?: string } {
  if (!err) return { message: "" };
  const e = err as { message?: string; status?: number; statusCode?: number; code?: string };
  return {
    status: e.status ?? e.statusCode,
    message: (e.message ?? String(err)).toLowerCase(),
    code: e.code,
  };
}

/**
 * Classify a caught provider error deterministically. Order matters: billing
 * exhaustion is detected BEFORE generic 429 rate limiting.
 */
export function classifyProviderFailure(err: unknown): ProviderFailureClassification {
  const { status, message, code } = extract(err);

  // Our own pre-send guard from the context budgeter.
  if (code === "context_too_large_after_compaction" || message.includes("context_too_large_after_compaction")) {
    return {
      category: "context_too_large_after_compaction",
      retryable: false,
      isBillingExhaustion: false,
      userMessage: "Patient record too large even after compaction.",
    };
  }

  // Billing / quota exhaustion — a 429 (or 403) whose message names credits/
  // quota/billing. This is NOT transient. Trips the breaker.
  const billingSignal =
    message.includes("no credits remaining") ||
    message.includes("insufficient_quota") ||
    message.includes("exceeded your current quota") ||
    message.includes("billing") ||
    (message.includes("quota") && message.includes("credit"));
  if (billingSignal) {
    return {
      category: "billing_quota_exhausted",
      retryable: true, // retryable once credits are restored — just not right now
      isBillingExhaustion: true,
      userMessage: "Provider credits are unavailable (billing quota exhausted).",
    };
  }

  // Provider max-context error (raw, before our guard would have caught it).
  if (message.includes("maximum context length") || message.includes("context_length_exceeded")) {
    return {
      category: "context_too_large",
      retryable: false,
      isBillingExhaustion: false,
      userMessage: "Patient record exceeded the model context window.",
    };
  }

  // Generic transient rate limiting (429 without a billing signal).
  if (status === 429 || message.includes("rate limit") || message.includes("too many requests")) {
    return {
      category: "rate_limited",
      retryable: true,
      isBillingExhaustion: false,
      userMessage: "Temporarily rate limited by the provider.",
    };
  }

  // Network / connection.
  if (
    message.includes("connection error") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("network") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("fetch failed")
  ) {
    return {
      category: "connection_error",
      retryable: true,
      isBillingExhaustion: false,
      userMessage: "Network/connection error contacting the provider.",
    };
  }

  if (status != null && status >= 500) {
    return { category: "provider_5xx", retryable: true, isBillingExhaustion: false, userMessage: "Provider server error." };
  }
  if (status === 400) {
    return { category: "provider_400_other", retryable: false, isBillingExhaustion: false, userMessage: "Provider rejected the request (400)." };
  }
  return { category: "unknown_provider_error", retryable: true, isBillingExhaustion: false, userMessage: "Unknown provider error." };
}

// ─── Process-local billing circuit breaker ───────────────────────────────────
// One boolean per server process. Set when billing exhaustion is first seen so
// the runner stops scheduling new provider work; cleared at the start of a
// fresh run (once credits are presumably restored).
let billingBreakerTripped = false;
let billingBreakerReason: string | null = null;
let billingBreakerAt: string | null = null;

export function tripBillingBreaker(reason: string): void {
  if (!billingBreakerTripped) {
    billingBreakerTripped = true;
    billingBreakerReason = reason;
    billingBreakerAt = new Date().toISOString();
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "error", source: "plexus_iq_provider", kind: "billing_circuit_breaker_tripped",
      reason, at: billingBreakerAt,
    }));
  }
}

export function isBillingBreakerTripped(): boolean {
  return billingBreakerTripped;
}

export function billingBreakerState(): { tripped: boolean; reason: string | null; at: string | null } {
  return { tripped: billingBreakerTripped, reason: billingBreakerReason, at: billingBreakerAt };
}

export function resetBillingBreaker(): void {
  billingBreakerTripped = false;
  billingBreakerReason = null;
  billingBreakerAt = null;
}
