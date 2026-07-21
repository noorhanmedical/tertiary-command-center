/**
 * Phase 2B — patient_ancillary_cases repository.
 *
 * Every write path here is guarded by FEATURE_ANCILLARY_CASE_WRITE.
 * When the flag is OFF, write helpers throw a well-typed error so
 * calling code never silently skips persistence. Read helpers
 * gracefully handle the case where the migration hasn't been applied
 * (returns null / empty array) so callers can preview safely.
 *
 * The single-file domain-repo convention matches
 * server/repositories/plexusIdentity.repo.ts (introduced Phase 2A) and
 * server/repositories/directMessages.repo.ts.
 */

import { db } from "../db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  patientAncillaryCases,
  ANCILLARY_ACTIVE_LIFECYCLE_STATUSES,
  type AncillaryLifecycleStatus,
  type AncillaryQualificationStatus,
  type AncillaryAdminReviewStatus,
  type PatientAncillaryCase,
} from "@shared/schema/ancillaryCases";
import { featureFlags } from "../lib/featureFlags";

const WRITE_FLAG_OFF_MESSAGE =
  "ancillary_case_write_disabled: enable FEATURE_ANCILLARY_CASE_WRITE after applying migration 0050 (and confirming Phase 2A is applied)";
const PG_UNDEFINED_TABLE = "42P01";
const PG_UNIQUE_VIOLATION = "23505";

function guardWrite(): void {
  if (!featureFlags.ancillaryCaseWrite) {
    const err = new Error(WRITE_FLAG_OFF_MESSAGE) as Error & { code?: string; status?: number };
    err.code = "ANCILLARY_CASE_WRITE_DISABLED";
    err.status = 503;
    throw err;
  }
}

function logSchemaFailure(record: { op: string; code: string; writeFlag: boolean }): void {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({
    level: "error",
    source: "ancillary_cases",
    kind: "schema_configuration_error",
    ...record,
    remediation:
      "Apply migrations/0050_add_patient_ancillary_cases.sql before enabling FEATURE_ANCILLARY_CASE_WRITE.",
  }));
}

/**
 * Read-path helper.
 *   • Flag OFF → swallow 42P01 (preview safe).
 *   • Flag ON  → structured log + re-throw with ANCILLARY_CASE_MIGRATION_MISSING.
 * Prevents "missing migration" from being masked as "no ancillary case found".
 */
async function safeRead<T>(op: () => Promise<T>, fallback: T, opName = "unknown"): Promise<T> {
  try {
    return await op();
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === PG_UNDEFINED_TABLE) {
      if (!featureFlags.ancillaryCaseWrite) return fallback;
      logSchemaFailure({ op: opName, code, writeFlag: true });
      const err = new Error(
        `ancillary_case_migration_missing: table absent (${PG_UNDEFINED_TABLE}) while FEATURE_ANCILLARY_CASE_WRITE is ON (op=${opName})`,
      ) as Error & { code?: string; status?: number };
      err.code = "ANCILLARY_CASE_MIGRATION_MISSING";
      err.status = 503;
      throw err;
    }
    throw e;
  }
}

// ─── Reads ────────────────────────────────────────────────────────
export async function getAncillaryCaseById(
  id: number,
): Promise<PatientAncillaryCase | null> {
  return safeRead(
    async () => {
      const rows = await db
        .select()
        .from(patientAncillaryCases)
        .where(eq(patientAncillaryCases.id, id))
        .limit(1);
      return rows[0] ?? null;
    },
    null,
    "getAncillaryCaseById",
  );
}

export async function listAncillaryCasesForPatient(
  globalPlexusPatientId: number,
): Promise<PatientAncillaryCase[]> {
  return safeRead(
    async () => {
      return db
        .select()
        .from(patientAncillaryCases)
        .where(eq(patientAncillaryCases.globalPlexusPatientId, globalPlexusPatientId))
        .orderBy(desc(patientAncillaryCases.openedAt));
    },
    [] as PatientAncillaryCase[],
    "listAncillaryCasesForPatient",
  );
}

export async function listAncillaryCasesForMembership(
  membershipId: number,
): Promise<PatientAncillaryCase[]> {
  return safeRead(
    async () => {
      return db
        .select()
        .from(patientAncillaryCases)
        .where(eq(patientAncillaryCases.patientClinicMembershipId, membershipId))
        .orderBy(desc(patientAncillaryCases.openedAt));
    },
    [] as PatientAncillaryCase[],
    "listAncillaryCasesForMembership",
  );
}

export async function listAncillaryCasesForScreening(
  screeningId: number,
): Promise<PatientAncillaryCase[]> {
  return safeRead(
    async () => {
      return db
        .select()
        .from(patientAncillaryCases)
        .where(eq(patientAncillaryCases.originatingScreeningId, screeningId))
        .orderBy(desc(patientAncillaryCases.openedAt));
    },
    [] as PatientAncillaryCase[],
    "listAncillaryCasesForScreening",
  );
}

export async function listAncillaryCasesForExecutionCase(
  executionCaseId: number,
): Promise<PatientAncillaryCase[]> {
  return safeRead(
    async () => {
      return db
        .select()
        .from(patientAncillaryCases)
        .where(eq(patientAncillaryCases.executionCaseId, executionCaseId))
        .orderBy(desc(patientAncillaryCases.openedAt));
    },
    [] as PatientAncillaryCase[],
    "listAncillaryCasesForExecutionCase",
  );
}

/**
 * The active-case probe used by reconciliation. Returns the (at most
 * one) active row matching (globalPlexusPatientId, clinicId, serviceType)
 * where lifecycle_status IN ('new','active','on_hold').
 */
export async function findActiveAncillaryCase(args: {
  globalPlexusPatientId: number;
  clinicId: number;
  serviceType: string;
}): Promise<PatientAncillaryCase | null> {
  return safeRead(
    async () => {
      const rows = await db
        .select()
        .from(patientAncillaryCases)
        .where(
          and(
            eq(patientAncillaryCases.globalPlexusPatientId, args.globalPlexusPatientId),
            eq(patientAncillaryCases.clinicId, args.clinicId),
            eq(patientAncillaryCases.serviceType, args.serviceType),
            inArray(
              patientAncillaryCases.lifecycleStatus,
              ANCILLARY_ACTIVE_LIFECYCLE_STATUSES as unknown as string[],
            ),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    null,
    "findActiveAncillaryCase",
  );
}

/**
 * MAX(episode_sequence) + 1 across every historical row for the same
 * (globalPlexusPatientId, clinicId, serviceType) — including active,
 * closed, cancelled, archived. Never resets to 1 for a real
 * re-episode.
 */
export async function computeNextEpisodeSequence(args: {
  globalPlexusPatientId: number;
  clinicId: number;
  serviceType: string;
}): Promise<number> {
  return safeRead(
    async () => {
      const rows = await db
        .select({ max: sql<number>`MAX(${patientAncillaryCases.episodeSequence})` })
        .from(patientAncillaryCases)
        .where(
          and(
            eq(patientAncillaryCases.globalPlexusPatientId, args.globalPlexusPatientId),
            eq(patientAncillaryCases.clinicId, args.clinicId),
            eq(patientAncillaryCases.serviceType, args.serviceType),
          ),
        );
      const currentMax = Number(rows[0]?.max ?? 0);
      return currentMax > 0 ? currentMax + 1 : 1;
    },
    1,
    "computeNextEpisodeSequence",
  );
}

// ─── Writes ───────────────────────────────────────────────────────
export type CreateAncillaryCaseInput = {
  globalPlexusPatientId: number;
  patientClinicMembershipId: number;
  clinicId: number;
  originatingScreeningId?: number | null;
  executionCaseId?: number | null;
  serviceType: string;
  episodeSequence: number;
  lifecycleStatus?: AncillaryLifecycleStatus;
  qualificationStatus?: AncillaryQualificationStatus;
  adminReviewStatus?: AncillaryAdminReviewStatus;
};

export type CreateAncillaryCaseResult =
  | { created: true; row: PatientAncillaryCase }
  | { created: false; conflict: PatientAncillaryCase };

/**
 * Insert. Handles the partial-unique-index race gracefully — if
 * another concurrent transaction won the race, re-reads and returns
 * the winning row instead of duplicating.
 */
export async function createAncillaryCase(
  input: CreateAncillaryCaseInput,
): Promise<CreateAncillaryCaseResult> {
  guardWrite();
  try {
    const [row] = await db
      .insert(patientAncillaryCases)
      .values({
        globalPlexusPatientId: input.globalPlexusPatientId,
        patientClinicMembershipId: input.patientClinicMembershipId,
        clinicId: input.clinicId,
        originatingScreeningId: input.originatingScreeningId ?? null,
        executionCaseId: input.executionCaseId ?? null,
        serviceType: input.serviceType,
        episodeSequence: input.episodeSequence,
        lifecycleStatus: input.lifecycleStatus ?? "new",
        qualificationStatus: input.qualificationStatus ?? "unscreened",
        adminReviewStatus: input.adminReviewStatus ?? "pending",
      })
      .returning();
    return { created: true, row };
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === PG_UNIQUE_VIOLATION) {
      // Race: another transaction just committed the same active row.
      const existing = await findActiveAncillaryCase({
        globalPlexusPatientId: input.globalPlexusPatientId,
        clinicId: input.clinicId,
        serviceType: input.serviceType,
      });
      if (existing) return { created: false, conflict: existing };
    }
    throw e;
  }
}

/** Lifecycle transitions. Each is a small typed update; audit-emit happens at the service layer. */
export async function updateAncillaryCaseLifecycle(
  id: number,
  patch: {
    lifecycleStatus?: AncillaryLifecycleStatus;
    qualificationStatus?: AncillaryQualificationStatus;
    adminReviewStatus?: AncillaryAdminReviewStatus;
    clinicallyCompletedAt?: Date | null;
    financiallyCompletedAt?: Date | null;
    closedAt?: Date | null;
  },
): Promise<PatientAncillaryCase | null> {
  guardWrite();
  const values: Record<string, unknown> = { updatedAt: sql`CURRENT_TIMESTAMP` };
  if (patch.lifecycleStatus !== undefined) values.lifecycleStatus = patch.lifecycleStatus;
  if (patch.qualificationStatus !== undefined) values.qualificationStatus = patch.qualificationStatus;
  if (patch.adminReviewStatus !== undefined) values.adminReviewStatus = patch.adminReviewStatus;
  if (patch.clinicallyCompletedAt !== undefined) values.clinicallyCompletedAt = patch.clinicallyCompletedAt;
  if (patch.financiallyCompletedAt !== undefined) values.financiallyCompletedAt = patch.financiallyCompletedAt;
  if (patch.closedAt !== undefined) values.closedAt = patch.closedAt;

  const [row] = await db
    .update(patientAncillaryCases)
    .set(values)
    .where(eq(patientAncillaryCases.id, id))
    .returning();
  return row ?? null;
}

export async function closeAncillaryCase(id: number): Promise<PatientAncillaryCase | null> {
  return updateAncillaryCaseLifecycle(id, {
    lifecycleStatus: "closed",
    closedAt: new Date(),
  });
}
export async function cancelAncillaryCase(id: number): Promise<PatientAncillaryCase | null> {
  return updateAncillaryCaseLifecycle(id, {
    lifecycleStatus: "cancelled",
    closedAt: new Date(),
  });
}
export async function archiveAncillaryCase(id: number): Promise<PatientAncillaryCase | null> {
  return updateAncillaryCaseLifecycle(id, {
    lifecycleStatus: "archived",
    closedAt: new Date(),
  });
}
export async function placeAncillaryCaseOnHold(id: number): Promise<PatientAncillaryCase | null> {
  return updateAncillaryCaseLifecycle(id, { lifecycleStatus: "on_hold" });
}
/**
 * Reactivate a previously on_hold case. Only permitted when the case
 * is currently on_hold (guarded here to prevent accidental
 * closed→active revival — that is a separate explicit reopening
 * workflow with its own audit trail; not part of Phase 2B).
 */
export async function reactivateOnHoldAncillaryCase(
  id: number,
): Promise<PatientAncillaryCase | null> {
  guardWrite();
  const [row] = await db
    .update(patientAncillaryCases)
    .set({ lifecycleStatus: "active", updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(patientAncillaryCases.id, id),
        eq(patientAncillaryCases.lifecycleStatus, "on_hold"),
      ),
    )
    .returning();
  return row ?? null;
}
