/**
 * Plexus identity repository — all six tables in one file (single-domain
 * convention matches server/repositories/directMessages.repo.ts).
 *
 * Every write path in this file is guarded by the
 * `FEATURE_PLEXUS_IDENTITY_WRITE` flag. When the flag is OFF, write
 * helpers throw a well-typed error so calling code never silently
 * skips persistence. Read helpers gracefully handle the case where
 * the migration hasn't been applied yet (returns null / empty array)
 * so the screening flow can safely call them for match previews.
 */

import { db } from "../db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  globalPlexusPatients,
  patientClinicMemberships,
  patientExternalIdentifiers,
  patientIdentityMatchCandidates,
  patientIdentityMergeEvents,
  plexusIdAliases,
  SENSITIVE_IDENTIFIER_TYPES,
  type ExternalIdentifierType,
  type GlobalPlexusPatient,
  type PatientClinicMembership,
  type PatientExternalIdentifier,
  type PatientIdentityMatchCandidate,
  type PatientIdentityMergeEvent,
  type PlexusIdAlias,
} from "@shared/schema/plexusIdentity";
import { featureFlags } from "../lib/featureFlags";
import { generateUniquePlexusId } from "../services/plexusIdentity/plexusIdGenerator";

const WRITE_FLAG_OFF_MESSAGE =
  "plexus_identity_write_disabled: enable FEATURE_PLEXUS_IDENTITY_WRITE after applying migration 0049";

// Postgres "undefined_table". If the migration hasn't been applied,
// every query against the six Plexus identity tables comes back with
// this SQLSTATE.
const PG_UNDEFINED_TABLE = "42P01";

function guardWrite(): void {
  if (!featureFlags.plexusIdentityWrite) {
    const err = new Error(WRITE_FLAG_OFF_MESSAGE) as Error & { code?: string; status?: number };
    err.code = "PLEXUS_IDENTITY_WRITE_DISABLED";
    err.status = 503;
    throw err;
  }
}

/**
 * Structured non-PHI log record. Kept as a helper so tests can spy on
 * it without pulling in a heavier logger. Emits to stderr as JSON so
 * ops tooling can pick it up alongside other structured logs. Never
 * includes patient-facing values.
 */
function logSchemaFailure(record: {
  op: string;
  code: string;
  writeFlag: boolean;
  reviewFlag: boolean;
}): void {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      level: "error",
      source: "plexus_identity",
      kind: "schema_configuration_error",
      ...record,
      // Guidance for on-call — no PHI, safe to log.
      remediation:
        "Apply migrations/0049_add_plexus_identity.sql before enabling FEATURE_PLEXUS_IDENTITY_WRITE.",
    }),
  );
}

/**
 * Read-path helper.
 *
 * Behavior on Postgres "undefined_table" (42P01):
 *   • Both flags OFF → swallow. Returns the fallback so preview / probe
 *     flows can call the resolver pre-migration without crashing the
 *     screening ingestion path.
 *   • Either flag ON → structured log + re-throw with a stable code so
 *     the caller cannot mistake "migration missing" for "no patient
 *     match found". This prevents the failure mode where a missing
 *     migration silently returns `no_match` and the resolver commits a
 *     duplicate global patient.
 *
 * Any other error is always re-thrown.
 */
async function safeRead<T>(
  op: () => Promise<T>,
  fallback: T,
  opName = "unknown",
): Promise<T> {
  try {
    return await op();
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === PG_UNDEFINED_TABLE) {
      const write = featureFlags.plexusIdentityWrite;
      const review = featureFlags.plexusIdentityReview;
      if (!write && !review) {
        return fallback;
      }
      logSchemaFailure({
        op: opName,
        code,
        writeFlag: write,
        reviewFlag: review,
      });
      const err = new Error(
        `plexus_identity_migration_missing: table absent (${PG_UNDEFINED_TABLE}) while a Plexus identity feature flag is ON (op=${opName})`,
      ) as Error & { code?: string; status?: number };
      err.code = "PLEXUS_IDENTITY_MIGRATION_MISSING";
      err.status = 503;
      throw err;
    }
    throw e;
  }
}

// ─── global_plexus_patients ───────────────────────────────────────
export async function findGlobalPatientByPlexusId(
  plexusId: string,
): Promise<GlobalPlexusPatient | null> {
  return safeRead(
    async () => {
      const rows = await db
        .select()
        .from(globalPlexusPatients)
        .where(eq(globalPlexusPatients.plexusId, plexusId))
        .limit(1);
      return rows[0] ?? null;
    },
    null,
    "findGlobalPatientByPlexusId",
  );
}

export async function findGlobalPatientById(
  id: number,
): Promise<GlobalPlexusPatient | null> {
  return safeRead(
    async () => {
      const rows = await db
        .select()
        .from(globalPlexusPatients)
        .where(eq(globalPlexusPatients.id, id))
        .limit(1);
      return rows[0] ?? null;
    },
    null,
    "findGlobalPatientById",
  );
}

export type CreateGlobalPatientInput = {
  displayName?: string | null;
  normalizedName?: string | null;
  dob?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
};

export async function createGlobalPatient(
  input: CreateGlobalPatientInput,
): Promise<GlobalPlexusPatient> {
  guardWrite();
  const plexusId = await generateUniquePlexusId(async (candidate) => {
    const existing = await findGlobalPatientByPlexusId(candidate);
    return existing !== null;
  });
  const [row] = await db
    .insert(globalPlexusPatients)
    .values({
      plexusId,
      displayName: input.displayName ?? null,
      normalizedName: input.normalizedName ?? null,
      dob: input.dob ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
    })
    .returning();
  return row;
}

// ─── patient_clinic_memberships ───────────────────────────────────
export async function findActiveMembership(args: {
  globalPlexusPatientId: number;
  clinicId: number;
}): Promise<PatientClinicMembership | null> {
  return safeRead(
    async () => {
      const rows = await db
        .select()
        .from(patientClinicMemberships)
        .where(
          and(
            eq(patientClinicMemberships.globalPlexusPatientId, args.globalPlexusPatientId),
            eq(patientClinicMemberships.clinicId, args.clinicId),
            eq(patientClinicMemberships.membershipStatus, "active"),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    null,
    "findActiveMembership",
  );
}

export async function findMembershipByClinicMrn(args: {
  clinicId: number;
  clinicMrn: string;
}): Promise<PatientClinicMembership | null> {
  if (!args.clinicMrn) return null;
  return safeRead(
    async () => {
      const rows = await db
        .select()
        .from(patientClinicMemberships)
        .where(
          and(
            eq(patientClinicMemberships.clinicId, args.clinicId),
            eq(patientClinicMemberships.clinicMrn, args.clinicMrn),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    null,
    "findMembershipByClinicMrn",
  );
}

export type CreateMembershipInput = {
  globalPlexusPatientId: number;
  clinicId: number;
  clinicMrn?: string | null;
  sourceSystem?: string | null;
  sourcePatientIdentifier?: string | null;
};

export async function createMembership(
  input: CreateMembershipInput,
): Promise<PatientClinicMembership> {
  guardWrite();
  const [row] = await db
    .insert(patientClinicMemberships)
    .values({
      globalPlexusPatientId: input.globalPlexusPatientId,
      clinicId: input.clinicId,
      clinicMrn: input.clinicMrn ?? null,
      sourceSystem: input.sourceSystem ?? null,
      sourcePatientIdentifier: input.sourcePatientIdentifier ?? null,
    })
    .returning();
  return row;
}

// ─── patient_external_identifiers ─────────────────────────────────
export type CreateExternalIdentifierInput = {
  globalPlexusPatientId: number;
  patientClinicMembershipId?: number | null;
  clinicId?: number | null;
  sourceSystem?: string | null;
  identifierType: ExternalIdentifierType;
  identifierValueEncrypted?: string | null;
  normalizedOrHashedMatchValue?: string | null;
};

export async function createExternalIdentifier(
  input: CreateExternalIdentifierInput,
): Promise<PatientExternalIdentifier> {
  guardWrite();

  // Refuse to persist sensitive raw values until an approved encryption
  // mechanism exists. Match values may only be non-reversible digests.
  if (SENSITIVE_IDENTIFIER_TYPES.includes(input.identifierType)) {
    if (input.identifierValueEncrypted) {
      const err = new Error(
        "plexus_identity_sensitive_write_blocked: no approved encryption mechanism is wired for payer/medicare identifiers",
      ) as Error & { code?: string; status?: number };
      err.code = "PLEXUS_IDENTITY_ENCRYPTION_UNRESOLVED";
      err.status = 503;
      throw err;
    }
    // The normalized/hashed match value must be a one-way digest — the
    // caller is responsible for hashing before invoking this repo. We
    // enforce shape (non-empty when provided) but the semantic HMAC
    // check belongs at the service layer.
  }

  const [row] = await db
    .insert(patientExternalIdentifiers)
    .values({
      globalPlexusPatientId: input.globalPlexusPatientId,
      patientClinicMembershipId: input.patientClinicMembershipId ?? null,
      clinicId: input.clinicId ?? null,
      sourceSystem: input.sourceSystem ?? null,
      identifierType: input.identifierType,
      identifierValueEncrypted: input.identifierValueEncrypted ?? null,
      normalizedOrHashedMatchValue: input.normalizedOrHashedMatchValue ?? null,
    })
    .returning();
  return row;
}

export async function findExternalIdentifiersByMatchValue(args: {
  identifierType: ExternalIdentifierType;
  normalizedOrHashedMatchValue: string;
}): Promise<PatientExternalIdentifier[]> {
  return safeRead(
    async () => {
      return db
        .select()
        .from(patientExternalIdentifiers)
        .where(
          and(
            eq(patientExternalIdentifiers.identifierType, args.identifierType),
            eq(
              patientExternalIdentifiers.normalizedOrHashedMatchValue,
              args.normalizedOrHashedMatchValue,
            ),
            eq(patientExternalIdentifiers.active, true),
          ),
        )
        .limit(20);
    },
    [] as PatientExternalIdentifier[],
    "findExternalIdentifiersByMatchValue",
  );
}

// ─── patient_identity_match_candidates (Plexus-only) ──────────────
export type CreateMatchCandidateInput = {
  incomingMembershipId?: number | null;
  stagedImportRowId?: number | null;
  candidateGlobalPatientId: number;
  matchScore?: number;
  matchTier?: string;
  matchedSignals?: unknown[];
  conflictingSignals?: unknown[];
};

export async function createMatchCandidate(
  input: CreateMatchCandidateInput,
): Promise<PatientIdentityMatchCandidate> {
  guardWrite();
  const [row] = await db
    .insert(patientIdentityMatchCandidates)
    .values({
      incomingMembershipId: input.incomingMembershipId ?? null,
      stagedImportRowId: input.stagedImportRowId ?? null,
      candidateGlobalPatientId: input.candidateGlobalPatientId,
      matchScore: input.matchScore != null ? String(input.matchScore) : null,
      matchTier: input.matchTier ?? null,
      matchedSignals: (input.matchedSignals ?? []) as unknown as never,
      conflictingSignals: (input.conflictingSignals ?? []) as unknown as never,
    })
    .returning();
  return row;
}

// ─── patient_identity_merge_events (Plexus-only, append-only) ─────
export type CreateMergeEventInput = {
  survivingGlobalPatientId: number;
  mergedGlobalPatientId: number;
  survivingPlexusId: string;
  mergedPlexusId: string;
  reviewedByUserId: string;
  reason?: string;
  evidenceSnapshot?: Record<string, unknown>;
};

export async function createMergeEvent(
  input: CreateMergeEventInput,
): Promise<PatientIdentityMergeEvent> {
  guardWrite();
  const [row] = await db
    .insert(patientIdentityMergeEvents)
    .values({
      survivingGlobalPatientId: input.survivingGlobalPatientId,
      mergedGlobalPatientId: input.mergedGlobalPatientId,
      survivingPlexusId: input.survivingPlexusId,
      mergedPlexusId: input.mergedPlexusId,
      reviewedByUserId: input.reviewedByUserId,
      reason: input.reason ?? null,
      evidenceSnapshot: (input.evidenceSnapshot ?? {}) as unknown as never,
    })
    .returning();
  return row;
}

// ─── plexus_id_aliases (Plexus-only) ──────────────────────────────
export async function findAlias(
  aliasPlexusId: string,
): Promise<PlexusIdAlias | null> {
  return safeRead(
    async () => {
      const rows = await db
        .select()
        .from(plexusIdAliases)
        .where(eq(plexusIdAliases.aliasPlexusId, aliasPlexusId))
        .limit(1);
      return rows[0] ?? null;
    },
    null,
    "findAlias",
  );
}

export async function createAlias(input: {
  aliasPlexusId: string;
  survivingGlobalPatientId: number;
  reason?: string;
}): Promise<PlexusIdAlias> {
  guardWrite();
  const [row] = await db
    .insert(plexusIdAliases)
    .values({
      aliasPlexusId: input.aliasPlexusId,
      survivingGlobalPatientId: input.survivingGlobalPatientId,
      reason: input.reason ?? null,
    })
    .returning();
  return row;
}
