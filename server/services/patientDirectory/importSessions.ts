// Patient Directory import-session tracking (task #723).
//
// Each bulk-import run through the Patient Directory is stamped onto a
// screening_batches row (import_source_fields / import_kind /
// import_created_by). Minimal-field ("service") imports submitted by
// non-admin staff park their parsed preview in pending_import_payload
// until an admin approves the match review; nothing is written to
// patient_screenings until then.

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { writePatientDirectoryEvent } from "./patientDirectoryWriter";

export type ImportKind = "full" | "service";

export type PendingImportPayload = {
  rows: Array<{
    rowIndex: number;
    identity: Record<string, string | null | undefined>;
    extras?: { dateOfService?: string; procedure?: string };
    matchCandidates?: Array<{
      patientScreeningId: number;
      name: string;
      dob: string | null;
      facility: string | null;
      score: number;
    }>;
  }>;
  sourceFields: string[];
  minimal: boolean;
  submittedBy: string | null;
  submittedByUsername: string | null;
  submittedAt: string;
};

export type ImportBatchSummary = {
  id: number;
  name: string;
  createdAt: string;
  createdByUserId: string | null;
  createdByUsername: string | null;
  patientCount: number;
  sourceFields: string[];
  importKind: ImportKind | null;
  pending: boolean;
  pendingPayload: PendingImportPayload | null;
  patientNames: string[];
};

type Row = Record<string, unknown>;

function rowsOf(res: unknown): Row[] {
  return ((res as { rows?: Row[] }).rows ?? []) as Row[];
}

export async function createImportBatch(input: {
  name: string;
  facility?: string | null;
  sourceFields: string[];
  importKind: ImportKind;
  createdBy: string | null;
  pendingPayload?: PendingImportPayload | null;
}): Promise<number> {
  const batch = await storage.createScreeningBatch({
    name: input.name,
    facility: input.facility ?? null,
    scheduleDate: new Date().toISOString().slice(0, 10),
    status: "draft",
    patientCount: 0,
  } as never);
  const id = (batch as unknown as { id: number }).id;
  await db.execute(sql`
    UPDATE screening_batches
    SET import_source_fields = ${JSON.stringify(input.sourceFields)}::jsonb,
        import_kind = ${input.importKind},
        import_created_by = ${input.createdBy ?? null},
        pending_import_payload = ${input.pendingPayload ? JSON.stringify(input.pendingPayload) : null}::jsonb
    WHERE id = ${id}
  `);
  return id;
}

export async function setBatchPendingPayload(
  batchId: number,
  payload: PendingImportPayload | null,
): Promise<void> {
  await db.execute(sql`
    UPDATE screening_batches
    SET pending_import_payload = ${payload ? JSON.stringify(payload) : null}::jsonb
    WHERE id = ${batchId}
  `);
}

export async function syncImportBatchPatientCount(batchId: number): Promise<void> {
  await db.execute(sql`
    UPDATE screening_batches b
    SET patient_count = (
      SELECT count(*) FROM patient_screenings p
      WHERE p.batch_id = b.id AND p.deleted_at IS NULL
    )
    WHERE b.id = ${batchId}
  `);
}

export async function getImportBatchPendingPayload(
  batchId: number,
): Promise<PendingImportPayload | null> {
  const res = await db.execute(sql`
    SELECT pending_import_payload FROM screening_batches WHERE id = ${batchId}
  `);
  const first = rowsOf(res)[0];
  return (first?.pending_import_payload as PendingImportPayload | null) ?? null;
}

/**
 * Authoritative import metadata for a batch. Authorization decisions in
 * import-confirm MUST use this (never client-supplied importKind) so a
 * non-admin can't relabel a pending service batch as "full" to bypass
 * admin approval.
 */
export async function getImportBatchMeta(batchId: number): Promise<{
  exists: boolean;
  importKind: ImportKind | null;
  hasPendingPayload: boolean;
  createdBy: string | null;
}> {
  const res = await db.execute(sql`
    SELECT import_kind, pending_import_payload IS NOT NULL AS has_pending, import_created_by
    FROM screening_batches WHERE id = ${batchId}
  `);
  const first = rowsOf(res)[0];
  if (!first) return { exists: false, importKind: null, hasPendingPayload: false, createdBy: null };
  return {
    exists: true,
    importKind: ((first.import_kind as string | null) ?? null) as ImportKind | null,
    hasPendingPayload: Boolean(first.has_pending),
    createdBy: (first.import_created_by as string | null) ?? null,
  };
}

export async function listImportBatches(limit = 30): Promise<ImportBatchSummary[]> {
  const batchesRes = await db.execute(sql`
    SELECT b.id, b.name, b.created_at, b.import_source_fields, b.import_kind,
           b.import_created_by, b.pending_import_payload, b.patient_count,
           u.username AS created_by_username
    FROM screening_batches b
    LEFT JOIN users u ON u.id = b.import_created_by
    WHERE (b.import_source_fields IS NOT NULL OR b.pending_import_payload IS NOT NULL)
      AND b.status <> 'import_deleted'
    ORDER BY b.created_at DESC
    LIMIT ${limit}
  `);
  const batches = rowsOf(batchesRes);
  if (batches.length === 0) return [];

  const ids = batches.map((b) => Number(b.id));
  const namesRes = await db.execute(sql`
    SELECT batch_id, name, count(*) OVER (PARTITION BY batch_id) AS total
    FROM patient_screenings
    WHERE batch_id = ANY(ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::int[])
      AND deleted_at IS NULL
    ORDER BY batch_id, id
  `);
  const namesByBatch = new Map<number, { names: string[]; count: number }>();
  for (const r of rowsOf(namesRes)) {
    const bid = Number(r.batch_id);
    const entry = namesByBatch.get(bid) ?? { names: [], count: 0 };
    entry.count += 1;
    if (entry.names.length < 10) entry.names.push(String(r.name ?? ""));
    namesByBatch.set(bid, entry);
  }

  return batches.map((b) => {
    const bid = Number(b.id);
    const live = namesByBatch.get(bid);
    const pendingPayload = (b.pending_import_payload as PendingImportPayload | null) ?? null;
    const pendingNames = pendingPayload
      ? pendingPayload.rows.map((r) => String(r.identity?.name ?? "")).filter(Boolean).slice(0, 10)
      : [];
    const createdAt = b.created_at instanceof Date
      ? b.created_at.toISOString()
      : String(b.created_at ?? "");
    return {
      id: bid,
      name: String(b.name ?? ""),
      createdAt,
      createdByUserId: (b.import_created_by as string | null) ?? null,
      createdByUsername: (b.created_by_username as string | null) ?? null,
      patientCount: live?.count ?? (pendingPayload ? pendingPayload.rows.length : 0),
      sourceFields: (b.import_source_fields as string[] | null) ?? [],
      importKind: ((b.import_kind as string | null) ?? null) as ImportKind | null,
      pending: pendingPayload != null,
      pendingPayload,
      patientNames: live && live.names.length > 0 ? live.names : pendingNames,
    } satisfies ImportBatchSummary;
  });
}

/** Soft-delete every patient in the batch + retire the batch from Recent Imports. */
export async function deleteImportBatch(
  batchId: number,
  actorUserId: string | null,
): Promise<{ affected: number }> {
  const res = await db.execute(sql`
    UPDATE patient_screenings
    SET deleted_at = now(),
        deleted_by_user_id = ${actorUserId ?? null},
        delete_expires_at = now() + interval '14 days',
        delete_reason = 'Import batch deleted'
    WHERE batch_id = ${batchId}
      AND deleted_at IS NULL
  `);
  const affected = Number((res as unknown as { rowCount?: number }).rowCount ?? 0);
  await db.execute(sql`
    UPDATE screening_batches
    SET status = 'import_deleted',
        pending_import_payload = NULL,
        patient_count = 0
    WHERE id = ${batchId}
  `);
  await writePatientDirectoryEvent({
    patientScreeningId: null,
    kind: "batch_deleted",
    actorUserId,
    relatedEntityId: batchId,
    relatedEntityType: "screening_batch",
    payload: { batchId, affected },
  });
  return { affected };
}
