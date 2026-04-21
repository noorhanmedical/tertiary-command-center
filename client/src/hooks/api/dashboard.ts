import { useQuery } from "@tanstack/react-query";
import type { ScheduleDashboardResponse } from "@/components/HomeDashboard";
import { qk } from "./keys";

export function useScheduleDashboard(opts: {
  weekOverride?: string | null;
  enabled?: boolean;
}) {
  const { weekOverride, enabled = true } = opts;
  return useQuery<ScheduleDashboardResponse>({
    queryKey: qk.scheduleDashboard.weekly(weekOverride),
    queryFn: async () => {
      const url = weekOverride
        ? `/api/schedule/dashboard?weekStart=${encodeURIComponent(weekOverride)}`
        : "/api/schedule/dashboard";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    enabled,
    refetchInterval: 120_000,
  });
}
