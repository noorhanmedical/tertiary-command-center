// Notification service (Phase 6A). The one place operational notifications are
// created. It applies the canonical fatigue tier per type, persists via the
// repo (with dedupe), and fires a PHI-safe live-bus nudge so the recipient's
// notification center refetches within ~1s. Producers (handoff, task, workforce
// recovery, …) call the typed helpers below — they never insert rows directly.
//
// PHI discipline: `title`/`shortBody` should be operator-facing and minimal.
// Never put clinical detail or full patient identity in a notification; the
// canonical record (linked by id) is where the real data lives.

import {
  notificationSeverityForType,
  type InsertNotification,
  type Notification,
  type NotificationType,
} from "@shared/schema";
import { notificationsRepository } from "../../repositories/notifications.repo";
import { publishLiveActivity } from "../engagement/liveActivityBus";

// PHI-safe bus signal. Like "message_sent", this carries ONLY the event literal
// so any instance's notification-center consumer refetches its own scoped,
// authorized notifications. Never carries recipient id or content.
export const NOTIFICATION_EVENT = "notification_created";

export interface CreateNotificationInput {
  recipientUserId: string;
  type: NotificationType;
  title: string;
  shortBody?: string | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  taskId?: number | null;
  handoffId?: number | null;
  conversationId?: number | null;
  facilityId?: string | null;
  priorityLevel?: string | null;
  dedupeKey?: string | null;
  metadata?: Record<string, unknown> | null;
  expiresAt?: Date | null;
  /** Override the canonical severity (rare — e.g. escalate a NORMAL type). */
  severity?: "HIGH" | "NORMAL" | "LOW";
}

/**
 * Create one operational notification. Best-effort by design: a notification is
 * a SIGNAL, never the source of truth, so its failure must never break the
 * business operation that triggered it. Returns the row on success or null on
 * failure (logged) — callers should not depend on the return value for
 * correctness.
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<Notification | null> {
  try {
    const record: InsertNotification = {
      recipientUserId: input.recipientUserId,
      type: input.type,
      severity: input.severity ?? notificationSeverityForType(input.type),
      title: input.title,
      shortBody: input.shortBody ?? null,
      patientScreeningId: input.patientScreeningId ?? null,
      executionCaseId: input.executionCaseId ?? null,
      taskId: input.taskId ?? null,
      handoffId: input.handoffId ?? null,
      conversationId: input.conversationId ?? null,
      facilityId: input.facilityId ?? null,
      priorityLevel: input.priorityLevel ?? null,
      dedupeKey: input.dedupeKey ?? null,
      metadata: input.metadata ?? null,
      readAt: null,
      acknowledgedAt: null,
      expiresAt: input.expiresAt ?? null,
    };
    const row = await notificationsRepository.create(record);
    // PHI-safe nudge — content stays in the DB behind the scoped read endpoint.
    publishLiveActivity(NOTIFICATION_EVENT);
    return row;
  } catch (err) {
    console.error(
      "[notifications] create failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Notify a handoff recipient. Ack-required (P1/P2) uses a distinct type +
 *  dedupe key so it self-supersedes if re-emitted and can be expired on ack. */
export async function notifyHandoffReceived(args: {
  recipientUserId: string;
  handoffId: number;
  executionCaseId: number;
  patientScreeningId?: number | null;
  facilityId?: string | null;
  priorityLevel: string;
  reason: string;
  ackRequired: boolean;
}): Promise<Notification | null> {
  const ackRequired = args.ackRequired;
  return createNotification({
    recipientUserId: args.recipientUserId,
    type: ackRequired ? "handoff_ack_required" : "handoff_received",
    title: ackRequired
      ? `${args.priorityLevel} handoff needs your acknowledgement`
      : `New ${args.priorityLevel} handoff assigned to you`,
    shortBody: args.reason,
    handoffId: args.handoffId,
    executionCaseId: args.executionCaseId,
    patientScreeningId: args.patientScreeningId ?? null,
    facilityId: args.facilityId ?? null,
    priorityLevel: args.priorityLevel,
    dedupeKey: `handoff:${args.handoffId}`,
  });
}

/** Notify a user their task was assigned/claimed onto them. */
export async function notifyTaskAssigned(args: {
  recipientUserId: string;
  taskId: number;
  title: string;
  priorityLevel?: string | null;
  patientScreeningId?: number | null;
  facilityId?: string | null;
}): Promise<Notification | null> {
  return createNotification({
    recipientUserId: args.recipientUserId,
    type: "task_assigned",
    title: "A task was assigned to you",
    shortBody: args.title,
    taskId: args.taskId,
    priorityLevel: args.priorityLevel ?? null,
    patientScreeningId: args.patientScreeningId ?? null,
    facilityId: args.facilityId ?? null,
    dedupeKey: `task_assigned:${args.taskId}:${args.recipientUserId}`,
  });
}

/** Notify managers of a workforce exception (needs coverage / failed
 *  redistribution / deactivated-owner work released). */
export async function notifyManagerException(args: {
  recipientUserId: string;
  type: Extract<
    NotificationType,
    "needs_coverage" | "redistribution_failed" | "user_deactivated_work_released" | "manager_escalation"
  >;
  title: string;
  shortBody?: string | null;
  executionCaseId?: number | null;
  facilityId?: string | null;
  dedupeKey?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<Notification | null> {
  return createNotification({
    recipientUserId: args.recipientUserId,
    type: args.type,
    title: args.title,
    shortBody: args.shortBody ?? null,
    executionCaseId: args.executionCaseId ?? null,
    facilityId: args.facilityId ?? null,
    dedupeKey: args.dedupeKey ?? null,
    metadata: args.metadata ?? null,
  });
}

/** Expire the ack/received notification(s) for a handoff once it is
 *  acknowledged/completed/cancelled elsewhere — keeps the center from showing
 *  a stale "needs acknowledgement" after the fact (stale-state convergence). */
export async function clearHandoffNotifications(
  recipientUserId: string,
  handoffId: number,
): Promise<void> {
  try {
    await notificationsRepository.expireByDedupeKeys(recipientUserId, [`handoff:${handoffId}`]);
    publishLiveActivity(NOTIFICATION_EVENT);
  } catch (err) {
    console.error(
      "[notifications] clearHandoffNotifications failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}
