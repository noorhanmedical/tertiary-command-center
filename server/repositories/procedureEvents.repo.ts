import { db } from "../db";
import { eq, and, or, desc, gte, lte, ilike, inArray, isNull } from "drizzle-orm";
import {
  procedureEvents,
  type ProcedureEvent,
  type InsertProcedureEvent,
} from "@shared/schema/procedureEvents";
export type { ProcedureEvent } from "@shared/schema/procedureEvents";
import { upsertCaseDocumentReadinessForProcedureComplete } from "./documentReadiness.repo";
import { createPendingProcedureNotes } from "./generatedNotes.repo";
import { evaluateBillingReadinessForProcedure } from "./billingReadiness.repo";
import { upsertProcedureCompleteEvent, clearProcedureCompleteEvent } from "./globalSchedule.repo";
import { featureFlags, procedureNoteRuntimeEnabled } from "../lib/featureFlags";

const PG_UNDEFINED_TABLE = "42P01";
const PG_UNDEFINED_COLUMN = "42703";
const PG_UNIQUE_VIOLATION = "23505";

export type ListProcedureEventsFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  globalScheduleEventId?: number;
  facilityId?: string;
  serviceType?: string;
  procedureStatus?: string;
};

export async function createProcedureEvent(
  input: InsertProcedureEvent,
): Promise<ProcedureEvent> {
  const [result] = await db
    .insert(procedureEvents)
    .values(input)
    .returning();
  return result;
}

export async function updateProcedureEvent(
  id: number,
  updates: Partial<InsertProcedureEvent>,
): Promise<ProcedureEvent | undefined> {
  const [result] = await db
    .update(procedureEvents)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(procedureEvents.id, id))
    .returning();

  // If a procedure moves away from "complete" (reopened, no-show, cancelled,
  // back to not_started/in_progress, etc.), remove its mirrored
  // `procedure_complete` schedule event so the calendar ✓ badge disappears.
  if (
    result &&
    updates.procedureStatus !== undefined &&
    updates.procedureStatus !== "complete"
  ) {
    void clearProcedureCompleteEvent(id).catch((err) => {
      console.error("[procedureEvents.repo] clearProcedureCompleteEvent failed:", err);
    });
  }

  // Phase 2F Hook A: a procedure transitioned INTO "complete" via a generic
  // update. Run the canonical orchestration AWAITED (flag-gated; OFF ⇒ zero
  // Phase 2F reads/writes) so no async DB task escapes the caller. Non-throwing:
  // never reverses this already-committed update.
  if (result && updates.procedureStatus === "complete" && featureFlags.canonicalProcedureLifecycle) {
    try {
      const { onProcedureCompleted } = await import(
        "../services/procedureLifecycle/procedureLifecycleOrchestration"
      );
      // Pass the committed event's clinic as the expected clinic scope.
      await onProcedureCompleted({ procedureEventId: id, expectedClinicId: result.clinicId ?? null });
    } catch (err) {
      console.error("[procedureEvents.repo] onProcedureCompleted failed:", err);
    }
  }

  return result;
}

export async function getProcedureEventById(id: number): Promise<ProcedureEvent | undefined> {
  const [result] = await db
    .select()
    .from(procedureEvents)
    .where(eq(procedureEvents.id, id))
    .limit(1);
  return result;
}

export async function listProcedureEvents(
  filters: ListProcedureEventsFilters = {},
  limit = 100,
): Promise<ProcedureEvent[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.executionCaseId != null) conditions.push(eq(procedureEvents.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(procedureEvents.patientScreeningId, filters.patientScreeningId));
  if (filters.globalScheduleEventId != null) conditions.push(eq(procedureEvents.globalScheduleEventId, filters.globalScheduleEventId));
  if (filters.facilityId) conditions.push(eq(procedureEvents.facilityId, filters.facilityId));
  if (filters.serviceType) conditions.push(eq(procedureEvents.serviceType, filters.serviceType));
  if (filters.procedureStatus) conditions.push(eq(procedureEvents.procedureStatus, filters.procedureStatus));

  const query = db.select().from(procedureEvents).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(procedureEvents.createdAt)).limit(safeLimit)
    : query.orderBy(desc(procedureEvents.createdAt)).limit(safeLimit);
}

// ─── Ultrasound Tech completed procedures ────────────────────────────────────

const ULTRASOUND_TECH_SPECIFIC_SERVICE_NAMES = ["Ultrasound", "VitalWave", "BrainWave"] as const;

export type ListUltrasoundTechCompletedProceduresFilters = {
  completedByUserId?: string;
  facilityId?: string;
  serviceType?: string;
  procedureStatus?: string;
  startDate?: Date;
  endDate?: Date;
};

/** Ultrasound Tech completed procedures view: defaults to procedureStatus
 *  "complete" when none specified, and to ultrasound-relevant service types
 *  when no explicit serviceType is provided. Ordered by completedAt DESC. */
export async function listUltrasoundTechCompletedProcedures(
  filters: ListUltrasoundTechCompletedProceduresFilters = {},
  limit = 100,
): Promise<ProcedureEvent[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.serviceType) {
    conditions.push(eq(procedureEvents.serviceType, filters.serviceType));
  } else {
    const ultrasoundFilter = or(
      ilike(procedureEvents.serviceType, "%ultrasound%"),
      inArray(procedureEvents.serviceType, [...ULTRASOUND_TECH_SPECIFIC_SERVICE_NAMES]),
    );
    if (ultrasoundFilter) conditions.push(ultrasoundFilter);
  }

  if (filters.procedureStatus) {
    conditions.push(eq(procedureEvents.procedureStatus, filters.procedureStatus));
  } else {
    conditions.push(eq(procedureEvents.procedureStatus, "complete"));
  }

  if (filters.completedByUserId) conditions.push(eq(procedureEvents.completedByUserId, filters.completedByUserId));
  if (filters.facilityId) conditions.push(eq(procedureEvents.facilityId, filters.facilityId));
  if (filters.startDate) conditions.push(gte(procedureEvents.completedAt, filters.startDate));
  if (filters.endDate) conditions.push(lte(procedureEvents.completedAt, filters.endDate));

  return db
    .select()
    .from(procedureEvents)
    .where(and(...conditions))
    .orderBy(desc(procedureEvents.completedAt))
    .limit(safeLimit);
}

// ─── Phase 2F — tenant-scoped reads (clinic from request context only) ──────

/** Single procedure event scoped to (id, clinicId). Another clinic's row (or a
 *  clinic-less legacy row) reads as not-found — never disclosed. */
export async function getProcedureEventByIdForClinic(
  id: number,
  clinicId: number,
): Promise<ProcedureEvent | undefined> {
  const [row] = await db
    .select()
    .from(procedureEvents)
    .where(and(eq(procedureEvents.id, id), eq(procedureEvents.clinicId, clinicId)))
    .limit(1);
  return row;
}

/** Clinic-scoped procedure-event list — clinic_id is always in the predicate. */
export async function listProcedureEventsForClinic(
  clinicId: number,
  filters: ListProcedureEventsFilters = {},
  limit = 100,
): Promise<ProcedureEvent[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [eq(procedureEvents.clinicId, clinicId)];
  if (filters.executionCaseId != null) conditions.push(eq(procedureEvents.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(procedureEvents.patientScreeningId, filters.patientScreeningId));
  if (filters.globalScheduleEventId != null) conditions.push(eq(procedureEvents.globalScheduleEventId, filters.globalScheduleEventId));
  if (filters.facilityId) conditions.push(eq(procedureEvents.facilityId, filters.facilityId));
  if (filters.serviceType) conditions.push(eq(procedureEvents.serviceType, filters.serviceType));
  if (filters.procedureStatus) conditions.push(eq(procedureEvents.procedureStatus, filters.procedureStatus));
  return db.select().from(procedureEvents).where(and(...conditions)).orderBy(desc(procedureEvents.createdAt)).limit(safeLimit);
}

/** Clinic-scoped Ultrasound-Tech completed procedures list. */
export async function listUltrasoundTechCompletedProceduresForClinic(
  clinicId: number,
  filters: ListUltrasoundTechCompletedProceduresFilters = {},
  limit = 100,
): Promise<ProcedureEvent[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [eq(procedureEvents.clinicId, clinicId)];
  if (filters.serviceType) {
    conditions.push(eq(procedureEvents.serviceType, filters.serviceType));
  } else {
    const ultrasoundFilter = or(
      ilike(procedureEvents.serviceType, "%ultrasound%"),
      inArray(procedureEvents.serviceType, [...ULTRASOUND_TECH_SPECIFIC_SERVICE_NAMES]),
    );
    if (ultrasoundFilter) conditions.push(ultrasoundFilter);
  }
  conditions.push(eq(procedureEvents.procedureStatus, filters.procedureStatus ?? "complete"));
  if (filters.completedByUserId) conditions.push(eq(procedureEvents.completedByUserId, filters.completedByUserId));
  if (filters.facilityId) conditions.push(eq(procedureEvents.facilityId, filters.facilityId));
  if (filters.startDate) conditions.push(gte(procedureEvents.completedAt, filters.startDate));
  if (filters.endDate) conditions.push(lte(procedureEvents.completedAt, filters.endDate));
  return db.select().from(procedureEvents).where(and(...conditions)).orderBy(desc(procedureEvents.completedAt)).limit(safeLimit);
}

// ─── Phase 2F — canonical, case-scoped procedure lifecycle commands ─────────

/** The canonical procedure-event row(s) for an ancillary case (clinic-scoped).
 *  The migration-0054 partial unique guarantees ≤1; more than one signals
 *  pre-backfill corruption and is surfaced to the caller, never hidden. */
export async function findCanonicalProcedureEventsByCase(
  clinicId: number,
  ancillaryCaseId: number,
): Promise<ProcedureEvent[]> {
  return db
    .select()
    .from(procedureEvents)
    .where(and(eq(procedureEvents.clinicId, clinicId), eq(procedureEvents.ancillaryCaseId, ancillaryCaseId)))
    .orderBy(desc(procedureEvents.completedAt))
    .limit(5);
}

export type CanonicalProcedureEventInput = {
  clinicId: number;
  ancillaryCaseId: number;
  globalPlexusPatientId?: number | null;
  patientClinicMembershipId?: number | null;
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  globalScheduleEventId?: number | null;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  serviceType: string;
  completedByUserId?: string | null;
  completedAt: Date;
  note?: string | null;
};

/** Insert a new canonical, case-linked completed procedure event (server-owned
 *  ownership fields). Throws PG unique-violation (23505) on a concurrent
 *  case-scoped insert so the caller can reselect the exact winner. */
export async function insertCanonicalProcedureEvent(
  input: CanonicalProcedureEventInput,
): Promise<ProcedureEvent> {
  const [row] = await db
    .insert(procedureEvents)
    .values({
      clinicId: input.clinicId,
      ancillaryCaseId: input.ancillaryCaseId,
      globalPlexusPatientId: input.globalPlexusPatientId ?? null,
      patientClinicMembershipId: input.patientClinicMembershipId ?? null,
      executionCaseId: input.executionCaseId ?? null,
      patientScreeningId: input.patientScreeningId ?? null,
      globalScheduleEventId: input.globalScheduleEventId ?? null,
      patientName: input.patientName ?? null,
      patientDob: input.patientDob ?? null,
      facilityId: input.facilityId ?? null,
      serviceType: input.serviceType,
      procedureStatus: "complete",
      completedByUserId: input.completedByUserId ?? null,
      completedAt: input.completedAt,
      note: input.note ?? null,
    })
    .returning();
  return row;
}

export type CompleteExistingOutcome =
  | { outcome: "completed"; procedureEvent: ProcedureEvent }
  | { outcome: "already_complete_preserved"; procedureEvent: ProcedureEvent }
  | { outcome: "timestamp_conflict"; procedureEvent: ProcedureEvent }
  | { outcome: "zero_row_conflict" };

/**
 * Mark an existing canonical procedure event complete. FULLY scoped: the
 * update WHERE requires the exact id + clinic + ancillary case + service. The
 * canonical completedAt is IMMUTABLE — the first transition to complete owns
 * it. A repeated idempotent completion preserves the existing completedAt /
 * completedByUserId / note (no silent rewrite); an EXPLICIT, different
 * completedAt on an already-complete event returns timestamp_conflict (reviewed
 * correction is out of scope). `.returning()` requires exactly one affected row.
 */
export async function completeExistingProcedureEvent(
  existing: ProcedureEvent,
  expected: { clinicId: number; ancillaryCaseId: number; serviceType: string },
  patch: { completedAt: Date; explicit: boolean; completedByUserId?: string | null; note?: string | null },
): Promise<CompleteExistingOutcome> {
  const alreadyComplete = existing.procedureStatus === "complete" && existing.completedAt != null;
  if (alreadyComplete) {
    if (patch.explicit && existing.completedAt != null && existing.completedAt.getTime() !== patch.completedAt.getTime()) {
      return { outcome: "timestamp_conflict", procedureEvent: existing };
    }
    // Idempotent repeat — preserve the original completion instant + fields.
    return { outcome: "already_complete_preserved", procedureEvent: existing };
  }
  const rows = await db
    .update(procedureEvents)
    .set({
      procedureStatus: "complete",
      completedAt: patch.completedAt,
      completedByUserId: patch.completedByUserId ?? undefined,
      note: patch.note ?? undefined,
      updatedAt: new Date(),
    })
    .where(and(
      eq(procedureEvents.id, existing.id),
      eq(procedureEvents.clinicId, expected.clinicId),
      eq(procedureEvents.ancillaryCaseId, expected.ancillaryCaseId),
      eq(procedureEvents.serviceType, expected.serviceType),
    ))
    .returning();
  if (rows.length !== 1) return { outcome: "zero_row_conflict" };
  return { outcome: "completed", procedureEvent: rows[0] };
}

export type LinkProcedureEventOutcome =
  | { outcome: "linked"; procedureEvent: ProcedureEvent }
  | { outcome: "already_linked_same_case_and_synced"; procedureEvent: ProcedureEvent }
  | { outcome: "ownership_conflict" }
  | { outcome: "identity_conflict" }
  | { outcome: "zero_row_conflict" }
  | { outcome: "migration_missing" };

/**
 * Link a procedure event to its ancillary case — server-owned ownership write.
 * NEVER re-homes an event from one case to another. Requires: the event's
 * clinic is the same clinic OR NULL (unassigned legacy row being adopted); and
 * its ancillary_case_id is NULL or already equal to the target case.
 *
 * When ALREADY the same case, this SYNCHRONIZES rather than short-circuiting:
 * it fills a NULL clinic (eligibility requires clinic + case) and fills NULL
 * canonical identity (global patient / membership) when tenant-consistent. A
 * conflicting NON-NULL identity is `identity_conflict` (never overwritten). All
 * writes are exact-ownership scoped and `.returning()` affected-row checked — a
 * zero-row race is `zero_row_conflict`, never reported as linked/synced.
 */
export async function linkProcedureEventToAncillaryCase(input: {
  procedureEventId: number;
  clinicId: number;
  ancillaryCaseId: number;
  globalPlexusPatientId?: number | null;
  patientClinicMembershipId?: number | null;
}): Promise<LinkProcedureEventOutcome> {
  try {
    const [pe] = await db
      .select()
      .from(procedureEvents)
      .where(eq(procedureEvents.id, input.procedureEventId))
      .limit(1);
    if (!pe) return { outcome: "zero_row_conflict" };
    if (pe.clinicId != null && pe.clinicId !== input.clinicId) return { outcome: "ownership_conflict" };
    if (pe.ancillaryCaseId != null && pe.ancillaryCaseId !== input.ancillaryCaseId) return { outcome: "ownership_conflict" };

    if (pe.ancillaryCaseId === input.ancillaryCaseId) {
      // Same case — validate + synchronize; never overwrite a conflicting non-null.
      if (pe.globalPlexusPatientId != null && input.globalPlexusPatientId != null && pe.globalPlexusPatientId !== input.globalPlexusPatientId) return { outcome: "identity_conflict" };
      if (pe.patientClinicMembershipId != null && input.patientClinicMembershipId != null && pe.patientClinicMembershipId !== input.patientClinicMembershipId) return { outcome: "identity_conflict" };
      const patch: Record<string, unknown> = {};
      if (pe.clinicId == null) patch.clinicId = input.clinicId;
      if (pe.globalPlexusPatientId == null && input.globalPlexusPatientId != null) patch.globalPlexusPatientId = input.globalPlexusPatientId;
      if (pe.patientClinicMembershipId == null && input.patientClinicMembershipId != null) patch.patientClinicMembershipId = input.patientClinicMembershipId;
      if (Object.keys(patch).length === 0) return { outcome: "already_linked_same_case_and_synced", procedureEvent: pe };
      const rows = await db
        .update(procedureEvents)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(
          eq(procedureEvents.id, input.procedureEventId),
          eq(procedureEvents.ancillaryCaseId, input.ancillaryCaseId),
          or(isNull(procedureEvents.clinicId), eq(procedureEvents.clinicId, input.clinicId)),
        ))
        .returning();
      if (rows.length !== 1) return { outcome: "zero_row_conflict" };
      return { outcome: "already_linked_same_case_and_synced", procedureEvent: rows[0] };
    }

    const rows = await db
      .update(procedureEvents)
      .set({
        ancillaryCaseId: input.ancillaryCaseId,
        clinicId: input.clinicId,
        globalPlexusPatientId: input.globalPlexusPatientId ?? pe.globalPlexusPatientId ?? null,
        patientClinicMembershipId: input.patientClinicMembershipId ?? pe.patientClinicMembershipId ?? null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(procedureEvents.id, input.procedureEventId),
        isNull(procedureEvents.ancillaryCaseId),
        or(isNull(procedureEvents.clinicId), eq(procedureEvents.clinicId, input.clinicId)),
      ))
      .returning();
    if (rows.length !== 1) return { outcome: "zero_row_conflict" };
    return { outcome: "linked", procedureEvent: rows[0] };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === PG_UNDEFINED_TABLE || code === PG_UNDEFINED_COLUMN) return { outcome: "migration_missing" };
    throw e;
  }
}

export type MarkProcedureCompleteInput = {
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  globalScheduleEventId?: number | null;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  serviceType: string;
  completedByUserId?: string | null;
  note?: string | null;
  completedAt?: Date | null;
};

/** Upsert procedure event as complete (deduped by patientScreeningId + serviceType)
 *  and create/update the standard set of case_document_readiness rows. */
export async function markProcedureComplete(
  input: MarkProcedureCompleteInput,
): Promise<{ procedureEvent: ProcedureEvent; documentRows: Awaited<ReturnType<typeof upsertCaseDocumentReadinessForProcedureComplete>> }> {
  const now = input.completedAt instanceof Date && !isNaN(input.completedAt.getTime()) ? input.completedAt : new Date();

  // Deduplicate by (patientScreeningId, serviceType) when screening is linked
  let existing: ProcedureEvent | undefined;
  if (input.patientScreeningId != null) {
    const [row] = await db
      .select()
      .from(procedureEvents)
      .where(
        and(
          eq(procedureEvents.patientScreeningId, input.patientScreeningId),
          eq(procedureEvents.serviceType, input.serviceType),
        ),
      )
      .limit(1);
    existing = row;
  }

  let procedureEvent: ProcedureEvent;

  if (existing) {
    const [updated] = await db
      .update(procedureEvents)
      .set({
        procedureStatus: "complete",
        completedAt: now,
        completedByUserId: input.completedByUserId ?? undefined,
        note: input.note ?? undefined,
        updatedAt: now,
      })
      .where(eq(procedureEvents.id, existing.id))
      .returning();
    procedureEvent = updated;
  } else {
    const [created] = await db
      .insert(procedureEvents)
      .values({
        executionCaseId: input.executionCaseId ?? undefined,
        patientScreeningId: input.patientScreeningId ?? undefined,
        globalScheduleEventId: input.globalScheduleEventId ?? undefined,
        patientName: input.patientName ?? undefined,
        patientDob: input.patientDob ?? undefined,
        facilityId: input.facilityId ?? undefined,
        serviceType: input.serviceType,
        procedureStatus: "complete",
        completedByUserId: input.completedByUserId ?? undefined,
        completedAt: now,
        note: input.note ?? undefined,
      })
      .returning();
    procedureEvent = created;
  }

  void upsertProcedureCompleteEvent({
    procedureEventId: procedureEvent.id,
    completedAt: now,
    serviceType: input.serviceType,
    executionCaseId: input.executionCaseId ?? null,
    patientScreeningId: input.patientScreeningId ?? null,
    patientName: input.patientName ?? null,
    patientDob: input.patientDob ?? null,
    facilityId: input.facilityId ?? null,
  }).catch((err) => {
    console.error("[procedureEvents.repo] upsertProcedureCompleteEvent failed:", err);
  });

  const documentRows = await upsertCaseDocumentReadinessForProcedureComplete({
    executionCaseId: input.executionCaseId ?? null,
    patientScreeningId: input.patientScreeningId ?? null,
    patientName: input.patientName ?? null,
    patientDob: input.patientDob ?? null,
    facilityId: input.facilityId ?? null,
    serviceType: input.serviceType,
  });

  // Legacy post-procedure-note writer. Phase 2F: suppress ONLY when the FULL
  // canonical Procedure Note runtime is enabled (all three flags) — then the
  // two-condition canonical service is the only post_procedure_note creator.
  // Partial enablement preserves the legacy writer so the workflow is never
  // stranded with neither a legacy nor a canonical note.
  if (!procedureNoteRuntimeEnabled()) {
    void createPendingProcedureNotes({
      executionCaseId: input.executionCaseId ?? null,
      patientScreeningId: input.patientScreeningId ?? null,
      procedureEventId: procedureEvent.id,
      serviceType: input.serviceType,
    }).catch((err) => {
      console.error("[procedureEvents.repo] createPendingProcedureNotes failed:", err);
    });
  }

  void evaluateBillingReadinessForProcedure({
    executionCaseId: input.executionCaseId ?? null,
    patientScreeningId: input.patientScreeningId ?? null,
    procedureEventId: procedureEvent.id,
    patientName: input.patientName ?? null,
    patientDob: input.patientDob ?? null,
    facilityId: input.facilityId ?? null,
    serviceType: input.serviceType,
  }).catch((err) => {
    console.error("[procedureEvents.repo] evaluateBillingReadinessForProcedure failed:", err);
  });

  return { procedureEvent, documentRows };
}
