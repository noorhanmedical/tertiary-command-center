// Client access to the unified operational notification center (Phase 6A).
//
// The backend (/api/notifications/*) is a recipient-scoped delivery layer. This
// hook exposes the recent list + unread count and the read/ack mutations, and
// keeps them fresh via the PHI-safe SSE nudge (the "notification_created"
// signal on the shared engagement activity stream) with a polling fallback.

import { useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// Mirrors server/repositories/notifications.repo.ts row shape (subset used by
// the UI). All PHI-minimal — the canonical record is opened via the pointers.
export type PortalNotification = {
  id: number;
  type: string;
  severity: "HIGH" | "NORMAL" | "LOW";
  title: string;
  shortBody: string | null;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  taskId: number | null;
  handoffId: number | null;
  conversationId: number | null;
  facilityId: string | null;
  priorityLevel: string | null;
  readAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
};

const LIST_KEY = ["/api/notifications"] as const;
const COUNT_KEY = ["/api/notifications/unread-count"] as const;

async function fetchNotifications(): Promise<PortalNotification[]> {
  const res = await apiRequest("GET", "/api/notifications?limit=50");
  const json = (await res.json()) as { notifications: PortalNotification[] };
  return json.notifications ?? [];
}

async function fetchUnreadCount(): Promise<number> {
  const res = await apiRequest("GET", "/api/notifications/unread-count");
  const json = (await res.json()) as { count: number };
  return json.count ?? 0;
}

/**
 * Notification center data + actions. Live-refreshes on the shared engagement
 * activity stream (which now forwards the PHI-safe "notification_created"
 * nudge) and falls back to a 30s poll so the badge stays roughly current even
 * if the stream drops.
 */
export function useNotifications() {
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    void queryClient.invalidateQueries({ queryKey: COUNT_KEY });
  }, [queryClient]);

  // PHI-safe SSE nudge. Reuses the existing /api/engagement/activity-stream
  // (any authenticated user) — NOT a new realtime system. We only refetch our
  // own scoped notifications when the "notification_created" signal arrives.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/engagement/activity-stream", { withCredentials: true });
    const onActivity = (ev: MessageEvent) => {
      let eventType = "";
      try {
        eventType = (JSON.parse(ev.data) as { eventType?: string }).eventType ?? "";
      } catch {
        return;
      }
      if (eventType !== "notification_created") return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(invalidate, 250);
    };
    es.addEventListener("activity", onActivity);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      es.removeEventListener("activity", onActivity);
      es.close();
    };
  }, [invalidate]);

  const listQuery = useQuery<PortalNotification[]>({
    queryKey: LIST_KEY,
    queryFn: fetchNotifications,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const countQuery = useQuery<number>({
    queryKey: COUNT_KEY,
    queryFn: fetchUnreadCount,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const markRead = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/notifications/${id}/read`);
    },
    onSuccess: invalidate,
  });

  const acknowledge = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/notifications/${id}/acknowledge`);
    },
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/notifications/mark-all-read");
    },
    onSuccess: invalidate,
  });

  return {
    notifications: listQuery.data ?? [],
    unreadCount: countQuery.data ?? 0,
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    refetch: invalidate,
    markRead,
    acknowledge,
    markAllRead,
  };
}
