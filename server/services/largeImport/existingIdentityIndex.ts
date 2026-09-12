// DB-backed loader for the existing-patient identity index used by dedup.
// Kept separate from the pure classifier so classification logic stays
// unit-testable without a database connection.

import { db } from "../../db";
import { patientScreenings } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  buildPatientIdentityIndex,
  type PatientIdentityIndex,
} from "@shared/patientIdentity";
import { identityInputOfExisting, type ExistingPatientRef } from "./dedupClassifier";

/**
 * Load the existing-patient identity index for a clinic (or global when
 * clinicId is null, e.g. admin). ONE query for the base rows + ONE for MRNs,
 * then an in-memory index — no N+1. Soft-deleted rows excluded. `mrn` is read
 * defensively (column exists via migration 0026 but may be absent on very old
 * databases).
 */
export async function loadExistingIdentityIndex(
  clinicId: number | null,
): Promise<PatientIdentityIndex<ExistingPatientRef>> {
  const conds = [isNull(patientScreenings.deletedAt)];
  if (clinicId != null) conds.push(eq(patientScreenings.clinicId, clinicId));

  const rows = await db
    .select({
      id: patientScreenings.id,
      name: patientScreenings.name,
      dob: patientScreenings.dob,
      mrn: patientScreenings.mrn,
      facility: patientScreenings.facility,
      phone: patientScreenings.phoneNumber,
    })
    .from(patientScreenings)
    .where(and(...conds));

  const refs: ExistingPatientRef[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    dob: r.dob ?? null,
    mrn: (r as { mrn?: string | null }).mrn ?? null,
    facility: r.facility ?? null,
    phone: r.phone ?? null,
  }));

  return buildPatientIdentityIndex(refs, identityInputOfExisting);
}

// Re-export so callers importing from the loader get a single surface.
export { classifyRows, tallyClassifications } from "./dedupClassifier";
export type { ClassifiedRow, ExistingPatientRef, RowClassification } from "./dedupClassifier";
