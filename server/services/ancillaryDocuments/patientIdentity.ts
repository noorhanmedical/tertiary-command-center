import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { patientScreenings } from "@shared/schema/screening";
import { patientClinicMemberships, globalPlexusPatients } from "@shared/schema/plexusIdentity";
import { projectDocumentPatientIdentity, type DocumentPatientIdentity } from "@shared/documentPatientIdentity";

/** Follow existing foreign keys only. Never resolves names, creates patients,
 * follows a merge without a verified clinic membership, or mutates documents. */
type ScreeningDocumentIdentity = {
  clinicId: number | null;
  batchId: number;
  globalPatientId: number | null;
  membershipId: number | null;
  identity: DocumentPatientIdentity;
};

export async function readDocumentPatientIdentities(
  screeningIds: number[], clinicId?: number,
): Promise<Map<number, ScreeningDocumentIdentity>> {
  if (!screeningIds.length) return new Map();
  const rows = await db.select({
    screeningId: patientScreenings.id,
    screeningMrn: patientScreenings.mrn,
    screeningDob: patientScreenings.dob,
    clinicId: patientScreenings.clinicId,
    batchId: patientScreenings.batchId,
    globalPatientId: patientScreenings.globalPlexusPatientId,
    membershipId: patientScreenings.patientClinicMembershipId,
    membership: {
      clinicId: patientClinicMemberships.clinicId,
      globalPlexusPatientId: patientClinicMemberships.globalPlexusPatientId,
      membershipStatus: patientClinicMemberships.membershipStatus,
      clinicMrn: patientClinicMemberships.clinicMrn,
    },
    patient: {
      id: globalPlexusPatients.id,
      dob: globalPlexusPatients.dob,
      plexusId: globalPlexusPatients.plexusId,
      identityStatus: globalPlexusPatients.identityStatus,
    },
  }).from(patientScreenings)
    .leftJoin(patientClinicMemberships, eq(patientScreenings.patientClinicMembershipId, patientClinicMemberships.id))
    .leftJoin(globalPlexusPatients, eq(patientClinicMemberships.globalPlexusPatientId, globalPlexusPatients.id))
    .where(and(inArray(patientScreenings.id, screeningIds),
      clinicId == null ? undefined : eq(patientScreenings.clinicId, clinicId)));
  return new Map(rows.filter(row => screeningIds.includes(row.screeningId) && (clinicId == null || row.clinicId === clinicId)).map(row => [row.screeningId, {
    clinicId: row.clinicId, batchId: row.batchId,
    globalPatientId: row.globalPatientId, membershipId: row.membershipId,
    identity: projectDocumentPatientIdentity(row),
  }]));
}
