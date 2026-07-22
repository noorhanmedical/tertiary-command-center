// acsWorkflowRuntime — Phase 2 PR 2.5.
//
// Projects an ACS (ancillary care specialist) view of a single case
// from the canonical sources:
//   - patient_execution_cases (engagementStatus, lifecycleStatus)
//   - global_schedule_events (status, startsAt)
//   - case_document_readiness (per-document presence)
//   - billing_readiness_checks
//   - procedure_events (procedureStatus completed)
//
// Each ACS workflow status is derived honestly — when the source
// data is missing the status is reported as "needed"/"pending"
// rather than faked to "completed".

import { db } from "../../db";
import { and, eq } from "drizzle-orm";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { globalScheduleEvents } from "@shared/schema/globalSchedule";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import { billingReadinessChecks } from "@shared/schema/billingReadiness";
import { procedureEvents } from "@shared/schema/procedureEvents";
import { featureFlags } from "../../lib/featureFlags";
import {
  getCanonicalAppointmentsByService,
  type CanonicalAppointmentProjection,
} from "../canonicalAppointments/appointmentProjection";

export type AcsWorkflowStatus =
  | "assigned"
  | "scheduled"
  | "confirmed"
  | "consent_needed"
  | "consent_signed"
  | "screening_needed"
  | "screening_completed"
  | "report_needed"
  | "report_uploaded"
  | "order_note_needed"
  | "order_note_present"
  | "procedure_note_needed"
  | "procedure_note_present"
  | "physician_signature_pending"
  | "billing_readiness_pending"
  | "billing_ready"
  | "completed";

export type AcsWorkflowSnapshot = {
  executionCaseId: number;
  patientName: string | null;
  facilityId: string | null;
  engagementStatus: string | null;
  /** Bullet list of every status currently applicable. A case can
   *  legitimately carry multiple (e.g. consent_signed + report_needed). */
  statuses: AcsWorkflowStatus[];
  /** Per-document readiness so the panel can render honest pending. */
  documentReadiness: Array<{
    documentType: string;
    documentStatus: string;
    completedAt: string | null;
    blocksBilling: boolean;
  }>;
  /** Per-check billing readiness so the panel can render honest pending. */
  billingChecks: Array<{
    serviceType: string;
    readinessStatus: string;
    missingRequirements: unknown;
  }>;
  /** The next schedule event for the case (if any). */
  nextScheduleEvent: {
    id: number;
    status: string;
    startsAt: string;
    serviceType: string | null;
  } | null;
  /** Phase 2D-C1 — canonical per-service appointment projection (flag ON).
   *  Undefined when FEATURE_CANONICAL_APPOINTMENT is OFF (legacy read). */
  appointmentByService?: Record<string, CanonicalAppointmentProjection>;
  /** Phase 2D-C1 — appointment-only Order Note eligibility (flag ON). */
  appointmentEligibleForOrderNote?: boolean;
};

const PRESENT_DOC_STATUSES = new Set([
  "completed", "complete", "uploaded", "generated", "approved",
  "signed", "verified", "present",
]);

function statusFor(
  current: string | null,
  needed: AcsWorkflowStatus,
  present: AcsWorkflowStatus,
): AcsWorkflowStatus {
  if (!current) return needed;
  return PRESENT_DOC_STATUSES.has(current.toLowerCase()) ? present : needed;
}

export async function getAcsWorkflowSnapshot(
  executionCaseId: number,
): Promise<AcsWorkflowSnapshot | null> {
  const [execCase] = await db
    .select()
    .from(patientExecutionCases)
    .where(eq(patientExecutionCases.id, executionCaseId))
    .limit(1);
  if (!execCase) return null;

  const [legacyNextEvent] = await db
    .select()
    .from(globalScheduleEvents)
    .where(and(
      eq(globalScheduleEvents.executionCaseId, executionCaseId),
      eq(globalScheduleEvents.eventType, "ancillary_appointment"),
    ))
    .orderBy(globalScheduleEvents.startsAt)
    .limit(1);

  // Phase 2D-C1 — under the canonical flag, ACS reads the SAME canonical
  // ancillary appointment truth everyone else does: the active
  // (scheduled) event per service, never a cancelled/no_show/rescheduled
  // prior event. doctor_visit is excluded by the projection.
  let appointmentByService: Record<string, CanonicalAppointmentProjection> | undefined;
  let appointmentEligibleForOrderNote: boolean | undefined;
  let canonicalNext: { id: number; status: string; startsAt: string; serviceType: string | null } | null | undefined;
  if (featureFlags.canonicalAppointment && execCase.clinicId != null) {
    appointmentByService = await getCanonicalAppointmentsByService({
      clinicId: execCase.clinicId,
      executionCaseId,
      includeHistory: true,
    });
    appointmentEligibleForOrderNote = Object.values(appointmentByService).some(
      (p) => p.appointmentEligibleForOrderNote,
    );
    const actives = Object.values(appointmentByService)
      .map((p) => p.activeAppointment)
      .filter((v): v is NonNullable<typeof v> => v != null)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const a = actives[0];
    canonicalNext = a
      ? { id: a.globalScheduleEventId, status: a.status, startsAt: a.startsAt.toISOString(), serviceType: a.serviceType }
      : null;
  }
  // Under the flag, the canonical active event is authoritative; OFF
  // keeps the legacy first-by-start read.
  const nextEvent = featureFlags.canonicalAppointment ? null : legacyNextEvent;

  const docRows = await db
    .select()
    .from(caseDocumentReadiness)
    .where(eq(caseDocumentReadiness.executionCaseId, executionCaseId));

  const billingRows = await db
    .select()
    .from(billingReadinessChecks)
    .where(eq(billingReadinessChecks.executionCaseId, executionCaseId));

  const procRows = await db
    .select()
    .from(procedureEvents)
    .where(eq(procedureEvents.executionCaseId, executionCaseId));

  const docByType: Record<string, { documentStatus: string }> = {};
  for (const d of docRows) {
    docByType[d.documentType] = { documentStatus: d.documentStatus };
  }

  const statuses = new Set<AcsWorkflowStatus>();
  if (execCase.assignedTeamMemberId != null) statuses.add("assigned");
  const effectiveNextStatus = featureFlags.canonicalAppointment
    ? (canonicalNext?.status ?? null)
    : (nextEvent?.status ?? null);
  if (effectiveNextStatus) {
    if (effectiveNextStatus === "scheduled" || effectiveNextStatus === "rescheduled") {
      statuses.add("scheduled");
    } else if (effectiveNextStatus === "confirmed") {
      statuses.add("scheduled");
      statuses.add("confirmed");
    }
  }

  statuses.add(statusFor(docByType["informed_consent"]?.documentStatus ?? null, "consent_needed", "consent_signed"));
  statuses.add(statusFor(docByType["screening_form"]?.documentStatus ?? null, "screening_needed", "screening_completed"));
  statuses.add(statusFor(docByType["report"]?.documentStatus ?? null, "report_needed", "report_uploaded"));
  statuses.add(statusFor(docByType["order_note"]?.documentStatus ?? null, "order_note_needed", "order_note_present"));
  statuses.add(statusFor(docByType["post_procedure_note"]?.documentStatus ?? null, "procedure_note_needed", "procedure_note_present"));

  // Physician signing — no canonical writer yet. We expose
  // "physician_signature_pending" when the order note is present
  // but no physician_signed_order row says "signed".
  const signed = docByType["physician_signed_order"];
  const orderPresent = statuses.has("order_note_present");
  const physicianSigned = signed && PRESENT_DOC_STATUSES.has((signed.documentStatus ?? "").toLowerCase());
  if (orderPresent && !physicianSigned) {
    statuses.add("physician_signature_pending");
  }

  // Billing readiness: ready when ALL checks have readinessStatus = "ready".
  const allChecks = billingRows.map((c) => ({
    serviceType: c.serviceType,
    readinessStatus: c.readinessStatus,
    missingRequirements: c.missingRequirements,
  }));
  const allReady =
    allChecks.length > 0 &&
    allChecks.every((c) => (c.readinessStatus ?? "").toLowerCase() === "ready");
  if (allChecks.length === 0 || !allReady) {
    statuses.add("billing_readiness_pending");
  } else {
    statuses.add("billing_ready");
  }

  // Completed = a procedure_event with procedureStatus = "completed" AND billing ready.
  const procedureComplete = procRows.some(
    (p) => (p.procedureStatus ?? "").toLowerCase() === "completed",
  );
  if (procedureComplete && allReady) statuses.add("completed");

  return {
    executionCaseId,
    patientName: execCase.patientName,
    facilityId: execCase.facilityId ?? null,
    engagementStatus: execCase.engagementStatus,
    statuses: Array.from(statuses),
    documentReadiness: docRows.map((d) => ({
      documentType: d.documentType,
      documentStatus: d.documentStatus,
      completedAt: d.completedAt instanceof Date ? d.completedAt.toISOString() : (d.completedAt as string | null),
      blocksBilling: d.blocksBilling,
    })),
    billingChecks: allChecks,
    nextScheduleEvent: featureFlags.canonicalAppointment
      ? (canonicalNext ?? null)
      : nextEvent
        ? {
          id: nextEvent.id,
          status: nextEvent.status,
          startsAt: nextEvent.startsAt instanceof Date ? nextEvent.startsAt.toISOString() : (nextEvent.startsAt as string),
          serviceType: nextEvent.serviceType,
        }
        : null,
    ...(appointmentByService !== undefined ? { appointmentByService } : {}),
    ...(appointmentEligibleForOrderNote !== undefined ? { appointmentEligibleForOrderNote } : {}),
  };
}
