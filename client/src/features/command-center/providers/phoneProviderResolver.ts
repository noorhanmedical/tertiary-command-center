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
import type {
  PhoneProviderPreferencesDTO,
  PhoneProviderDescriptor,
  SelectablePhoneProviderId,
} from "@shared/phoneProvider";

// Registry of KNOWN adapters. Additional providers (dialpad/aircall/8x8/goto)
// register here as they are implemented; until then only manual + ringcentral
// have concrete adapters. Unknown/unimplemented ids resolve to manual.
const REGISTRY: Partial<Record<PhoneProviderId, PhoneProviderAdapter>> = {
  manual: manualPhoneProvider,
  ringcentral: ringCentralProvider,
};

// Provider ids that have a concrete, selectable adapter today.
export const AVAILABLE_PROVIDER_IDS: PhoneProviderId[] = ["manual", "ringcentral"];

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
  /** Whether the resolved provider is actually live/ready. RingCentral is
   *  provider-ready but NOT live unless credentials are configured; the UI
   *  uses this to show an honest boundary rather than faking a call. */
  live: boolean;
};

// Is a given provider actually LIVE (has real credentials/API), vs merely a
// registered adapter? Manual is always live (it's a tel:/log fallback).
// RingCentral is live only when the click-to-call flag/credentials are present.
export function isProviderLive(
  providerId: PhoneProviderId,
  opts: { ringCentralEnabled: boolean },
): boolean {
  if (providerId === "manual") return true;
  if (providerId === "ringcentral") return opts.ringCentralEnabled;
  // Other providers have no live implementation yet.
  return false;
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
  return {
    adapter,
    providerId: resolvedId,
    source,
    live: isProviderLive(resolvedId, { ringCentralEnabled: opts.ringCentralEnabled }),
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
    return {
      providerId: id as SelectablePhoneProviderId,
      displayName: adapter.label,
      facilityId: opts.facilityId ?? null,
      live: isProviderLive(id, { ringCentralEnabled: opts.ringCentralEnabled }),
    };
  });
}
