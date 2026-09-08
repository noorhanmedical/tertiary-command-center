// Phase 4 — ACTIVE-WORK CLAIM / LEASE.
//
// A CLAIM is server-authoritative proof that a team member is ACTIVELY working
// a case right now (call workspace open / on a call). It is DISTINCT from:
//   • OWNERSHIP (patient_execution_cases.assigned_team_member_id) — who the
//     case belongs to, and
//   • DISPOSITION (engagement_status / lifecycle_status / next_action_at /
//     call_attempt_count) — what happened / when to act next.
// A claim exists purely to stop CONCURRENT work + redistribution of the same
// patient. It NEVER mutates ownership or disposition and NEVER touches metrics.
//
// Storage: three additive columns on patient_execution_cases (migration 0084):
//   active_claim_by (outreach_schedulers.id), active_claim_at, active_claim_expires_at.
// A claim is ACTIVE only while  by IS NOT NULL AND expires_at > now  — expiry is
// IMPLICIT (a crashed browser's claim is simply ignored and overwritten; no
// sweeper, no permanent lock rows).
//
// Concurrency: this service does NOT invent a lock platform. It composes the
// canonical primitives already in the codebase:
//   • pg_advisory_xact_lock keyed on the PATIENT (name+dob) → serializes claim
//     acquisition across a patient's sibling cases (cross-service protection),
//     auto-released at commit/rollback (same idiom as canonicalFinancial
//     paymentCommands).
//   • SELECT … FOR UPDATE on the case row → serializes same-case acquisition
//     (same idiom as applyDistribution / createHandoff).
// Together these give a DB-level guarantee of AT MOST ONE active claim per
// patient — two concurrent acquirers can never both win.

import { createHash } from "crypto";
import { and, eq, ne, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { storage } from "../../storage";
import { appendJourneyEvent } from "../journey/appendJourneyEvent";

/** Default lease length. A claim is renewed by the client while the workspace
 *  stays open; if the browser crashes, the lease lapses after this window and
 *  the case becomes claimable again. Configurable; not sub-minute. */
export const WORKCLAIM_LEASE_SECONDS = Math.max(
  30,
  Number(process.env.WORKCLAIM_LEASE_SECONDS ?? 300),
);
/** Recommended client renewal interval (server exposes it; client honors it).
 *  Comfortably shorter than the lease so a live call never lapses mid-work. */
export const WORKCLAIM_RENEW_SECONDS = Math.max(
  15,
  Number(process.env.WORKCLAIM_RENEW_SECONDS ?? 120),
);

export type ClaimColumns = {
  activeClaimBy: number | null;
  activeClaimExpiresAt: Date | string | null;
};

/** PURE: is there an ACTIVE (non-expired) claim on this row right now? */
export function isClaimActive(row: ClaimColumns, now: Date = new Date()): boolean {
  if (row.activeClaimBy == null || row.activeClaimExpiresAt == null) return false;
  const exp = row.activeClaimExpiresAt instanceof Date
    ? row.activeClaimExpiresAt
    : new Date(row.activeClaimExpiresAt);
  return exp.getTime() > now.getTime();
}

/** PURE: patient-level advisory-lock key (two int32s) from name+dob, so all
 *  claim acquires for the SAME patient serialize regardless of which sibling
 *  case they target. Case-insensitive name; null dob folded to "". */
export function patientLockKey(name: string, dob: string | null): [number, number] {
  const norm = `${(name ?? "").trim().toLowerCase()}|${dob ?? ""}`;
  const hash = createHash("sha256").update(norm).digest();
  return [hash.readInt32BE(0), hash.readInt32BE(4)];
}

export type ClaimInfo = {
  executionCaseId: number;
  active: boolean;
  claimedBySchedulerId: number | null;
  claimedByName: string | null;
  claimedAt: Date | null;
  expiresAt: Date | null;
};

export type AcquireOutcome =
  | { ok: true; state: "acquired" | "renewed"; claim: ClaimInfo; leaseSeconds: number }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "conflict" | "conflict_sibling"; claim: ClaimInfo };

/** Resolve a login userId → their roster scheduler id (ownership id). Mirrors
 *  the established storage.getOutreachSchedulers() match used elsewhere. */
export async function resolveActingSchedulerId(userId: string | null | undefined): Promise<number | null> {
  if (!userId) return null;
  const rosters = await storage.getOutreachSchedulers();
  const mine = rosters.find((r) => r.userId === userId);
  return mine ? mine.id : null;
}

async function schedulerName(schedulerId: number | null): Promise<string | null> {
  if (schedulerId == null) return null;
  const rosters = await storage.getOutreachSchedulers();
  return rosters.find((r) => r.id === schedulerId)?.name ?? null;
}

function toClaimInfo(
  executionCaseId: number,
  row: { activeClaimBy: number | null; activeClaimAt: Date | string | null; activeClaimExpiresAt: Date | string | null },
  now: Date,
): ClaimInfo {
  const expiresAt = row.activeClaimExpiresAt
    ? row.activeClaimExpiresAt instanceof Date ? row.activeClaimExpiresAt : new Date(row.activeClaimExpiresAt)
    : null;
  const claimedAt = row.activeClaimAt
    ? row.activeClaimAt instanceof Date ? row.activeClaimAt : new Date(row.activeClaimAt)
    : null;
  return {
    executionCaseId,
    active: isClaimActive(row, now),
    claimedBySchedulerId: row.activeClaimBy,
    claimedByName: null, // filled by the caller when a display name is needed
    claimedAt,
    expiresAt,
  };
}

/** Read the current claim for a case (with the holder's display name). */
export async function getClaim(executionCaseId: number, now: Date = new Date()): Promise<ClaimInfo | null> {
  const [row] = await db
    .select({
      activeClaimBy: patientExecutionCases.activeClaimBy,
      activeClaimAt: patientExecutionCases.activeClaimAt,
      activeClaimExpiresAt: patientExecutionCases.activeClaimExpiresAt,
    })
    .from(patientExecutionCases)
    .where(eq(patientExecutionCases.id, executionCaseId))
    .limit(1);
  if (!row) return null;
  const info = toClaimInfo(executionCaseId, row, now);
  info.claimedByName = await schedulerName(info.active ? info.claimedBySchedulerId : null);
  return info;
}

/** True when the member currently holds a VALID (non-expired) active claim on
 *  ANY case. Used by the absence watcher as positive evidence of live work. */
export async function memberHoldsActiveClaim(schedulerId: number, now: Date = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ id: patientExecutionCases.id })
    .from(patientExecutionCases)
    .where(
      and(
        eq(patientExecutionCases.activeClaimBy, schedulerId),
        gt(patientExecutionCases.activeClaimExpiresAt, now),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Concurrency-safe ACQUIRE. Exactly one of two concurrent acquirers wins; the
 * loser gets a conflict describing who holds the patient. Re-acquire by the
 * SAME scheduler is idempotent (renews the lease). A sibling case being
 * actively worked by a DIFFERENT scheduler blocks acquisition (cross-service
 * protection). Audit + return are handled AFTER commit (never inside the tx,
 * which holds FOR UPDATE — mirrors applyDistribution's deferred-audit rule).
 */
export async function acquireClaim(input: {
  executionCaseId: number;
  schedulerId: number;
  actorUserId?: string | null;
  now?: Date;
  leaseSeconds?: number;
}): Promise<AcquireOutcome> {
  const now = input.now ?? new Date();
  const leaseSeconds = input.leaseSeconds ?? WORKCLAIM_LEASE_SECONDS;
  const expiresAt = new Date(now.getTime() + leaseSeconds * 1000);

  // Stable identity pre-read (name+dob never change) to key the patient mutex.
  const [pre] = await db
    .select({ name: patientExecutionCases.patientName, dob: patientExecutionCases.patientDob })
    .from(patientExecutionCases)
    .where(eq(patientExecutionCases.id, input.executionCaseId))
    .limit(1);
  if (!pre) return { ok: false, code: "not_found" };
  const [k1, k2] = patientLockKey(pre.name, pre.dob ?? null);

  const outcome = await db.transaction(async (tx) => {
    // PATIENT-level mutex (auto-released at commit): serializes sibling acquires.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${k1}, ${k2})`);
    // CASE-level row lock: serializes same-case acquires + gives a consistent read.
    await tx.execute(sql`SELECT id FROM patient_execution_cases WHERE id = ${input.executionCaseId} FOR UPDATE`);
    const [row] = await tx
      .select({
        activeClaimBy: patientExecutionCases.activeClaimBy,
        activeClaimAt: patientExecutionCases.activeClaimAt,
        activeClaimExpiresAt: patientExecutionCases.activeClaimExpiresAt,
      })
      .from(patientExecutionCases)
      .where(eq(patientExecutionCases.id, input.executionCaseId))
      .limit(1);
    if (!row) return { ok: false as const, code: "not_found" as const };

    // Existing ACTIVE claim on THIS case.
    if (isClaimActive(row, now)) {
      if (row.activeClaimBy === input.schedulerId) {
        // Idempotent re-acquire by the holder → renew the lease.
        await tx
          .update(patientExecutionCases)
          .set({ activeClaimExpiresAt: expiresAt })
          .where(eq(patientExecutionCases.id, input.executionCaseId));
        return {
          ok: true as const,
          state: "renewed" as const,
          claim: toClaimInfo(input.executionCaseId, { ...row, activeClaimExpiresAt: expiresAt }, now),
        };
      }
      return { ok: false as const, code: "conflict" as const, claim: toClaimInfo(input.executionCaseId, row, now) };
    }

    // SIBLING conflict: any OTHER case for the same patient (name+dob) held by a
    // DIFFERENT scheduler right now → block (don't let two workers contact the
    // same patient for different services simultaneously).
    const dobCond = pre.dob != null
      ? eq(patientExecutionCases.patientDob, pre.dob)
      : isNull(patientExecutionCases.patientDob);
    const [sibling] = await tx
      .select({
        activeClaimBy: patientExecutionCases.activeClaimBy,
        activeClaimAt: patientExecutionCases.activeClaimAt,
        activeClaimExpiresAt: patientExecutionCases.activeClaimExpiresAt,
        siblingId: patientExecutionCases.id,
      })
      .from(patientExecutionCases)
      .where(
        and(
          ne(patientExecutionCases.id, input.executionCaseId),
          sql`lower(${patientExecutionCases.patientName}) = ${pre.name.trim().toLowerCase()}`,
          dobCond,
          isNotNull(patientExecutionCases.activeClaimBy),
          ne(patientExecutionCases.activeClaimBy, input.schedulerId),
          gt(patientExecutionCases.activeClaimExpiresAt, now),
        ),
      )
      .limit(1);
    if (sibling) {
      return {
        ok: false as const,
        code: "conflict_sibling" as const,
        claim: toClaimInfo(sibling.siblingId, sibling, now),
      };
    }

    // Acquire.
    await tx
      .update(patientExecutionCases)
      .set({ activeClaimBy: input.schedulerId, activeClaimAt: now, activeClaimExpiresAt: expiresAt, updatedAt: now })
      .where(eq(patientExecutionCases.id, input.executionCaseId));
    return {
      ok: true as const,
      state: "acquired" as const,
      claim: toClaimInfo(input.executionCaseId, { activeClaimBy: input.schedulerId, activeClaimAt: now, activeClaimExpiresAt: expiresAt }, now),
    };
  });

  if (outcome.ok) {
    outcome.claim.claimedByName = await schedulerName(outcome.claim.claimedBySchedulerId);
    // Audit ONLY the meaningful transition (a fresh acquire), never the renew
    // heartbeat (that would flood the timeline).
    if (outcome.state === "acquired") {
      await auditClaim(input.executionCaseId, input.actorUserId ?? null, "claim_acquired", {
        schedulerId: input.schedulerId,
        expiresAt: outcome.claim.expiresAt?.toISOString() ?? null,
      });
    }
    return { ...outcome, leaseSeconds };
  }
  if (outcome.code === "conflict" || outcome.code === "conflict_sibling") {
    outcome.claim.claimedByName = await schedulerName(outcome.claim.claimedBySchedulerId);
  }
  return outcome;
}

export type RenewOutcome =
  | { ok: true; claim: ClaimInfo; leaseSeconds: number }
  | { ok: false; code: "not_found" | "not_holder" | "expired" };

/** Extend the lease — ONLY when the caller currently holds the active claim.
 *  Not audited (heartbeat). A lapsed/other-held claim cannot be renewed. */
export async function renewClaim(input: {
  executionCaseId: number;
  schedulerId: number;
  now?: Date;
  leaseSeconds?: number;
}): Promise<RenewOutcome> {
  const now = input.now ?? new Date();
  const leaseSeconds = input.leaseSeconds ?? WORKCLAIM_LEASE_SECONDS;
  const expiresAt = new Date(now.getTime() + leaseSeconds * 1000);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM patient_execution_cases WHERE id = ${input.executionCaseId} FOR UPDATE`);
    const [row] = await tx
      .select({
        activeClaimBy: patientExecutionCases.activeClaimBy,
        activeClaimAt: patientExecutionCases.activeClaimAt,
        activeClaimExpiresAt: patientExecutionCases.activeClaimExpiresAt,
      })
      .from(patientExecutionCases)
      .where(eq(patientExecutionCases.id, input.executionCaseId))
      .limit(1);
    if (!row) return { ok: false as const, code: "not_found" as const };
    if (!isClaimActive(row, now)) return { ok: false as const, code: "expired" as const };
    if (row.activeClaimBy !== input.schedulerId) return { ok: false as const, code: "not_holder" as const };
    await tx
      .update(patientExecutionCases)
      .set({ activeClaimExpiresAt: expiresAt })
      .where(eq(patientExecutionCases.id, input.executionCaseId));
    return {
      ok: true as const,
      claim: toClaimInfo(input.executionCaseId, { ...row, activeClaimExpiresAt: expiresAt }, now),
      leaseSeconds,
    };
  });
}

export type ReleaseOutcome =
  | { ok: true; released: boolean }
  | { ok: false; code: "not_found" | "not_holder" };

/** Release a claim held by the caller (idempotent: releasing an already-empty
 *  or already-expired claim succeeds as a no-op). A non-holder may NOT release
 *  another member's ACTIVE claim (use forceRelease for that). */
export async function releaseClaim(input: {
  executionCaseId: number;
  schedulerId: number;
  actorUserId?: string | null;
  now?: Date;
}): Promise<ReleaseOutcome> {
  const now = input.now ?? new Date();
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM patient_execution_cases WHERE id = ${input.executionCaseId} FOR UPDATE`);
    const [row] = await tx
      .select({
        activeClaimBy: patientExecutionCases.activeClaimBy,
        activeClaimExpiresAt: patientExecutionCases.activeClaimExpiresAt,
      })
      .from(patientExecutionCases)
      .where(eq(patientExecutionCases.id, input.executionCaseId))
      .limit(1);
    if (!row) return { ok: false as const, code: "not_found" as const };
    const active = isClaimActive(row, now);
    // A live claim owned by someone else must not be dropped by a non-holder.
    if (active && row.activeClaimBy !== input.schedulerId) {
      return { ok: false as const, code: "not_holder" as const };
    }
    const wasActiveHeld = active && row.activeClaimBy === input.schedulerId;
    await tx
      .update(patientExecutionCases)
      .set({ activeClaimBy: null, activeClaimAt: null, activeClaimExpiresAt: null, updatedAt: now })
      .where(eq(patientExecutionCases.id, input.executionCaseId));
    return { ok: true as const, released: wasActiveHeld };
  });
  if (outcome.ok && outcome.released) {
    await auditClaim(input.executionCaseId, input.actorUserId ?? null, "claim_released", {
      schedulerId: input.schedulerId,
    });
  }
  return outcome;
}

export type ForceReleaseOutcome =
  | { ok: true; previousHolder: number | null }
  | { ok: false; code: "not_found" };

/** EMERGENCY / admin force-release — clears the claim regardless of holder
 *  (account disabled, security, admin override). Always audited with the prior
 *  holder + reason. NOT used by ordinary redistribution. */
export async function forceReleaseClaim(input: {
  executionCaseId: number;
  actorUserId?: string | null;
  reason: string;
  now?: Date;
}): Promise<ForceReleaseOutcome> {
  const now = input.now ?? new Date();
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM patient_execution_cases WHERE id = ${input.executionCaseId} FOR UPDATE`);
    const [row] = await tx
      .select({ activeClaimBy: patientExecutionCases.activeClaimBy })
      .from(patientExecutionCases)
      .where(eq(patientExecutionCases.id, input.executionCaseId))
      .limit(1);
    if (!row) return { ok: false as const, code: "not_found" as const };
    const previousHolder = row.activeClaimBy;
    await tx
      .update(patientExecutionCases)
      .set({ activeClaimBy: null, activeClaimAt: null, activeClaimExpiresAt: null, updatedAt: now })
      .where(eq(patientExecutionCases.id, input.executionCaseId));
    return { ok: true as const, previousHolder };
  });
  if (outcome.ok) {
    await auditClaim(input.executionCaseId, input.actorUserId ?? null, "claim_force_released", {
      previousHolder: outcome.previousHolder,
      reason: input.reason,
    });
  }
  return outcome;
}

/** Best-effort audit of a MEANINGFUL claim transition (never renew/heartbeat).
 *  PHI-safe: patient name is required by the writer, but no metrics are touched
 *  and this is not a disposition. */
async function auditClaim(
  executionCaseId: number,
  actorUserId: string | null,
  action: "claim_acquired" | "claim_released" | "claim_force_released",
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    const [ec] = await db
      .select({
        patientName: patientExecutionCases.patientName,
        patientDob: patientExecutionCases.patientDob,
        patientScreeningId: patientExecutionCases.patientScreeningId,
      })
      .from(patientExecutionCases)
      .where(eq(patientExecutionCases.id, executionCaseId))
      .limit(1);
    await appendJourneyEvent({
      patientScreeningId: ec?.patientScreeningId ?? undefined,
      executionCaseId,
      actorUserId,
      patientName: ec?.patientName ?? "Unnamed",
      patientDob: ec?.patientDob ?? undefined,
      eventType: "engagement_assignment_changed",
      eventSource: "work_claim",
      summary: `Active-work ${action.replace("claim_", "claim ")}`,
      metadata: { action, ...metadata },
    });
  } catch {
    // Best-effort audit — never blocks the claim operation.
  }
}

// ─── Call-result integration (Phase 4, Part 8 + Part 19) ─────────────────────

/** Thrown when a call-result is submitted by someone who does NOT hold the
 *  active claim (a stale browser tab / concurrent worker). The route maps this
 *  to HTTP 409 so the client can surface a clear "someone else is working this
 *  patient / your session is stale" state instead of silently double-writing. */
export class StaleWorkClaimError extends Error {
  readonly holderSchedulerId: number | null;
  constructor(holderSchedulerId: number | null) {
    super("This work is held by another team member (stale or concurrent claim).");
    this.name = "StaleWorkClaimError";
    this.holderSchedulerId = holderSchedulerId;
  }
}

export type ClaimCallResultDecision = {
  /** true → the submitter must be rejected (409): a valid claim is held by
   *  someone else and the submitter is not an admin override. */
  reject: boolean;
  /** true → the submitter currently holds the active claim, so a successful
   *  disposition should RELEASE it (clear the claim columns) in the same tx. */
  heldBySubmitter: boolean;
  holderSchedulerId: number | null;
};

/**
 * PURE decision for how a call-result submission interacts with an existing
 * claim. Backward-compatible fast path: NO active claim → allow, nothing to
 * release (identical to pre-Phase-4). A valid claim held by the SUBMITTER →
 * allow + release-on-success. A valid claim held by ANOTHER scheduler → reject
 * (409) unless the submitter is an admin (authoritative override, which does
 * NOT disturb the other member's claim — it simply proceeds).
 */
export function decideClaimForCallResult(
  claim: ClaimColumns,
  actingSchedulerId: number | null,
  isAdmin: boolean,
  now: Date = new Date(),
): ClaimCallResultDecision {
  if (!isClaimActive(claim, now)) {
    return { reject: false, heldBySubmitter: false, holderSchedulerId: null };
  }
  const holder = claim.activeClaimBy;
  if (holder != null && holder === actingSchedulerId) {
    return { reject: false, heldBySubmitter: true, holderSchedulerId: holder };
  }
  // Active claim held by someone else.
  return { reject: !isAdmin, heldBySubmitter: false, holderSchedulerId: holder };
}
