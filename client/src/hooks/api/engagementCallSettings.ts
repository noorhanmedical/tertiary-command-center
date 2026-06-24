import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  EngagementCallConfig,
  CallConfigPatch,
  RoundingMode,
  WorkdayTier,
} from "@shared/schema";

export const ENGAGEMENT_CALL_SETTINGS_QK = ["/api/engagement/call-settings"];

export type EngagementTeam = "PCS" | "ACS";
export type CalendarStatus = "working" | "pto" | "unavailable";

export type { EngagementCallConfig, CallConfigPatch, RoundingMode, WorkdayTier };

export interface CallSettingsMember {
  schedulerId: number;
  name: string;
  facility: string;
  userId: string | null;
  configured: boolean;
  // persisted inputs
  team: EngagementTeam;
  callWorkdayPercent: number;
  visitPercent: number | null;
  outreachPercent: number | null;
  explicitCompletedCallKpi: number | null;
  explicitScheduledKpi: number | null;
  facilitiesCovered: string[] | null;
  maxDailyCapacity: number | null;
  manualWorkingToday: boolean | null;
  active: boolean;
  // derived
  completedCallKpi: number;
  scheduledKpi: number;
  visitTarget: number;
  outreachTarget: number;
  effectiveVisitPercent: number;
  effectiveOutreachPercent: number;
  carryover: number;
  remainingCapacity: number;
  calendarWorkingToday: boolean | null;
  calendarStatus: CalendarStatus;
  ptoToday: boolean;
  manualOverrideActive: boolean;
  workingToday: boolean;
}

export interface CallSettingsResponse {
  config: EngagementCallConfig;
  members: CallSettingsMember[];
  calendarAvailable: boolean;
  asOfDate: string;
}

export interface CallSettingsPatch {
  team?: EngagementTeam;
  callWorkdayPercent?: number;
  visitPercent?: number | null;
  outreachPercent?: number | null;
  explicitCompletedCallKpi?: number | null;
  explicitScheduledKpi?: number | null;
  facilitiesCovered?: string[] | null;
  maxDailyCapacity?: number | null;
  manualWorkingToday?: boolean | null;
  active?: boolean;
}

export function useEngagementCallSettings() {
  return useQuery<CallSettingsResponse>({
    queryKey: ENGAGEMENT_CALL_SETTINGS_QK,
    queryFn: async () => {
      const res = await fetch("/api/engagement/call-settings", {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Failed to load call settings (${res.status})`);
      }
      return res.json();
    },
    staleTime: 15_000,
  });
}

export function useUpdateCallSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { schedulerId: number; patch: CallSettingsPatch }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/engagement/call-settings/${vars.schedulerId}`,
        vars.patch,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ENGAGEMENT_CALL_SETTINGS_QK });
    },
  });
}

export function useUpdateCallConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: CallConfigPatch) => {
      const res = await apiRequest("PATCH", "/api/engagement/call-config", patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ENGAGEMENT_CALL_SETTINGS_QK });
    },
  });
}
