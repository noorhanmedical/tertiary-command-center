// Client hooks for scheduling resource capacity + temporary overrides.
//
// Reads/writes the per-facility equipment configuration that drives the
// capacity-aware scheduler. Mirrors the organization.ts hook pattern.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type ResourceType = "brainwave" | "vitalwave" | "ultrasound";

export type ResourceCapacityConfig = {
  resourceType: ResourceType;
  machineCount: number;
  durationMinutes: number;
  minutesPerStudy: number | null;
  turnoverMinutes: number;
};

export type TemporaryOverride = {
  id: number;
  clinicId: number;
  facilityId: string | null;
  resourceType: ResourceType;
  startDate: string;
  endDate: string;
  availableCapacity: number;
  reason: string | null;
  createdBy: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FacilityCapacityResponse = {
  clinicId: number | null;
  facility: string | null;
  effective: Record<ResourceType, ResourceCapacityConfig>;
  rows: Array<ResourceCapacityConfig & { id: number; clinicId: number }>;
  overrides: TemporaryOverride[];
};

const capacityKey = (facility: string | null | undefined) => [
  "/api/scheduling/capacity",
  facility ?? "",
];

export function useFacilityCapacity(facility: string | null | undefined) {
  return useQuery<FacilityCapacityResponse>({
    queryKey: capacityKey(facility),
    queryFn: async () => {
      const res = await fetch(
        `/api/scheduling/capacity?facility=${encodeURIComponent(facility ?? "")}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Failed to load capacity (${res.status})`);
      return res.json();
    },
    enabled: !!facility,
    staleTime: 30_000,
  });
}

function invalidateCapacity(
  queryClient: ReturnType<typeof useQueryClient>,
  facility: string | null | undefined,
) {
  queryClient.invalidateQueries({ queryKey: capacityKey(facility) });
  // The scheduler's availability queries also change when capacity changes.
  queryClient.invalidateQueries({
    predicate: (q) =>
      Array.isArray(q.queryKey) &&
      typeof q.queryKey[0] === "string" &&
      (q.queryKey[0] as string).startsWith("scheduler-availability"),
  });
}

export function useUpdateCapacity(facility: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      resourceType,
      body,
    }: {
      resourceType: ResourceType;
      body: Partial<ResourceCapacityConfig>;
    }) =>
      apiRequest(
        "PUT",
        `/api/scheduling/capacity/${encodeURIComponent(facility ?? "")}/${resourceType}`,
        { resourceType, ...body },
      ).then((r) => r.json()),
    onSuccess: () => invalidateCapacity(queryClient, facility),
  });
}

export function useCreateOverride(facility: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      resourceType: ResourceType;
      startDate: string;
      endDate: string;
      availableCapacity: number;
      reason?: string | null;
    }) =>
      apiRequest(
        "POST",
        `/api/scheduling/capacity/${encodeURIComponent(facility ?? "")}/overrides`,
        body,
      ).then((r) => r.json()),
    onSuccess: () => invalidateCapacity(queryClient, facility),
  });
}

export function useLiftOverride(facility: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/scheduling/capacity/overrides/${id}`).then((r) => r.json()),
    onSuccess: () => invalidateCapacity(queryClient, facility),
  });
}
