// Doximity — EXTERNAL-ASSISTED phone provider (Phase 6).
//
// Doximity Dialer is a clinician-facing dialer that presents the clinic's
// number as caller-id. Plexus can LAUNCH it (deep link / tel: fallback) but —
// with the API access this organization has today — cannot observe ringing,
// connection, duration, or a provider session id. So its capability ceiling is
// `canLaunchExternalProvider` ONLY (see PHONE_PROVIDER_CAPABILITIES). Every
// other capability is intentionally false and MUST stay false until real
// Doximity Dialer API access is proven for this org.
//
// Because the Team Portal UX is capability-driven, enabling a deeper Doximity
// integration later (e.g. flipping canProvideProviderSessionId/canReceive
// ProviderEvents true + implementing startCall) requires NO CallWorkspace
// change — only this adapter + the shared capability registry.
//
// HONESTY: launchExternal reports only that Plexus ATTEMPTED to open the
// dialer. It never fabricates a placed/connected call. The employee records the
// canonical business disposition manually, exactly like the manual provider.

import { capabilitiesFor } from "@shared/phoneProvider";
import type {
  LaunchExternalResult,
  PhoneCallSession,
  PhoneCallSummary,
  PhoneProviderAdapter,
  PhoneProviderConfig,
  RecentCallsInput,
  SaveCallDispositionInput,
  StartCallInput,
} from "./phoneProviderTypes";

/** Build the Doximity dialer deep-link for a number, if a template is
 *  configured; otherwise null (caller falls back to tel:). A future proven
 *  Doximity scheme/SDK slots in here without touching the Call UI. The template
 *  may contain the `{number}` placeholder (E.164 or raw digits). */
function doximityHref(phoneNumber: string): string | null {
  const template = (import.meta.env.VITE_DOXIMITY_DIALER_URL_TEMPLATE as string | undefined) ?? null;
  const digits = phoneNumber.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (template && template.includes("{number}")) {
    return template.replace("{number}", encodeURIComponent(digits));
  }
  // No proven Doximity deep-link configured → fall back to the device dialer,
  // which routes to Doximity when the clinician has it set as their handler.
  return `tel:${digits}`;
}

export const doximityPhoneProvider: PhoneProviderAdapter = {
  id: "doximity",
  label: "Doximity",
  supportsEmbeddedDialer: false,
  supportsRecordingStatus: false,
  supportsDispositionSync: false,
  supportsCallEvents: false,
  capabilities: capabilitiesFor("doximity"),

  async initialize(_config: PhoneProviderConfig) {
    return;
  },

  // Doximity cannot be INITIATED from Plexus (no API). startCall exists only to
  // satisfy the adapter contract and deliberately returns a non-live "pending"
  // session so the UX never treats Doximity as an integrated provider — the UX
  // uses launchExternal instead (mode = external_assisted).
  async startCall(input: StartCallInput): Promise<PhoneCallSession> {
    return {
      callId: `doximity-pending-${Date.now()}`,
      providerId: "doximity",
      phoneNumber: input.phoneNumber,
      patientUuid: input.patientUuid,
      patientName: input.patientName,
      status: "dialing",
      startedAt: new Date().toISOString(),
      recordingStatus: "unsupported",
    };
  },

  async endCall(_callId: string) {
    return;
  },

  async getActiveCall() {
    return null;
  },

  async getRecentCalls(_input?: RecentCallsInput): Promise<PhoneCallSummary[]> {
    return [];
  },

  async saveDisposition(_input: SaveCallDispositionInput) {
    return;
  },

  async launchExternal(input: StartCallInput): Promise<LaunchExternalResult> {
    const href = doximityHref(input.phoneNumber);
    if (!href) {
      return {
        launched: false,
        href: null,
        note: "No phone number to dial.",
      };
    }
    let launched = false;
    try {
      if (typeof window !== "undefined") {
        window.open(href, "_self");
        launched = true;
      }
    } catch {
      launched = false;
    }
    return {
      launched,
      href,
      // HONEST: assisted launch only — Plexus cannot verify this call.
      note: "Opened your dialer. Plexus can't verify this call automatically — record the outcome below.",
    };
  },
};
