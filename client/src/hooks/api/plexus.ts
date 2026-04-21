import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  PlexusTaskSummary,
  UserEntry,
} from "@/components/plexus/SchedulerIcon";
import { qk } from "./keys";

export function usePlexusUsers() {
  return useQuery<UserEntry[]>({
    queryKey: qk.plexus.users(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useMyWorkTasks() {
  return useQuery<PlexusTaskSummary[]>({
    queryKey: qk.plexus.myWorkTasks(),
    refetchInterval: 60_000,
  });
}

export function useUrgentTasks() {
  return useQuery<PlexusTaskSummary[]>({
    queryKey: qk.plexus.urgentTasks(),
    refetchInterval: 30_000,
  });
}

export function useUnreadPerTask() {
  return useQuery<{ taskId: number; unreadCount: number }[]>({
    queryKey: qk.plexus.unreadPerTask(),
    refetchInterval: 60_000,
  });
}

export function useJoinTaskAsCollaborator() {
  return useMutation({
    mutationFn: async (taskId: number) => {
      const res = await apiRequest(
        "POST",
        `/api/plexus/tasks/${taskId}/collaborators`,
        { role: "collaborator" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.plexus.urgentTasks() });
    },
  });
}
