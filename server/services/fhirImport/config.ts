// FHIR Import Pipeline — clinic-to-group mapping config
//
// Maps ECW bulk export group IDs to Plexus clinic identifiers. This config
// is the single source of truth for which S3 group folder belongs to which
// clinic. The scheduler reads it to know which clinic(s) to poll; the API
// route accepts an ad-hoc groupId that must match a configured mapping
// (or be overridden by explicit clinicId + clinicSlug in the request body).
//
// To add a new clinic:
//   1. Add an entry to DEFAULT_CLINIC_GROUP_MAPPINGS below.
//   2. Set FHIR_CLINIC_MAPPINGS_JSON in the environment to override at
//      runtime without a code deploy (optional).

export type ClinicGroupMapping = {
  /** ECW bulk export group ID (UUID format) */
  groupId: string;
  /** Integer FK to clinics.id */
  clinicId: number;
  /** Text slug stored in patient_directory.clinic_id (tech debt: TEXT column) */
  clinicSlug: string;
  /** Human-readable clinic name used in batch naming */
  clinicName: string;
};

// ─── Default mappings (compile-time) ─────────────────────────────────────

const DEFAULT_CLINIC_GROUP_MAPPINGS: ClinicGroupMapping[] = [
  {
    groupId: "2b9a8d39-aa67-4352-992e-de3d22073e44",
    clinicId: 1,
    clinicSlug: "taylor-family-practice",
    clinicName: "Taylor Family Practice",
  },
];

// ─── Runtime override via environment ────────────────────────────────────

/**
 * Returns the active clinic-group mappings. When FHIR_CLINIC_MAPPINGS_JSON
 * is set, its contents override the compile-time defaults (useful for
 * staging / production config without a code redeploy).
 *
 * Expected env var format:
 * ```json
 * [{"groupId":"...","clinicId":2,"clinicSlug":"...","clinicName":"..."}]
 * ```
 */
export function getClinicGroupMappings(): ClinicGroupMapping[] {
  const raw = process.env.FHIR_CLINIC_MAPPINGS_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as ClinicGroupMapping[];
      }
      console.warn("[fhirImport/config] FHIR_CLINIC_MAPPINGS_JSON parsed but was empty — using defaults");
    } catch (err: any) {
      console.error(
        `[fhirImport/config] Failed to parse FHIR_CLINIC_MAPPINGS_JSON: ${err?.message ?? err} — using defaults`,
      );
    }
  }
  return DEFAULT_CLINIC_GROUP_MAPPINGS;
}

/**
 * Looks up a mapping by groupId. Returns null when the groupId is not
 * configured (the route handler returns 400 in this case).
 */
export function getMappingByGroupId(groupId: string): ClinicGroupMapping | null {
  return getClinicGroupMappings().find((m) => m.groupId === groupId) ?? null;
}

/**
 * Looks up a mapping by clinicId. Returns null when not found.
 */
export function getMappingByClinicId(clinicId: number): ClinicGroupMapping | null {
  return getClinicGroupMappings().find((m) => m.clinicId === clinicId) ?? null;
}

// ─── Scheduler config ─────────────────────────────────────────────────────

/**
 * How often the FHIR import scheduler polls S3 for new exports.
 * Reads FHIR_IMPORT_INTERVAL_HOURS (default 6 hours).
 * The scheduler is only active when FHIR_AUTO_IMPORT_ENABLED=1.
 */
export function getFhirImportIntervalMs(): number {
  const hours = parseFloat(process.env.FHIR_IMPORT_INTERVAL_HOURS ?? "6");
  const parsed = isFinite(hours) && hours > 0 ? hours : 6;
  return Math.round(parsed * 60 * 60 * 1000);
}

export const FHIR_AUTO_IMPORT_ENABLED =
  process.env.FHIR_AUTO_IMPORT_ENABLED === "1";
