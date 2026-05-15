import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  patientCommunications,
  patientScreenings,
  patientJourneyEvents,
  type InsertPatientCommunication,
  type PatientCommunication,
  type PatientCommunicationType,
} from "@shared/schema";

// Append-only repository for the patient_communications timeline.
//
// outreach_calls remains the system of record for outreach metrics;
// patient_communications is the unified read-model entry the patient
// command canvas + history folders read from.

export type ListPatientCommunicationsOptions = {
  types?: PatientCommunicationType[];
  limit?: number;
};

export async function createPatientCommunication(
  input: InsertPatientCommunication,
): Promise<PatientCommunication> {
  const [row] = await db
    .insert(patientCommunications)
    .values(input)
    .returning();
  return row;
}

export async function listPatientCommunicationsByPatient(
  patientScreeningId: number,
  options: ListPatientCommunicationsOptions = {},
): Promise<PatientCommunication[]> {
  const where = options.types && options.types.length > 0
    ? and(
        eq(patientCommunications.patientScreeningId, patientScreeningId),
        inArray(patientCommunications.communicationType, options.types),
      )
    : eq(patientCommunications.patientScreeningId, patientScreeningId);
  return db
    .select()
    .from(patientCommunications)
    .where(where)
    .orderBy(desc(patientCommunications.occurredAt))
    .limit(Math.min(Math.max(options.limit ?? 200, 1), 500));
}

export async function listPatientCommunicationsByExecutionCase(
  executionCaseId: number,
  options: ListPatientCommunicationsOptions = {},
): Promise<PatientCommunication[]> {
  const where = options.types && options.types.length > 0
    ? and(
        eq(patientCommunications.executionCaseId, executionCaseId),
        inArray(patientCommunications.communicationType, options.types),
      )
    : eq(patientCommunications.executionCaseId, executionCaseId);
  return db
    .select()
    .from(patientCommunications)
    .where(where)
    .orderBy(desc(patientCommunications.occurredAt))
    .limit(Math.min(Math.max(options.limit ?? 200, 1), 500));
}

export async function getLatestPatientCommunication(
  patientScreeningId: number,
): Promise<PatientCommunication | undefined> {
  const [row] = await db
    .select()
    .from(patientCommunications)
    .where(eq(patientCommunications.patientScreeningId, patientScreeningId))
    .orderBy(desc(patientCommunications.occurredAt))
    .limit(1);
  return row;
}

// Helper used by call/marketing wiring: after a successful side-effect
// (call logged, marketing email sent), append a one-line journey event
// so the patient_journey_events timeline reflects the touch too.
export async function appendCommunicationJourneyEvent(input: {
  patientScreeningId: number | null;
  executionCaseId: number | null;
  actorUserId: string | null;
  patientName: string | null;
  patientDob: string | null;
  summary: string;
  eventType?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (input.patientScreeningId == null && input.executionCaseId == null) return;
  try {
    await db.insert(patientJourneyEvents).values({
      patientScreeningId: input.patientScreeningId,
      executionCaseId: input.executionCaseId,
      actorUserId: input.actorUserId ?? null,
      patientName: input.patientName ?? "",
      patientDob: input.patientDob ?? null,
      eventType: input.eventType ?? "communication_logged",
      eventSource: "team_portal",
      summary: input.summary,
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    console.error(
      "[patientCommunications] failed to append journey event:",
      err instanceof Error ? err.message : err,
    );
  }
}

// "My recent communication patients" — returns up to `limit` patient
// screening ids the given user has logged a communication for,
// newest-first. Used by /api/portal/my-patients to widen the touch
// signal beyond journey/calls/tasks.
export async function listMyRecentCommunicationPatients(
  userId: string,
  limit: number = 200,
): Promise<Array<{ patientScreeningId: number; occurredAt: Date | null; summary: string | null }>> {
  if (!userId) return [];
  const rows = await db
    .select({
      patientScreeningId: patientCommunications.patientScreeningId,
      occurredAt: patientCommunications.occurredAt,
      summary: patientCommunications.summary,
    })
    .from(patientCommunications)
    .where(
      and(
        eq(patientCommunications.actorUserId, userId),
        sql`${patientCommunications.patientScreeningId} IS NOT NULL`,
      ),
    )
    .orderBy(desc(patientCommunications.occurredAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rows
    .filter((r) => r.patientScreeningId != null)
    .map((r) => ({
      patientScreeningId: r.patientScreeningId as number,
      occurredAt: r.occurredAt,
      summary: r.summary,
    }));
}

// Filter helper used by status endpoints to verify the patient is
// still active. Returns true when the screening row exists and is not
// soft-deleted.
export async function isPatientActive(
  patientScreeningId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: patientScreenings.id })
    .from(patientScreenings)
    .where(
      and(
        eq(patientScreenings.id, patientScreeningId),
        isNull(patientScreenings.deletedAt),
      ),
    )
    .limit(1);
  return !!row;
}
