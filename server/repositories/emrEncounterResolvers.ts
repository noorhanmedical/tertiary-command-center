// Resolvers for EMR Encounter ingestion (Batch: EMR roster sync).
//
// Two lookups the FHIR Encounter can't satisfy on its own:
//   1. facility (text) → clinics.id           — tenancy (clinic_id)
//   2. patient subject → patient_directory.id  — canonical patient link
//
// Both are intentionally conservative: they NEVER invent a clinic or a
// patient. An unresolved facility throws (tenancy must be explicit per the
// row-level multi-tenancy rule); an unresolved patient returns null (the
// schedule row is still useful, it just isn't linked to a directory row yet).

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { clinics } from "@shared/schema/clinics";
import { patientDirectory } from "@shared/schema/patientDirectory";
import {
  buildPatientIdentityKeys,
  type PatientIdentityInput,
} from "@shared/patientIdentity";

// ───────────────────────────────────────────────────────────────────────────
// 1. facility → clinic_id
// ───────────────────────────────────────────────────────────────────────────
//
// ECW gives a text facility/practice; tenancy needs the integer clinics.id.
// We resolve via a small explicit map (clinic slug) so a misconfigured
// facility never silently lands under the wrong tenant. For the July 2026
// launch this is a single entry (Taylor Family Practice). As clinics are
// added, extend the map or move it into an app_settings-backed table.

/** facility text (normalized) → clinic slug. Single source for the launch.
 *  Keep keys lowercase; lookups normalize the incoming facility. */
const FACILITY_TO_CLINIC_SLUG: Record<string, string> = {
  // Taylor Family Practice — ECW practice code IIIIAD.
  "taylor family practice": "taylor-family-practice",
  "iiiiad": "taylor-family-practice",
};

function normalizeFacilityKey(value: string | null | undefined): string {
  if (!value) return "";
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

const clinicIdBySlugCache = new Map<string, number>();

/** Resolve a facility text to a clinics.id. Throws when it can't — tenancy
 *  must be explicit. Caches slug→id for the process lifetime. */
export async function resolveClinicIdForFacility(
  facility: string | null | undefined,
): Promise<number> {
  const key = normalizeFacilityKey(facility);
  const slug = FACILITY_TO_CLINIC_SLUG[key];
  if (!slug) {
    throw new Error(
      `Unresolved facility → clinic mapping for "${facility ?? "(null)"}". ` +
        `Add it to FACILITY_TO_CLINIC_SLUG before ingesting this practice.`,
    );
  }

  const cached = clinicIdBySlugCache.get(slug);
  if (cached != null) return cached;

  const [row] = await db
    .select({ id: clinics.id })
    .from(clinics)
    .where(eq(clinics.slug, slug))
    .limit(1);

  if (!row) {
    throw new Error(
      `Clinic slug "${slug}" (facility "${facility}") not found in clinics table. ` +
        `Seed the clinic row first.`,
    );
  }
  clinicIdBySlugCache.set(slug, row.id);
  return row.id;
}

// ───────────────────────────────────────────────────────────────────────────
// 2. patient subject → patient_directory.id
// ───────────────────────────────────────────────────────────────────────────
//
// The Encounter's subject resolves (upstream, via the bulk Patient resource)
// to a name/dob/mrn. We match that against patient_directory using the same
// tiered identity logic the rest of the platform uses (MRN+DOB, then
// name+DOB). Returns null when there's no confident match — the schedule row
// is still written, just unlinked, and a later backfill can attach it.

export type ResolvePatientDirectoryInput = PatientIdentityInput;

/** Resolve a patient identity to patient_directory.id. Returns null when no
 *  confident match exists (caller writes the row unlinked). */
export async function resolvePatientDirectoryId(
  input: ResolvePatientDirectoryInput,
): Promise<number | null> {
  const keys = buildPatientIdentityKeys(input);

  // Tier 1: MRN + DOB (strongest signal we can build from FHIR Patient).
  if (keys.mrnDob && input.mrn && input.dob) {
    const [byMrn] = await db
      .select({ id: patientDirectory.id })
      .from(patientDirectory)
      .where(
        and(
          sql`upper(regexp_replace(${patientDirectory.mrn}, '[^A-Za-z0-9]', '', 'g')) = ${input.mrn.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`,
          eq(patientDirectory.dob, input.dob),
        ),
      )
      .limit(1);
    if (byMrn) return byMrn.id;
  }

  // Tier 2: name + DOB (last-resort; lower confidence). We compare on a
  // normalized first/last + dob. patient_directory stores split names, so we
  // match the concatenation loosely.
  if (input.name && input.dob) {
    const normName = input.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const [byName] = await db
      .select({ id: patientDirectory.id })
      .from(patientDirectory)
      .where(
        and(
          eq(patientDirectory.dob, input.dob),
          sql`lower(trim(${patientDirectory.firstName} || ' ' || ${patientDirectory.lastName})) = ${normName}`,
        ),
      )
      .limit(1);
    if (byName) return byName.id;
  }

  return null;
}
