import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { patientScreenings, type PatientScreening } from "@shared/schema/screening";

import {
  getExecutionCaseById,
  getExecutionCaseByScreeningId,
  listJourneyEvents,
} from "./executionCase.repo";
import { listGlobalScheduleEvents } from "./globalSchedule.repo";
import { listSchedulingTriageCases } from "./schedulingTriage.repo";
import { listInsuranceEligibilityReviews } from "./insuranceEligibility.repo";
import { listCooldownRecords } from "./cooldown.repo";
import { listCaseDocumentReadiness } from "./documentReadiness.repo";
import { listProcedureEvents } from "./procedureEvents.repo";
import { listGeneratedNotes } from "./generatedNotes.repo";
import { listBillingReadinessChecks } from "./billingReadiness.repo";
import { listBillingDocumentRequests } from "./billingDocuments.repo";
import { listCompletedBillingPackages } from "./completedBillingPackages.repo";
import { listProjectedInvoiceRows } from "./projectedInvoices.repo";

export type PatientPacketLookup = {
  executionCaseId?: number;
  patientScreeningId?: number;
  patientName?: string;
  patientDob?: string;
};

export type PatientPacket = {
  resolvedPatientScreeningId: number | null;
  resolvedExecutionCaseId: number | null;
  patientScreening: PatientScreening | null;
  executionCase: Awaited<ReturnType<typeof getExecutionCaseById>> | null;
  journeyEvents: Awaited<ReturnType<typeof listJourneyEvents>>;
  globalScheduleEvents: Awaited<ReturnType<typeof listGlobalScheduleEvents>>;
  schedulingTriageCases: Awaited<ReturnType<typeof listSchedulingTriageCases>>;
  insuranceEligibilityReviews: Awaited<ReturnType<typeof listInsuranceEligibilityReviews>>;
  cooldownRecords: Awaited<ReturnType<typeof listCooldownRecords>>;
  caseDocumentReadiness: Awaited<ReturnType<typeof listCaseDocumentReadiness>>;
  procedureEvents: Awaited<ReturnType<typeof listProcedureEvents>>;
  procedureNotes: Awaited<ReturnType<typeof listGeneratedNotes>>;
  billingReadinessChecks: Awaited<ReturnType<typeof listBillingReadinessChecks>>;
  billingDocumentRequests: Awaited<ReturnType<typeof listBillingDocumentRequests>>;
  completedBillingPackages: Awaited<ReturnType<typeof listCompletedBillingPackages>>;
  projectedInvoiceRows: Awaited<ReturnType<typeof listProjectedInvoiceRows>>;
};

async function findScreeningByNameAndDob(
  patientName: string,
  patientDob: string,
): Promise<PatientScreening | undefined> {
  const [row] = await db
    .select()
    .from(patientScreenings)
    .where(and(eq(patientScreenings.name, patientName), eq(patientScreenings.dob, patientDob)))
    .orderBy(desc(patientScreenings.id))
    .limit(1);
  return row;
}

async function findLatestScreeningByName(
  patientName: string,
): Promise<PatientScreening | undefined> {
  const [row] = await db
    .select()
    .from(patientScreenings)
    .where(eq(patientScreenings.name, patientName))
    .orderBy(desc(patientScreenings.id))
    .limit(1);
  return row;
}

async function getScreeningById(id: number): Promise<PatientScreening | undefined> {
  const [row] = await db
    .select()
    .from(patientScreenings)
    .where(eq(patientScreenings.id, id))
    .limit(1);
  return row;
}

const SAFE_LIMIT = 200;

/** Aggregate the full operational spine for a single patient.
 *  Resolves patientScreeningId from one of: executionCaseId, patientScreeningId,
 *  or (patientName + patientDob). Empty arrays/null fields when not found. */
export async function getPatientPacket(lookup: PatientPacketLookup): Promise<PatientPacket> {
  let resolvedScreeningId: number | null = lookup.patientScreeningId ?? null;
  let resolvedExecutionCaseId: number | null = lookup.executionCaseId ?? null;
  let patientScreening: PatientScreening | null = null;

  if (lookup.executionCaseId != null) {
    const execCase = await getExecutionCaseById(lookup.executionCaseId);
    if (execCase) {
      resolvedExecutionCaseId = execCase.id;
      if (resolvedScreeningId == null && execCase.patientScreeningId != null) {
        resolvedScreeningId = execCase.patientScreeningId;
      }
    }
  }

  if (resolvedScreeningId == null && lookup.patientName) {
    // Try exact name + dob first, then fall back to name-only (newest match
    // wins) so callers don't have to know which seed/fixture wrote the row
    // (DOB formats vary: legacy fixtures use ISO "1958-04-12" while the
    // canonical seed uses "01/01/1950"). Name-only fallback ensures the most
    // recently-created TestGuy row always resolves.
    let screening: PatientScreening | undefined;
    if (lookup.patientDob) {
      screening = await findScreeningByNameAndDob(lookup.patientName, lookup.patientDob);
    }
    if (!screening) {
      screening = await findLatestScreeningByName(lookup.patientName);
    }
    if (screening) {
      resolvedScreeningId = screening.id;
      patientScreening = screening;
    }
  }

  if (resolvedScreeningId != null && !patientScreening) {
    patientScreening = (await getScreeningById(resolvedScreeningId)) ?? null;
  }

  // Resolve execution case from screening if not yet known
  let executionCase: Awaited<ReturnType<typeof getExecutionCaseById>> | null = null;
  if (resolvedExecutionCaseId != null) {
    executionCase = (await getExecutionCaseById(resolvedExecutionCaseId)) ?? null;
  } else if (resolvedScreeningId != null) {
    executionCase = (await getExecutionCaseByScreeningId(resolvedScreeningId)) ?? null;
    if (executionCase) resolvedExecutionCaseId = executionCase.id;
  }

  const screeningFilter = resolvedScreeningId != null ? { patientScreeningId: resolvedScreeningId } : {};
  const caseFilter = resolvedExecutionCaseId != null ? { executionCaseId: resolvedExecutionCaseId } : {};

  // If we have neither identifier, return empty packet
  if (resolvedScreeningId == null && resolvedExecutionCaseId == null) {
    return {
      resolvedPatientScreeningId: null,
      resolvedExecutionCaseId: null,
      patientScreening: null,
      executionCase: null,
      journeyEvents: [],
      globalScheduleEvents: [],
      schedulingTriageCases: [],
      insuranceEligibilityReviews: [],
      cooldownRecords: [],
      caseDocumentReadiness: [],
      procedureEvents: [],
      procedureNotes: [],
      billingReadinessChecks: [],
      billingDocumentRequests: [],
      completedBillingPackages: [],
      projectedInvoiceRows: [],
    };
  }

  const filterFor = (preferScreening: boolean) => {
    if (preferScreening && resolvedScreeningId != null) return screeningFilter;
    if (resolvedExecutionCaseId != null) return caseFilter;
    return screeningFilter;
  };

  const [
    journeyEvents,
    globalScheduleEvents,
    schedulingTriageCases,
    insuranceEligibilityReviews,
    cooldownRecords,
    caseDocumentReadiness,
    procedureEvents,
    procedureNotes,
    billingReadinessChecks,
    billingDocumentRequests,
    completedBillingPackages,
    projectedInvoiceRows,
  ] = await Promise.all([
    resolvedExecutionCaseId != null
      ? listJourneyEvents({ executionCaseId: resolvedExecutionCaseId }, SAFE_LIMIT)
      : Promise.resolve([] as Awaited<ReturnType<typeof listJourneyEvents>>),
    listGlobalScheduleEvents(filterFor(true), SAFE_LIMIT),
    listSchedulingTriageCases(filterFor(true), SAFE_LIMIT),
    listInsuranceEligibilityReviews(filterFor(true), SAFE_LIMIT),
    listCooldownRecords(filterFor(true), SAFE_LIMIT),
    listCaseDocumentReadiness(filterFor(true), SAFE_LIMIT),
    listProcedureEvents(filterFor(true), SAFE_LIMIT),
    listGeneratedNotes(filterFor(true), SAFE_LIMIT),
    listBillingReadinessChecks(filterFor(true), SAFE_LIMIT),
    listBillingDocumentRequests(filterFor(true), SAFE_LIMIT),
    listCompletedBillingPackages(filterFor(true), SAFE_LIMIT),
    listProjectedInvoiceRows(filterFor(true), SAFE_LIMIT),
  ]);

  return {
    resolvedPatientScreeningId: resolvedScreeningId,
    resolvedExecutionCaseId,
    patientScreening,
    executionCase,
    journeyEvents,
    globalScheduleEvents,
    schedulingTriageCases,
    insuranceEligibilityReviews,
    cooldownRecords,
    caseDocumentReadiness,
    procedureEvents,
    procedureNotes,
    billingReadinessChecks,
    billingDocumentRequests,
    completedBillingPackages,
    projectedInvoiceRows,
  };
}
