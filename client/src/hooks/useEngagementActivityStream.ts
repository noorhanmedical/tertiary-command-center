// Team Portal live queue-refresh via the shared engagement activity SSE.
//
// Subscribes to GET /api/engagement/activity-stream (the portal-accessible
// endpoint that reuses the SAME liveActivityBus as the admin distribution
// stream — not a second realtime system). On a PHI-free "activity" nudge, it
// invalidates the Team Portal work-queue + schedule caches so a cross-user
// ownership/work-state change (reassignment, absence redistribution, a call
// disposition logged by a manager, etc.) is reflected WITHOUT a manual reload.
//
// The server remains authoritative: the event carries only an eventType
// literal; the client refetches its own scope-enforced canonical data.

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateTeamPortalScheduleQueries } from "@/lib/portal/scheduleInvalidations";

export function useEngagementActivityStream(
  ctx: { facility?: string | null; selectedDate?: string | null } = {},
  enabled = true,
): void {
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep latest ctx in a ref so reconnects aren't triggered by ctx changes.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    if (
      !enabled ||
      typeof window === "undefined" ||
      typeof EventSource === "undefined"
    ) {
      return;
    }
    let cancelled = false;
    const es = new EventSource("/api/engagement/activity-stream", {
      withCredentials: true,
    });

    es.addEventListener("activity", () => {
      // Debounce bursts (e.g. a bulk assign / auto-distribute writing many
      // events at once) into a single refetch.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (cancelled) return;
        invalidateTeamPortalScheduleQueries(queryClient, {
          facility: ctxRef.current.facility ?? null,
          selectedDate: ctxRef.current.selectedDate ?? null,
        });
        // Engagement board + Call Results (when those surfaces are mounted).
        queryClient.invalidateQueries({
          predicate: (q) =>
            Array.isArray(q.queryKey) &&
            (q.queryKey[0] === "/api/engagement/assignment-board" ||
              q.queryKey[0] === "/api/engagement/call-results-list"),
        });
      }, 250);
    });

    // EventSource auto-reconnects on error; the query polling paths still cover
    // any gap, so no explicit error handling beyond letting it retry.
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      es.close();
    };
  }, [enabled, queryClient]);
}
