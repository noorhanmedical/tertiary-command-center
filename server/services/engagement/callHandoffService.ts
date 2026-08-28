// Call handoff service (Phase 3C / decisions K6, K8, K10).
//
// A handoff transfers/requests ownership of ONE call case from one team member
// to another. Ownership is canonical (patient_execution_cases.assignedTeamMemberId);
// the call_handoffs row records the transfer, its priority, deadline, and
// acknowledgement. Messaging is a NON-BLOCKING notification layer (req 21) —
// its failure never blocks the ownership transfer.
//
// Concurrency (req 20): the ownership mutation runs in a transaction with a
// FOR UPDATE row lock on the execution case, mirroring applyDistribution, so a
// case can never be double-assigned across manager/auto/PTO/peer paths.

import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { patientExecutionCases } from "@shared/schema/executionCase";
import {
  callHandoffs,
  handoffRequiresAcknowledgement,
  handoffMayExceedCapacity,
  type CallHandoff,
  type PlexusTaskPriorityLevel,
} from "@shared/schema";
import { storage } from "../../storage";
import { callHandoffsRepository } from "../../repositories/callHandoffs.repo";
import { engagementCallSettingsRepository } from "../../repositories/engagementCallSettings.repo";
import { appendJourneyEvent } from "../journey/appendJourneyEvent";
import { openDirectConversation, postSystemMessage } from "../messaging/messagingService";
import { computeCallTargets, remainingCapacity, getCarryoverCounts, getGlobalCallConfig } from "./callSettingsService";

export interface CreateHandoffInput {
  executionCaseId: number;
  toUserId: string;
  priorityLevel: PlexusTaskPriorityLevel;
  reason: string;
  note?: string | null;
  dueAt?: Date | null;
  source?: "peer" | "manager" | "system";
  managerOverride?: boolean;
  actorUserId: string; // who is creating the handoff (from)
  // Clinic context for the notification conversation. Null skips messaging
  // (e.g. system/admin flows with no clinic) — the transfer still succeeds.
  clinicId?: number | null;
}

export interface HandoffEligibility {
  eligible: boolean;
  code:
    | "ok"
    | "recipient_inactive"
    | "recipient_not_working"
    | "recipient_no_roster"
    | "facility_mismatch"
    | "over_capacity_blocked";
  reason: string;
  // Recipient capacity snapshot surfaced to the caller (manager sees over-cap).
  recipientCapacity?: {
    schedulerId: number;
    dailyCallCapacity: number;
    assigned: number;
    remainingCapacity: number;
    overCapacityAfter: number;
    workingToday: boolean;
  };
}

class HandoffError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export { HandoffError };

// Resolve the recipient's roster member for a facility (prefer exact facility
// match, else any roster row for the user).
async function resolveRecipientScheduler(toUserId: string, facilityId: string | null) {
  const rows = await storage.getOutreachSchedulers();
  const mine = rows.filter((r) => r.userId === toUserId);
  if (mine.length === 0) return null;
  if (facilityId) {
    const exact = mine.find((r) => r.facility === facilityId);
    if (exact) return exact;
  }
  return mine[0];
}

/**
 * Check whether `toUserId` may receive the given case at `priorityLevel`.
 * Read-only. Surfaces the recipient's capacity so managers can see an
 * over-capacity state instead of it being hidden (req 9).
 */
export async function checkHandoffEligibility(input: {
  toUserId: string;
  facilityId: string | null;
  priorityLevel: PlexusTaskPriorityLevel;
  managerOverride?: boolean;
}): Promise<HandoffEligibility> {
  const sched = await resolveRecipientScheduler(input.toUserId, input.facilityId);
  if (!sched) {
    return {
      eligible: false,
      code: "recipient_no_roster",
      reason: "Recipient is not a call team member.",
    };
  }

  const [saved] = await engagementCallSettingsRepository.listForSchedulers([sched.id]);
  const active = saved?.active ?? true;
  if (!active) {
    return { eligible: false, code: "recipient_inactive", reason: "Recipient is not active." };
  }

  // Facility coverage: a member with an explicit facilitiesCovered list must
  // cover this facility (a member's own facility always counts). Empty/unset
  // list => covers any facility.
  const covered = (saved?.facilitiesCovered ?? []).filter(Boolean);
  if (input.facilityId && covered.length > 0) {
    const coversOwn = sched.facility === input.facilityId;
    if (!coversOwn && !covered.includes(input.facilityId)) {
      return {
        eligible: false,
        code: "facility_mismatch",
        reason: `Recipient does not cover facility "${input.facilityId}".`,
      };
    }
  }

  // Working-today (PTO/manual override). Reuse the metrics service derivation
  // indirectly via the settings + PTO. We treat manualWorkingToday=false or an
  // approved PTO as not-working.
  const { config, tiers } = await getGlobalCallConfig();
  const targets = computeCallTargets(
    {
      callWorkdayPercent: saved?.callWorkdayPercent ?? 100,
      visitPercent: saved?.visitPercent ?? null,
      explicitCompletedKpi: saved?.explicitCompletedKpi ?? null,
      explicitScheduledKpi: saved?.explicitScheduledKpi ?? null,
      maxDailyCapacity: saved?.maxDailyCapacity ?? null,
    },
    config,
    tiers,
  );
  const dailyCallCapacity = Math.max(0, Math.min(targets.completedCallKpi, targets.maxDailyCapacity));
  const [carryoverMap, assignedMap] = await Promise.all([
    getCarryoverCounts([sched.id]),
    getAssignedCount(sched.id),
  ]);
  const carryover = carryoverMap.get(sched.id) ?? 0;
  const assigned = assignedMap;
  const remaining = remainingCapacity(dailyCallCapacity, carryover);
  const overCapacityAfter = Math.max(0, assigned + 1 - dailyCallCapacity);

  const workingToday = saved?.manualWorkingToday !== false; // null/true => working
  if (!workingToday) {
    return {
      eligible: false,
      code: "recipient_not_working",
      reason: "Recipient is not working today.",
      recipientCapacity: {
        schedulerId: sched.id,
        dailyCallCapacity,
        assigned,
        remainingCapacity: remaining,
        overCapacityAfter,
        workingToday,
      },
    };
  }

  // Capacity gate. P1/P2 (or managerOverride) may exceed capacity; P3–P5 may
  // not unless overridden. We NEVER hide the over-capacity state.
  const wouldExceed = assigned + 1 > dailyCallCapacity;
  const mayExceed = handoffMayExceedCapacity(input.priorityLevel, input.managerOverride ?? false);
  if (wouldExceed && !mayExceed) {
    return {
      eligible: false,
      code: "over_capacity_blocked",
      reason:
        "Recipient is at capacity. Use P1/P2 or a manager override to exceed normal capacity.",
      recipientCapacity: {
        schedulerId: sched.id,
        dailyCallCapacity,
        assigned,
        remainingCapacity: remaining,
        overCapacityAfter,
        workingToday,
      },
    };
  }

  return {
    eligible: true,
    code: "ok",
    reason: "Recipient can receive this handoff.",
    recipientCapacity: {
      schedulerId: sched.id,
      dailyCallCapacity,
      assigned,
      remainingCapacity: remaining,
      overCapacityAfter,
      workingToday,
    },
  };
}

async function getAssignedCount(schedulerId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(patientExecutionCases)
    .where(
      and(
        eq(patientExecutionCases.assignedTeamMemberId, schedulerId),
        eq(patientExecutionCases.lifecycleStatus, "active"),
        sql`${patientExecutionCases.engagementStatus} NOT IN ('completed','scheduled','cancelled','archived','closed')`,
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Create a handoff: verify eligibility, transfer ownership canonically (txn +
 * FOR UPDATE), record the handoff row, emit a journey event, then best-effort
 * notify the recipient via messaging (non-blocking).
 */
export async function createHandoff(input: CreateHandoffInput): Promise<{
  handoff: CallHandoff;
  ownershipTransferred: boolean;
  notified: boolean;
}> {
  const ec = await db
    .select()
    .from(patientExecutionCases)
    .where(eq(patientExecutionCases.id, input.executionCaseId))
    .limit(1)
    .then((r) => r[0]);
  if (!ec) throw new HandoffError("case_not_found", "Execution case not found", 404);

  const facilityId = ec.facilityId ?? null;

  // Eligibility (req 9). Throws for hard failures; surfaces capacity for soft.
  const eligibility = await checkHandoffEligibility({
    toUserId: input.toUserId,
    facilityId,
    priorityLevel: input.priorityLevel,
    managerOverride: input.managerOverride ?? false,
  });
  if (!eligibility.eligible) {
    const err = new HandoffError(eligibility.code, eligibility.reason, 409);
    (err as unknown as { eligibility: HandoffEligibility }).eligibility = eligibility;
    throw err;
  }

  const recipientSchedulerId = eligibility.recipientCapacity!.schedulerId;
  const previousSchedulerId = ec.assignedTeamMemberId ?? null;

  // ── Canonical ownership transfer with row lock (req 8, req 20) ──
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM patient_execution_cases WHERE id = ${input.executionCaseId} FOR UPDATE`,
    );
    await tx
      .update(patientExecutionCases)
      .set({
        assignedTeamMemberId: recipientSchedulerId,
        assignedRole: "scheduler",
        updatedAt: now,
      })
      .where(eq(patientExecutionCases.id, input.executionCaseId));
  });

  // ── Record the handoff row (source of truth for the transfer) ──
  const handoff = await callHandoffsRepository.create({
    executionCaseId: input.executionCaseId,
    patientScreeningId: ec.patientScreeningId ?? null,
    fromUserId: input.actorUserId,
    toUserId: input.toUserId,
    facilityId,
    priorityLevel: input.priorityLevel,
    reason: input.reason,
    note: input.note ?? null,
    dueAt: input.dueAt ?? null,
    status: "pending",
    source: input.source ?? "peer",
    managerOverride: input.managerOverride ?? false,
    createdByUserId: input.actorUserId,
    metadata: {
      previousSchedulerId,
      newSchedulerId: recipientSchedulerId,
    },
  });

  // ── Audit / journey event ──
  try {
    await appendJourneyEvent({
      patientScreeningId: ec.patientScreeningId ?? undefined,
      executionCaseId: input.executionCaseId,
      actorUserId: input.actorUserId,
      patientName: ec.patientName ?? "Unnamed",
      patientDob: ec.patientDob ?? undefined,
      eventType: "engagement_assignment_changed",
      eventSource: "call_handoff",
      summary: `Handoff (${input.priorityLevel}) to team member — ${input.reason}`,
      metadata: {
        handoffId: handoff.id,
        previousSchedulerId,
        newSchedulerId: recipientSchedulerId,
        priorityLevel: input.priorityLevel,
        source: input.source ?? "peer",
        managerOverride: input.managerOverride ?? false,
        reason: input.reason,
      },
    });
  } catch {
    // Best-effort audit — never blocks the transfer.
  }

  // ── Non-blocking messaging notification (req 21) ──
  let notified = false;
  try {
    if (input.clinicId == null || input.clinicId <= 0) {
      throw new Error("no clinic context for handoff notification");
    }
    const { conversationId } = await openDirectConversation({
      clinicId: input.clinicId,
      meUserId: input.actorUserId,
      otherUserId: input.toUserId,
    });
    await postSystemMessage({
      conversationId,
      body: `New ${input.priorityLevel} call handoff assigned to you: ${input.reason}`,
      metadata: {
        kind: "call_handoff",
        handoffId: handoff.id,
        executionCaseId: input.executionCaseId,
        priorityLevel: input.priorityLevel,
      },
    });
    notified = true;
  } catch (err) {
    // Notification failure must NOT undo the transfer — the handoff row still
    // exists and ownership is already moved. Surface it as observable.
    console.error(
      "[call-handoff] notification failed (handoff still valid):",
      err instanceof Error ? err.message : err,
    );
  }

  return { handoff, ownershipTransferred: true, notified };
}

/** Recipient acknowledges a handoff (required for P1/P2). */
export async function acknowledgeHandoff(
  handoffId: number,
  actorUserId: string,
): Promise<CallHandoff> {
  const h = await callHandoffsRepository.getById(handoffId);
  if (!h) throw new HandoffError("not_found", "Handoff not found", 404);
  if (h.toUserId !== actorUserId) {
    throw new HandoffError("forbidden", "Only the recipient can acknowledge.", 403);
  }
  if (h.status === "cancelled") {
    throw new HandoffError("cancelled", "Handoff was recalled.", 409);
  }
  const now = new Date();
  const updated = await callHandoffsRepository.update(handoffId, {
    status: "acknowledged",
    acknowledgedAt: now,
    acknowledgedByUserId: actorUserId,
    viewedAt: h.viewedAt ?? now,
  });
  return updated!;
}

/** Mark a handoff viewed (lightweight receipt for the queue render). */
export async function markHandoffViewed(
  handoffId: number,
  actorUserId: string,
): Promise<CallHandoff | undefined> {
  const h = await callHandoffsRepository.getById(handoffId);
  if (!h || h.toUserId !== actorUserId || h.viewedAt) return h;
  return callHandoffsRepository.update(handoffId, { viewedAt: new Date() });
}

/** Recipient completes the handoff's underlying call/work. */
export async function completeHandoff(
  handoffId: number,
  actorUserId: string,
): Promise<CallHandoff> {
  const h = await callHandoffsRepository.getById(handoffId);
  if (!h) throw new HandoffError("not_found", "Handoff not found", 404);
  if (h.toUserId !== actorUserId) {
    throw new HandoffError("forbidden", "Only the recipient can complete.", 403);
  }
  // P1/P2 must be acknowledged before completion (audited flow, req 10).
  if (handoffRequiresAcknowledgement(h.priorityLevel) && h.status === "pending") {
    throw new HandoffError(
      "ack_required",
      "This priority handoff must be acknowledged before completion.",
      409,
    );
  }
  const updated = await callHandoffsRepository.update(handoffId, {
    status: "completed",
    completedAt: new Date(),
  });
  return updated!;
}

/** Sender or a manager recalls a handoff before it completes. Does NOT revert
 *  ownership automatically (the current owner keeps the case unless a manager
 *  explicitly redistributes) — recall just closes the request record. */
export async function cancelHandoff(
  handoffId: number,
  actorUserId: string,
  isManager: boolean,
): Promise<CallHandoff> {
  const h = await callHandoffsRepository.getById(handoffId);
  if (!h) throw new HandoffError("not_found", "Handoff not found", 404);
  if (!isManager && h.fromUserId !== actorUserId) {
    throw new HandoffError("forbidden", "Only the sender or a manager can recall.", 403);
  }
  if (h.status === "completed") {
    throw new HandoffError("completed", "Handoff already completed.", 409);
  }
  const updated = await callHandoffsRepository.update(handoffId, {
    status: "cancelled",
    cancelledAt: new Date(),
    cancelledByUserId: actorUserId,
  });
  return updated!;
}

// ─── Right-rail queue composition (req 6 + req 11) ───────────────────────────
//
// Attach each case's open handoffs and apply the CENTRALIZED queue ordering so
// PRIORITY / TEAM HANDOFFS surface above standard assigned work — without
// creating a second ownership model (the execution case stays canonical).

import { effectiveTaskPriorityLevel } from "@shared/schema";
import { sortQueueItems, type QueueItem } from "./queueScoring";
import { startOfTodayUtc } from "./callSettingsService";

export interface QueueCaseAnnotation<T> {
  case: T;
  handoffs: CallHandoff[];
  // The highest-priority OPEN handoff on this case (drives queue placement).
  topHandoff: CallHandoff | null;
  isHandoff: boolean;
  isCarryover: boolean;
}

/**
 * Given scheduler-portal case rows, attach open handoffs and return them in
 * canonical queue order (priority handoffs first). Pure ordering via
 * queueScoring; the underlying ownership is untouched.
 */
export async function annotateAndOrderQueue<
  T extends {
    id: number;
    nextActionAt?: Date | string | null;
    priorityScore?: number | null;
    createdAt?: Date | string | null;
    priorityLevel?: string | null;
    priority?: string | null;
  },
>(cases: T[]): Promise<QueueCaseAnnotation<T>[]> {
  if (cases.length === 0) return [];
  const ids = cases.map((c) => c.id);
  const openHandoffs = await callHandoffsRepository.listOpenForExecutionCases(ids);
  const byCase = new Map<number, CallHandoff[]>();
  for (const h of openHandoffs) {
    const list = byCase.get(h.executionCaseId) ?? [];
    list.push(h);
    byCase.set(h.executionCaseId, list);
  }

  const startOfToday = startOfTodayUtc().getTime();
  const toDate = (v: Date | string | null | undefined): Date | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const priorityRank: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };

  const annotated = cases.map((c) => {
    const handoffs = (byCase.get(c.id) ?? []).sort(
      (a, b) => (priorityRank[a.priorityLevel] ?? 9) - (priorityRank[b.priorityLevel] ?? 9),
    );
    const topHandoff = handoffs[0] ?? null;
    const nextActionAt = toDate(c.nextActionAt);
    // Carryover = past-due next action from a prior day, still owned.
    const isCarryover =
      !!nextActionAt && nextActionAt.getTime() < startOfToday;
    return {
      annotation: {
        case: c,
        handoffs,
        topHandoff,
        isHandoff: !!topHandoff,
        isCarryover,
      } as QueueCaseAnnotation<T>,
      queueItem: {
        executionCaseId: c.id,
        priorityLevel: topHandoff
          ? (topHandoff.priorityLevel as QueueItem["priorityLevel"])
          : effectiveTaskPriorityLevel({ priorityLevel: c.priorityLevel, priority: c.priority }),
        isHandoff: !!topHandoff,
        nextActionAt,
        priorityScore: c.priorityScore ?? null,
        createdAt: toDate(c.createdAt),
        isCarryover,
      } as QueueItem,
    };
  });

  const orderedItems = sortQueueItems(annotated.map((a) => a.queueItem));
  const orderById = new Map(orderedItems.map((it, idx) => [it.executionCaseId, idx]));
  return annotated
    .sort(
      (a, b) =>
        (orderById.get(a.queueItem.executionCaseId) ?? 0) -
        (orderById.get(b.queueItem.executionCaseId) ?? 0),
    )
    .map((a) => a.annotation);
}

export { callHandoffsRepository };
