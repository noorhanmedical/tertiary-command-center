// Phase 5B — CLIENT wrappers over the EXISTING Phase 4 active-work-claim routes
// (server/routes/workClaims.ts). This is NOT a new claim service: it only calls
// the canonical endpoints and maps their responses into typed results + calm,
// human-language messages (never "409", "lease", or "active_claim_by"). All
// concurrency/lease semantics remain server-owned; identity is derived
// server-side from the session (the client passes no scheduler id).

import { apiRequest, ApiError } from "@/lib/queryClient";

// Server defaults (workClaimService.WORKCLAIM_LEASE_SECONDS / _RENEW_SECONDS).
// The real values ALWAYS come from the acquire/renew response; these are only a
// safety floor if a response omits them.
export const DEFAULT_WORKCLAIM_LEASE_SECONDS = 300;
export const DEFAULT_WORKCLAIM_RENEW_SECONDS = 120;

const base = (executionCaseId: number) => `/api/engagement/work-claims/${executionCaseId}`;

/** Mirror of the server ClaimInfo (Dates serialize to ISO strings over HTTP). */
export type WorkClaimInfo = {
  executionCaseId: number;
  active: boolean;
  claimedBySchedulerId: number | null;
  claimedByName: string | null;
  claimedAt: string | null;
  expiresAt: string | null;
};

type ParsedApiError = { status: number; code: string | null; body: Record<string, unknown> | null };

function parseApiError(e: unknown): ParsedApiError {
  if (e instanceof ApiError) {
    let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(e.body) as Record<string, unknown>; } catch { body = null; }
    return { status: e.status, code: e.code ?? (body?.code as string | undefined) ?? null, body };
  }
  return { status: 0, code: null, body: null };
}

function holderNameFrom(body: Record<string, unknown> | null): string | null {
  const claim = body?.claim as { claimedByName?: string | null } | undefined;
  return claim?.claimedByName ?? null;
}

export type AcquireResult =
  | {
      ok: true;
      state: "acquired" | "renewed";
      claim: WorkClaimInfo;
      leaseSeconds: number;
      renewSeconds: number;
    }
  | {
      ok: false;
      // conflict = this case; conflict_sibling = another service for the same
      // patient; both mean "someone else is already working this patient".
      reason: "conflict" | "conflict_sibling";
      holderName: string | null;
      message: string;
    }
  | {
      ok: false;
      reason: "no_roster_identity" | "not_found" | "error";
      holderName: null;
      message: string;
    };

/** Acquire (or idempotently renew) the caller's active-work claim on a case.
 *  Call this when the employee ENTERS active editable work on a patient. */
export async function acquireWorkClaim(executionCaseId: number): Promise<AcquireResult> {
  try {
    const res = await apiRequest("POST", `${base(executionCaseId)}/acquire`, {});
    const body = await res.json();
    return {
      ok: true,
      state: body.state === "renewed" ? "renewed" : "acquired",
      claim: body.claim as WorkClaimInfo,
      leaseSeconds: Number(body.leaseSeconds) || DEFAULT_WORKCLAIM_LEASE_SECONDS,
      renewSeconds: Number(body.renewSeconds) || DEFAULT_WORKCLAIM_RENEW_SECONDS,
    };
  } catch (e) {
    const p = parseApiError(e);
    if (p.status === 409 && (p.code === "conflict" || p.code === "conflict_sibling")) {
      const holderName = holderNameFrom(p.body);
      return {
        ok: false,
        reason: p.code,
        holderName,
        message:
          (p.body?.error as string | undefined) ??
          (p.code === "conflict_sibling"
            ? "This patient is already being worked for another service."
            : "This patient is already being worked by another team member."),
      };
    }
    if (p.status === 409 && p.code === "no_roster_identity") {
      return {
        ok: false,
        reason: "no_roster_identity",
        holderName: null,
        message: "Your account isn't set up to actively work patients (no scheduler profile).",
      };
    }
    if (p.status === 404) {
      return { ok: false, reason: "not_found", holderName: null, message: "This patient case is no longer available." };
    }
    return { ok: false, reason: "error", holderName: null, message: "Couldn't start working this patient. Try again." };
  }
}

export type RenewResult =
  | { ok: true; claim: WorkClaimInfo; leaseSeconds: number }
  // lost = the caller no longer holds the claim (expired / taken over). The
  // caller must stop mutable work. transient = a network/server blip → retry.
  | { ok: false; reason: "lost"; message: string }
  | { ok: false; reason: "transient" };

/** Heartbeat the claim while active work continues. `lost` means the claim is
 *  genuinely gone (expired or someone else holds it); `transient` is a blip. */
export async function renewWorkClaim(executionCaseId: number): Promise<RenewResult> {
  try {
    const res = await apiRequest("POST", `${base(executionCaseId)}/renew`, {});
    const body = await res.json();
    return { ok: true, claim: body.claim as WorkClaimInfo, leaseSeconds: Number(body.leaseSeconds) || DEFAULT_WORKCLAIM_LEASE_SECONDS };
  } catch (e) {
    const p = parseApiError(e);
    // not_holder / expired / not_found = the claim is genuinely lost.
    if (p.status === 409 && (p.code === "not_holder" || p.code === "expired")) {
      return { ok: false, reason: "lost", message: "This patient is now being worked by someone else." };
    }
    if (p.status === 404) return { ok: false, reason: "lost", message: "This patient case is no longer available." };
    // Anything else (network, 5xx, 401 blip) is transient — keep the claim,
    // retry on the next heartbeat; server expiry remains authoritative.
    return { ok: false, reason: "transient" };
  }
}

/** Release the caller's own claim (workspace close / abandon without logging).
 *  Best-effort + idempotent server-side; a holder's successful DISPOSITION
 *  already releases server-side, so this is only for close-without-disposition. */
export async function releaseWorkClaim(executionCaseId: number): Promise<boolean> {
  try {
    const res = await apiRequest("POST", `${base(executionCaseId)}/release`, {});
    const body = await res.json().catch(() => ({}));
    return !!body?.ok;
  } catch {
    return false; // never block UI teardown on a release failure
  }
}

/** Read the current claim for a case (holder + expiry). Used by browser-restore
 *  to decide editable-vs-read-only WITHOUT trusting local state. */
export async function inspectWorkClaim(
  executionCaseId: number,
): Promise<{ claim: WorkClaimInfo | null; leaseSeconds: number; renewSeconds: number } | null> {
  try {
    const res = await apiRequest("GET", base(executionCaseId));
    const body = await res.json();
    return {
      claim: (body.claim as WorkClaimInfo | null) ?? null,
      leaseSeconds: Number(body.leaseSeconds) || DEFAULT_WORKCLAIM_LEASE_SECONDS,
      renewSeconds: Number(body.renewSeconds) || DEFAULT_WORKCLAIM_RENEW_SECONDS,
    };
  } catch {
    return null;
  }
}

/** Parse a disposition (call-result) error into a stale-claim signal. The
 *  canonical call-result endpoint returns 409 { code:"stale_work_claim",
 *  claimedBySchedulerId } when the submitter no longer holds the claim. */
export function parseStaleWorkClaim(
  e: unknown,
): { stale: true; claimedBySchedulerId: number | null } | { stale: false } {
  const p = parseApiError(e);
  if (p.status === 409 && p.code === "stale_work_claim") {
    const holder = p.body?.claimedBySchedulerId;
    return { stale: true, claimedBySchedulerId: typeof holder === "number" ? holder : null };
  }
  return { stale: false };
}
