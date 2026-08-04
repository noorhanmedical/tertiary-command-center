// Phase 2J — shared support for the canonical financial COMMAND services.
//
// Every command is transactional, idempotent, and append-only for audit: it writes
// exactly one canonical_financial_transitions row inside its own transaction. A
// duplicate idempotency key returns the SAME prior result (never a second write).
// A missing canonical table surfaces as MigrationMissingError → the route answers
// 503. No destructive UPDATE/DELETE of financial history exists anywhere here.

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { canonicalFinancialTransitions, type CanonicalFinancialEntityType } from "@shared/schema/canonicalFinancialTransitions";
import { globalPlexusPatients, patientClinicMemberships } from "@shared/schema/plexusIdentity";

// Explicit supported-currency vocabulary — an arbitrary code never qualifies.
export const SUPPORTED_CURRENCIES = new Set(["USD"]);
const ACTIVE_IDENTITY = new Set(["active", "current"]);

/** Prove EXACT canonical patient identity (a non-null id pair is NOT sufficient):
 *  the membership exists under this clinic, is active, and points at the case's
 *  global patient; the global patient exists, is active/current, not merged away.
 *  Returns null on success or a PHI-free failure code. */
export async function verifyCanonicalIdentity(clinicId: number, globalPlexusPatientId: number | null, patientClinicMembershipId: number | null): Promise<string | null> {
  if (globalPlexusPatientId == null || patientClinicMembershipId == null) return "identity_incomplete";
  const mems = await db.select().from(patientClinicMemberships).where(and(eq(patientClinicMemberships.clinicId, clinicId), eq(patientClinicMemberships.id, patientClinicMembershipId))).limit(2);
  const mem = mems.find((m) => m.id === patientClinicMembershipId && m.clinicId === clinicId);
  if (!mem) return "membership_not_found";
  if (mem.membershipStatus !== "active") return "membership_inactive";
  if ((mem.globalPlexusPatientId ?? null) !== globalPlexusPatientId) return "identity_membership_mismatch";
  const gps = await db.select().from(globalPlexusPatients).where(eq(globalPlexusPatients.id, globalPlexusPatientId)).limit(2);
  const gp = gps.find((g) => g.id === globalPlexusPatientId);
  if (!gp) return "global_patient_not_found";
  if (!ACTIVE_IDENTITY.has(gp.identityStatus ?? "")) return "global_patient_inactive";
  if (gp.mergedIntoPatientId != null) return "global_patient_merged";
  return null;
}

const MIGRATION_CODE = "ANCILLARY_DOCUMENT_MIGRATION_MISSING";
export const FINANCIAL_MIGRATION_CODES = new Set(["42P01", "42703", MIGRATION_CODE]);

export class FinancialMigrationMissingError extends Error {
  readonly code = MIGRATION_CODE;
  constructor(cause?: unknown) { super("Canonical financial migration not applied"); this.name = "FinancialMigrationMissingError"; (this as { cause?: unknown }).cause = cause; }
}
export function isFinancialMigration(e: unknown): boolean {
  return e instanceof FinancialMigrationMissingError || FINANCIAL_MIGRATION_CODES.has((e as { code?: string })?.code ?? "");
}

// A minimal structural view of the db/tx handle the commands use (real drizzle in
// prod, the fake-db in tests). Keeps the services decoupled from the concrete type.
export type DbLike = {
  select: (...a: unknown[]) => any;
  insert: (t: unknown) => any;
  update: (t: unknown) => any;
  transaction: <T>(fn: (tx: DbLike) => Promise<T>) => Promise<T>;
  execute: (q: unknown) => Promise<unknown>;
};

export type TransitionInput = {
  entityType: CanonicalFinancialEntityType;
  entityId: number;
  clinicId: number;
  ancillaryCaseId?: number | null;
  serviceType?: string | null;
  fromStatus?: string | null;
  toStatus: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  reason?: string | null;
  sourceType?: string | null;
  sourceReference?: string | null;
  idempotencyKey?: string | null;
  commandFingerprint?: string | null;
};

/** Append one audit/transition row (inside the caller's transaction). */
export async function writeTransition(tx: DbLike, t: TransitionInput): Promise<void> {
  await tx.insert(canonicalFinancialTransitions).values({
    entityType: t.entityType, entityId: t.entityId, clinicId: t.clinicId,
    ancillaryCaseId: t.ancillaryCaseId ?? null, serviceType: t.serviceType ?? null,
    fromStatus: t.fromStatus ?? null, toStatus: t.toStatus,
    actorUserId: t.actorUserId ?? null, actorRole: t.actorRole ?? null,
    reason: t.reason ?? null, sourceType: t.sourceType ?? null, sourceReference: t.sourceReference ?? null,
    idempotencyKey: t.idempotencyKey ?? null, commandFingerprint: t.commandFingerprint ?? null,
  }).returning();
}

/** Deterministic fingerprint of the FULL material command intent (sorted keys,
 *  trimmed strings, normalized null) — the exact-replay identity for a given key. */
export function commandFingerprint(intent: Record<string, unknown>): string {
  const norm = (v: unknown): unknown => {
    if (v == null) return null;
    if (Array.isArray(v)) return v.map(norm);
    if (typeof v === "object") { const o: Record<string, unknown> = {}; for (const k of Object.keys(v as object).sort()) o[k] = norm((v as Record<string, unknown>)[k]); return o; }
    if (typeof v === "string") return v.trim();
    return v;
  };
  return JSON.stringify(norm(intent));
}

export type ReplayResult = { kind: "none" } | { kind: "replay"; entityId: number } | { kind: "conflict" };
/** Idempotent-replay detection bound to command INTENT: no prior → none; same key +
 *  same fingerprint → replay (return the prior result); same key + DIFFERENT
 *  fingerprint → conflict (a different command reused a key). */
export async function idempotentReplay(db: DbLike, entityType: CanonicalFinancialEntityType, clinicId: number, idempotencyKey: string | null | undefined, fingerprint: string): Promise<ReplayResult> {
  if (!idempotencyKey) return { kind: "none" };
  const rows = await db.select().from(canonicalFinancialTransitions).where(and(
    eq(canonicalFinancialTransitions.entityType, entityType),
    eq(canonicalFinancialTransitions.clinicId, clinicId),
    eq(canonicalFinancialTransitions.idempotencyKey, idempotencyKey),
  )).limit(1);
  const hit = (rows as { entityType: string; clinicId: number; idempotencyKey: string | null; entityId: number; commandFingerprint: string | null }[])
    .find((r) => r.entityType === entityType && r.clinicId === clinicId && r.idempotencyKey === idempotencyKey);
  if (!hit) return { kind: "none" };
  if ((hit.commandFingerprint ?? null) !== fingerprint) return { kind: "conflict" };
  return { kind: "replay", entityId: hit.entityId };
}

/** Convergence lookup after a unique-violation (returns the recorded entityId for
 *  the key, ignoring fingerprint — the fingerprint gate already ran at command entry). */
export async function priorTransitionEntityId(db: DbLike, entityType: CanonicalFinancialEntityType, clinicId: number, idempotencyKey: string | null | undefined): Promise<number | null> {
  if (!idempotencyKey) return null;
  const rows = await db.select().from(canonicalFinancialTransitions).where(and(
    eq(canonicalFinancialTransitions.entityType, entityType), eq(canonicalFinancialTransitions.clinicId, clinicId), eq(canonicalFinancialTransitions.idempotencyKey, idempotencyKey),
  )).limit(1);
  const hit = (rows as { entityType: string; clinicId: number; idempotencyKey: string | null; entityId: number }[]).find((r) => r.entityType === entityType && r.clinicId === clinicId && r.idempotencyKey === idempotencyKey);
  return hit ? hit.entityId : null;
}

export const nonEmpty = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);
