// Client access to persisted phone-provider defaults (admin_settings-backed).
//
// The settings API is the SOURCE OF TRUTH for org / facility / team-member
// defaults. localStorage / VITE_DEFAULT_PHONE_PROVIDER are FALLBACK ONLY, used
// by the resolver when the API has not (yet) returned or has nothing persisted.

import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  PhoneProviderPreferencesDTO,
  PhoneProviderScopeLevel,
  SelectablePhoneProviderId,
} from "@shared/phoneProvider";

const PHONE_PROVIDER_SETTINGS_PATH = "/api/settings/phone-provider";

function phoneProviderQueryKey(facilityId: string | null) {
  return ["phone-provider-settings", facilityId ?? "__none__"] as const;
}

async function fetchPhoneProviderPreferences(
  facilityId: string | null,
): Promise<PhoneProviderPreferencesDTO> {
  const qs = facilityId ? `?facilityId=${encodeURIComponent(facilityId)}` : "";
  const res = await apiRequest("GET", `${PHONE_PROVIDER_SETTINGS_PATH}${qs}`);
  return (await res.json()) as PhoneProviderPreferencesDTO;
}

/** Persisted phone-provider defaults for a facility scope + the current user.
 *  Returns `undefined` until loaded; the resolver treats missing layers as
 *  "not persisted" and falls back accordingly. */
export function usePhoneProviderPreferences(facilityId: string | null) {
  return useQuery<PhoneProviderPreferencesDTO>({
    queryKey: phoneProviderQueryKey(facilityId),
    queryFn: () => fetchPhoneProviderPreferences(facilityId),
    staleTime: 60_000,
  });
}

export type SavePhoneProviderDefaultInput = {
  scope: PhoneProviderScopeLevel;
  providerId: SelectablePhoneProviderId;
  facilityId?: string | null;
};

/** Persist a default at a scope level (explicit "make default" action). */
export function useSavePhoneProviderDefault(facilityIdForInvalidation: string | null) {
  return useMutation({
    mutationFn: async (input: SavePhoneProviderDefaultInput) => {
      const res = await apiRequest("PUT", PHONE_PROVIDER_SETTINGS_PATH, input);
      return await res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: phoneProviderQueryKey(facilityIdForInvalidation),
      });
    },
  });
}
