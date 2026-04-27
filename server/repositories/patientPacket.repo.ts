import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { patientScreenings, type PatientScreening } from "@shared/schema/screening";
import { patientExecutionCases } from "@shared/schema/executionCase";

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

/** Warning values surfaced when the resolution chain didn't produce a strict
 *  identifier match. Currently only "name_only_fallback" is emitted. */
export type PatientPacketLookupWarning = "name_only_fallback";

export type PatientPacket = {
  resolvedPatientScreeningId: number | null;
  resolvedExecutionCaseId: number | null;
  lookupWarning: PatientPacketLookupWarning | null;
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

/** Prefer screenings that have a linked patient_execution_case row — these
 *  are the canonical-spine rows produced by the seed/commit flow and have
 *  insurance/cooldown/document/procedure/billing children attached. Returns
 *  the screening tied to the most recent execution case for the given name. */
async function findLatestCanonicalScreeningByName(
  patientName: string,
): Promise<PatientScreening | undefined> {
  const rows = await db
    .select({ screening: patientScreenings })
    .from(patientScreenings)
    .innerJoin(
      patientExecutionCases,
      eq(patientExecutionCases.patientScreeningId, patientScreenings.id),
    )
    .where(eq(patientScreenings.name, patientName))
    .orderBy(desc(patientExecutionCases.id))
    .limit(1);
  return rows[0]?.screening;
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
  // Strict resolution priority:
  //   1. executionCaseId  (wins first — directly addresses a canonical case)
  //   2. patientScreeningId (wins second)
  //   3. patientName + patientDob (exact match)
  //   4. patientName alone — TEST/ADMIN-ONLY fallback. When this branch fires
  //      we set lookupWarning = "name_only_fallback" so the caller can show
  //      a "best-effort" indicator rather than treating the row as a strict
  //      identifier match. Production lookups should always supply at least
  //      a screening id or (name + dob).
  let resolvedScreeningId: number | null = lookup.patientScreeningId ?? null;
  let resolvedExecutionCaseId: number | null = lookup.executionCaseId ?? null;
  let patientScreening: PatientScreening | null = null;
  let lookupWarning: PatientPacketLookupWarning | null = null;

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
    // Step 3 (exact name + dob) does NOT set the fallback warning — that's a
    // legitimate strict match. Steps 4a (canonical-linked) and 4b (newest by
    // name) DO set the warning since the caller didn't pin to a specific row.
    let screening: PatientScreening | undefined;
    if (lookup.patientDob) {
      screening = await findScreeningByNameAndDob(lookup.patientName, lookup.patientDob);
    }
    if (!screening) {
      screening = await findLatestCanonicalScreeningByName(lookup.patientName);
      if (screening) lookupWarning = "name_only_fallback";
    }
    if (!screening) {
      screening = await findLatestScreeningByName(lookup.patientName);
      if (screening) lookupWarning = "name_only_fallback";
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
      lookupWarning,
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
    lookupWarning,
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
