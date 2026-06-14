// scheduleStatusService — Phase 2 PR 2.4.
//
// Encapsulates status transitions for global_schedule_events.
// The single canonical writer for cancel / reschedule / no-show /
// confirm. Always:
//   - reads the existing event
//   - validates the requested transition
//   - updates global_schedule_events.status (+ startsAt when
//     applicable for reschedule)
//   - appends a patient_journey_events row
//   - returns the updated row
//
// We intentionally do NOT create local-only events — every transition
// writes to global_schedule_events. The route layer enforces
// facility scope before calling this service.

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { globalScheduleEvents } from "@shared/schema/globalSchedule";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { appendJourneyEvent } from "../journey/appendJourneyEvent";

export type ScheduleTransition = "cancel" | "reschedule" | "no_show" | "confirm";

const VALID_TRANSITIONS: Record<string, Set<ScheduleTransition>> = {
  // From → which transitions are allowed.
  scheduled: new Set(["cancel", "reschedule", "no_show", "confirm"]),
  confirmed: new Set(["cancel", "reschedule", "no_show"]),
  rescheduled: new Set(["cancel", "reschedule", "no_show", "confirm"]),
};

export type TransitionInput = {
  eventId: number;
  transition: ScheduleTransition;
  actorUserId: string | null;
  /** Required for reschedule. */
  newStartsAt?: Date | null;
  newEndsAt?: Date | null;
  /** Operator note (audit only). */
  note?: string | null;
};

export type TransitionResult = {
  ok: true;
  event: typeof globalScheduleEvents.$inferSelect;
  fromStatus: string;
  toStatus: string;
} | {
  ok: false;
  error: string;
  status: 400 | 404 | 409;
};

const TRANSITION_TO_STATUS: Record<ScheduleTransition, string> = {
  cancel: "cancelled",
  reschedule: "rescheduled",
  no_show: "no_show",
  confirm: "confirmed",
};

const TRANSITION_TO_EVENT_TYPE: Record<ScheduleTransition, string> = {
  cancel: "schedule_cancelled",
  reschedule: "schedule_rescheduled",
  no_show: "schedule_no_show",
  confirm: "schedule_confirmed",
};

export async function applyScheduleTransition(
  input: TransitionInput,
): Promise<TransitionResult> {
  const [existing] = await db
    .select()
    .from(globalScheduleEvents)
    .where(eq(globalScheduleEvents.id, input.eventId))
    .limit(1);
  if (!existing) {
    return { ok: false, error: "Schedule event not found", status: 404 };
  }

  const fromStatus = existing.status;
  const allowed = VALID_TRANSITIONS[fromStatus];
  if (!allowed || !allowed.has(input.transition)) {
    return {
      ok: false,
      error: `Cannot ${input.transition} an event in status "${fromStatus}"`,
      status: 409,
    };
  }

  if (input.transition === "reschedule") {
    if (!input.newStartsAt) {
      return { ok: false, error: "reschedule requires newStartsAt", status: 400 };
    }
    if (Number.isNaN(input.newStartsAt.getTime())) {
      return { ok: false, error: "newStartsAt is not a valid datetime", status: 400 };
    }
  }

  const toStatus = TRANSITION_TO_STATUS[input.transition];

  const updates: Record<string, unknown> = {
    status: toStatus,
    updatedAt: new Date(),
  };
  if (input.transition === "reschedule") {
    updates.startsAt = input.newStartsAt;
    if (input.newEndsAt) updates.endsAt = input.newEndsAt;
  }

  const [updated] = await db
    .update(globalScheduleEvents)
    .set(updates)
    .where(eq(globalScheduleEvents.id, input.eventId))
    .returning();

  // Reflect operationally onto the execution case for cancel + no-show.
  if (existing.executionCaseId != null) {
    if (input.transition === "cancel" || input.transition === "no_show") {
      try {
        await db
          .update(patientExecutionCases)
          .set({
            engagementStatus: input.transition === "cancel" ? "scheduling_needed" : "needs_followup",
            nextActionAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(patientExecutionCases.id, existing.executionCaseId));
      } catch (err: any) {
        console.error("[schedule-status] execution case update failed:", err.message);
      }
    } else if (input.transition === "reschedule") {
      try {
        await db
          .update(patientExecutionCases)
          .set({
            engagementStatus: "scheduled",
            nextActionAt: input.newStartsAt ?? new Date(),
            updatedAt: new Date(),
          })
          .where(eq(patientExecutionCases.id, existing.executionCaseId));
      } catch (err: any) {
        console.error("[schedule-status] execution case update (reschedule) failed:", err.message);
      }
    }
  }

  try {
    await appendJourneyEvent({
      patientName: existing.patientName ?? "Unknown",
      patientDob: existing.patientDob ?? undefined,
      patientScreeningId: existing.patientScreeningId ?? undefined,
      executionCaseId: existing.executionCaseId ?? undefined,
      eventType: TRANSITION_TO_EVENT_TYPE[input.transition] as any,
      eventSource: "scheduler_portal",
      actorUserId: input.actorUserId,
      summary: `${TRANSITION_TO_STATUS[input.transition]} via ${input.transition}`,
      metadata: {
        globalScheduleEventId: input.eventId,
        fromStatus,
        toStatus,
        newStartsAt: input.newStartsAt?.toISOString() ?? null,
        newEndsAt: input.newEndsAt?.toISOString() ?? null,
        note: input.note ?? null,
      },
    });
  } catch (err: any) {
    console.error("[schedule-status] journey append failed:", err.message);
  }

  return { ok: true, event: updated ?? existing, fromStatus, toStatus };
}
