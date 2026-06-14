import { db } from "../db";
import { and, eq, isNull, desc } from "drizzle-orm";
import {
  patientNotes,
  type PatientNote,
  type InsertPatientNote,
} from "@shared/schema/patientNotes";

export type ListPatientNotesFilters = {
  patientScreeningId?: number;
  executionCaseId?: number;
  noteType?: string;
  /** When true, archived notes are included. Default false. */
  includeArchived?: boolean;
};

export async function listPatientNotes(
  filters: ListPatientNotesFilters,
  limit = 100,
): Promise<PatientNote[]> {
  const conditions = [];
  if (filters.patientScreeningId != null) {
    conditions.push(eq(patientNotes.patientScreeningId, filters.patientScreeningId));
  }
  if (filters.executionCaseId != null) {
    conditions.push(eq(patientNotes.executionCaseId, filters.executionCaseId));
  }
  if (filters.noteType) {
    conditions.push(eq(patientNotes.noteType, filters.noteType));
  }
  if (!filters.includeArchived) {
    conditions.push(isNull(patientNotes.archivedAt));
  }
  let q = db.select().from(patientNotes);
  if (conditions.length > 0) q = q.where(and(...conditions)) as typeof q;
  return q.orderBy(desc(patientNotes.createdAt)).limit(limit);
}

export async function createPatientNote(input: InsertPatientNote): Promise<PatientNote> {
  const [row] = await db.insert(patientNotes).values(input).returning();
  return row;
}

export async function archivePatientNote(id: number): Promise<PatientNote | undefined> {
  const [row] = await db
    .update(patientNotes)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(patientNotes.id, id))
    .returning();
  return row;
}
