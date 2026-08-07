/**
 * Phase 2E — unified Ancillary Documents reference repository.
 *
 * Indexes canonical source records (Order Notes in procedure_notes;
 * reports/consent/screening forms in the documents store). NEVER stores
 * document bytes or full note text.
 *
 * Registry writes are guarded by FEATURE_UNIFIED_ANCILLARY_DOCUMENTS.
 * Reads are safe when the migration is absent AND the flag is OFF
 * (return empty); reads throw a structured 503 when the flag is ON but
 * the migration is missing so a legacy fallback cannot silently mask.
 */

import { db } from "../db";
import { and, desc, eq, inArray, isNull, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import {
  ancillaryDocumentReferences,
  ancillaryDocumentReconciliationFailures,
  ANCILLARY_DOCUMENT_KINDS,
  ANCILLARY_DOCUMENT_FAILURE_ACTIONS,
  type AncillaryDocumentReference,
  type AncillaryDocumentReconciliationFailure,
  type AncillaryDocumentKind,
  type AncillaryDocumentFailureAction,
} from "@shared/schema/ancillaryDocuments";
import { featureFlags } from "../lib/featureFlags";

const PG_UNDEFINED_TABLE = "42P01";
const PG_UNDEFINED_COLUMN = "42703";
const PG_UNIQUE_VIOLATION = "23505";

function guardWrite(): void {
  if (!featureFlags.unifiedAncillaryDocuments) {
    const err = new Error(
      "ancillary_document_write_disabled: enable FEATURE_UNIFIED_ANCILLARY_DOCUMENTS after applying migration 0053",
    ) as Error & { code?: string; status?: number };
    err.code = "ANCILLARY_DOCUMENT_WRITE_DISABLED";
    err.status = 503;
    throw err;
  }
}

async function safeRead<T>(op: () => Promise<T>, fallback: T, opName = "unknown"): Promise<T> {
  try {
    return await op();
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === PG_UNDEFINED_TABLE || code === PG_UNDEFINED_COLUMN) {
      if (!featureFlags.unifiedAncillaryDocuments) return fallback;
      const err = new Error(
        `ancillary_document_migration_missing: schema element absent (${code}) while FEATURE_UNIFIED_ANCILLARY_DOCUMENTS is ON (op=${opName})`,
      ) as Error & { code?: string; status?: number };
      err.code = "ANCILLARY_DOCUMENT_MIGRATION_MISSING";
      err.status = 503;
      throw err;
    }
    throw e;
  }
}

// ─── Reference reads ──────────────────────────────────────────────
export async function listReferencesForAncillaryCase(
  ancillaryCaseId: number,
): Promise<AncillaryDocumentReference[]> {
  return safeRead(async () => {
    return db
      .select()
      .from(ancillaryDocumentReferences)
      .where(eq(ancillaryDocumentReferences.ancillaryCaseId, ancillaryCaseId))
      .orderBy(desc(ancillaryDocumentReferences.actualCreatedAt));
  }, [] as AncillaryDocumentReference[], "listReferencesForAncillaryCase");
}

export async function getActiveReference(
  ancillaryCaseId: number,
  documentKind: AncillaryDocumentKind,
): Promise<AncillaryDocumentReference | null> {
  return safeRead(async () => {
    const rows = await db
      .select()
      .from(ancillaryDocumentReferences)
      .where(
        and(
          eq(ancillaryDocumentReferences.ancillaryCaseId, ancillaryCaseId),
          eq(ancillaryDocumentReferences.documentKind, documentKind),
          isNull(ancillaryDocumentReferences.supersededAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }, null, "getActiveReference");
}

export async function getReferenceBySource(
  sourceTable: string,
  sourceId: number,
  documentKind: AncillaryDocumentKind,
): Promise<AncillaryDocumentReference | null> {
  return safeRead(async () => {
    const rows = await db
      .select()
      .from(ancillaryDocumentReferences)
      .where(
        and(
          eq(ancillaryDocumentReferences.sourceTable, sourceTable),
          eq(ancillaryDocumentReferences.sourceId, sourceId),
          eq(ancillaryDocumentReferences.documentKind, documentKind),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }, null, "getReferenceBySource");
}

export type ClinicDocumentSearchFilters = {
  clinicId: number;
  patientScreeningId?: number;
  executionCaseId?: number;
  ancillaryCaseId?: number;
  globalPlexusPatientId?: number;
  serviceType?: string;
  documentKind?: AncillaryDocumentKind;
  documentStatus?: string;
  limit?: number;
};

/** Tenant-scoped operational search over canonical references. */
export async function searchClinicReferences(
  filters: ClinicDocumentSearchFilters,
): Promise<AncillaryDocumentReference[]> {
  const limit = Math.min(Math.max(1, filters.limit ?? 200), 1000);
  return safeRead(async () => {
    const conds = [eq(ancillaryDocumentReferences.clinicId, filters.clinicId)];
    if (filters.patientScreeningId != null) conds.push(eq(ancillaryDocumentReferences.patientScreeningId, filters.patientScreeningId));
    if (filters.executionCaseId != null) conds.push(eq(ancillaryDocumentReferences.executionCaseId, filters.executionCaseId));
    if (filters.ancillaryCaseId != null) conds.push(eq(ancillaryDocumentReferences.ancillaryCaseId, filters.ancillaryCaseId));
    if (filters.globalPlexusPatientId != null) conds.push(eq(ancillaryDocumentReferences.globalPlexusPatientId, filters.globalPlexusPatientId));
    if (filters.serviceType) conds.push(eq(ancillaryDocumentReferences.serviceType, filters.serviceType));
    if (filters.documentKind) conds.push(eq(ancillaryDocumentReferences.documentKind, filters.documentKind));
    if (filters.documentStatus) conds.push(eq(ancillaryDocumentReferences.documentStatus, filters.documentStatus));
    return db
      .select()
      .from(ancillaryDocumentReferences)
      .where(and(...conds))
      .orderBy(desc(ancillaryDocumentReferences.actualCreatedAt))
      .limit(limit);
  }, [] as AncillaryDocumentReference[], "searchClinicReferences");
}

// ─── Keyset-paginated operational search ──────────────────────────
export type ReferencePageCursor = { actualCreatedAt: Date; id: number };

export type ReferencePageQuery = {
  filters: Omit<ClinicDocumentSearchFilters, "limit">;
  currentOnly: boolean;
  cursor?: ReferencePageCursor | null;
  // Page size the caller wants back. The repo fetches limit+1 to detect a
  // next page WITHOUT a fixed 500-row prefetch.
  limit: number;
};

/**
 * True server-side keyset page. All filters, includeHistory (currentOnly),
 * clinic scope, the compound cursor, ordering (actual_created_at DESC, id
 * DESC), and limit+1 live in the SQL — no in-memory 500-row prefetch. The
 * cursor predicate is:
 *   actual_created_at < c.ts OR (actual_created_at = c.ts AND id < c.id)
 * which is stable when timestamps tie and yields no duplicate/missing rows.
 */
export async function searchClinicReferencesPage(
  q: ReferencePageQuery,
): Promise<AncillaryDocumentReference[]> {
  const pageLimit = Math.min(Math.max(1, q.limit), 500);
  const f = q.filters;
  return safeRead(async () => {
    const conds = [eq(ancillaryDocumentReferences.clinicId, f.clinicId)];
    if (f.patientScreeningId != null) conds.push(eq(ancillaryDocumentReferences.patientScreeningId, f.patientScreeningId));
    if (f.executionCaseId != null) conds.push(eq(ancillaryDocumentReferences.executionCaseId, f.executionCaseId));
    if (f.ancillaryCaseId != null) conds.push(eq(ancillaryDocumentReferences.ancillaryCaseId, f.ancillaryCaseId));
    if (f.globalPlexusPatientId != null) conds.push(eq(ancillaryDocumentReferences.globalPlexusPatientId, f.globalPlexusPatientId));
    if (f.serviceType) conds.push(eq(ancillaryDocumentReferences.serviceType, f.serviceType));
    if (f.documentKind) conds.push(eq(ancillaryDocumentReferences.documentKind, f.documentKind));
    if (f.documentStatus) conds.push(eq(ancillaryDocumentReferences.documentStatus, f.documentStatus));
    if (q.currentOnly) {
      conds.push(isNull(ancillaryDocumentReferences.supersededAt));
      conds.push(ne(ancillaryDocumentReferences.documentStatus, "voided"));
      conds.push(ne(ancillaryDocumentReferences.documentStatus, "superseded"));
    }
    if (q.cursor) {
      // Compound keyset: strictly "after" the cursor in (createdAt DESC, id DESC).
      conds.push(
        or(
          lt(ancillaryDocumentReferences.actualCreatedAt, q.cursor.actualCreatedAt),
          and(
            eq(ancillaryDocumentReferences.actualCreatedAt, q.cursor.actualCreatedAt),
            lt(ancillaryDocumentReferences.id, q.cursor.id),
          ),
        )!,
      );
    }
    return db
      .select()
      .from(ancillaryDocumentReferences)
      .where(and(...conds))
      .orderBy(desc(ancillaryDocumentReferences.actualCreatedAt), desc(ancillaryDocumentReferences.id))
      .limit(pageLimit + 1);
  }, [] as AncillaryDocumentReference[], "searchClinicReferencesPage");
}

// ─── Reference writes ─────────────────────────────────────────────
export type CreateReferenceInput = {
  clinicId: number;
  globalPlexusPatientId?: number | null;
  patientClinicMembershipId?: number | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  ancillaryCaseId: number;
  documentKind: AncillaryDocumentKind;
  sourceSystem?: string | null;
  sourceTable: string;
  sourceId: number;
  serviceType?: string | null;
  documentStatus: string;
  effectiveClinicalDate?: Date | null;
  signedAt?: Date | null;
  // The SOURCE's own creation timestamp (procedure_notes.created_at /
  // case_document_readiness.created_at) — NEVER the retry/insert/backfill time
  // and never the effective clinical date. Omit to let the DB default stand.
  actualCreatedAt?: Date | null;
  createdByUserId?: string | null;
  metadata?: Record<string, unknown>;
};

export type CreateReferenceResult =
  | { outcome: "created"; created: true; row: AncillaryDocumentReference }
  // Idempotent: the EXACT same canonical source (table, id, kind) already
  // indexed AND already in sync — returned unchanged.
  | { outcome: "reused_exact_source_unchanged"; created: false; existing: AncillaryDocumentReference }
  // Same exact source, but stale mutable fields (status/signedAt/timestamps/…)
  // were refreshed. Immutable identity (clinic/case/source/kind) untouched.
  | { outcome: "reused_exact_source_updated"; created: false; existing: AncillaryDocumentReference }
  // The exact source record is indexed under a DIFFERENT clinic — never reuse,
  // never update, never disclose cross-clinic detail. Reconciliation deferred.
  | { outcome: "source_clinic_conflict"; created: false }
  // The exact source record is indexed under a DIFFERENT ancillary case.
  | { outcome: "source_case_conflict"; created: false }
  // The scoped update affected zero rows (concurrent ownership/identity change)
  // — never reported as success.
  | { outcome: "synchronization_conflict"; created: false }
  // A DIFFERENT current source already holds this (case, kind) slot. NEVER
  // reused — the caller must supersede via a reviewed workflow or defer. The
  // new source is never silently attached to the existing reference id.
  | { outcome: "active_kind_conflict"; created: false; existing: AncillaryDocumentReference };

// Mutable fields a same-source sync may refresh. Immutable identity
// (clinicId, ancillaryCaseId, sourceTable, sourceId, documentKind) is NEVER
// touched here.
function ms(d: Date | null | undefined): number | null {
  return d instanceof Date ? d.getTime() : null;
}
function computeExactSourceSyncPatch(
  existing: AncillaryDocumentReference,
  input: CreateReferenceInput,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.documentStatus !== existing.documentStatus) patch.documentStatus = input.documentStatus;
  const inSigned = input.signedAt ?? null;
  if (ms(existing.signedAt) !== ms(inSigned)) patch.signedAt = inSigned;
  const inEff = input.effectiveClinicalDate ?? null;
  if (ms(existing.effectiveClinicalDate) !== ms(inEff)) patch.effectiveClinicalDate = inEff;
  // Correct a prior mis-indexed actual_created_at ONLY when a source timestamp
  // is supplied and differs.
  if (input.actualCreatedAt != null && ms(existing.actualCreatedAt) !== ms(input.actualCreatedAt)) patch.actualCreatedAt = input.actualCreatedAt;
  if (input.serviceType != null && input.serviceType !== existing.serviceType) patch.serviceType = input.serviceType;
  if (input.globalPlexusPatientId != null && input.globalPlexusPatientId !== existing.globalPlexusPatientId) patch.globalPlexusPatientId = input.globalPlexusPatientId;
  if (input.patientClinicMembershipId != null && input.patientClinicMembershipId !== existing.patientClinicMembershipId) patch.patientClinicMembershipId = input.patientClinicMembershipId;
  if (input.patientScreeningId != null && input.patientScreeningId !== existing.patientScreeningId) patch.patientScreeningId = input.patientScreeningId;
  if (input.executionCaseId != null && input.executionCaseId !== existing.executionCaseId) patch.executionCaseId = input.executionCaseId;
  const nextDl = (input.metadata ?? {}).download_reference;
  const curMeta = (existing.metadata as Record<string, unknown> | null) ?? {};
  if (nextDl !== undefined && nextDl !== curMeta.download_reference) patch.metadata = { ...curMeta, download_reference: nextDl };
  return patch;
}

/**
 * Tenant-safe exact-source sync: refresh a same-source reference's stale
 * mutable fields, NEVER its immutable identity or ownership. An ownership
 * mismatch (clinic or ancillary case) is a structured CONFLICT — never a
 * reuse, never an update. The update is scoped by full identity and verified
 * with `.returning()`: exactly one affected row → updated; zero rows (a
 * concurrent ownership/identity change) → synchronization_conflict.
 */
async function syncExactSourceReference(
  existing: AncillaryDocumentReference,
  input: CreateReferenceInput,
): Promise<CreateReferenceResult> {
  // Ownership conflicts — never re-home an existing reference, never reuse.
  if (existing.clinicId !== input.clinicId) return { outcome: "source_clinic_conflict", created: false };
  if (existing.ancillaryCaseId !== input.ancillaryCaseId) return { outcome: "source_case_conflict", created: false };
  const patch = computeExactSourceSyncPatch(existing, input);
  if (Object.keys(patch).length === 0) {
    return { outcome: "reused_exact_source_unchanged", created: false, existing };
  }
  const updated = await db
    .update(ancillaryDocumentReferences)
    .set({ ...patch, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(
      eq(ancillaryDocumentReferences.id, existing.id),
      eq(ancillaryDocumentReferences.clinicId, input.clinicId),
      eq(ancillaryDocumentReferences.ancillaryCaseId, input.ancillaryCaseId),
      eq(ancillaryDocumentReferences.sourceTable, input.sourceTable),
      eq(ancillaryDocumentReferences.sourceId, input.sourceId),
      eq(ancillaryDocumentReferences.documentKind, input.documentKind),
    ))
    .returning();
  // Exactly one affected row → updated. Zero → a concurrent ownership/identity
  // change slipped in; NEVER report success.
  if (updated.length !== 1) return { outcome: "synchronization_conflict", created: false };
  // Id-preserving merged view (immutable identity intact + refreshed fields).
  const merged = { ...existing, ...(patch as Partial<AncillaryDocumentReference>) };
  return { outcome: "reused_exact_source_updated", created: false, existing: merged };
}

/**
 * Insert a new canonical reference — or, for the EXACT same
 * (source_table, source_id, kind), SYNC its stale mutable fields in place
 * (never its immutable identity). A DIFFERENT source occupying the active
 * (case, kind) slot returns `active_kind_conflict` (never reused, never
 * overwritten). The source's own timestamp is preserved via actualCreatedAt.
 */
export async function createReference(input: CreateReferenceInput): Promise<CreateReferenceResult> {
  guardWrite();
  if (!(ANCILLARY_DOCUMENT_KINDS as readonly string[]).includes(input.documentKind)) {
    throw new Error(`invalid documentKind: ${input.documentKind}`);
  }
  const existingSource = await getReferenceBySource(input.sourceTable, input.sourceId, input.documentKind);
  if (existingSource) return syncExactSourceReference(existingSource, input);
  // A current reference of the same (case, kind) but a DIFFERENT source blocks
  // a silent reuse — surface the conflict, never overwrite the slot.
  const activeOther = await getActiveReference(input.ancillaryCaseId, input.documentKind);
  if (activeOther && !(activeOther.sourceTable === input.sourceTable && activeOther.sourceId === input.sourceId)) {
    return { outcome: "active_kind_conflict", created: false, existing: activeOther };
  }
  try {
    const [row] = await db
      .insert(ancillaryDocumentReferences)
      .values({
        clinicId: input.clinicId,
        globalPlexusPatientId: input.globalPlexusPatientId ?? null,
        patientClinicMembershipId: input.patientClinicMembershipId ?? null,
        patientScreeningId: input.patientScreeningId ?? null,
        executionCaseId: input.executionCaseId ?? null,
        ancillaryCaseId: input.ancillaryCaseId,
        documentKind: input.documentKind,
        sourceSystem: input.sourceSystem ?? null,
        sourceTable: input.sourceTable,
        sourceId: input.sourceId,
        serviceType: input.serviceType ?? null,
        documentStatus: input.documentStatus,
        effectiveClinicalDate: input.effectiveClinicalDate ?? null,
        signedAt: input.signedAt ?? null,
        // Preserve the SOURCE's creation timestamp; omit to keep the DB default.
        ...(input.actualCreatedAt != null ? { actualCreatedAt: input.actualCreatedAt } : {}),
        createdByUserId: input.createdByUserId ?? null,
        metadata: (input.metadata ?? {}) as unknown as never,
      })
      .returning();
    return { outcome: "created", created: true, row };
  } catch (e) {
    if ((e as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      // Concurrent insert. Reread by EXACT source only — never fall back to an
      // unrelated active reference of the same case/kind.
      const winner = await getReferenceBySource(input.sourceTable, input.sourceId, input.documentKind);
      if (winner) return syncExactSourceReference(winner, input);
      // The active-per-case-kind partial unique fired for a DIFFERENT source.
      const other = await getActiveReference(input.ancillaryCaseId, input.documentKind);
      if (other) return { outcome: "active_kind_conflict", created: false, existing: other };
    }
    throw e;
  }
}

/** Update the reference's status/signed/superseded (mirrors source state). */
export async function updateReferenceStatus(
  id: number,
  patch: { documentStatus?: string; signedAt?: Date | null; supersededAt?: Date | null },
): Promise<AncillaryDocumentReference | null> {
  guardWrite();
  const values: Record<string, unknown> = { updatedAt: sql`CURRENT_TIMESTAMP` };
  if (patch.documentStatus !== undefined) values.documentStatus = patch.documentStatus;
  if (patch.signedAt !== undefined) values.signedAt = patch.signedAt;
  if (patch.supersededAt !== undefined) values.supersededAt = patch.supersededAt;
  const [row] = await db
    .update(ancillaryDocumentReferences)
    .set(values)
    .where(eq(ancillaryDocumentReferences.id, id))
    .returning();
  return row ?? null;
}

// ─── Retry ledger ─────────────────────────────────────────────────
export type RecordDocumentFailureInput = {
  clinicId: number;
  ancillaryCaseId?: number | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  documentKind?: string | null;
  sourceTable?: string | null;
  sourceId?: number | null;
  requestedAction: AncillaryDocumentFailureAction;
  sourceSystem?: string | null;
  errorCode?: string | null;
};

export async function recordAncillaryDocumentFailure(
  input: RecordDocumentFailureInput,
): Promise<AncillaryDocumentReconciliationFailure> {
  if (!(ANCILLARY_DOCUMENT_FAILURE_ACTIONS as readonly string[]).includes(input.requestedAction)) {
    throw new Error(`invalid requestedAction: ${input.requestedAction}`);
  }
  // SOURCE-SPECIFIC dedupe (mirrors the two partial unique indexes in 0053).
  // Always clinic-scoped so clinic A and clinic B never dedupe together.
  //   • source-bearing → key on the exact canonical source (two different
  //     source_ids ⇒ two rows, each with its own attempt count);
  //   • source-less    → key on (clinic, case, action, kind).
  const dedupeConds = [
    eq(ancillaryDocumentReconciliationFailures.clinicId, input.clinicId),
    eq(ancillaryDocumentReconciliationFailures.requestedAction, input.requestedAction),
    isNull(ancillaryDocumentReconciliationFailures.resolvedAt),
  ];
  if (input.documentKind != null) {
    dedupeConds.push(eq(ancillaryDocumentReconciliationFailures.documentKind, input.documentKind));
  }
  if (input.sourceId != null) {
    // Source-bearing: exact (source_table, source_id).
    dedupeConds.push(isNotNull(ancillaryDocumentReconciliationFailures.sourceId));
    dedupeConds.push(eq(ancillaryDocumentReconciliationFailures.sourceId, input.sourceId));
    if (input.sourceTable != null) {
      dedupeConds.push(eq(ancillaryDocumentReconciliationFailures.sourceTable, input.sourceTable));
    }
  } else {
    // Source-less: case-level. Never dedupe against a source-bearing row.
    dedupeConds.push(isNull(ancillaryDocumentReconciliationFailures.sourceId));
    if (input.ancillaryCaseId != null) {
      dedupeConds.push(eq(ancillaryDocumentReconciliationFailures.ancillaryCaseId, input.ancillaryCaseId));
    }
  }
  const existing = await db
    .select()
    .from(ancillaryDocumentReconciliationFailures)
    .where(and(...dedupeConds))
    .limit(1);
  if (existing[0]) {
    const [updated] = await db
      .update(ancillaryDocumentReconciliationFailures)
      .set({
        attemptCount: (existing[0].attemptCount ?? 0) + 1,
        lastAttemptedAt: sql`CURRENT_TIMESTAMP`,
        errorCode: input.errorCode ?? existing[0].errorCode,
        sourceSystem: input.sourceSystem ?? existing[0].sourceSystem,
      })
      .where(eq(ancillaryDocumentReconciliationFailures.id, existing[0].id))
      .returning();
    return updated;
  }
  try {
    const [inserted] = await db
      .insert(ancillaryDocumentReconciliationFailures)
      .values({
        clinicId: input.clinicId,
        ancillaryCaseId: input.ancillaryCaseId ?? null,
        patientScreeningId: input.patientScreeningId ?? null,
        executionCaseId: input.executionCaseId ?? null,
        documentKind: input.documentKind ?? null,
        sourceTable: input.sourceTable ?? null,
        sourceId: input.sourceId ?? null,
        requestedAction: input.requestedAction,
        sourceSystem: input.sourceSystem ?? null,
        errorCode: input.errorCode ?? null,
        attemptCount: 1,
      })
      .returning();
    return inserted;
  } catch (e) {
    // K5 concurrency — a racing writer won the exact unresolved slot (0053 partial-
    // unique index). CONVERGE on the winner instead of surfacing a failure: re-read the
    // exact unresolved failure and bump it, so the loser returns the DURABLE winner
    // (never a false "retry_not_recorded" merely because the other writer won).
    if ((e as { code?: string })?.code !== PG_UNIQUE_VIOLATION) throw e;
    const [winner] = await db
      .select()
      .from(ancillaryDocumentReconciliationFailures)
      .where(and(...dedupeConds))
      .limit(1);
    if (!winner) throw e;
    const [converged] = await db
      .update(ancillaryDocumentReconciliationFailures)
      .set({
        attemptCount: (winner.attemptCount ?? 0) + 1,
        lastAttemptedAt: sql`CURRENT_TIMESTAMP`,
        errorCode: input.errorCode ?? winner.errorCode,
        sourceSystem: input.sourceSystem ?? winner.sourceSystem,
      })
      .where(eq(ancillaryDocumentReconciliationFailures.id, winner.id))
      .returning();
    return converged ?? winner;
  }
}

export async function resolveAncillaryDocumentFailure(args: {
  ancillaryCaseId?: number | null;
  documentKind?: string | null;
  requestedAction?: AncillaryDocumentFailureAction;
}): Promise<void> {
  const conds = [isNull(ancillaryDocumentReconciliationFailures.resolvedAt)];
  if (args.ancillaryCaseId != null) conds.push(eq(ancillaryDocumentReconciliationFailures.ancillaryCaseId, args.ancillaryCaseId));
  if (args.documentKind != null) conds.push(eq(ancillaryDocumentReconciliationFailures.documentKind, args.documentKind));
  if (args.requestedAction) conds.push(eq(ancillaryDocumentReconciliationFailures.requestedAction, args.requestedAction));
  await db
    .update(ancillaryDocumentReconciliationFailures)
    .set({ resolvedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(...conds));
}

/**
 * Resolve EXACTLY ONE reconciliation failure by its primary key, scoped to
 * the owning clinic. Unlike resolveAncillaryDocumentFailure (which resolves
 * every row matching case + kind + action), this closes only the specific
 * failure that was successfully processed — so a still-pending sibling retry
 * (e.g. a separate link_order_note) is never silently swept closed.
 *
 * Idempotent: the `resolvedAt IS NULL` guard means a second call resolves
 * nothing and returns false, without error.
 */
export async function resolveAncillaryDocumentFailureById(args: {
  id: number;
  clinicId: number;
}): Promise<boolean> {
  const rows = await db
    .update(ancillaryDocumentReconciliationFailures)
    .set({ resolvedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(ancillaryDocumentReconciliationFailures.id, args.id),
        eq(ancillaryDocumentReconciliationFailures.clinicId, args.clinicId),
        isNull(ancillaryDocumentReconciliationFailures.resolvedAt),
      ),
    )
    .returning();
  return rows.length > 0;
}

/**
 * Load EXACTLY ONE unresolved reconciliation failure by primary key, scoped to
 * the owning clinic. Used to VERIFY that a recovery action (e.g. a failed
 * Procedure Note regeneration) is being executed for a genuine, still-open
 * failure — never to casually reclaim work from an unrelated caller. Returns
 * null when the id does not exist, belongs to another clinic, or is already
 * resolved.
 */
export async function getUnresolvedAncillaryDocumentFailureById(args: {
  id: number;
  clinicId: number;
}): Promise<AncillaryDocumentReconciliationFailure | null> {
  return safeRead(async () => {
    const [row] = await db
      .select()
      .from(ancillaryDocumentReconciliationFailures)
      .where(
        and(
          eq(ancillaryDocumentReconciliationFailures.id, args.id),
          eq(ancillaryDocumentReconciliationFailures.clinicId, args.clinicId),
          isNull(ancillaryDocumentReconciliationFailures.resolvedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }, null as AncillaryDocumentReconciliationFailure | null, "getUnresolvedAncillaryDocumentFailureById");
}

export async function listUnresolvedAncillaryDocumentFailures(args?: {
  clinicId?: number;
  limit?: number;
}): Promise<AncillaryDocumentReconciliationFailure[]> {
  const limit = Math.min(Math.max(1, args?.limit ?? 100), 500);
  return safeRead(async () => {
    const conds = [isNull(ancillaryDocumentReconciliationFailures.resolvedAt)];
    if (args?.clinicId != null) conds.push(eq(ancillaryDocumentReconciliationFailures.clinicId, args.clinicId));
    return db
      .select()
      .from(ancillaryDocumentReconciliationFailures)
      .where(and(...conds))
      .orderBy(ancillaryDocumentReconciliationFailures.firstFailedAt)
      .limit(limit);
  }, [] as AncillaryDocumentReconciliationFailure[], "listUnresolvedAncillaryDocumentFailures");
}

// Re-export for consumers that batch reference reads by case ids.
export async function listReferencesForCaseIds(
  caseIds: number[],
): Promise<AncillaryDocumentReference[]> {
  if (caseIds.length === 0) return [];
  return safeRead(async () => {
    return db
      .select()
      .from(ancillaryDocumentReferences)
      .where(inArray(ancillaryDocumentReferences.ancillaryCaseId, caseIds));
  }, [] as AncillaryDocumentReference[], "listReferencesForCaseIds");
}
