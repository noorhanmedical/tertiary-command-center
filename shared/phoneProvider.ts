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
export const SELECTABLE_PHONE_PROVIDER_IDS = ["manual", "ringcentral"] as const;
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
  /** Whether the provider is actually live (has real credentials/config). */
  live: boolean;
};
