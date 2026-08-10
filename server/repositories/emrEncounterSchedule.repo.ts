// EMR Encounter → global_schedule_events ingestion (Batch: EMR roster sync).
//
// Routes FHIR Encounter resources from the bulk export into the existing
// global_schedule_events table as eventType 'doctor_visit',
// source 'ecw_fhir_bulk'. Idempotent UPSERT keyed on
// (external_source_system, external_encounter_id) — see migration 0041.
//
// SAFETY CONTRACT (do not violate — see read-path trace 2026-06-28):
//   1. Dedup on externalEncounterId ONLY. NEVER set patientScreeningId on
//      EMR rows. A separate writer (createGlobalScheduleEventFromScreeningCommit)
//      dedups doctor_visit rows by patientScreeningId; populating it here would
//      let the two writers overwrite each other. EMR roster rows and
//      screening-commit rows are intentionally distinct.
//   2. Only ingest planned + recent encounters (caller filters). Do NOT bulk
//      load the full finished history — listTechnicianLiaisonClinicVisits reads
//      doctor_visit with no status filter.
//   3. Always resolve clinicId explicitly; never rely on NULL for tenancy.

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  globalScheduleEvents,
  type GlobalScheduleEvent,
} from "@shared/schema/globalSchedule";

const EXTERNAL_SOURCE_SYSTEM = "ecw_fhir_bulk";

/** FHIR Encounter.status → global_schedule_events.status */
export function mapEncounterStatus(fhirStatus: string | null | undefined): string {
  switch ((fhirStatus ?? "").toLowerCase()) {
    case "planned":
      return "scheduled";
    case "arrived":
    case "triaged":
    case "in-progress":
    case "onleave":
      return "scheduled"; // came in / active — still an open roster item
    case "finished":
      return "completed";
    case "cancelled":
    case "entered-in-error":
      return "cancelled";
    case "noshow":
    case "no-show":
      return "no_show";
    default:
      return "scheduled";
  }
}

export type EmrEncounterUpsertInput = {
  externalEncounterId: string;          // FHIR Encounter.id (required, dedup key)
  clinicId: number;                     // resolved from facility — required for tenancy
  patientDirectoryId?: number | null;   // resolved via MRN; null if unresolved
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;           // text facility, matching existing convention
  serviceType?: string | null;          // Encounter.type[].text
  fhirStatus?: string | null;           // raw Encounter.status (mapped internally)
  startsAt: Date;                       // Encounter.period.start
  endsAt?: Date | null;                 // Encounter.period.end
  providerNpi?: string | null;          // participant.individual reference
  reasonText?: string | null;           // reasonCode[].text
  locationRef?: string | null;          // location[].location.reference
  source?: "ecw_fhir_bulk" | "healow_booking";
};

/** Idempotent UPSERT of one EMR Encounter into global_schedule_events.
 *  Matches on (external_source_system, external_encounter_id). Updates
 *  status/time/provider on re-import so a planned→arrived→finished (or
 *  →cancelled) transition across nightly pulls lands on the same row. */
export async function upsertEmrEncounterScheduleEvent(
  input: EmrEncounterUpsertInput,
): Promise<{ event: GlobalScheduleEvent; created: boolean }> {
  if (!input.externalEncounterId) {
    throw new Error("externalEncounterId is required");
  }
  if (input.clinicId == null) {
    throw new Error("clinicId is required (tenancy) — resolve from facility before ingest");
  }
  if (!(input.startsAt instanceof Date) || isNaN(input.startsAt.getTime())) {
    throw new Error("startsAt must be a valid Date");
  }

  const sourceSystem = input.source ?? EXTERNAL_SOURCE_SYSTEM;

  const payload = {
    clinicId: input.clinicId,
    // NOTE: patientScreeningId intentionally omitted (safety rule #1).
    patientDirectoryId: input.patientDirectoryId ?? undefined,
    patientName: input.patientName ?? undefined,
    patientDob: input.patientDob ?? undefined,
    facilityId: input.facilityId ?? undefined,
    eventType: "doctor_visit" as const,
    serviceType: input.serviceType ?? undefined,
    source: sourceSystem,
    status: mapEncounterStatus(input.fhirStatus),
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? undefined,
    externalSourceSystem: sourceSystem,
    externalEncounterId: input.externalEncounterId,
    metadata: {
      providerNpi: input.providerNpi ?? null,
      reasonText: input.reasonText ?? null,
      locationRef: input.locationRef ?? null,
      fhirStatus: input.fhirStatus ?? null,
    },
  };

  const [existing] = await db
    .select()
    .from(globalScheduleEvents)
    .where(
      and(
        eq(globalScheduleEvents.externalSourceSystem, sourceSystem),
        eq(globalScheduleEvents.externalEncounterId, input.externalEncounterId),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(globalScheduleEvents)
      .set({ ...payload, updatedAt: new Date() })
      .where(eq(globalScheduleEvents.id, existing.id))
      .returning();
    return { event: updated, created: false };
  }

  const [created] = await db
    .insert(globalScheduleEvents)
    .values(payload)
    .returning();
  return { event: created, created: true };
}
