// scheduleTransitionApi — Phase 2 PR 2.4
//
// Thin client for POST /api/global-schedule-events/:id/transition.

import { invalidateTeamPortalScheduleQueries } from "./scheduleInvalidations";
import type { QueryClient } from "@tanstack/react-query";

export type ScheduleTransition = "cancel" | "reschedule" | "no_show" | "confirm";

export type TransitionInput = {
  eventId: number;
  transition: ScheduleTransition;
  newStartsAt?: string | null;
  newEndsAt?: string | null;
  note?: string | null;
};

export async function postScheduleTransition(input: TransitionInput): Promise<unknown> {
  const res = await fetch(`/api/global-schedule-events/${input.eventId}/transition`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transition: input.transition,
      newStartsAt: input.newStartsAt ?? null,
      newEndsAt: input.newEndsAt ?? null,
      note: input.note ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function postScheduleTransitionAndInvalidate(
  input: TransitionInput,
  queryClient: QueryClient,
  ctx: Parameters<typeof invalidateTeamPortalScheduleQueries>[1] = {},
): Promise<unknown> {
  const result = await postScheduleTransition(input);
  invalidateTeamPortalScheduleQueries(queryClient, ctx);
  return result;
}
