// Physician Portal — signature repository.
//
// Route/service layers must not issue db.select/db.execute directly. Every
// SQL statement that backs the signatures worklist / bulk-sign / return
// endpoints lives here so future changes can be reasoned about at a single
// architectural boundary and unit tests can mock the repo cleanly.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { patientScreenings } from "@shared/schema/screening";
import type { ProcedureNote } from "@shared/schema/generatedNotes";
import { SIGNABLE_GEN_STATUSES } from "../services/physicianPortal/signatureRules";

// SIGNABLE_GEN_STATUSES + READY_BILLING live in signatureRules.ts (pure).
// Imported here only so the WHERE-clause filter matches the client-side
// eligibility rule.

export type PhysicianSignatureListFilters = {
  // Authenticated clinic scope — REQUIRED. Every signature read is filtered
  // to this clinic; it is derived from req.clinicId, never a request payload.
  clinicId: number;
  limit?: number;
  serviceType?: string;
  signatureStatus?: string;
  facilityId?: string;
};

export type PhysicianSignatureRow = ProcedureNote & {
  patientName: string | null;
  patientDob: string | null;
  patientAge: number | null;
  patientGender: string | null;
  patientInsurance: string | null;
  patientFacility: string | null;
  diagnoses: string | null;
  history: string | null;
  medications: string | null;
};

/**
 * Load the joined notes+patient rows the signatures worklist needs.
 * Filters by generation-status (signable set) and non-signed signature
 * status. `facilityId` filters the joined `patientScreenings.facility`.
 */
export async function listSignatureCandidateRows(
  filters: PhysicianSignatureListFilters,
): Promise<PhysicianSignatureRow[]> {
  const limit = filters.limit
    ? Math.min(Math.max(1, filters.limit), 500)
    : 200;

  const conditions = [
    // Tenant isolation: only this clinic's notes are ever listed.
    eq(procedureNotes.clinicId, filters.clinicId),
    inArray(procedureNotes.generationStatus, [...SIGNABLE_GEN_STATUSES]),
    sql`COALESCE(${procedureNotes.signatureStatus}, 'needs_signature') <> 'signed'`,
  ];
  if (filters.serviceType) {
    conditions.push(eq(procedureNotes.serviceType, filters.serviceType));
  }
  if (filters.signatureStatus) {
    conditions.push(
      sql`COALESCE(${procedureNotes.signatureStatus}, 'needs_signature') = ${filters.signatureStatus}`,
    );
  }

  const rows = await db
    .select({
      id: procedureNotes.id,
      clinicId: procedureNotes.clinicId,
      executionCaseId: procedureNotes.executionCaseId,
      patientScreeningId: procedureNotes.patientScreeningId,
      procedureEventId: procedureNotes.procedureEventId,
      serviceType: procedureNotes.serviceType,
      noteType: procedureNotes.noteType,
      generationStatus: procedureNotes.generationStatus,
      generatedText: procedureNotes.generatedText,
      generatedByAi: procedureNotes.generatedByAi,
      sourceData: procedureNotes.sourceData,
      errorMessage: procedureNotes.errorMessage,
      signatureStatus: procedureNotes.signatureStatus,
      signedAt: procedureNotes.signedAt,
      signedByUserId: procedureNotes.signedByUserId,
      returnReason: procedureNotes.returnReason,
      // Phase 2E-A2 canonical Order Note identity columns.
      ancillaryCaseId: procedureNotes.ancillaryCaseId,
      globalPlexusPatientId: procedureNotes.globalPlexusPatientId,
      patientClinicMembershipId: procedureNotes.patientClinicMembershipId,
      qualifyingGlobalScheduleEventId: procedureNotes.qualifyingGlobalScheduleEventId,
      adminReviewEventId: procedureNotes.adminReviewEventId,
      effectiveClinicalDate: procedureNotes.effectiveClinicalDate,
      supersedesNoteId: procedureNotes.supersedesNoteId,
      supersededAt: procedureNotes.supersededAt,
      createdAt: procedureNotes.createdAt,
      updatedAt: procedureNotes.updatedAt,
      patientName: patientScreenings.name,
      patientDob: patientScreenings.dob,
      patientAge: patientScreenings.age,
      patientGender: patientScreenings.gender,
      patientInsurance: patientScreenings.insurance,
      patientFacility: patientScreenings.facility,
      diagnoses: patientScreenings.diagnoses,
      history: patientScreenings.history,
      medications: patientScreenings.medications,
    })
    .from(procedureNotes)
    .leftJoin(
      patientScreenings,
      eq(procedureNotes.patientScreeningId, patientScreenings.id),
    )
    .where(and(...conditions))
    .orderBy(desc(procedureNotes.createdAt))
    .limit(limit);

  return filters.facilityId
    ? rows.filter((n) => n.patientFacility === filters.facilityId)
    : rows;
}

/**
 * For a batch of patient_screening ids, return the set of (screeningId, serviceType)
 * pairs whose ancillary report has been uploaded/approved/completed. Used by the
 * worklist to compute the `reportUploaded` flag on each signature row.
 */
export async function listReportUploadedKeys(
  patientScreeningIds: number[],
  clinicId: number,
): Promise<Set<string>> {
  const keys = new Set<string>();
  if (patientScreeningIds.length === 0) return keys;
  // Screening ids already come from clinic-scoped notes; the clinic guard
  // (tolerating legacy NULL clinic_id for those screenings) keeps a
  // mislabeled cross-clinic readiness row from leaking a flag.
  const rows = await db.execute<{
    patient_screening_id: number;
    service_type: string;
  }>(sql`
    SELECT DISTINCT patient_screening_id, service_type
      FROM case_document_readiness
     WHERE document_type = 'report'
       AND document_status IN ('uploaded', 'approved', 'completed')
       AND (clinic_id = ${clinicId} OR clinic_id IS NULL)
       AND patient_screening_id IN (${sql.join(patientScreeningIds, sql`, `)})
  `);
  for (const r of rows.rows) {
    keys.add(`${r.patient_screening_id}::${r.service_type}`);
  }
  return keys;
}

/**
 * For a batch of patient_screening ids, return the most recent
 * billing_readiness_checks.readiness_status per (screeningId, serviceType).
 * Missing keys mean the note has no billing readiness row yet (treat as
 * "not_ready" at the service layer).
 */
export async function listLatestBillingReadinessStatuses(
  patientScreeningIds: number[],
  clinicId: number,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (patientScreeningIds.length === 0) return out;
  const rows = await db.execute<{
    patient_screening_id: number;
    service_type: string;
    readiness_status: string;
  }>(sql`
    SELECT DISTINCT ON (patient_screening_id, service_type)
           patient_screening_id, service_type, readiness_status
      FROM billing_readiness_checks
     WHERE patient_screening_id IN (${sql.join(patientScreeningIds, sql`, `)})
       AND (clinic_id = ${clinicId} OR clinic_id IS NULL)
     ORDER BY patient_screening_id, service_type, updated_at DESC
  `);
  for (const r of rows.rows) {
    out.set(`${r.patient_screening_id}::${r.service_type}`, r.readiness_status);
  }
  return out;
}

/**
 * Load a single procedure_notes row scoped to the authenticated clinic.
 * Requires BOTH id and clinicId. Returns undefined for both an absent id
 * and an other-clinic id — the caller maps both to the same not-found
 * response, so tenant existence is never disclosed.
 */
export async function getProcedureNoteByIdForClinic(args: {
  id: number;
  clinicId: number;
}): Promise<ProcedureNote | undefined> {
  const [note] = await db
    .select()
    .from(procedureNotes)
    .where(and(eq(procedureNotes.id, args.id), eq(procedureNotes.clinicId, args.clinicId)))
    .limit(1);
  return note;
}
