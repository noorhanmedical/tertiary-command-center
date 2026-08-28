// Centralized call-queue ordering (decision K5/K6, requirement 6).
//
// ONE place defines the deterministic order the PCS/ACS call queue surfaces
// work. Every screen that renders the queue must sort through this module so
// priority math is never scattered across components.
//
// Conceptual tiers (highest first):
//   1. P1 handoffs / immediate work
//   2. overdue callbacks
//   3. P2 same-day handoffs
//   4. overdue carryover
//   5. current-day normal assigned work
//   6. P3 when due
//   7. P4 routine
//   8. P5 low priority
//
// We express these as an integer TIER (lower = earlier), then break ties with
// the useful existing signals — nextActionAt (sooner first), the explicit
// priorityScore column (higher first), and createdAt (older first) — so the
// ordering is fully deterministic.

import type { PlexusTaskPriorityLevel } from "@shared/schema/plexus";

export interface QueueItem {
  executionCaseId: number;
  // Canonical P-level of the item. For a plain assigned case with no handoff,
  // callers pass the case's effective priority (default P3-ish); for a handoff
  // item, the handoff's priorityLevel.
  priorityLevel: PlexusTaskPriorityLevel;
  // True when this item is a call handoff (vs standard assigned work).
  isHandoff: boolean;
  // Next action / callback time. Null = no scheduled callback.
  nextActionAt: Date | null;
  // Explicit priorityScore column (higher = earlier). Null → treated as -inf.
  priorityScore: number | null;
  // When the item entered the system (older = earlier on final tiebreak).
  createdAt: Date | null;
  // True when this item is carried over from a prior day (past-due, still
  // owned). Used to place overdue carryover in its tier.
  isCarryover: boolean;
}

// Tier constants — lower sorts earlier. Gaps left for future insertion.
export const QUEUE_TIER = {
  P1_HANDOFF: 10,
  OVERDUE_CALLBACK: 20,
  P2_HANDOFF: 30,
  OVERDUE_CARRYOVER: 40,
  CURRENT_NORMAL: 50,
  P3_DUE: 60,
  P4_ROUTINE: 70,
  P5_LOW: 80,
} as const;

function isOverdue(nextActionAt: Date | null, now: number): boolean {
  if (!nextActionAt) return false;
  const t = nextActionAt.getTime();
  return Number.isFinite(t) && t <= now;
}

function isDue(nextActionAt: Date | null, now: number, windowMs: number): boolean {
  if (!nextActionAt) return false;
  const t = nextActionAt.getTime();
  return Number.isFinite(t) && t <= now + windowMs;
}

/**
 * Assign the canonical queue tier for an item. Pure + deterministic.
 * `nowMs` and `dueWindowMs` are injectable for testing.
 */
export function queueTier(
  item: QueueItem,
  nowMs: number = Date.now(),
  dueWindowMs: number = 24 * 60 * 60 * 1000,
): number {
  const pl = item.priorityLevel;

  // 1 & 3: priority handoffs are surfaced by their P-level first.
  if (item.isHandoff) {
    if (pl === "P1") return QUEUE_TIER.P1_HANDOFF;
    if (pl === "P2") return QUEUE_TIER.P2_HANDOFF;
    // P3–P5 handoffs fall through to the same tiers as normal work of that
    // level (they are not "priority" handoffs), but keep their due/routine
    // placement below.
  } else if (pl === "P1") {
    // A non-handoff P1 is still immediate work.
    return QUEUE_TIER.P1_HANDOFF;
  }

  // 2: overdue callbacks (a due-in-the-past nextActionAt on live work).
  if (isOverdue(item.nextActionAt, nowMs) && !item.isCarryover) {
    return QUEUE_TIER.OVERDUE_CALLBACK;
  }

  // 4: overdue carryover (prior-day unfinished work).
  if (item.isCarryover) {
    return QUEUE_TIER.OVERDUE_CARRYOVER;
  }

  // 6: P3 when due (has a due nextActionAt within the window).
  if (pl === "P3" && isDue(item.nextActionAt, nowMs, dueWindowMs)) {
    return QUEUE_TIER.P3_DUE;
  }

  // 7 & 8: routine / low.
  if (pl === "P4") return QUEUE_TIER.P4_ROUTINE;
  if (pl === "P5") return QUEUE_TIER.P5_LOW;

  // 5: everything else is current-day normal assigned work (P2/P3 not-yet-due).
  return QUEUE_TIER.CURRENT_NORMAL;
}

/** Deterministic comparator: tier ASC, then nextActionAt ASC (nulls last),
 *  then priorityScore DESC (nulls last), then createdAt ASC (older first). */
export function compareQueueItems(
  a: QueueItem,
  b: QueueItem,
  nowMs: number = Date.now(),
  dueWindowMs?: number,
): number {
  const at = queueTier(a, nowMs, dueWindowMs);
  const bt = queueTier(b, nowMs, dueWindowMs);
  if (at !== bt) return at - bt;

  const aNAA = a.nextActionAt ? a.nextActionAt.getTime() : Number.POSITIVE_INFINITY;
  const bNAA = b.nextActionAt ? b.nextActionAt.getTime() : Number.POSITIVE_INFINITY;
  if (aNAA !== bNAA) return aNAA - bNAA;

  const aPS = a.priorityScore ?? Number.NEGATIVE_INFINITY;
  const bPS = b.priorityScore ?? Number.NEGATIVE_INFINITY;
  if (aPS !== bPS) return bPS - aPS;

  const aCA = a.createdAt ? a.createdAt.getTime() : Number.POSITIVE_INFINITY;
  const bCA = b.createdAt ? b.createdAt.getTime() : Number.POSITIVE_INFINITY;
  return aCA - bCA;
}

/** Sort a list of queue items in canonical order (stable, non-mutating). */
export function sortQueueItems<T extends QueueItem>(
  items: T[],
  nowMs: number = Date.now(),
  dueWindowMs?: number,
): T[] {
  return [...items].sort((a, b) => compareQueueItems(a, b, nowMs, dueWindowMs));
}
