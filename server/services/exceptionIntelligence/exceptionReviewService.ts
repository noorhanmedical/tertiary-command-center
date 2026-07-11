// exceptionReviewService — Phase 3 PR 3.3.
//
// Human-review state machine on exception_snapshots:
//   open → acknowledged → (in_review) → resolved | dismissed
//   any → reopened (status returns to open)
//
// Every transition records an exception_review_events row.

import { db } from "../../db";
import { eq, sql } from "drizzle-orm";
import { exceptionSnapshots } from "@shared/schema/exceptionSnapshots";
import { exceptionReviewEvents } from "@shared/schema/exceptionReviews";

export type ReviewActorContext = { actorUserId: string | null };
export type ReviewResult = { ok: true; status: string } | { ok: false; error: string; status: 400 | 404 | 409 };

async function loadException(id: number) {
  const [row] = await db.select().from(exceptionSnapshots).where(eq(exceptionSnapshots.id, id)).limit(1);
  return row;
}

async function recordEvent(args: {
  exceptionSnapshotId: number;
  eventType: string;
  actorUserId: string | null;
  assignedToUserId?: string | null;
  assignedRole?: string | null;
  reason?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(exceptionReviewEvents).values({
    exceptionSnapshotId: args.exceptionSnapshotId,
    eventType: args.eventType,
    actorUserId: args.actorUserId,
    assignedToUserId: args.assignedToUserId ?? null,
    assignedRole: args.assignedRole ?? null,
    reason: args.reason ?? null,
    note: args.note ?? null,
    metadata: args.metadata ?? {},
  });
}

export async function acknowledge(id: number, ctx: ReviewActorContext): Promise<ReviewResult> {
  const row = await loadException(id);
  if (!row) return { ok: false, error: "Exception not found", status: 404 };
  if (row.status === "resolved" || row.status === "dismissed" || row.status === "superseded") {
    return { ok: false, error: `Cannot acknowledge an exception in status "${row.status}"`, status: 409 };
  }
  await db.update(exceptionSnapshots).set({
    status: "acknowledged",
    acknowledgedAt: sql`CURRENT_TIMESTAMP`,
    acknowledgedByUserId: ctx.actorUserId,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  } as any).where(eq(exceptionSnapshots.id, id));
  await recordEvent({ exceptionSnapshotId: id, eventType: "acknowledged", actorUserId: ctx.actorUserId });
  return { ok: true, status: "acknowledged" };
}

export async function assign(id: number, ctx: ReviewActorContext & { assignedToUserId?: string | null; assignedRole?: string | null }): Promise<ReviewResult> {
  const row = await loadException(id);
  if (!row) return { ok: false, error: "Exception not found", status: 404 };
  if (!ctx.assignedToUserId && !ctx.assignedRole) {
    return { ok: false, error: "Must provide assignedToUserId or assignedRole", status: 400 };
  }
  await db.update(exceptionSnapshots).set({
    assignedToUserId: ctx.assignedToUserId ?? null,
    assignedRole: ctx.assignedRole ?? row.assignedRole ?? null,
    status: row.status === "open" ? "in_review" : row.status,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  } as any).where(eq(exceptionSnapshots.id, id));
  await recordEvent({
    exceptionSnapshotId: id,
    eventType: "assigned",
    actorUserId: ctx.actorUserId,
    assignedToUserId: ctx.assignedToUserId ?? null,
    assignedRole: ctx.assignedRole ?? null,
  });
  return { ok: true, status: "assigned" };
}

export async function addNote(id: number, ctx: ReviewActorContext & { note: string }): Promise<ReviewResult> {
  const row = await loadException(id);
  if (!row) return { ok: false, error: "Exception not found", status: 404 };
  if (!ctx.note.trim()) return { ok: false, error: "Note text required", status: 400 };
  await recordEvent({ exceptionSnapshotId: id, eventType: "note_added", actorUserId: ctx.actorUserId, note: ctx.note });
  return { ok: true, status: row.status };
}

export async function dismiss(id: number, ctx: ReviewActorContext & { reason: string }): Promise<ReviewResult> {
  const row = await loadException(id);
  if (!row) return { ok: false, error: "Exception not found", status: 404 };
  if (!ctx.reason.trim()) return { ok: false, error: "Reason required", status: 400 };
  await db.update(exceptionSnapshots).set({
    status: "dismissed",
    dismissedReason: ctx.reason,
    resolvedAt: sql`CURRENT_TIMESTAMP`,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  } as any).where(eq(exceptionSnapshots.id, id));
  await recordEvent({ exceptionSnapshotId: id, eventType: "dismissed", actorUserId: ctx.actorUserId, reason: ctx.reason });
  return { ok: true, status: "dismissed" };
}

export async function resolve(id: number, ctx: ReviewActorContext & { reason: string }): Promise<ReviewResult> {
  const row = await loadException(id);
  if (!row) return { ok: false, error: "Exception not found", status: 404 };
  if (!ctx.reason.trim()) return { ok: false, error: "Reason required", status: 400 };
  await db.update(exceptionSnapshots).set({
    status: "resolved",
    resolutionReason: ctx.reason,
    resolvedAt: sql`CURRENT_TIMESTAMP`,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  } as any).where(eq(exceptionSnapshots.id, id));
  await recordEvent({ exceptionSnapshotId: id, eventType: "resolved", actorUserId: ctx.actorUserId, reason: ctx.reason });
  return { ok: true, status: "resolved" };
}

export async function reopen(id: number, ctx: ReviewActorContext): Promise<ReviewResult> {
  const row = await loadException(id);
  if (!row) return { ok: false, error: "Exception not found", status: 404 };
  if (row.status === "open") return { ok: false, error: "Exception is already open", status: 409 };
  await db.update(exceptionSnapshots).set({
    status: "open",
    resolvedAt: null,
    resolutionReason: null,
    dismissedReason: null,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  } as any).where(eq(exceptionSnapshots.id, id));
  await recordEvent({ exceptionSnapshotId: id, eventType: "reopened", actorUserId: ctx.actorUserId });
  return { ok: true, status: "open" };
}

export async function listReviewEvents(id: number) {
  return db.select().from(exceptionReviewEvents).where(eq(exceptionReviewEvents.exceptionSnapshotId, id));
}
