// Phone provider resolver + registry.
//
// The Call UI must NEVER hard-wire a specific provider (e.g. RingCentral).
// Instead it asks this resolver for the effective PhoneProviderAdapter, chosen
// by a precedence chain:
//
//   TEAM-MEMBER OVERRIDE  →  FACILITY DEFAULT  →  ORGANIZATION DEFAULT  →  MANUAL
//
// Each layer supplies an optional PhoneProviderId; the first present one wins,
// falling back to "manual" (always available). The resolved provider's
// `startCall`/`endCall` are what the UI calls — swapping providers is a config
// change, not a code change.
//
// CONFIG SOURCE (honest scope): org/facility/team-member preferences are read
// from `PhoneProviderPreferences` supplied by the caller. Today the UI seeds
// these from `getClientPhoneProviderPreferences()` (env + localStorage for the
// team-member override). The Admin-Settings-backed org/facility persistence is
// a separate server wiring step — this resolver already accepts those layers so
// wiring them later is drop-in, with no UI change. RingCentral remains NOT LIVE
// unless real credentials/API are present (its adapter returns a synthetic
// "pending" session, which the UI surfaces as an honest boundary — never a
// completed call).

import type { PhoneProviderAdapter, PhoneProviderId, PhoneProviderConfig } from "./phoneProviderTypes";
import { manualPhoneProvider } from "./manualPhoneProvider";
import { ringCentralProvider } from "./ringCentralProvider";
import { doximityPhoneProvider } from "./doximityPhoneProvider";
import {
  providerModeFromCapabilities,
  NO_PHONE_PROVIDER_CAPABILITIES,
  type PhoneProviderCapabilities,
  type PhoneProviderMode,
  type PhoneProviderPreferencesDTO,
  type PhoneProviderDescriptor,
  type SelectablePhoneProviderId,
} from "@shared/phoneProvider";

// Registry of KNOWN adapters. Additional providers (dialpad/aircall/8x8/goto)
// register here as they are implemented; until then only manual + ringcentral
// have concrete adapters. Unknown/unimplemented ids resolve to manual.
const REGISTRY: Partial<Record<PhoneProviderId, PhoneProviderAdapter>> = {
  manual: manualPhoneProvider,
  doximity: doximityPhoneProvider,
  ringcentral: ringCentralProvider,
};

// Provider ids that have a concrete, selectable adapter today.
export const AVAILABLE_PROVIDER_IDS: PhoneProviderId[] = ["manual", "doximity", "ringcentral"];

export type PhoneProviderPreferences = {
  /** Team-member's explicit override (highest precedence). */
  teamMemberProviderId?: PhoneProviderId | null;
  /** Facility default. */
  facilityProviderId?: PhoneProviderId | null;
  /** Organization default. */
  orgProviderId?: PhoneProviderId | null;
};

export type ResolvedPhoneProvider = {
  adapter: PhoneProviderAdapter;
  providerId: PhoneProviderId;
  /** Which precedence layer supplied the choice. */
  source: "team_member" | "facility" | "organization" | "manual_fallback";
  /** Declarative capabilities of the resolved provider (UX branches on these). */
  capabilities: PhoneProviderCapabilities;
  /** Operating mode derived from capabilities: integrated / external_assisted /
   *  manual. The Team Portal renders per MODE, never per provider name. */
  mode: PhoneProviderMode;
  /** Fail-closed readiness: the provider's REQUIRED config is actually valid.
   *  Integrated providers (RingCentral) are ready ONLY behind the enabled flag/
   *  credentials; manual + external-assisted are always ready (no creds needed). */
  ready: boolean;
  /** Back-compat: a provider that can place a VERIFIED in-app call right now
   *  (integrated AND ready). External-assisted/manual are NOT "live" — they use
   *  launch/manual paths. */
  live: boolean;
};

// Capability ceiling for a registered adapter (or none for unknown ids).
function capabilitiesOf(providerId: PhoneProviderId): PhoneProviderCapabilities {
  return REGISTRY[providerId]?.capabilities ?? NO_PHONE_PROVIDER_CAPABILITIES;
}

/**
 * Fail-closed readiness. A capable provider is only READY when its required
 * configuration is actually present:
 *   • manual            → always ready (dial on your own phone).
 *   • external_assisted → always ready (deep-link/tel: launch needs no creds).
 *   • integrated        → ready ONLY behind valid config/flag (RingCentral =
 *                         ringCentralEnabled). Unknown integrated → NOT ready.
 */
export function isProviderReady(
  providerId: PhoneProviderId,
  opts: { ringCentralEnabled: boolean },
): boolean {
  const mode = providerModeFromCapabilities(capabilitiesOf(providerId));
  if (mode === "manual" || mode === "external_assisted") return true;
  if (providerId === "ringcentral") return opts.ringCentralEnabled;
  return false;
}

// Is a given provider actually LIVE — i.e. INTEGRATED and ready to place a
// verified in-app call? Manual + external-assisted are never "live" in this
// sense (they use the manual/launch paths). RingCentral is live only behind the
// enabled flag/credentials (fail closed).
export function isProviderLive(
  providerId: PhoneProviderId,
  opts: { ringCentralEnabled: boolean },
): boolean {
  const mode = providerModeFromCapabilities(capabilitiesOf(providerId));
  return mode === "integrated" && isProviderReady(providerId, opts);
}

function resolveId(prefs: PhoneProviderPreferences): {
  providerId: PhoneProviderId;
  source: ResolvedPhoneProvider["source"];
} {
  if (prefs.teamMemberProviderId && REGISTRY[prefs.teamMemberProviderId]) {
    return { providerId: prefs.teamMemberProviderId, source: "team_member" };
  }
  if (prefs.facilityProviderId && REGISTRY[prefs.facilityProviderId]) {
    return { providerId: prefs.facilityProviderId, source: "facility" };
  }
  if (prefs.orgProviderId && REGISTRY[prefs.orgProviderId]) {
    return { providerId: prefs.orgProviderId, source: "organization" };
  }
  return { providerId: "manual", source: "manual_fallback" };
}

/**
 * Resolve the effective phone provider for a call.
 * @param prefs precedence layers (team-member → facility → org)
 * @param opts.ringCentralEnabled whether RingCentral click-to-call is live
 * @param opts.explicitProviderId a per-call switch chosen by the user for THIS
 *        call (overrides the precedence chain but not availability — unknown
 *        ids fall back to manual).
 */
export function resolvePhoneProvider(
  prefs: PhoneProviderPreferences,
  opts: { ringCentralEnabled: boolean; explicitProviderId?: PhoneProviderId | null },
): ResolvedPhoneProvider {
  // A per-call user switch wins over the precedence chain (but must be a real,
  // registered provider). Otherwise resolve by precedence.
  let providerId: PhoneProviderId;
  let source: ResolvedPhoneProvider["source"];
  if (opts.explicitProviderId && REGISTRY[opts.explicitProviderId]) {
    providerId = opts.explicitProviderId;
    // The switch is a manual, per-call choice; label its source honestly.
    source = "team_member";
  } else {
    const r = resolveId(prefs);
    providerId = r.providerId;
    source = r.source;
  }
  const adapter = REGISTRY[providerId] ?? manualPhoneProvider;
  const resolvedId = adapter.id;
  const capabilities = adapter.capabilities ?? NO_PHONE_PROVIDER_CAPABILITIES;
  const ready = isProviderReady(resolvedId, { ringCentralEnabled: opts.ringCentralEnabled });
  const mode = providerModeFromCapabilities(capabilities);
  return {
    adapter,
    providerId: resolvedId,
    source,
    capabilities,
    mode,
    ready,
    live: mode === "integrated" && ready,
  };
}

// Client preference seed.
//
// SOURCE OF TRUTH: the persisted admin_settings-backed preferences supplied via
// `persisted` (fetched with usePhoneProviderPreferences). Each persisted layer
// wins for its scope. localStorage (team-member) and VITE_DEFAULT_PHONE_PROVIDER
// (org) are FALLBACK ONLY — used when nothing is persisted for that layer.
const TEAM_MEMBER_PROVIDER_LS_KEY = "plexus.phoneProvider.teamMemberOverride";

function readLocalStorageTeamMemberOverride(): PhoneProviderId | null {
  try {
    const v = localStorage.getItem(TEAM_MEMBER_PROVIDER_LS_KEY);
    if (v && (AVAILABLE_PROVIDER_IDS as string[]).includes(v)) {
      return v as PhoneProviderId;
    }
  } catch {
    /* localStorage unavailable — ignore */
  }
  return null;
}

function readEnvOrgDefault(): PhoneProviderId | null {
  const envOrg = (import.meta.env.VITE_DEFAULT_PHONE_PROVIDER as string | undefined) ?? null;
  return envOrg && (AVAILABLE_PROVIDER_IDS as string[]).includes(envOrg)
    ? (envOrg as PhoneProviderId)
    : null;
}

/**
 * Build the resolver's precedence layers. Persisted settings (from the
 * settings API) are authoritative; env/localStorage only fill layers the API
 * left unset. Pass `persisted` from usePhoneProviderPreferences; when it is
 * undefined (still loading / API unavailable) the fallbacks alone are used so
 * the Call UI degrades gracefully to manual.
 */
export function getClientPhoneProviderPreferences(
  persisted?: PhoneProviderPreferencesDTO | null,
): PhoneProviderPreferences {
  const teamMemberProviderId =
    (persisted?.teamMemberProviderId as PhoneProviderId | null | undefined) ??
    readLocalStorageTeamMemberOverride();
  const facilityProviderId = (persisted?.facilityProviderId as PhoneProviderId | null | undefined) ?? null;
  const orgProviderId =
    (persisted?.orgProviderId as PhoneProviderId | null | undefined) ?? readEnvOrgDefault();
  return {
    teamMemberProviderId: teamMemberProviderId ?? null,
    facilityProviderId,
    orgProviderId,
  };
}

export function setTeamMemberPhoneProviderOverride(providerId: PhoneProviderId | null): void {
  try {
    if (providerId == null) localStorage.removeItem(TEAM_MEMBER_PROVIDER_LS_KEY);
    else localStorage.setItem(TEAM_MEMBER_PROVIDER_LS_KEY, providerId);
  } catch {
    /* ignore */
  }
}

export function providerConfigFor(providerId: PhoneProviderId): PhoneProviderConfig {
  const adapter = REGISTRY[providerId] ?? manualPhoneProvider;
  return { providerId: adapter.id, displayName: adapter.label };
}

/**
 * Registry descriptors for the selectable providers (Item 7 clinic-phone /
 * caller-id concept). Each descriptor carries providerId + displayName +
 * optional facility + honest readiness — enough for a facility-scoped
 * clinic-phone entry to be added to the registry WITHOUT rewriting the Call UI.
 * `facilityId` lets a future clinic-phone descriptor be scoped to one facility;
 * today the built-in adapters are facility-agnostic (facilityId = null).
 */
export function listProviderDescriptors(opts: {
  ringCentralEnabled: boolean;
  facilityId?: string | null;
}): PhoneProviderDescriptor[] {
  return AVAILABLE_PROVIDER_IDS.map((id) => {
    const adapter = REGISTRY[id] ?? manualPhoneProvider;
    const capabilities = adapter.capabilities ?? NO_PHONE_PROVIDER_CAPABILITIES;
    return {
      providerId: id as SelectablePhoneProviderId,
      displayName: adapter.label,
      facilityId: opts.facilityId ?? null,
      live: isProviderLive(id, { ringCentralEnabled: opts.ringCentralEnabled }),
      ready: isProviderReady(id, { ringCentralEnabled: opts.ringCentralEnabled }),
      mode: providerModeFromCapabilities(capabilities),
      capabilities,
    };
  });
}
