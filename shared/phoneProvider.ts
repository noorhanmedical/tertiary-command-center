// Phone-provider settings contract — shared by server (admin_settings
// persistence) and client (resolver seed). The Call UI resolves the effective
// provider by precedence:
//
//   TEAM-MEMBER OVERRIDE  →  FACILITY DEFAULT  →  ORGANIZATION DEFAULT  →  MANUAL
//
// Persistence lives in admin_settings under domain "phone_provider":
//   - key "default_provider", global scope (facilityId NULL, userId NULL)  → org default
//   - key "default_provider", facility scope (facilityId set, userId NULL)  → facility default
//   - key "default_provider", user scope (userId set)                       → team-member default
//
// localStorage / VITE_DEFAULT_PHONE_PROVIDER are FALLBACK ONLY (used when the
// settings API has no persisted value), never the source of truth.

export const PHONE_PROVIDER_DOMAIN = "phone_provider";
export const PHONE_PROVIDER_DEFAULT_KEY = "default_provider";

/**
 * Provider ids that have a concrete, selectable adapter today. Kept in sync
 * with the client registry (AVAILABLE_PROVIDER_IDS). Additional providers
 * (dialpad/aircall/8x8/goto) join this list as their adapters land.
 */
export const SELECTABLE_PHONE_PROVIDER_IDS = ["manual", "doximity", "ringcentral"] as const;
export type SelectablePhoneProviderId = (typeof SELECTABLE_PHONE_PROVIDER_IDS)[number];

export function isSelectablePhoneProviderId(v: unknown): v is SelectablePhoneProviderId {
  return typeof v === "string" && (SELECTABLE_PHONE_PROVIDER_IDS as readonly string[]).includes(v);
}

/** The jsonb settingValue shape stored under phone_provider/default_provider. */
export type PhoneProviderSettingValue = {
  providerId: SelectablePhoneProviderId;
};

/** Which scope a persisted phone-provider default applies to. */
export type PhoneProviderScopeLevel = "organization" | "facility" | "team_member";

/**
 * Resolved phone-provider preferences the server returns to the client so the
 * resolver can pick the effective provider WITHOUT re-reading env/localStorage
 * as the source of truth. Each layer is null when nothing is persisted for it.
 */
export type PhoneProviderPreferencesDTO = {
  orgProviderId: SelectablePhoneProviderId | null;
  facilityProviderId: SelectablePhoneProviderId | null;
  teamMemberProviderId: SelectablePhoneProviderId | null;
  /** Echoes the facility scope the facility layer was resolved for (or null). */
  facilityId: string | null;
};

/**
 * A registry descriptor for a phone-provider option. Supports the clinic-phone
 * / caller-id concept (Item 7): a provider can be described with a facility +
 * display name + readiness WITHOUT rewriting the Call UI. `live` reflects
 * whether the provider has real credentials/config wired.
 */
export type PhoneProviderDescriptor = {
  providerId: SelectablePhoneProviderId;
  displayName: string;
  /** Optional facility this descriptor is scoped to (clinic-phone concept). */
  facilityId?: string | null;
  /** Whether the provider can place a VERIFIED in-app call now (integrated+ready). */
  live: boolean;
  /** Fail-closed readiness of the provider's required config. */
  ready?: boolean;
  /** Capability-derived operating mode for UX. */
  mode?: PhoneProviderMode;
  /** Declared capability ceiling. */
  capabilities?: PhoneProviderCapabilities;
};

// ─── Phase 6 — provider CAPABILITY model ─────────────────────────────────────
//
// Plexus is provider-AGNOSTIC. The Team Portal calling UX branches on what a
// provider can ACTUALLY do, never on a hard-coded provider name. Adding a new
// HIPAA-appropriate provider means declaring its capabilities here + shipping
// an adapter — never editing CallWorkspace/DispositionSheet/work-claims/
// outreach_calls.
//
// Capabilities are declarative FACTS about a provider integration. They are the
// ceiling of what is possible; actual readiness (valid credentials/config) is a
// SEPARATE, fail-closed runtime check (a capable provider with no credentials is
// NOT live). Telephony evidence a provider reports NEVER becomes a business
// disposition — the employee always records the outcome.

export type PhoneProviderCapabilities = {
  /** Plexus can place the call itself via the provider API (integrated). */
  canInitiateFromPlexus: boolean;
  /** Plexus can launch/deep-link an EXTERNAL dialer (assisted, e.g. Doximity). */
  canLaunchExternalProvider: boolean;
  /** Plexus can confirm the call was actually initiated (not just attempted). */
  canVerifyInitiation: boolean;
  /** Live call-state transitions (ringing/connected) are observable. */
  canObserveLiveState: boolean;
  /** Plexus can confirm the call connected/answered (line-level, NOT "reached"). */
  canVerifyConnection: boolean;
  /** Provider reports talk-time / duration. */
  canProvideDuration: boolean;
  /** Provider delivers asynchronous events (webhook/subscription). */
  canReceiveProviderEvents: boolean;
  /** Provider/Plexus can control the presented caller-id (clinic phone). */
  canControlCallerId: boolean;
  /** Provider supports inbound calls surfaced to Plexus. */
  canHandleInbound: boolean;
  /** Provider yields a durable provider call/session id for correlation. */
  canProvideProviderSessionId: boolean;
};

export const NO_PHONE_PROVIDER_CAPABILITIES: PhoneProviderCapabilities = {
  canInitiateFromPlexus: false,
  canLaunchExternalProvider: false,
  canVerifyInitiation: false,
  canObserveLiveState: false,
  canVerifyConnection: false,
  canProvideDuration: false,
  canReceiveProviderEvents: false,
  canControlCallerId: false,
  canHandleInbound: false,
  canProvideProviderSessionId: false,
};

/**
 * The operating MODE the Team Portal renders for a provider, derived purely
 * from capabilities (never the provider name):
 *   • integrated        — Plexus initiates + can observe live state (RingCentral).
 *   • external_assisted  — Plexus can only LAUNCH an external dialer; no
 *                          verification/duration (Doximity dialer today).
 *   • manual             — Plexus can neither initiate nor launch; the employee
 *                          dials on their own phone (Manual).
 */
export type PhoneProviderMode = "integrated" | "external_assisted" | "manual";

export function providerModeFromCapabilities(c: PhoneProviderCapabilities): PhoneProviderMode {
  if (c.canInitiateFromPlexus) return "integrated";
  if (c.canLaunchExternalProvider) return "external_assisted";
  return "manual";
}

/**
 * Declared capability CEILING per provider. NOT readiness — a provider can be
 * capable yet not live (missing credentials). RingCentral's deep-integration
 * capabilities are declared here but only become LIVE behind valid config +
 * the server adapter flag; until then the provider fails closed to manual.
 *
 * Doximity is EXTERNAL-ASSISTED: Plexus can launch its dialer (deep link) but
 * does NOT (today) receive events, verify connection, or get a session id. Those
 * are declared false and MUST stay false unless real Doximity API access proves
 * otherwise — flipping one to true later enables that behavior with NO Call UI
 * change.
 */
export const PHONE_PROVIDER_CAPABILITIES: Record<SelectablePhoneProviderId, PhoneProviderCapabilities> = {
  manual: { ...NO_PHONE_PROVIDER_CAPABILITIES },
  doximity: {
    ...NO_PHONE_PROVIDER_CAPABILITIES,
    // Assisted launch only. Everything else stays false until Doximity Dialer
    // API access is proven for this organization.
    canLaunchExternalProvider: true,
  },
  ringcentral: {
    canInitiateFromPlexus: true,
    canLaunchExternalProvider: false,
    canVerifyInitiation: true,
    canObserveLiveState: true,
    canVerifyConnection: true,
    canProvideDuration: true,
    canReceiveProviderEvents: true,
    canControlCallerId: true,
    canHandleInbound: true,
    canProvideProviderSessionId: true,
  },
};

export function capabilitiesFor(providerId: SelectablePhoneProviderId): PhoneProviderCapabilities {
  return PHONE_PROVIDER_CAPABILITIES[providerId] ?? NO_PHONE_PROVIDER_CAPABILITIES;
}

/** Canonical provider states an integrated provider's telephony session can be
 *  in. EVIDENCE ONLY — never a business disposition. */
export const TELEPHONY_SESSION_STATES = [
  "initiated",
  "proceeding", // ringing / early media
  "connected",  // answered at the line level (NOT "patient reached")
  "ended",
  "failed",
  "no_answer",
  "busy",
  "canceled",
] as const;
export type TelephonySessionState = (typeof TELEPHONY_SESSION_STATES)[number];

/** Terminal provider states — no later non-terminal event may regress them. */
export const TERMINAL_TELEPHONY_STATES: readonly TelephonySessionState[] = [
  "ended",
  "failed",
  "no_answer",
  "busy",
  "canceled",
];

export function isTerminalTelephonyState(s: TelephonySessionState): boolean {
  return TERMINAL_TELEPHONY_STATES.includes(s);
}

/** Monotonic rank so out-of-order provider events never regress live state.
 *  Higher = later in a normal call lifecycle. Terminal states share the top
 *  rank; ties are resolved by the caller using provider sequence/timestamp. */
export const TELEPHONY_STATE_RANK: Record<TelephonySessionState, number> = {
  initiated: 0,
  proceeding: 1,
  connected: 2,
  ended: 3,
  failed: 3,
  no_answer: 3,
  busy: 3,
  canceled: 3,
};
