// Storage-backed deps for the Patient Directory service (Batch B).
//
// Bridges the deps-injected projection (`patientDirectoryService.ts`)
// to the live storage layer. Defensive reads where the 0027/0028/0029
// columns / tables may not exist yet:
//   - patient_screenings.mrn   -> migration 0026 (committed)
//   - patient_screenings.do_not_contact + reason + actor + set_at
//                              -> migration 0027 (pending apply)
//   - screening_batches.source_file_name + source_importer_user_id
//                              -> migration 0028 (pending apply)
//   - patient_directory_events -> migration 0029 (pending apply)
//
// When a pending column / table is missing, the reader returns null /
// empty without crashing. The UI surfaces fall back to the existing
// "source unavailable" state.

import { storage } from "../../storage";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import type {
  PatientDirectoryCallHistoryEntry,
  PatientDirectoryCooldown,
  PatientDirectoryDeps,
  PatientDirectoryEngagementSummary,
  PatientDirectoryEvent,
  PatientDirectoryPriorTest,
  PatientDirectoryProfile,
} from "./patientDirectoryService";

function nullableField<T>(row: Record<string, unknown>, key: string): T | null {
  const v = row[key];
  return v === undefined || v === null ? null : (v as T);
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

async function loadProfile(id: number): Promise<PatientDirectoryProfile | null> {
  const row = await storage.getPatientScreening(id);
  if (!row) return null;
  const rec = row as unknown as Record<string, unknown>;
  // batch lookup for source linkage.
  const batchId = (rec.batchId as number) ?? 0;
  let batchName: string | null = null;
  let batchCreatedAt: string | null = null;
  let sourceFileName: string | null = null;
  if (batchId) {
    try {
      const batch = await storage.getScreeningBatch(batchId);
      if (batch) {
        batchName = batch.name ?? null;
        batchCreatedAt = toIso(batch.createdAt);
        // 0028 columns — defensive read.
        sourceFileName = nullableField<string>(batch as unknown as Record<string, unknown>, "sourceFileName");
      }
    } catch {
      // batch lookup failed — leave nulls.
    }
  }
  return {
    patientScreeningId: id,
    identity: {
      name: (rec.name as string) ?? "",
      facility: nullableField<string>(rec, "facility"),
      dob: nullableField<string>(rec, "dob"),
      phoneNumber: nullableField<string>(rec, "phoneNumber"),
      email: nullableField<string>(rec, "email"),
      insurance: nullableField<string>(rec, "insurance"),
      mrn: nullableField<string>(rec, "mrn"), // 0026 — committed
    } as PatientDirectoryProfile["identity"],
    patientType: (rec.patientType as string) ?? "visit",
    adminApprovalStatus: (rec.adminApprovalStatus as string) ?? "pending",
    adminApprovedAt: toIso(rec.adminApprovedAt),
    adminApprovedByUserId: nullableField<string>(rec, "adminApprovedByUserId"),
    createdAt: toIso(rec.createdAt) ?? new Date(0).toISOString(),
    source: {
      batchId,
      batchName,
      batchCreatedAt: batchCreatedAt ?? new Date(0).toISOString(),
      sourceFileName,
    },
  };
}

async function loadEngagement(id: number): Promise<PatientDirectoryEngagementSummary | null> {
  try {
    const assignment = await storage.getActiveAssignmentForPatient(id);
    if (!assignment) {
      return {
        patientScreeningId: id,
        currentAssignmentId: null,
        currentAssignmentStatus: null,
        currentAssignedTo: null,
        lastEngagementUpdate: null,
      };
    }
    const rec = assignment as unknown as Record<string, unknown>;
    return {
      patientScreeningId: id,
      currentAssignmentId: (rec.id as number) ?? null,
      currentAssignmentStatus: nullableField<string>(rec, "status"),
      currentAssignedTo: nullableField<string>(rec, "schedulerUserId") ?? nullableField<string>(rec, "assignedToUserId"),
      lastEngagementUpdate: toIso(rec.updatedAt) ?? toIso(rec.createdAt),
    };
  } catch {
    return null;
  }
}

async function loadCallHistory(id: number): Promise<ReadonlyArray<PatientDirectoryCallHistoryEntry>> {
  try {
    const calls = await storage.listOutreachCallsForPatient(id);
    return calls.map((c) => {
      const rec = c as unknown as Record<string, unknown>;
      const outcome = (rec.outcome as string) ?? "";
      return {
        id: (rec.id as number) ?? 0,
        patientScreeningId: id,
        startedAt: toIso(rec.startedAt) ?? "",
        outcome,
        notes: nullableField<string>(rec, "notes"),
        callbackAt: toIso(rec.callbackAt),
        attemptNumber: (rec.attemptNumber as number | null) ?? null,
        durationSeconds: (rec.durationSeconds as number | null) ?? null,
        isDncOutcome: outcome === "refused_dnc" || outcome === "dnc" || outcome === "do_not_contact",
      } satisfies PatientDirectoryCallHistoryEntry;
    });
  } catch {
    return [];
  }
}

async function loadCooldown(id: number): Promise<PatientDirectoryCooldown | null> {
  try {
    const rows = await db.execute(sql`
      SELECT id, cooldown_status, cooldown_start_date, cooldown_end_date,
             note, reviewed_by_user_id
      FROM cooldown_records
      WHERE patient_screening_id = ${id}
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const r = (rows as unknown as { rows?: Array<Record<string, unknown>> }).rows;
    const first = r?.[0];
    if (!first) return null;
    return {
      patientScreeningId: id,
      active: (first.cooldown_status as string) === "active",
      intervalLabel: (first.cooldown_status as string) ?? "unknown",
      startsAt: (first.cooldown_start_date as string | null) ?? null,
      endsAt: (first.cooldown_end_date as string | null) ?? null,
      reason: (first.note as string | null) ?? null,
      setByUserId: (first.reviewed_by_user_id as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

async function loadPriorTests(id: number): Promise<ReadonlyArray<PatientDirectoryPriorTest>> {
  try {
    const patient = await storage.getPatientScreening(id);
    if (!patient) return [];
    const name = (patient as unknown as { name?: string }).name ?? "";
    const dob = (patient as unknown as { dob?: string | null }).dob ?? null;
    if (!name) return [];
    const rows = await storage.getPatientGroupTestHistory(name, dob);
    return rows.map((r) => {
      const rec = r as unknown as Record<string, unknown>;
      return {
        patientScreeningId: id,
        patientName: (rec.patientName as string) ?? name,
        testName: (rec.testType as string) ?? "",
        dateOfService: (rec.dateOfService as string | null) ?? null,
        facility: nullableField<string>(rec, "facility"),
        source: nullableField<string>(rec, "source"),
        notes: nullableField<string>(rec, "notes"),
      } satisfies PatientDirectoryPriorTest;
    });
  } catch {
    return [];
  }
}

async function loadEvents(id: number): Promise<ReadonlyArray<PatientDirectoryEvent>> {
  // 0029 patient_directory_events — defensive read.
  try {
    const rows = await db.execute(sql`
      SELECT kind, occurred_at, actor_user_id, payload
      FROM patient_directory_events
      WHERE patient_screening_id = ${id}
      ORDER BY occurred_at DESC
      LIMIT 200
    `);
    const r = (rows as unknown as { rows?: Array<Record<string, unknown>> }).rows;
    if (!r || r.length === 0) return [];
    return r.map((row) => ({
      kind: ((row.kind as PatientDirectoryEvent["kind"]) ?? "other"),
      occurredAt: toIso(row.occurred_at) ?? new Date().toISOString(),
      actorUserId: (row.actor_user_id as string | null) ?? null,
      payload: ((row.payload as Record<string, unknown>) ?? {}) as Record<string, unknown>,
    } satisfies PatientDirectoryEvent));
  } catch {
    // Table not yet migrated.
    return [];
  }
}

export function createPatientDirectoryStorageDeps(): PatientDirectoryDeps {
  return { loadProfile, loadEngagement, loadCallHistory, loadCooldown, loadPriorTests, loadEvents };
}
