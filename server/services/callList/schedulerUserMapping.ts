// Scheduler ↔ user mapping resolver + audit for the call-list engine.
//
// The Team Member Portal call list is user-scoped, but engagement work is
// assigned to an `outreach_schedulers` row (patient_execution_cases
// .assignedTeamMemberId). The bridge from a logged-in user to their
// scheduler row is `outreach_schedulers.user_id`. When that column is NULL
// the user can never see their assigned work, so the resolver returns a
// STRUCTURED missing-mapping signal instead of an empty list that looks like
// "no work".
//
// See docs/architecture/call-list-engine-architecture.md §"scheduler-user mapping".

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { outreachSchedulers, users } from "@shared/schema";

export const MISSING_SCHEDULER_USER_MAPPING = "MISSING_SCHEDULER_USER_MAPPING";

export type ResolvedScheduler = {
  id: number;
  name: string;
  facility: string | null;
};

export type ResolveSchedulerResult =
  | { status: "ok"; schedulers: ResolvedScheduler[] }
  | { status: "missing_user_mapping"; code: typeof MISSING_SCHEDULER_USER_MAPPING };

/**
 * Resolve a logged-in user id to the outreach_schedulers row(s) mapped to
 * them via `user_id`. Returns a structured missing-mapping result (NOT an
 * empty list) when no scheduler is linked, so callers can distinguish
 * "unmapped account" from "mapped but has no work today".
 */
export async function resolveSchedulerForUser(
  userId: string,
): Promise<ResolveSchedulerResult> {
  const rows = await db
    .select({
      id: outreachSchedulers.id,
      name: outreachSchedulers.name,
      facility: outreachSchedulers.facility,
    })
    .from(outreachSchedulers)
    .where(eq(outreachSchedulers.userId, userId));

  if (rows.length === 0) {
    return { status: "missing_user_mapping", code: MISSING_SCHEDULER_USER_MAPPING };
  }
  return { status: "ok", schedulers: rows };
}

export type SchedulerMappingAuditRow = {
  schedulerId: number;
  schedulerName: string;
  facility: string | null;
  mapped: boolean;
  userId: string | null;
  username: string | null;
  /** Single unambiguous suggested user, when the scheduler is unmapped. */
  suggestedUserId: string | null;
  suggestedUsername: string | null;
  suggestionReason: string | null;
};

/**
 * Build a full audit of scheduler→user mappings. For unmapped schedulers it
 * proposes a single user link ONLY when exactly one username matches the
 * scheduler name (case-insensitive). Ambiguous or zero matches yield no
 * suggestion — the engine never guesses an identity mapping.
 */
export async function buildSchedulerMappingAudit(): Promise<SchedulerMappingAuditRow[]> {
  const [schedulers, allUsers] = await Promise.all([
    db
      .select({
        id: outreachSchedulers.id,
        name: outreachSchedulers.name,
        facility: outreachSchedulers.facility,
        userId: outreachSchedulers.userId,
      })
      .from(outreachSchedulers),
    db.select({ id: users.id, username: users.username }).from(users),
  ]);

  const usernameById = new Map(allUsers.map((u) => [u.id, u.username]));
  // Group users by normalized username so we can detect ambiguity.
  const usersByNormalizedName = new Map<string, { id: string; username: string }[]>();
  for (const u of allUsers) {
    const key = (u.username ?? "").trim().toLowerCase();
    if (!key) continue;
    const list = usersByNormalizedName.get(key) ?? [];
    list.push(u);
    usersByNormalizedName.set(key, list);
  }

  return schedulers.map((s) => {
    const mapped = s.userId != null;
    if (mapped) {
      return {
        schedulerId: s.id,
        schedulerName: s.name,
        facility: s.facility,
        mapped: true,
        userId: s.userId,
        username: usernameById.get(s.userId!) ?? null,
        suggestedUserId: null,
        suggestedUsername: null,
        suggestionReason: null,
      };
    }

    const key = (s.name ?? "").trim().toLowerCase();
    const matches = usersByNormalizedName.get(key) ?? [];
    const unambiguous = matches.length === 1 ? matches[0] : null;

    return {
      schedulerId: s.id,
      schedulerName: s.name,
      facility: s.facility,
      mapped: false,
      userId: null,
      username: null,
      suggestedUserId: unambiguous?.id ?? null,
      suggestedUsername: unambiguous?.username ?? null,
      suggestionReason: unambiguous
        ? `Exact username match for "${s.name}"`
        : matches.length > 1
          ? `Ambiguous — ${matches.length} users match "${s.name}"`
          : `No username matches "${s.name}"`,
    };
  });
}

/**
 * Apply a single scheduler→user mapping. Admin-gated at the route layer.
 * Verifies both rows exist and the user is not already linked to a different
 * scheduler before writing. Returns the updated scheduler id.
 */
export async function applySchedulerUserMapping(
  schedulerId: number,
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [scheduler] = await db
    .select({ id: outreachSchedulers.id, userId: outreachSchedulers.userId })
    .from(outreachSchedulers)
    .where(eq(outreachSchedulers.id, schedulerId))
    .limit(1);
  if (!scheduler) return { ok: false, reason: "Scheduler not found" };

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return { ok: false, reason: "User not found" };

  const [conflict] = await db
    .select({ id: outreachSchedulers.id })
    .from(outreachSchedulers)
    .where(and(eq(outreachSchedulers.userId, userId)))
    .limit(1);
  if (conflict && conflict.id !== schedulerId) {
    return {
      ok: false,
      reason: `User already mapped to scheduler #${conflict.id}`,
    };
  }

  await db
    .update(outreachSchedulers)
    .set({ userId })
    .where(eq(outreachSchedulers.id, schedulerId));
  return { ok: true };
}
