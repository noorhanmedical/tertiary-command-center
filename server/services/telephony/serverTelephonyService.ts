// Phase 6 — server telephony service (provider-agnostic initiation).
//
// The server side mirrors the client's capability model: it resolves the
// effective provider for a facility/user (same precedence: team-member →
// facility → org → manual), checks CAPABILITY + READINESS (fail closed), and
// only INTEGRATED, ready providers (today: RingCentral) are initiated from
// Plexus. Manual / external-assisted providers are never initiated here — the
// employee dials (manual) or launches an external dialer (Doximity) client-side.
//
// On a successful integrated initiation we open a telephony_session carrying
// the provider session id. That session is PROVIDER EVIDENCE only; the business
// disposition is always the employee's separate recordCallResult write.

import {
  capabilitiesFor,
  type PhoneProviderCapabilities,
  type SelectablePhoneProviderId,
} from "@shared/phoneProvider";
import { getPhoneProviderPreferences } from "../../repositories/adminSettings.repo";
import {
  resolveRingCentralClient,
  type RingCentralClient,
  type RingCentralCallStatus,
} from "../ringCentral/ringCentralClient";
import { startTelephonySession } from "./telephonySessionService";
import type { TelephonySession } from "@shared/schema/telephonySessions";
import type { TelephonySessionState } from "@shared/phoneProvider";

export type ResolvedServerProvider = {
  providerId: SelectablePhoneProviderId;
  capabilities: PhoneProviderCapabilities;
  /** Integrated + ready → Plexus can initiate. Fail-closed. */
  canInitiate: boolean;
  /** Non-sensitive reason when initiation is unavailable. */
  reason: string | null;
};

/** Resolve the effective provider for a facility/user, with fail-closed
 *  readiness. Precedence matches the client resolver. */
export async function resolveServerProvider(
  scope: { facilityId?: string | null; userId?: string | null },
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedServerProvider> {
  const prefs = await getPhoneProviderPreferences({
    facilityId: scope.facilityId ?? null,
    userId: scope.userId ?? null,
  });
  const providerId: SelectablePhoneProviderId =
    (prefs.teamMemberProviderId as SelectablePhoneProviderId | null) ??
    (prefs.facilityProviderId as SelectablePhoneProviderId | null) ??
    (prefs.orgProviderId as SelectablePhoneProviderId | null) ??
    "manual";
  const capabilities = capabilitiesFor(providerId);
  if (!capabilities.canInitiateFromPlexus) {
    return {
      providerId,
      capabilities,
      canInitiate: false,
      reason:
        providerId === "manual"
          ? "manual provider — dial externally"
          : "provider does not support Plexus-initiated calls",
    };
  }
  // Integrated provider — check server readiness (fail closed).
  if (providerId === "ringcentral") {
    const { readiness } = resolveRingCentralClient(env);
    return {
      providerId,
      capabilities,
      canInitiate: readiness.ready,
      reason: readiness.ready ? null : readiness.reason,
    };
  }
  return { providerId, capabilities, canInitiate: false, reason: "unsupported integrated provider" };
}

export type InitiateProviderCallInput = {
  facilityId?: string | null;
  userId?: string | null;
  actingSchedulerId?: number | null;
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  toNumber: string;
  fromExtension?: string | null;
};

export type InitiateProviderCallResult =
  | {
      initiated: true;
      provider: SelectablePhoneProviderId;
      session: TelephonySession;
      providerSessionId: string;
      state: TelephonySessionState;
    }
  | {
      initiated: false;
      provider: SelectablePhoneProviderId;
      /** "fallback_manual" → client should use manual/launch; "error" → transient. */
      reason: string;
      code: "not_integrated" | "not_ready" | "provider_error";
    };

function mapInitStatus(s: RingCentralCallStatus): TelephonySessionState {
  switch (s) {
    case "ringing":
      return "proceeding";
    case "answered":
      return "connected";
    case "failed":
      return "failed";
    default:
      return "initiated";
  }
}

/**
 * Initiate a provider call for an INTEGRATED, ready provider and open the
 * telephony session. Returns a non-initiated result (with a code) when the
 * provider isn't integrated/ready or the provider errors — the caller falls
 * back to manual/launch WITHOUT faking a call. `ringCentralClientOverride` lets
 * tests inject a MockRingCentralClient.
 */
export async function initiateProviderCall(
  input: InitiateProviderCallInput,
  opts: { env?: NodeJS.ProcessEnv; ringCentralClientOverride?: RingCentralClient } = {},
): Promise<InitiateProviderCallResult> {
  const env = opts.env ?? process.env;
  const resolved = await resolveServerProvider(
    { facilityId: input.facilityId ?? null, userId: input.userId ?? null },
    env,
  );

  if (!resolved.capabilities.canInitiateFromPlexus) {
    return { initiated: false, provider: resolved.providerId, reason: resolved.reason ?? "not integrated", code: "not_integrated" };
  }
  if (!resolved.canInitiate) {
    return { initiated: false, provider: resolved.providerId, reason: resolved.reason ?? "not ready", code: "not_ready" };
  }

  if (resolved.providerId === "ringcentral") {
    const { client } = resolveRingCentralClient(env, opts.ringCentralClientOverride);
    try {
      const result = await client.initiateCall({
        fromUserExtension: input.fromExtension ?? String(env.RINGCENTRAL_FROM_EXTENSION ?? ""),
        toE164: input.toNumber,
        patientScreeningId: input.patientScreeningId ?? null,
      });
      const session = await startTelephonySession({
        provider: "ringcentral",
        providerSessionId: result.ringCentralCallId,
        executionCaseId: input.executionCaseId ?? null,
        patientScreeningId: input.patientScreeningId ?? null,
        actingSchedulerId: input.actingSchedulerId ?? null,
        actingUserId: input.userId ?? null,
        direction: "outbound",
      });
      const state = mapInitStatus(result.status);
      return {
        initiated: true,
        provider: "ringcentral",
        session,
        providerSessionId: result.ringCentralCallId,
        state,
      };
    } catch (e) {
      return {
        initiated: false,
        provider: "ringcentral",
        reason: e instanceof Error ? e.message : "provider error",
        code: "provider_error",
      };
    }
  }

  return { initiated: false, provider: resolved.providerId, reason: "unsupported integrated provider", code: "not_integrated" };
}
