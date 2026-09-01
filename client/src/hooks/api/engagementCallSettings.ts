import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export const ENGAGEMENT_CALL_SETTINGS_QK = ["/api/engagement/call-settings"];

export type EngagementTeam = "PCS" | "ACS";
export type CalendarStatus = "working" | "pto" | "unavailable";
export type RoundingMode = "round" | "floor" | "ceil";

export interface GlobalCallConfig {
  fullDayCompletedTarget: number;
  scheduledKpiPercent: number;
  defaultVisitPercent: number;
  defaultOutreachPercent: number;
  roundingMode: RoundingMode;
}

export interface WorkdayTier {
  workdayPercent: number;
  completedKpi: number;
}

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
  /** @deprecated Legacy Phase-1 input. NOT consumed by the target math
   *  (computeCallTargets uses the global config/tiers + explicit overrides).
   *  Returned for backward compat only; the Call Settings UI no longer edits
   *  or writes it. */
  baseCompletedCallKpi: number;
  /** @deprecated Legacy Phase-1 input — see baseCompletedCallKpi. Not the same
   *  as GlobalCallConfig.scheduledKpiPercent (that global field IS consumed). */
  scheduledKpiPercent: number;
  maxDailyCapacity: number | null;
  explicitCompletedKpi: number | null;
  explicitScheduledKpi: number | null;
  outreachPercent: number | null;
  facilitiesCovered: string[] | null;
  manualWorkingToday: boolean | null;
  active: boolean;
  // derived
  completedCallKpi: number;
  scheduledKpi: number;
  visitTarget: number;
  outreachTarget: number;
  carryover: number;
  remainingCapacity: number;
  calendarWorkingToday: boolean | null;
  calendarStatus: CalendarStatus;
  ptoToday: boolean;
  manualOverrideActive: boolean;
  workingToday: boolean;
}

export interface CallSettingsResponse {
  config: GlobalCallConfig;
  tiers: WorkdayTier[];
  members: CallSettingsMember[];
  calendarAvailable: boolean;
  asOfDate: string;
}

export interface CallSettingsPatch {
  team?: EngagementTeam;
  callWorkdayPercent?: number;
  visitPercent?: number | null;
  baseCompletedCallKpi?: number;
  scheduledKpiPercent?: number;
  maxDailyCapacity?: number | null;
  explicitCompletedKpi?: number | null;
  explicitScheduledKpi?: number | null;
  outreachPercent?: number | null;
  facilitiesCovered?: string[] | null;
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

export function useUpdateGlobalCallConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      config: GlobalCallConfig;
      tiers: WorkdayTier[];
    }) => {
      const res = await apiRequest(
        "PUT",
        "/api/engagement/call-settings/config",
        vars,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ENGAGEMENT_CALL_SETTINGS_QK });
    },
  });
}
