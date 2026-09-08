// Phase 6 — telephony session service.
//
// Owns the idempotent, ordering-safe application of PROVIDER TELEPHONY EVENTS
// to telephony_sessions. Providers deliver events that may arrive:
//   • multiple times (duplicates),
//   • late,
//   • out of order.
// This service guarantees an older/duplicate event can NEVER regress a newer
// authoritative state, using (in priority order) the provider event SEQUENCE,
// then the event TIMESTAMP, then a monotonic state RANK. Terminal states lock.
//
// EVIDENCE ONLY: provider_state is a line-level fact. This service NEVER writes
// a business outcome (reached / voicemail / …) — that is the employee's
// disposition via outreach_calls. "connected" here means the line answered,
// NOT that the patient was reached.

import {
  TELEPHONY_STATE_RANK,
  isTerminalTelephonyState,
  type TelephonySessionState,
} from "@shared/phoneProvider";
import type { TelephonySession } from "@shared/schema/telephonySessions";
import {
  createTelephonySession,
  findTelephonySessionByProviderId,
  updateTelephonySession,
} from "../../repositories/telephonySessions.repo";

export type StartTelephonySessionInput = {
  provider: string;
  providerSessionId?: string | null;
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  actingSchedulerId?: number | null;
  actingUserId?: string | null;
  direction?: "outbound" | "inbound";
};

/** Idempotently open a telephony session at initiation time. If a session for
 *  (provider, providerSessionId) already exists (e.g. a webhook raced ahead),
 *  reuse it and backfill correlation instead of inserting a duplicate. */
export async function startTelephonySession(
  input: StartTelephonySessionInput,
): Promise<TelephonySession> {
  if (input.providerSessionId) {
    const existing = await findTelephonySessionByProviderId(
      input.provider,
      input.providerSessionId,
    );
    if (existing) {
      // Backfill correlation the initiate call knows but an early webhook did not.
      const patch: Partial<TelephonySession> = {};
      if (existing.executionCaseId == null && input.executionCaseId != null)
        patch.executionCaseId = input.executionCaseId;
      if (existing.patientScreeningId == null && input.patientScreeningId != null)
        patch.patientScreeningId = input.patientScreeningId;
      if (existing.actingSchedulerId == null && input.actingSchedulerId != null)
        patch.actingSchedulerId = input.actingSchedulerId;
      if (existing.actingUserId == null && input.actingUserId != null)
        patch.actingUserId = input.actingUserId;
      if (Object.keys(patch).length === 0) return existing;
      return (await updateTelephonySession(existing.id, patch)) ?? existing;
    }
  }
  return createTelephonySession({
    provider: input.provider,
    providerSessionId: input.providerSessionId ?? null,
    executionCaseId: input.executionCaseId ?? null,
    patientScreeningId: input.patientScreeningId ?? null,
    actingSchedulerId: input.actingSchedulerId ?? null,
    actingUserId: input.actingUserId ?? null,
    direction: input.direction ?? "outbound",
    providerState: "initiated",
    startedAt: new Date(),
  });
}

export type ProviderTelephonyEvent = {
  provider: string;
  providerSessionId: string;
  state: TelephonySessionState;
  /** Provider event time (authoritative for ordering when no seq). */
  at?: Date | null;
  /** Provider monotonic sequence/version (best ordering signal when present). */
  seq?: number | null;
  /** Provider-reported talk time (usually on the terminal event). */
  durationSeconds?: number | null;
  /** Correlation the webhook may carry when the initiate call didn't pre-create. */
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
};

export type ApplyEventResult = {
  session: TelephonySession;
  /** True when this event advanced the authoritative provider_state. */
  stateChanged: boolean;
  /** True when the event was ignored as a duplicate/older/out-of-order event. */
  ignored: boolean;
};

/**
 * Decide whether an incoming event is strictly NEWER than what we've applied,
 * using provider sequence first, then event timestamp. When neither ordering
 * signal is available on both sides, treat as newer (best effort) — the state
 * RANK guard below still prevents regressions.
 */
function isStrictlyNewer(
  session: TelephonySession,
  event: ProviderTelephonyEvent,
): boolean {
  if (event.seq != null && session.eventSeq != null) return event.seq > session.eventSeq;
  if (event.at && session.lastProviderEventAt) {
    return event.at.getTime() > new Date(session.lastProviderEventAt).getTime();
  }
  return true;
}

/**
 * Apply a provider telephony event idempotently and order-safely.
 * - Creates the session if unseen (correlating what the event carries).
 * - Advances provider_state only when it does NOT regress a newer/terminal
 *   state.
 * - Fills connectedAt/endedAt/durationSeconds monotonically.
 * - Advances the ordering markers only when the event is strictly newer, so a
 *   stale/duplicate event never rewinds them.
 */
export async function applyProviderTelephonyEvent(
  event: ProviderTelephonyEvent,
): Promise<ApplyEventResult> {
  let session = await findTelephonySessionByProviderId(
    event.provider,
    event.providerSessionId,
  );
  if (!session) {
    session = await createTelephonySession({
      provider: event.provider,
      providerSessionId: event.providerSessionId,
      executionCaseId: event.executionCaseId ?? null,
      patientScreeningId: event.patientScreeningId ?? null,
      providerState: "initiated",
      startedAt: event.at ?? new Date(),
    });
  }

  const currentState = session.providerState as TelephonySessionState;
  const currentRank = TELEPHONY_STATE_RANK[currentState] ?? 0;
  const incomingRank = TELEPHONY_STATE_RANK[event.state] ?? 0;
  const newer = isStrictlyNewer(session, event);
  const currentTerminal = isTerminalTelephonyState(currentState);
  const incomingTerminal = isTerminalTelephonyState(event.state);

  const patch: Partial<TelephonySession> = {};
  let stateChanged = false;

  // State advance rule (never regress):
  //  • current non-terminal: accept a higher rank, or an equal rank that is
  //    strictly newer.
  //  • current terminal: only a strictly-newer terminal correction may replace
  //    it (rare provider re-classification); non-terminal events can't reopen.
  if (!currentTerminal) {
    if (incomingRank > currentRank || (incomingRank === currentRank && newer)) {
      if (event.state !== currentState) {
        patch.providerState = event.state;
        stateChanged = true;
      }
    }
  } else if (incomingTerminal && newer && event.state !== currentState) {
    patch.providerState = event.state;
    stateChanged = true;
  }

  // Timing / duration (fill-once / monotonic, independent of state advance so
  // a late "ended" still records duration even if state already terminal).
  if (event.state === "connected" && session.connectedAt == null) {
    patch.connectedAt = event.at ?? new Date();
  }
  if (incomingTerminal) {
    if (session.endedAt == null) patch.endedAt = event.at ?? new Date();
    if (event.durationSeconds != null && session.durationSeconds == null) {
      patch.durationSeconds = event.durationSeconds;
    }
  }
  // Backfill correlation if the event carries it and we didn't have it.
  if (session.executionCaseId == null && event.executionCaseId != null) {
    patch.executionCaseId = event.executionCaseId;
  }
  if (session.patientScreeningId == null && event.patientScreeningId != null) {
    patch.patientScreeningId = event.patientScreeningId;
  }

  // Ordering markers advance only for strictly-newer events.
  if (newer) {
    patch.lastProviderEventAt = event.at ?? new Date();
    if (event.seq != null) patch.eventSeq = event.seq;
  }

  const ignored = !stateChanged && Object.keys(patch).length === 0;
  if (ignored) return { session, stateChanged: false, ignored: true };

  const updated = (await updateTelephonySession(session.id, patch)) ?? session;
  return { session: updated, stateChanged, ignored: false };
}
