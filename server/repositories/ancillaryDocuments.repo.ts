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
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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
  createdByUserId?: string | null;
  metadata?: Record<string, unknown>;
};

export type CreateReferenceResult =
  | { created: true; row: AncillaryDocumentReference }
  | { created: false; existing: AncillaryDocumentReference };

/**
 * Insert a new canonical reference. If one already exists for the same
 * (source_table, source_id, kind) it is returned unchanged (idempotent).
 */
export async function createReference(input: CreateReferenceInput): Promise<CreateReferenceResult> {
  guardWrite();
  if (!(ANCILLARY_DOCUMENT_KINDS as readonly string[]).includes(input.documentKind)) {
    throw new Error(`invalid documentKind: ${input.documentKind}`);
  }
  const existing = await getReferenceBySource(input.sourceTable, input.sourceId, input.documentKind);
  if (existing) return { created: false, existing };
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
        createdByUserId: input.createdByUserId ?? null,
        metadata: (input.metadata ?? {}) as unknown as never,
      })
      .returning();
    return { created: true, row };
  } catch (e) {
    if ((e as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      const winner = await getReferenceBySource(input.sourceTable, input.sourceId, input.documentKind)
        ?? await getActiveReference(input.ancillaryCaseId, input.documentKind);
      if (winner) return { created: false, existing: winner };
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
  const dedupeConds = [
    eq(ancillaryDocumentReconciliationFailures.requestedAction, input.requestedAction),
    isNull(ancillaryDocumentReconciliationFailures.resolvedAt),
  ];
  if (input.ancillaryCaseId != null) {
    dedupeConds.push(eq(ancillaryDocumentReconciliationFailures.ancillaryCaseId, input.ancillaryCaseId));
  }
  if (input.documentKind != null) {
    dedupeConds.push(eq(ancillaryDocumentReconciliationFailures.documentKind, input.documentKind));
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
