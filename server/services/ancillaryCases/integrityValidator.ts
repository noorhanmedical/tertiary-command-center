/**
 * Shared tenant + identity integrity validator for Phase 2B.
 *
 * Every ancillary-case write path — reconciliation, backfill, admin
 * repair — funnels through here BEFORE touching
 * patient_ancillary_cases. Validation refuses:
 *
 *   • membership belongs to a different global patient
 *   • membership belongs to a different clinic
 *   • originating screening belongs to a different clinic
 *   • execution case belongs to a different clinic
 *   • global patient / membership / clinic missing
 *
 * These checks are strictly relational. They do NOT compare
 * demographic values (name / DOB / phone) — Phase 2A identity is the
 * only allowed identity source and it is opaque.
 */

import { db } from "../../db";
import { eq } from "drizzle-orm";
import {
  globalPlexusPatients,
  patientClinicMemberships,
} from "@shared/schema/plexusIdentity";
import { patientScreenings } from "@shared/schema/screening";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { clinics } from "@shared/schema/clinics";

export type IntegrityCheckInput = {
  clinicId: number;
  globalPlexusPatientId: number;
  patientClinicMembershipId: number;
  originatingScreeningId?: number | null;
  executionCaseId?: number | null;
};

export type IntegrityCheckResult =
  | { ok: true }
  | { ok: false; reason: IntegrityFailureReason };

export type IntegrityFailureReason =
  | "clinic_missing"
  | "global_patient_missing"
  | "membership_missing"
  | "membership_belongs_to_different_global_patient"
  | "membership_belongs_to_different_clinic"
  | "originating_screening_missing"
  | "originating_screening_belongs_to_different_clinic"
  | "execution_case_missing"
  | "execution_case_belongs_to_different_clinic";

/**
 * Bounded set of parallel `SELECT ... LIMIT 1` queries. Never mutates.
 * Callers are expected to have already validated non-null ids.
 */
export async function checkAncillaryCaseIntegrity(
  input: IntegrityCheckInput,
): Promise<IntegrityCheckResult> {
  const {
    clinicId,
    globalPlexusPatientId,
    patientClinicMembershipId,
    originatingScreeningId,
    executionCaseId,
  } = input;

  const [clinicRow] = await db
    .select({ id: clinics.id })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicRow) return { ok: false, reason: "clinic_missing" };

  const [globalRow] = await db
    .select({ id: globalPlexusPatients.id })
    .from(globalPlexusPatients)
    .where(eq(globalPlexusPatients.id, globalPlexusPatientId))
    .limit(1);
  if (!globalRow) return { ok: false, reason: "global_patient_missing" };

  const [membershipRow] = await db
    .select({
      id: patientClinicMemberships.id,
      clinicId: patientClinicMemberships.clinicId,
      globalPlexusPatientId: patientClinicMemberships.globalPlexusPatientId,
    })
    .from(patientClinicMemberships)
    .where(eq(patientClinicMemberships.id, patientClinicMembershipId))
    .limit(1);
  if (!membershipRow) return { ok: false, reason: "membership_missing" };
  if (membershipRow.globalPlexusPatientId !== globalPlexusPatientId) {
    return {
      ok: false,
      reason: "membership_belongs_to_different_global_patient",
    };
  }
  if (membershipRow.clinicId !== clinicId) {
    return {
      ok: false,
      reason: "membership_belongs_to_different_clinic",
    };
  }

  if (originatingScreeningId != null) {
    const [scr] = await db
      .select({ id: patientScreenings.id, clinicId: patientScreenings.clinicId })
      .from(patientScreenings)
      .where(eq(patientScreenings.id, originatingScreeningId))
      .limit(1);
    if (!scr) return { ok: false, reason: "originating_screening_missing" };
    if (scr.clinicId != null && scr.clinicId !== clinicId) {
      return {
        ok: false,
        reason: "originating_screening_belongs_to_different_clinic",
      };
    }
  }

  if (executionCaseId != null) {
    const [ec] = await db
      .select({ id: patientExecutionCases.id, clinicId: patientExecutionCases.clinicId })
      .from(patientExecutionCases)
      .where(eq(patientExecutionCases.id, executionCaseId))
      .limit(1);
    if (!ec) return { ok: false, reason: "execution_case_missing" };
    if (ec.clinicId != null && ec.clinicId !== clinicId) {
      return {
        ok: false,
        reason: "execution_case_belongs_to_different_clinic",
      };
    }
  }

  return { ok: true };
}
