// Phase 2J — shared support for the canonical financial COMMAND services.
//
// Every command is transactional, idempotent, and append-only for audit: it writes
// exactly one canonical_financial_transitions row inside its own transaction. A
// duplicate idempotency key returns the SAME prior result (never a second write).
// A missing canonical table surfaces as MigrationMissingError → the route answers
// 503. No destructive UPDATE/DELETE of financial history exists anywhere here.

import { and, eq } from "drizzle-orm";
import { canonicalFinancialTransitions, type CanonicalFinancialEntityType } from "@shared/schema/canonicalFinancialTransitions";

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
};

/** Append one audit/transition row (inside the caller's transaction). */
export async function writeTransition(tx: DbLike, t: TransitionInput): Promise<void> {
  await tx.insert(canonicalFinancialTransitions).values({
    entityType: t.entityType, entityId: t.entityId, clinicId: t.clinicId,
    ancillaryCaseId: t.ancillaryCaseId ?? null, serviceType: t.serviceType ?? null,
    fromStatus: t.fromStatus ?? null, toStatus: t.toStatus,
    actorUserId: t.actorUserId ?? null, actorRole: t.actorRole ?? null,
    reason: t.reason ?? null, sourceType: t.sourceType ?? null, sourceReference: t.sourceReference ?? null,
    idempotencyKey: t.idempotencyKey ?? null,
  }).returning();
}

/** Look up a prior transition by exact entity + clinic + idempotency key (idempotent
 *  replay detection). Returns the recorded entityId when found. */
export async function priorTransitionEntityId(db: DbLike, entityType: CanonicalFinancialEntityType, clinicId: number, idempotencyKey: string | null | undefined): Promise<number | null> {
  if (!idempotencyKey) return null;
  const rows = await db.select().from(canonicalFinancialTransitions).where(and(
    eq(canonicalFinancialTransitions.entityType, entityType),
    eq(canonicalFinancialTransitions.clinicId, clinicId),
    eq(canonicalFinancialTransitions.idempotencyKey, idempotencyKey),
  )).limit(1);
  const hit = (rows as { entityType: string; clinicId: number; idempotencyKey: string | null; entityId: number }[])
    .find((r) => r.entityType === entityType && r.clinicId === clinicId && r.idempotencyKey === idempotencyKey);
  return hit ? hit.entityId : null;
}

export const nonEmpty = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);
