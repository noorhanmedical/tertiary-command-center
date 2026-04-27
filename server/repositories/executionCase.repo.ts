import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import {
  patientExecutionCases,
  patientJourneyEvents,
  type PatientExecutionCase,
  type PatientJourneyEvent,
  type InsertPatientJourneyEvent,
} from "@shared/schema/executionCase";
import type { PatientScreening } from "@shared/schema/screening";

function deriveEngagementBucket(screening: PatientScreening): "visit" | "outreach" | "scheduling_triage" {
  const t = (screening.patientType ?? "visit").toLowerCase();
  if (t === "outreach") return "outreach";
  if (t === "visit") return "visit";
  return "scheduling_triage";
}

function deriveQualificationStatus(screening: PatientScreening): "qualified" | "not_qualified" | "unscreened" {
  const tests = screening.qualifyingTests ?? [];
  if (screening.status === "completed") {
    return tests.length > 0 ? "qualified" : "not_qualified";
  }
  return "unscreened";
}

export async function createOrUpdateExecutionCaseFromScreening(
  screening: PatientScreening,
  actorUserId: string | null,
): Promise<{ executionCase: PatientExecutionCase; created: boolean }> {
  const [existing] = await db
    .select()
    .from(patientExecutionCases)
    .where(eq(patientExecutionCases.patientScreeningId, screening.id))
    .limit(1);

  const engagementBucket = deriveEngagementBucket(screening);
  const qualificationStatus = deriveQualificationStatus(screening);
  const selectedServices = Array.isArray(screening.qualifyingTests) && screening.qualifyingTests.length > 0
    ? (screening.qualifyingTests as string[])
    : undefined;

  if (existing) {
    const [updated] = await db
      .update(patientExecutionCases)
      .set({
        patientName: screening.name,
        patientDob: screening.dob ?? undefined,
        facilityId: screening.facility ?? undefined,
        engagementBucket,
        qualificationStatus,
        selectedServices,
        updatedAt: new Date(),
      })
      .where(eq(patientExecutionCases.id, existing.id))
      .returning();
    return { executionCase: updated, created: false };
  }

  const [created] = await db
    .insert(patientExecutionCases)
    .values({
      patientScreeningId: screening.id,
      patientName: screening.name,
      patientDob: screening.dob ?? undefined,
      facilityId: screening.facility ?? undefined,
      source: "system_generated",
      engagementBucket,
      qualificationStatus,
      lifecycleStatus: "active",
      engagementStatus: "new",
      selectedServices,
    })
    .returning();

  return { executionCase: created, created: true };
}

export async function appendPatientJourneyEvent(
  event: InsertPatientJourneyEvent,
): Promise<PatientJourneyEvent> {
  const [result] = await db
    .insert(patientJourneyEvents)
    .values(event)
    .returning();
  return result;
}
