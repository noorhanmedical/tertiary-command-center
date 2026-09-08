// Phase 6 — client telephony API (thin fetch wrappers).
//
// The client NEVER talks to a phone provider directly. Integrated initiation
// goes through the SERVER (which owns credentials, enforces the work-claim
// guard, and opens the telephony_session). This module exposes only the two
// calls the Team Portal needs; it surfaces no OAuth/webhook/session internals.

export type InitiateCallResponse =
  | { initiated: true; provider: string; sessionId: number; providerSessionId: string; state: string }
  | { initiated: false; provider: string; code: string; reason: string };

/** Ask the server to place an integrated provider call for a claimed case. The
 *  server rejects (409) if the caller no longer holds the active claim, and
 *  returns { initiated:false } (with a code) when the provider isn't
 *  integrated/ready — the caller then falls back to manual/launch. */
export async function initiateProviderCall(body: {
  executionCaseId: number;
  patientScreeningId?: number | null;
  toNumber: string;
  facilityId?: string | null;
}): Promise<InitiateCallResponse> {
  const res = await fetch("/api/telephony/calls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    return { initiated: false, provider: "", code: "no_active_claim", reason: "claim lost" };
  }
  const data = await res.json().catch(() => ({}));
  return data as InitiateCallResponse;
}

export type CallStateResponse = {
  sessionId: number;
  provider: string;
  providerState: string;
  connectedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
};

/** Poll a telephony session's live state (line-level evidence only). */
export async function getCallState(sessionId: number): Promise<CallStateResponse | null> {
  const res = await fetch(`/api/telephony/calls/${sessionId}`, { credentials: "include" });
  if (!res.ok) return null;
  return (await res.json()) as CallStateResponse;
}
