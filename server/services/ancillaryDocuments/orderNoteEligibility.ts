/**
 * Phase 2E — centralized Order Note eligibility.
 *
 * Order Note eligibility is TRUE only when BOTH:
 *   1. The service-specific ancillary case admin_review_status is
 *      'approved' (read from patient_ancillary_cases, NOT the
 *      screening-level compatibility projection).
 *   2. Phase 2D reports a qualifying canonical appointment (via the
 *      existing helper — appointment rules are NOT duplicated here).
 *
 * Missing report / screening data / optional forms are WARNINGS, never
 * blockers. Mandatory consent may be a clinical/legal blocker for the
 * procedure workflow but does NOT alter this two-condition contract.
 */

import { db } from "../../db";
import { and, eq } from "drizzle-orm";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { globalScheduleEvents } from "@shared/schema/globalSchedule";
import { featureFlags } from "../../lib/featureFlags";
import {
  isOrderNoteAppointmentEligible,
} from "../canonicalAppointments/canonicalAppointmentService";
import { listCanonicalAppointmentsForAncillaryCase } from "../../repositories/canonicalAppointments.repo";

export type OrderNoteEligibilityInput = {
  clinicId: number;
  ancillaryCaseId: number;
};

export type OrderNoteEligibilityResult = {
  eligible: boolean;
  adminReviewEligible: boolean;
  appointmentEligible: boolean;
  reasons: string[];
  warnings: string[];
  ancillaryCaseId: number;
  serviceType: string | null;
  qualifyingAppointmentId?: number;
  clinicMismatch?: boolean;
  caseNotFound?: boolean;
  flagOff?: boolean;
};

export async function evaluateOrderNoteEligibility(
  input: OrderNoteEligibilityInput,
): Promise<OrderNoteEligibilityResult> {
  const base: OrderNoteEligibilityResult = {
    eligible: false, adminReviewEligible: false, appointmentEligible: false,
    reasons: [], warnings: [], ancillaryCaseId: input.ancillaryCaseId, serviceType: null,
  };
  if (!featureFlags.canonicalOrderNote) {
    return { ...base, flagOff: true, reasons: ["order_note_flag_off"] };
  }

  const [ac] = await db
    .select({
      id: patientAncillaryCases.id,
      clinicId: patientAncillaryCases.clinicId,
      serviceType: patientAncillaryCases.serviceType,
      adminReviewStatus: patientAncillaryCases.adminReviewStatus,
      originatingScreeningId: patientAncillaryCases.originatingScreeningId,
      executionCaseId: patientAncillaryCases.executionCaseId,
    })
    .from(patientAncillaryCases)
    .where(eq(patientAncillaryCases.id, input.ancillaryCaseId))
    .limit(1);
  if (!ac) return { ...base, caseNotFound: true, reasons: ["ancillary_case_not_found"] };
  if (ac.clinicId !== input.clinicId) {
    return { ...base, serviceType: ac.serviceType, clinicMismatch: true, reasons: ["cross_clinic_denied"] };
  }

  const reasons: string[] = [];

  // Condition 1 — service-specific Admin Review approved.
  const adminReviewEligible = ac.adminReviewStatus === "approved";
  if (!adminReviewEligible) {
    reasons.push(
      ac.adminReviewStatus === "rejected" ? "admin_review_rejected"
      : ac.adminReviewStatus === "needs_info" ? "admin_review_needs_info"
      : "admin_review_pending",
    );
  }

  // Condition 2 — qualifying canonical appointment (Phase 2D helper).
  const appt = await isOrderNoteAppointmentEligible({ ancillaryCaseId: input.ancillaryCaseId });
  const appointmentEligible = appt.eligible;
  let qualifyingAppointmentId: number | undefined;
  if (appt.eligible) {
    qualifyingAppointmentId = appt.event.id;
  } else {
    reasons.push(await diagnoseAppointmentBlocker(ac));
  }

  return {
    eligible: adminReviewEligible && appointmentEligible,
    adminReviewEligible,
    appointmentEligible,
    reasons,
    warnings: [],
    ancillaryCaseId: input.ancillaryCaseId,
    serviceType: ac.serviceType,
    qualifyingAppointmentId,
  };
}

/**
 * Map an ineligible appointment to a specific blocker reason (labeling
 * only — the qualify/deny decision is the Phase 2D helper's). Never
 * treats a doctor_visit or provisional (null-case) event as a case
 * appointment.
 */
async function diagnoseAppointmentBlocker(ac: {
  id: number;
  serviceType: string;
  originatingScreeningId: number | null;
  executionCaseId: number | null;
}): Promise<string> {
  const events = await listCanonicalAppointmentsForAncillaryCase(ac.id);
  const matching = events.filter((e) => e.serviceType === ac.serviceType);
  if (matching.length > 0) {
    const statuses = new Set(matching.map((e) => e.status));
    if (statuses.size === 1) {
      if (statuses.has("cancelled")) return "appointment_cancelled";
      if (statuses.has("no_show")) return "appointment_no_show";
      if (statuses.has("rescheduled")) return "appointment_rescheduled";
    }
    return "no_qualifying_appointment";
  }
  if (events.length > 0) return "appointment_service_mismatch";

  // No canonical ancillary event linked to the case. Distinguish a
  // doctor_visit and a provisional (null-case) quick-schedule.
  if (ac.originatingScreeningId != null) {
    const [dv] = await db
      .select({ id: globalScheduleEvents.id })
      .from(globalScheduleEvents)
      .where(and(
        eq(globalScheduleEvents.patientScreeningId, ac.originatingScreeningId),
        eq(globalScheduleEvents.eventType, "doctor_visit"),
      ))
      .limit(1);
    if (dv) return "doctor_visit_not_eligible";
  }
  if (ac.executionCaseId != null) {
    const [prov] = await db
      .select({ id: globalScheduleEvents.id })
      .from(globalScheduleEvents)
      .where(and(
        eq(globalScheduleEvents.executionCaseId, ac.executionCaseId),
        eq(globalScheduleEvents.eventType, "ancillary_appointment"),
      ))
      .limit(1);
    if (prov) return "provisional_appointment_not_eligible";
  }
  return "no_qualifying_appointment";
}
