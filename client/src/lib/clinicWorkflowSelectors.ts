import type {
  VisitWorkflowCard,
  ClinicWorkflowIndicators,
  ClinicWorkflowStatus,
  ScheduleLaterReason,
} from "../../../shared/clinicWorkflow";
import {
  deriveClinicWorkflowStatus,
  canBeReadyForTechnician,
  shouldCreateRemoteSchedulerFollowUp,
  shouldCreateUpcomingAppointmentConfirmation,
} from "../../../shared/clinicWorkflow";

export type WorkflowDisplayTone =
  | "neutral"
  | "info"
  | "warning"
  | "success"
  | "danger";

export function getWorkflowDisplayLabel(status: ClinicWorkflowStatus): string {
  switch (status) {
    case "prescreened_eligible":
      return "Prescreened Eligible";
    case "liaison_engaged":
      return "Liaison Engaged";
    case "patient_declined":
      return "Patient Declined";
    case "patient_interested":
      return "Patient Interested";
    case "same_day_requested":
      return "Same-Day Requested";
    case "ready_for_technician":
      return "Ready for Technician";
    case "with_technician":
      return "With Technician";
    case "test_completed":
      return "Test Completed";
    case "schedule_later":
      return "Schedule Later";
    case "remote_scheduler_follow_up":
      return "Remote Scheduler Follow-Up";
    case "future_appointment_booked":
      return "Future Appointment Booked";
    case "upcoming_appointment_confirmation":
      return "Upcoming Appointment Confirmation";
    case "completed":
      return "Completed";
    case "unable_to_complete":
      return "Unable to Complete";
    default:
      return status;
  }
}

export function getWorkflowTone(status: ClinicWorkflowStatus): WorkflowDisplayTone {
  switch (status) {
    case "ready_for_technician":
    case "test_completed":
    case "completed":
      return "success";
    case "schedule_later":
    case "remote_scheduler_follow_up":
    case "upcoming_appointment_confirmation":
      return "warning";
    case "patient_declined":
    case "unable_to_complete":
      return "danger";
    case "liaison_engaged":
    case "patient_interested":
    case "same_day_requested":
    case "future_appointment_booked":
      return "info";
    default:
      return "neutral";
  }
}

export function getScheduleLaterReasonLabel(reason: ScheduleLaterReason | null): string {
  switch (reason) {
    case "patient_unsure":
      return "Patient Unsure";
    case "patient_requested_later":
      return "Patient Requested Later";
    case "time_constraint":
      return "Time Constraint";
    case "liaison_interrupted":
      return "Liaison Interrupted";
    case "technician_unavailable":
      return "Technician Unavailable";
    case "missing_screening_form":
      return "Missing Screening Form";
    case "missing_informed_consent":
      return "Missing Informed Consent";
    case "other":
      return "Other";
    default:
      return "Not Set";
  }
}

export function getWorkflowChecklist(indicators: ClinicWorkflowIndicators) {
  return [
    { key: "prescreenedEligible", label: "Prescreened Eligible", done: indicators.prescreenedEligible },
    { key: "liaisonEngaged", label: "Liaison Engaged", done: indicators.liaisonEngaged },
    { key: "patientInterested", label: "Patient Interested", done: indicators.patientInterested === true },
    { key: "sameDayRequested", label: "Same-Day Requested", done: indicators.sameDayRequested },
    { key: "screeningFormComplete", label: "Screening Form Complete", done: indicators.screeningFormComplete },
    { key: "informedConsentComplete", label: "Informed Consent Complete", done: indicators.informedConsentComplete },
    { key: "readyForTechnician", label: "Ready for Technician", done: indicators.readyForTechnician },
    { key: "withTechnician", label: "With Technician", done: indicators.withTechnician },
    { key: "testCompleted", label: "Test Completed", done: indicators.testCompleted },
    { key: "futureAppointmentBooked", label: "Future Appointment Booked", done: indicators.futureAppointmentBooked },
    {
      key: "upcomingAppointmentConfirmationNeeded",
      label: "Upcoming Appointment Confirmation Needed",
      done: indicators.upcomingAppointmentConfirmationNeeded,
    },
    {
      key: "upcomingAppointmentConfirmationComplete",
      label: "Upcoming Appointment Confirmation Complete",
      done: indicators.upcomingAppointmentConfirmationComplete,
    },
  ];
}

export function getWorkflowWarnings(card: VisitWorkflowCard): string[] {
  const warnings: string[] = [];
  if (card.indicators.sameDayRequested && !card.indicators.screeningFormComplete) {
    warnings.push("Same-day requested but screening form is incomplete.");
  }
  if (card.indicators.sameDayRequested && !card.indicators.informedConsentComplete) {
    warnings.push("Same-day requested but informed consent is incomplete.");
  }
  if (card.indicators.readyForTechnician && !canBeReadyForTechnician(card.indicators)) {
    warnings.push("Patient is marked ready for technician without the required same-day prerequisites.");
  }
  if (shouldCreateRemoteSchedulerFollowUp(card.indicators) && !card.assignment.remoteSchedulerAssignedTo) {
    warnings.push("Remote scheduler follow-up is needed but no scheduler is assigned.");
  }
  if (shouldCreateUpcomingAppointmentConfirmation(card.indicators)) {
    warnings.push("Future appointment exists and upcoming appointment confirmation is still needed.");
  }
  return warnings;
}

export function normalizeWorkflowCard(card: VisitWorkflowCard): VisitWorkflowCard {
  return {
    ...card,
    status: deriveClinicWorkflowStatus(card.indicators),
  };
}
