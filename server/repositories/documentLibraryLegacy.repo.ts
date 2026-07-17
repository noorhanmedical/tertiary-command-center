// documentLibraryLegacy.repo.ts — Phase 5 architecture hardening.
//
// Extracted from server/routes/documentLibrary.ts. Holds the legacy
// uploaded_documents / documents / patient_screenings queries so the
// route stops importing drizzle-orm and ../db directly.
//
// Legacy back-fill semantics are preserved verbatim. Errors are still
// caught by the caller (migrateLegacyUploadedDocuments) — this repo
// throws on real query failure so callers can decide swallow vs log.

import { db } from "../db";
import { and, desc, eq, ilike, isNull, like, or } from "drizzle-orm";
import {
  documents as documentsTable,
  documentSurfaceAssignments,
  patientScreenings,
  uploadedDocuments,
} from "@shared/schema";

export const LEGACY_SOURCE_PREFIX = "legacy_uploaded_document_id=";

export async function listLegacyUploadedDocuments() {
  return db
    .select()
    .from(uploadedDocuments)
    .where(eq(uploadedDocuments.isTest, false));
}

export async function listMigratedLegacyMarkers(): Promise<Set<number>> {
  const migrated = await db
    .select({ sourceNotes: documentsTable.sourceNotes })
    .from(documentsTable)
    .where(like(documentsTable.sourceNotes, `${LEGACY_SOURCE_PREFIX}%`));
  const ids = new Set<number>();
  for (const r of migrated) {
    if (!r.sourceNotes) continue;
    const idStr = r.sourceNotes.slice(LEGACY_SOURCE_PREFIX.length);
    const n = parseInt(idStr, 10);
    if (!Number.isNaN(n)) ids.add(n);
  }
  return ids;
}

export async function findLatestPatientScreeningByExactName(
  name: string,
): Promise<number | null> {
  const matches = await db
    .select({ id: patientScreenings.id })
    .from(patientScreenings)
    .where(eq(patientScreenings.name, name))
    .orderBy(desc(patientScreenings.id))
    .limit(1);
  return matches[0]?.id ?? null;
}

// Transactional legacy row → library row upsert.
// Kept as a single unit inside the repo so the "insert doc + assign
// patient_chart surface" pair remains atomic.
export async function insertLegacyLibraryRow(row: {
  title: string;
  kind: any;
  filename: string;
  patientScreeningId: number | null;
  facility: string | null;
  sourceNotes: string;
}): Promise<number> {
  return await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(documentsTable)
      .values({
        title: row.title,
        description: "",
        kind: row.kind,
        signatureRequirement: "none",
        filename: row.filename,
        contentType: "application/pdf",
        sizeBytes: 0,
        patientScreeningId: row.patientScreeningId,
        facility: row.facility,
        sourceNotes: row.sourceNotes,
        createdByUserId: null,
      })
      .returning({ id: documentsTable.id });
    const newId = inserted[0]!.id;
    await tx
      .insert(documentSurfaceAssignments)
      .values({ documentId: newId, surface: "patient_chart" })
      .onConflictDoNothing();
    return newId;
  });
}

export async function getLegacyUploadedDocumentById(id: number) {
  const rows = await db
    .select()
    .from(uploadedDocuments)
    .where(eq(uploadedDocuments.id, id))
    .limit(1);
  return rows[0] ?? null;
}

// Cross-entity current-doc search for the command rail. Bounded by
// caller-provided limit (hard-capped at 100 in the route).
export async function searchCurrentLibraryDocuments(
  pattern: string,
  limit: number,
) {
  return db
    .select({
      id: documentsTable.id,
      title: documentsTable.title,
      kind: documentsTable.kind,
      filename: documentsTable.filename,
      facility: documentsTable.facility,
      contentType: documentsTable.contentType,
    })
    .from(documentsTable)
    .where(
      and(
        isNull(documentsTable.supersededByDocumentId),
        isNull(documentsTable.deletedAt),
        or(
          ilike(documentsTable.title, pattern),
          ilike(documentsTable.filename, pattern),
          ilike(documentsTable.description, pattern),
        ),
      ),
    )
    .orderBy(desc(documentsTable.createdAt))
    .limit(limit);
}

export async function getPatientScreeningNameAndDob(
  patientScreeningId: number,
): Promise<{ name: string; dob: string | null } | null> {
  const rows = await db
    .select({ name: patientScreenings.name, dob: patientScreenings.dob })
    .from(patientScreenings)
    .where(eq(patientScreenings.id, patientScreeningId))
    .limit(1);
  return rows[0] ?? null;
}
