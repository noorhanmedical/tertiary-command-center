// Client hooks for Organization Settings — Facilities + Clinicians.
// Feeds the Settings CRUD UI AND the Plexus IQ batch clinician dropdown.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface OrgFacility {
  id: number;
  name: string;
  slug: string;
  shortName: string | null;
  address: string | null;
  phone: string | null;
  timezone: string | null;
  facilityType: string | null;
  code: string | null;
  active: boolean;
  createdAt: string;
}

export interface OrgClinician {
  id: number;
  displayName: string;
  credentials: string | null;
  npi: string | null;
  role: string | null;
  active: boolean;
  facilityIds: number[];
  createdAt: string;
  updatedAt: string;
}

export const ORG_FACILITIES_QK = ["/api/org/facilities"];
export const ORG_CLINICIANS_QK = ["/api/org/clinicians"];

export function useFacilities(includeInactive = false) {
  return useQuery<OrgFacility[]>({
    queryKey: [...ORG_FACILITIES_QK, includeInactive],
    queryFn: async () => {
      const res = await fetch(`/api/org/facilities?includeInactive=${includeInactive}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load facilities (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useClinicians(includeInactive = false) {
  return useQuery<OrgClinician[]>({
    queryKey: [...ORG_CLINICIANS_QK, includeInactive],
    queryFn: async () => {
      const res = await fetch(`/api/org/clinicians?includeInactive=${includeInactive}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load clinicians (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });
}

/** Active clinicians for a facility BY NAME — the batch dropdown source. */
export function useFacilityCliniciansByName(facilityName: string | null | undefined) {
  return useQuery<{ facilityId: number | null; clinicians: OrgClinician[] }>({
    queryKey: ["/api/org/clinicians-by-facility-name", facilityName],
    queryFn: async () => {
      const res = await fetch(
        `/api/org/clinicians-by-facility-name?name=${encodeURIComponent(facilityName ?? "")}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Failed to load facility clinicians (${res.status})`);
      return res.json();
    },
    enabled: !!facilityName,
    staleTime: 30_000,
  });
}

function invalidateOrg(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({
    predicate: (q) =>
      Array.isArray(q.queryKey) &&
      typeof q.queryKey[0] === "string" &&
      (q.queryKey[0] as string).startsWith("/api/org/"),
  });
}

export function useCreateFacility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<OrgFacility>) =>
      apiRequest("POST", "/api/org/facilities", body).then((r) => r.json()),
    onSuccess: () => invalidateOrg(queryClient),
  });
}

export function useUpdateFacility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<OrgFacility> }) =>
      apiRequest("PATCH", `/api/org/facilities/${id}`, body).then((r) => r.json()),
    onSuccess: () => invalidateOrg(queryClient),
  });
}

export function useCreateClinician() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<OrgClinician> & { facilityIds?: number[] }) =>
      apiRequest("POST", "/api/org/clinicians", body).then((r) => r.json()),
    onSuccess: () => invalidateOrg(queryClient),
  });
}

export function useUpdateClinician() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<OrgClinician> & { facilityIds?: number[] } }) =>
      apiRequest("PATCH", `/api/org/clinicians/${id}`, body).then((r) => r.json()),
    onSuccess: () => invalidateOrg(queryClient),
  });
}

export function useAssociateClinician() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ clinicId, clinicianId }: { clinicId: number; clinicianId: number }) =>
      apiRequest("POST", `/api/org/facilities/${clinicId}/clinicians`, { clinicianId }).then((r) => r.json()),
    onSuccess: () => invalidateOrg(queryClient),
  });
}

export function useDissociateClinician() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ clinicId, clinicianId }: { clinicId: number; clinicianId: number }) =>
      apiRequest("DELETE", `/api/org/facilities/${clinicId}/clinicians/${clinicianId}`).then((r) => r.json()),
    onSuccess: () => invalidateOrg(queryClient),
  });
}
