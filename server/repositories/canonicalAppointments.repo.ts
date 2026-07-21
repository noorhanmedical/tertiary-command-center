/**
 * Phase 2D — canonical ancillary appointment repository.
 *
 * The canonical source is `global_schedule_events` extended with the
 * columns added in migration 0052 (ancillary_case_id, parent_event_id,
 * cancellation_reason, no_show_reason). The partial-unique index
 * `uq_gse_active_ancillary_appointment` enforces one active scheduled
 * canonical ancillary appointment per case.
 *
 * Every write is guarded by FEATURE_CANONICAL_APPOINTMENT. Reads are
 * safe when the migration is absent AND the flag is OFF (returns
 * empty/null); reads throw a structured error when the flag is ON but
 * the migration is missing so a legacy fallback cannot silently mask
 * as "no canonical event found".
 */

import { db } from "../db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { globalScheduleEvents } from "@shared/schema/globalSchedule";
import type { GlobalScheduleEvent } from "@shared/schema/globalSchedule";
import {
  canonicalAppointmentReconciliationFailures,
  CANONICAL_ANCILLARY_EVENT_TYPES,
  CANONICAL_APPOINTMENT_FAILURE_ACTIONS,
  ORDER_NOTE_QUALIFYING_STATUSES,
  type CanonicalAncillaryEventType,
  type CanonicalAppointmentFailureAction,
  type CanonicalAppointmentReconciliationFailure,
  type CanonicalAppointmentStatus,
} from "@shared/schema/canonicalAppointments";
import { featureFlags } from "../lib/featureFlags";

const PG_UNDEFINED_TABLE = "42P01";
const PG_UNIQUE_VIOLATION = "23505";
const PG_UNDEFINED_COLUMN = "42703";

function guardWrite(): void {
  if (!featureFlags.canonicalAppointment) {
    const err = new Error(
      "canonical_appointment_write_disabled: enable FEATURE_CANONICAL_APPOINTMENT after applying migration 0052",
    ) as Error & { code?: string; status?: number };
    err.code = "CANONICAL_APPOINTMENT_WRITE_DISABLED";
    err.status = 503;
    throw err;
  }
}

async function safeRead<T>(op: () => Promise<T>, fallback: T, opName = "unknown"): Promise<T> {
  try {
    return await op();
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === PG_UNDEFINED_TABLE || code === PG_UNDEFINED_COLUMN) {
      if (!featureFlags.canonicalAppointment) return fallback;
      const err = new Error(
        `canonical_appointment_migration_missing: schema element absent (${code}) while FEATURE_CANONICAL_APPOINTMENT is ON (op=${opName})`,
      ) as Error & { code?: string; status?: number };
      err.code = "CANONICAL_APPOINTMENT_MIGRATION_MISSING";
      err.status = 503;
      throw err;
    }
    throw e;
  }
}

// ─── Reads ────────────────────────────────────────────────────────
export async function getCanonicalAppointmentById(
  id: number,
): Promise<GlobalScheduleEvent | null> {
  return safeRead(async () => {
    const rows = await db
      .select()
      .from(globalScheduleEvents)
      .where(eq(globalScheduleEvents.id, id))
      .limit(1);
    return rows[0] ?? null;
  }, null, "getCanonicalAppointmentById");
}

/**
 * The ACTIVE canonical ancillary appointment for one case, or null.
 * Only 'scheduled' canonical events with a matching ancillary_case_id
 * qualify — doctor_visit is excluded by construction; cancelled /
 * no_show / rescheduled / completed do not qualify as "active".
 */
export async function getActiveCanonicalAppointmentForAncillaryCase(
  ancillaryCaseId: number,
): Promise<GlobalScheduleEvent | null> {
  return safeRead(async () => {
    const rows = await db
      .select()
      .from(globalScheduleEvents)
      .where(
        and(
          eq(globalScheduleEvents.ancillaryCaseId, ancillaryCaseId),
          eq(globalScheduleEvents.status, "scheduled"),
          inArray(
            globalScheduleEvents.eventType,
            CANONICAL_ANCILLARY_EVENT_TYPES as unknown as string[],
          ),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }, null, "getActiveCanonicalAppointmentForAncillaryCase");
}

/** All canonical events for one case (any status), newest first. */
export async function listCanonicalAppointmentsForAncillaryCase(
  ancillaryCaseId: number,
): Promise<GlobalScheduleEvent[]> {
  return safeRead(async () => {
    return db
      .select()
      .from(globalScheduleEvents)
      .where(
        and(
          eq(globalScheduleEvents.ancillaryCaseId, ancillaryCaseId),
          inArray(
            globalScheduleEvents.eventType,
            CANONICAL_ANCILLARY_EVENT_TYPES as unknown as string[],
          ),
        ),
      )
      .orderBy(desc(globalScheduleEvents.startsAt));
  }, [] as GlobalScheduleEvent[], "listCanonicalAppointmentsForAncillaryCase");
}

export async function listCanonicalAppointmentsForScreening(
  screeningId: number,
): Promise<GlobalScheduleEvent[]> {
  return safeRead(async () => {
    return db
      .select()
      .from(globalScheduleEvents)
      .where(
        and(
          eq(globalScheduleEvents.patientScreeningId, screeningId),
          inArray(
            globalScheduleEvents.eventType,
            CANONICAL_ANCILLARY_EVENT_TYPES as unknown as string[],
          ),
        ),
      )
      .orderBy(desc(globalScheduleEvents.startsAt));
  }, [] as GlobalScheduleEvent[], "listCanonicalAppointmentsForScreening");
}

export async function listCanonicalAppointmentsForExecutionCase(
  executionCaseId: number,
): Promise<GlobalScheduleEvent[]> {
  return safeRead(async () => {
    return db
      .select()
      .from(globalScheduleEvents)
      .where(
        and(
          eq(globalScheduleEvents.executionCaseId, executionCaseId),
          inArray(
            globalScheduleEvents.eventType,
            CANONICAL_ANCILLARY_EVENT_TYPES as unknown as string[],
          ),
        ),
      )
      .orderBy(desc(globalScheduleEvents.startsAt));
  }, [] as GlobalScheduleEvent[], "listCanonicalAppointmentsForExecutionCase");
}

export async function listCanonicalAppointmentsForClinic(args: {
  clinicId: number;
  limit?: number;
}): Promise<GlobalScheduleEvent[]> {
  const limit = Math.min(Math.max(1, args.limit ?? 200), 1000);
  return safeRead(async () => {
    return db
      .select()
      .from(globalScheduleEvents)
      .where(
        and(
          eq(globalScheduleEvents.clinicId, args.clinicId),
          inArray(
            globalScheduleEvents.eventType,
            CANONICAL_ANCILLARY_EVENT_TYPES as unknown as string[],
          ),
        ),
      )
      .orderBy(desc(globalScheduleEvents.startsAt))
      .limit(limit);
  }, [] as GlobalScheduleEvent[], "listCanonicalAppointmentsForClinic");
}

// ─── Writes ───────────────────────────────────────────────────────
export type CreateCanonicalEventInput = {
  clinicId: number;
  ancillaryCaseId: number;
  eventType: CanonicalAncillaryEventType;
  startsAt: Date;
  endsAt?: Date | null;
  serviceType: string;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  assignedUserId?: string | null;
  assignedRole?: string | null;
  roomId?: string | null;
  equipmentId?: string | null;
  source: string;
  metadata?: Record<string, unknown>;
};

export type CreateCanonicalEventResult =
  | { created: true; row: GlobalScheduleEvent }
  | { created: false; conflict: GlobalScheduleEvent };

/**
 * Insert a new canonical scheduled ancillary event. If the partial-
 * unique index races, re-reads and returns the existing row.
 */
export async function createCanonicalEvent(
  input: CreateCanonicalEventInput,
): Promise<CreateCanonicalEventResult> {
  guardWrite();
  try {
    const [row] = await db
      .insert(globalScheduleEvents)
      .values({
        clinicId: input.clinicId,
        ancillaryCaseId: input.ancillaryCaseId,
        eventType: input.eventType,
        serviceType: input.serviceType,
        source: input.source,
        status: "scheduled",
        startsAt: input.startsAt,
        endsAt: input.endsAt ?? null,
        patientScreeningId: input.patientScreeningId ?? null,
        executionCaseId: input.executionCaseId ?? null,
        patientName: input.patientName ?? null,
        patientDob: input.patientDob ?? null,
        facilityId: input.facilityId ?? null,
        assignedUserId: input.assignedUserId ?? null,
        assignedRole: input.assignedRole ?? null,
        roomId: input.roomId ?? null,
        equipmentId: input.equipmentId ?? null,
        metadata: (input.metadata ?? {}) as unknown as never,
      })
      .returning();
    return { created: true, row };
  } catch (e: unknown) {
    if ((e as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      const existing = await getActiveCanonicalAppointmentForAncillaryCase(
        input.ancillaryCaseId,
      );
      if (existing) return { created: false, conflict: existing };
    }
    throw e;
  }
}

/** Row-level status transition. Callers are responsible for the transition rules. */
export async function transitionCanonicalEvent(
  id: number,
  patch: {
    status: CanonicalAppointmentStatus;
    cancellationReason?: string | null;
    noShowReason?: string | null;
    startsAt?: Date;
    endsAt?: Date | null;
  },
): Promise<GlobalScheduleEvent | null> {
  guardWrite();
  const values: Record<string, unknown> = {
    status: patch.status,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  };
  if (patch.cancellationReason !== undefined) {
    values.cancellationReason = patch.cancellationReason;
  }
  if (patch.noShowReason !== undefined) {
    values.noShowReason = patch.noShowReason;
  }
  if (patch.startsAt !== undefined) values.startsAt = patch.startsAt;
  if (patch.endsAt !== undefined) values.endsAt = patch.endsAt;
  const [row] = await db
    .update(globalScheduleEvents)
    .set(values)
    .where(eq(globalScheduleEvents.id, id))
    .returning();
  return row ?? null;
}

/**
 * Reschedule: mark prior 'rescheduled' + insert new scheduled event.
 * The prior event is preserved permanently. parent_event_id on the
 * new event points back for lineage.
 */
export async function rescheduleCanonicalEvent(args: {
  priorEventId: number;
  input: CreateCanonicalEventInput;
}): Promise<{
  prior: GlobalScheduleEvent | null;
  next: CreateCanonicalEventResult;
}> {
  guardWrite();
  return db.transaction(async () => {
    // 1. Mark prior as rescheduled.
    const [prior] = await db
      .update(globalScheduleEvents)
      .set({ status: "rescheduled", updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(globalScheduleEvents.id, args.priorEventId))
      .returning();
    // 2. Insert new event with parent lineage.
    // Note: parent_event_id is server-owned; we bypass the omit'd
    // insertSchema by writing directly.
    try {
      const [row] = await db
        .insert(globalScheduleEvents)
        .values({
          clinicId: args.input.clinicId,
          ancillaryCaseId: args.input.ancillaryCaseId,
          eventType: args.input.eventType,
          serviceType: args.input.serviceType,
          source: args.input.source,
          status: "scheduled",
          startsAt: args.input.startsAt,
          endsAt: args.input.endsAt ?? null,
          patientScreeningId: args.input.patientScreeningId ?? null,
          executionCaseId: args.input.executionCaseId ?? null,
          patientName: args.input.patientName ?? null,
          patientDob: args.input.patientDob ?? null,
          facilityId: args.input.facilityId ?? null,
          assignedUserId: args.input.assignedUserId ?? null,
          assignedRole: args.input.assignedRole ?? null,
          roomId: args.input.roomId ?? null,
          equipmentId: args.input.equipmentId ?? null,
          metadata: (args.input.metadata ?? {}) as unknown as never,
          parentEventId: args.priorEventId,
        })
        .returning();
      return { prior: prior ?? null, next: { created: true, row } };
    } catch (e: unknown) {
      if ((e as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        const existing = await getActiveCanonicalAppointmentForAncillaryCase(
          args.input.ancillaryCaseId,
        );
        if (existing) return { prior: prior ?? null, next: { created: false, conflict: existing } };
      }
      throw e;
    }
  });
}

// ─── Retry ledger ─────────────────────────────────────────────────
export type RecordCanonicalAppointmentFailureInput = {
  clinicId: number;
  ancillaryCaseId?: number | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  provisionalEventId?: number | null;
  requestedAction: CanonicalAppointmentFailureAction;
  sourceSystem?: string | null;
  errorCode?: string | null;
};

export async function recordCanonicalAppointmentFailure(
  input: RecordCanonicalAppointmentFailureInput,
): Promise<CanonicalAppointmentReconciliationFailure> {
  if (!(CANONICAL_APPOINTMENT_FAILURE_ACTIONS as readonly string[]).includes(input.requestedAction)) {
    throw new Error(`invalid requestedAction: ${input.requestedAction}`);
  }
  const dedupeConds = [
    eq(canonicalAppointmentReconciliationFailures.requestedAction, input.requestedAction),
    isNull(canonicalAppointmentReconciliationFailures.resolvedAt),
  ];
  if (input.ancillaryCaseId != null) {
    dedupeConds.push(
      eq(canonicalAppointmentReconciliationFailures.ancillaryCaseId, input.ancillaryCaseId),
    );
  } else if (input.executionCaseId != null) {
    dedupeConds.push(
      eq(canonicalAppointmentReconciliationFailures.executionCaseId, input.executionCaseId),
    );
    dedupeConds.push(isNull(canonicalAppointmentReconciliationFailures.ancillaryCaseId));
  }
  const existing = await db
    .select()
    .from(canonicalAppointmentReconciliationFailures)
    .where(and(...dedupeConds))
    .limit(1);
  if (existing[0]) {
    const [updated] = await db
      .update(canonicalAppointmentReconciliationFailures)
      .set({
        attemptCount: (existing[0].attemptCount ?? 0) + 1,
        lastAttemptedAt: sql`CURRENT_TIMESTAMP`,
        errorCode: input.errorCode ?? existing[0].errorCode,
        sourceSystem: input.sourceSystem ?? existing[0].sourceSystem,
      })
      .where(eq(canonicalAppointmentReconciliationFailures.id, existing[0].id))
      .returning();
    return updated;
  }
  const [inserted] = await db
    .insert(canonicalAppointmentReconciliationFailures)
    .values({
      clinicId: input.clinicId,
      ancillaryCaseId: input.ancillaryCaseId ?? null,
      patientScreeningId: input.patientScreeningId ?? null,
      executionCaseId: input.executionCaseId ?? null,
      provisionalEventId: input.provisionalEventId ?? null,
      requestedAction: input.requestedAction,
      sourceSystem: input.sourceSystem ?? null,
      errorCode: input.errorCode ?? null,
      attemptCount: 1,
    })
    .returning();
  return inserted;
}

export async function resolveCanonicalAppointmentFailure(args: {
  ancillaryCaseId?: number | null;
  executionCaseId?: number | null;
  requestedAction?: CanonicalAppointmentFailureAction;
}): Promise<void> {
  const conds = [isNull(canonicalAppointmentReconciliationFailures.resolvedAt)];
  if (args.ancillaryCaseId != null) {
    conds.push(eq(canonicalAppointmentReconciliationFailures.ancillaryCaseId, args.ancillaryCaseId));
  } else if (args.executionCaseId != null) {
    conds.push(eq(canonicalAppointmentReconciliationFailures.executionCaseId, args.executionCaseId));
  }
  if (args.requestedAction) {
    conds.push(eq(canonicalAppointmentReconciliationFailures.requestedAction, args.requestedAction));
  }
  await db
    .update(canonicalAppointmentReconciliationFailures)
    .set({ resolvedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(...conds));
}

export async function listUnresolvedCanonicalAppointmentFailures(args?: {
  clinicId?: number;
  limit?: number;
}): Promise<CanonicalAppointmentReconciliationFailure[]> {
  const limit = Math.min(Math.max(1, args?.limit ?? 100), 500);
  return safeRead(async () => {
    const conds = [isNull(canonicalAppointmentReconciliationFailures.resolvedAt)];
    if (args?.clinicId != null) {
      conds.push(eq(canonicalAppointmentReconciliationFailures.clinicId, args.clinicId));
    }
    return db
      .select()
      .from(canonicalAppointmentReconciliationFailures)
      .where(and(...conds))
      .orderBy(canonicalAppointmentReconciliationFailures.firstFailedAt)
      .limit(limit);
  }, [] as CanonicalAppointmentReconciliationFailure[], "listUnresolvedCanonicalAppointmentFailures");
}

// Re-export the qualifying-status set so Order Note callers can share it.
export { ORDER_NOTE_QUALIFYING_STATUSES };
