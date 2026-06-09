// Journey-events spine — read-only repository (Batch 12 read-only foundation).

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { patientJourneyEvents } from "@shared/schema";
import type {
  JourneyEventSnapshot,
  ListJourneyEventsFilters,
} from "./contracts";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_LIMIT);
}

function mapRow(row: any): JourneyEventSnapshot {
  return {
    id: row.id,
    patientName: row.patientName,
    patientDob: row.patientDob,
    patientScreeningId: row.patientScreeningId,
    executionCaseId: row.executionCaseId,
    eventType: row.eventType,
    eventSource: row.eventSource,
    actorUserId: row.actorUserId,
    summary: row.summary,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
    createdAt: row.createdAt,
  };
}

/**
 * List journey events with rich filters. Ordered by createdAt DESC.
 */
export async function listJourneyEvents(
  filters: ListJourneyEventsFilters = {},
  limit?: number,
): Promise<JourneyEventSnapshot[]> {
  const safeLimit = clampLimit(limit);
  const conditions = [];
  if (filters.patientScreeningId != null) {
    conditions.push(
      eq(patientJourneyEvents.patientScreeningId, filters.patientScreeningId),
    );
  }
  if (filters.executionCaseId != null) {
    conditions.push(
      eq(patientJourneyEvents.executionCaseId, filters.executionCaseId),
    );
  }
  if (filters.eventType) {
    conditions.push(eq(patientJourneyEvents.eventType, filters.eventType));
  }
  if (filters.eventSource) {
    conditions.push(eq(patientJourneyEvents.eventSource, filters.eventSource));
  }
  if (filters.dateFrom) {
    conditions.push(
      sql`${patientJourneyEvents.createdAt} >= ${filters.dateFrom}::timestamp`,
    );
  }
  if (filters.dateTo) {
    conditions.push(
      sql`${patientJourneyEvents.createdAt} <= (${filters.dateTo}::date + interval '1 day')`,
    );
  }

  const rows =
    conditions.length === 0
      ? await db
          .select()
          .from(patientJourneyEvents)
          .orderBy(desc(patientJourneyEvents.createdAt))
          .limit(safeLimit)
      : await db
          .select()
          .from(patientJourneyEvents)
          .where(and(...conditions))
          .orderBy(desc(patientJourneyEvents.createdAt))
          .limit(safeLimit);

  return rows.map(mapRow);
}

/**
 * Read the full timeline for one patient_screenings row, newest first.
 */
export async function getJourneyTimelineForPatient(
  patientScreeningId: number,
  limit?: number,
): Promise<JourneyEventSnapshot[]> {
  return listJourneyEvents({ patientScreeningId }, limit);
}

/**
 * Read the latest journey event per execution case in the supplied set.
 * Used by the engagement-board read path today (inline join); this module
 * surfaces the shape consistently so future routes can switch over.
 */
export async function getLatestJourneyEventByExecutionCaseIds(
  executionCaseIds: number[],
): Promise<Map<number, JourneyEventSnapshot>> {
  const out = new Map<number, JourneyEventSnapshot>();
  if (executionCaseIds.length === 0) return out;
  const ids = Array.from(new Set(executionCaseIds.filter((n) => Number.isFinite(n))));
  if (ids.length === 0) return out;
  const rows = await db
    .select()
    .from(patientJourneyEvents)
    .where(sql`${patientJourneyEvents.executionCaseId} IN (${sql.join(ids, sql`, `)})`)
    .orderBy(desc(patientJourneyEvents.createdAt));
  for (const r of rows) {
    if (r.executionCaseId == null) continue;
    if (!out.has(r.executionCaseId)) {
      out.set(r.executionCaseId, mapRow(r));
    }
  }
  return out;
}
