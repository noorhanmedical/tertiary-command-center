import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AncillaryAppointment } from "@shared/schema";
import { qk } from "./keys";

export function useAppointmentsByFacility(
  facility: string | null | undefined,
) {
  return useQuery<AncillaryAppointment[]>({
    queryKey: qk.appointments.byFacility(facility),
    queryFn: async () => {
      const res = await fetch(
        `/api/appointments?facility=${encodeURIComponent(facility!)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load appointments");
      return res.json();
    },
    enabled: !!facility,
    refetchInterval: 30_000,
  });
}

export function useBookAppointment() {
  return useMutation({
    mutationFn: async (input: {
      patientName: string;
      facility: string;
      scheduledDate: string;
      scheduledTime: string;
      testType: string;
    }) => {
      const res = await apiRequest("POST", "/api/appointments", input);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to book");
      }
      return (await res.json()) as AncillaryAppointment;
    },
    onSuccess: () => {
      // Server-side filtering by facility means we invalidate the umbrella
      // key — react-query will refetch any active facility-scoped query.
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
    },
  });
}

export function useCancelAppointment() {
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/appointments/${id}`, {
        status: "cancelled",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
    },
  });
}
