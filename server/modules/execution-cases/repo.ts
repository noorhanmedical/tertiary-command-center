// Execution-case spine — read-only repository (Batch 10 read-only foundation).

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { patientExecutionCases } from "@shared/schema";
import type {
  ExecutionCaseStateSnapshot,
  ListExecutionCasesByUserFilters,
} from "./contracts";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_LIMIT);
}

function mapRowToSnapshot(row: any): ExecutionCaseStateSnapshot {
  return {
    executionCaseId: row.id,
    engagementBucket: row.engagementBucket,
    qualificationStatus: row.qualificationStatus,
    lifecycleStatus: row.lifecycleStatus,
    engagementStatus: row.engagementStatus,
    assignedTeamMemberId: row.assignedTeamMemberId,
    assignedRole: row.assignedRole,
    patientScreeningId: row.patientScreeningId,
    patientName: row.patientName,
    patientDob: row.patientDob,
    facilityId: row.facilityId,
    selectedServices: Array.isArray(row.selectedServices)
      ? (row.selectedServices as string[])
      : [],
    nextActionAt: row.nextActionAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Read one execution case by id.
 */
export async function getExecutionCaseSnapshot(
  executionCaseId: number,
): Promise<ExecutionCaseStateSnapshot | undefined> {
  if (!Number.isFinite(executionCaseId)) return undefined;
  const [row] = await db
    .select()
    .from(patientExecutionCases)
    .where(eq(patientExecutionCases.id, executionCaseId))
    .limit(1);
  return row ? mapRowToSnapshot(row) : undefined;
}

/**
 * Read execution cases assigned to a specific team member (assignedTeamMemberId).
 * `assignedTeamMemberId` is an outreach_schedulers.id today (no FK), which
 * mirrors how the engagement-board route consumes the column.
 */
export async function listExecutionCasesByAssignee(
  assignedTeamMemberId: number,
  filters: ListExecutionCasesByUserFilters = {},
  limit?: number,
): Promise<ExecutionCaseStateSnapshot[]> {
  const safeLimit = clampLimit(limit);
  const conditions = [
    eq(patientExecutionCases.assignedTeamMemberId, assignedTeamMemberId),
  ];
  if (filters.facilityId) {
    conditions.push(eq(patientExecutionCases.facilityId, filters.facilityId));
  }
  if (filters.engagementBucket) {
    conditions.push(
      eq(patientExecutionCases.engagementBucket, filters.engagementBucket),
    );
  }
  if (filters.lifecycleStatus) {
    conditions.push(
      eq(patientExecutionCases.lifecycleStatus, filters.lifecycleStatus),
    );
  }
  if (filters.engagementStatus) {
    conditions.push(
      eq(patientExecutionCases.engagementStatus, filters.engagementStatus),
    );
  }
  if (filters.qualificationStatus) {
    conditions.push(
      eq(
        patientExecutionCases.qualificationStatus,
        filters.qualificationStatus,
      ),
    );
  }

  const rows = await db
    .select()
    .from(patientExecutionCases)
    .where(and(...conditions))
    .orderBy(desc(patientExecutionCases.updatedAt))
    .limit(safeLimit);

  return rows.map((r) => mapRowToSnapshot(r));
}

/**
 * Read execution cases by patientScreeningId. Useful for "all spine rows
 * for this patient" lookups during the future Batch 5b migration.
 */
export async function listExecutionCasesByPatientScreeningId(
  patientScreeningId: number,
): Promise<ExecutionCaseStateSnapshot[]> {
  const rows = await db
    .select()
    .from(patientExecutionCases)
    .where(
      eq(patientExecutionCases.patientScreeningId, patientScreeningId),
    )
    .orderBy(desc(patientExecutionCases.id))
    .limit(MAX_LIMIT);

  return rows.map((r) => mapRowToSnapshot(r));
}

void inArray;
