import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { OutreachCall } from "@shared/schema";
import { qk } from "./keys";

export function useOutreachSchedulers<T = unknown>() {
  return useQuery<T[]>({
    queryKey: qk.outreach.schedulers(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useOutreachDashboard<T = unknown>(refetchMs = 60_000) {
  return useQuery<T>({
    queryKey: qk.outreach.dashboard(),
    refetchInterval: refetchMs,
  });
}

export function useOutreachCallsToday(
  schedulerUserId: string | null | undefined,
) {
  return useQuery<OutreachCall[]>({
    queryKey: qk.outreach.callsToday(schedulerUserId),
    queryFn: async () => {
      const res = await fetch(
        `/api/outreach/calls/today?schedulerUserId=${encodeURIComponent(
          schedulerUserId!,
        )}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load calls");
      return res.json();
    },
    enabled: !!schedulerUserId,
    refetchInterval: 30_000,
  });
}

export function useOutreachCallsByPatients(patientIds: number[]) {
  return useQuery<Record<number, OutreachCall[]>>({
    queryKey: qk.outreach.callsByPatients(patientIds),
    queryFn: async () => {
      const res = await fetch(
        `/api/outreach/calls/by-patients?ids=${patientIds.join(",")}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load calls");
      return res.json();
    },
    enabled: patientIds.length > 0,
    refetchInterval: 60_000,
  });
}

export function invalidateOutreach() {
  queryClient.invalidateQueries({ queryKey: qk.outreach.dashboard() });
  queryClient.invalidateQueries({ queryKey: ["/api/outreach/calls/by-patients"] });
  queryClient.invalidateQueries({ queryKey: ["/api/outreach/calls/today"] });
}

export function useLogOutreachCall() {
  return useMutation({
    mutationFn: async (input: {
      patientScreeningId: number;
      outcome: string;
      notes?: string;
      schedulerUserId?: string;
    }) => {
      const res = await apiRequest("POST", "/api/outreach/calls", input);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to log call");
      }
      return res.json();
    },
    onSuccess: invalidateOutreach,
  });
}

export function useSendOutreachEmail() {
  return useMutation({
    mutationFn: async (input: {
      patientScreeningId: number;
      to: string;
      subject: string;
      body: string;
    }) => {
      const res = await apiRequest("POST", "/api/outreach/send-email", input);
      return res.json();
    },
    onSuccess: invalidateOutreach,
  });
}

export function useSendOutreachMaterial() {
  return useMutation({
    mutationFn: async (input: {
      patientScreeningId: number;
      materialId: string;
    }) => {
      const res = await apiRequest("POST", "/api/outreach/send-material", input);
      return res.json();
    },
    onSuccess: invalidateOutreach,
  });
}
