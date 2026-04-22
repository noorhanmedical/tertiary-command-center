export const TEAM_MEMBER_ROLES = [
  "liaison",
  "technician",
  "remote_scheduler",
] as const;

export type TeamMemberRole = typeof TEAM_MEMBER_ROLES[number];

export const CLINIC_WORKFLOW_STATUS = [
  "prescreened_eligible",
  "liaison_engaged",
  "patient_declined",
  "patient_interested",
  "same_day_requested",
  "ready_for_technician",
  "with_technician",
  "test_completed",
  "schedule_later",
  "remote_scheduler_follow_up",
  "future_appointment_booked",
  "upcoming_appointment_confirmation",
  "completed",
  "unable_to_complete",
] as const;

export type ClinicWorkflowStatus = typeof CLINIC_WORKFLOW_STATUS[number];

export const SCHEDULE_LATER_REASONS = [
  "patient_unsure",
  "patient_requested_later",
  "time_constraint",
  "liaison_interrupted",
  "technician_unavailable",
  "missing_screening_form",
  "missing_informed_consent",
  "other",
] as const;

export type ScheduleLaterReason = typeof SCHEDULE_LATER_REASONS[number];

export const WORKFLOW_ACTIONS = [
  "engage_patient",
  "mark_interested",
  "mark_declined",
  "request_same_day",
  "complete_screening_form",
  "complete_informed_consent",
  "mark_ready_for_technician",
  "start_test",
  "complete_test",
  "schedule_later",
  "assign_remote_scheduler",
  "book_future_appointment",
  "mark_upcoming_appointment_confirmation_needed",
  "complete_upcoming_appointment_confirmation",
  "mark_unable_to_complete",
] as const;

export type WorkflowAction = typeof WORKFLOW_ACTIONS[number];

export interface ClinicWorkflowIndicators {
  prescreenedEligible: boolean;
  liaisonEngaged: boolean;
  patientInterested: boolean | null;
  sameDayRequested: boolean;
  screeningFormComplete: boolean;
  informedConsentComplete: boolean;
  readyForTechnician: boolean;
  withTechnician: boolean;
  testCompleted: boolean;
  scheduleLater: boolean;
  futureAppointmentBooked: boolean;
  upcomingAppointmentConfirmationNeeded: boolean;
  upcomingAppointmentConfirmationComplete: boolean;
}

export interface ClinicWorkflowAssignment {
  remoteSchedulerAssignedTo: string | null;
  callbackWindow: string | null;
  scheduleLaterReason: ScheduleLaterReason | null;
}

export interface ClinicWorkflowTimestamps {
  engagedAt: string | null;
  screeningCompletedAt: string | null;
  informedConsentCompletedAt: string | null;
  readyForTechnicianAt: string | null;
  withTechnicianAt: string | null;
  testCompletedAt: string | null;
  scheduleLaterAt: string | null;
  futureAppointmentBookedAt: string | null;
  upcomingAppointmentConfirmationCompletedAt: string | null;
}

export interface VisitWorkflowCard {
  patientId: string;
  visitId: string;
  facility: string;
  clinicDate: string;
  appointmentTime: string | null;
  qualifiedService: string | null;
  status: ClinicWorkflowStatus;
  indicators: ClinicWorkflowIndicators;
  assignment: ClinicWorkflowAssignment;
  timestamps: ClinicWorkflowTimestamps;
}

export const DEFAULT_CLINIC_WORKFLOW_INDICATORS: ClinicWorkflowIndicators = {
  prescreenedEligible: true,
  liaisonEngaged: false,
  patientInterested: null,
  sameDayRequested: false,
  screeningFormComplete: false,
  informedConsentComplete: false,
  readyForTechnician: false,
  withTechnician: false,
  testCompleted: false,
  scheduleLater: false,
  futureAppointmentBooked: false,
  upcomingAppointmentConfirmationNeeded: false,
  upcomingAppointmentConfirmationComplete: false,
};

export const DEFAULT_CLINIC_WORKFLOW_ASSIGNMENT: ClinicWorkflowAssignment = {
  remoteSchedulerAssignedTo: null,
  callbackWindow: null,
  scheduleLaterReason: null,
};

export const DEFAULT_CLINIC_WORKFLOW_TIMESTAMPS: ClinicWorkflowTimestamps = {
  engagedAt: null,
  screeningCompletedAt: null,
  informedConsentCompletedAt: null,
  readyForTechnicianAt: null,
  withTechnicianAt: null,
  testCompletedAt: null,
  scheduleLaterAt: null,
  futureAppointmentBookedAt: null,
  upcomingAppointmentConfirmationCompletedAt: null,
};

export function canBeReadyForTechnician(
  indicators: Pick<
    ClinicWorkflowIndicators,
    "sameDayRequested" | "screeningFormComplete" | "informedConsentComplete"
  >,
): boolean {
  return (
    indicators.sameDayRequested &&
    indicators.screeningFormComplete &&
    indicators.informedConsentComplete
  );
}

export function shouldCreateRemoteSchedulerFollowUp(
  indicators: Pick<ClinicWorkflowIndicators, "scheduleLater" | "futureAppointmentBooked">,
): boolean {
  return indicators.scheduleLater && !indicators.futureAppointmentBooked;
}

export function shouldCreateUpcomingAppointmentConfirmation(
  indicators: Pick<
    ClinicWorkflowIndicators,
    "futureAppointmentBooked" | "upcomingAppointmentConfirmationComplete"
  >,
): boolean {
  return (
    indicators.futureAppointmentBooked &&
    !indicators.upcomingAppointmentConfirmationComplete
  );
}

export function deriveClinicWorkflowStatus(
  indicators: ClinicWorkflowIndicators,
): ClinicWorkflowStatus {
  if (indicators.testCompleted) return "completed";
  if (indicators.withTechnician) return "with_technician";
  if (indicators.readyForTechnician) return "ready_for_technician";
  if (indicators.upcomingAppointmentConfirmationNeeded) {
    return "upcoming_appointment_confirmation";
  }
  if (indicators.futureAppointmentBooked) return "future_appointment_booked";
  if (indicators.scheduleLater) return "remote_scheduler_follow_up";
  if (indicators.sameDayRequested) return "same_day_requested";
  if (indicators.patientInterested === true) return "patient_interested";
  if (indicators.liaisonEngaged) return "liaison_engaged";
  return "prescreened_eligible";
}

export function applyWorkflowAutomation(
  card: VisitWorkflowCard,
  nowIso: string,
): VisitWorkflowCard {
  const next: VisitWorkflowCard = {
    ...card,
    indicators: { ...card.indicators },
    assignment: { ...card.assignment },
    timestamps: { ...card.timestamps },
  };

  if (canBeReadyForTechnician(next.indicators)) {
    next.indicators.readyForTechnician = true;
    next.indicators.scheduleLater = false;
    next.assignment.scheduleLaterReason = null;
    if (!next.timestamps.readyForTechnicianAt) {
      next.timestamps.readyForTechnicianAt = nowIso;
    }
  }

  if (shouldCreateRemoteSchedulerFollowUp(next.indicators)) {
    next.status = "remote_scheduler_follow_up";
    if (!next.timestamps.scheduleLaterAt) {
      next.timestamps.scheduleLaterAt = nowIso;
    }
  }

  if (shouldCreateUpcomingAppointmentConfirmation(next.indicators)) {
    next.indicators.upcomingAppointmentConfirmationNeeded = true;
  }

  next.status = deriveClinicWorkflowStatus(next.indicators);
  return next;
}

export function engageLiaison(card: VisitWorkflowCard, nowIso: string): VisitWorkflowCard {
  return applyWorkflowAutomation(
    {
      ...card,
      indicators: {
        ...card.indicators,
        liaisonEngaged: true,
      },
      timestamps: {
        ...card.timestamps,
        engagedAt: card.timestamps.engagedAt ?? nowIso,
      },
    },
    nowIso,
  );
}

export function markPatientInterested(
  card: VisitWorkflowCard,
  interested: boolean,
  nowIso: string,
): VisitWorkflowCard {
  return applyWorkflowAutomation(
    {
      ...card,
      indicators: {
        ...card.indicators,
        patientInterested: interested,
      },
      status: interested ? "patient_interested" : "patient_declined",
    },
    nowIso,
  );
}

export function requestSameDay(card: VisitWorkflowCard, nowIso: string): VisitWorkflowCard {
  return applyWorkflowAutomation(
    {
      ...card,
      indicators: {
        ...card.indicators,
        sameDayRequested: true,
        scheduleLater: false,
      },
      assignment: {
        ...card.assignment,
        scheduleLaterReason: null,
      },
      status: "same_day_requested",
    },
    nowIso,
  );
}

export function completeScreeningForm(
  card: VisitWorkflowCard,
  nowIso: string,
): VisitWorkflowCard {
  return applyWorkflowAutomation(
    {
      ...card,
      indicators: {
        ...card.indicators,
        screeningFormComplete: true,
      },
      timestamps: {
        ...card.timestamps,
        screeningCompletedAt: card.timestamps.screeningCompletedAt ?? nowIso,
      },
    },
    nowIso,
  );
}

export function completeInformedConsent(
  card: VisitWorkflowCard,
  nowIso: string,
): VisitWorkflowCard {
  return applyWorkflowAutomation(
    {
      ...card,
      indicators: {
        ...card.indicators,
        informedConsentComplete: true,
      },
      timestamps: {
        ...card.timestamps,
        informedConsentCompletedAt:
          card.timestamps.informedConsentCompletedAt ?? nowIso,
      },
    },
    nowIso,
  );
}

export function scheduleLater(
  card: VisitWorkflowCard,
  reason: ScheduleLaterReason,
  callbackWindow: string | null,
  nowIso: string,
): VisitWorkflowCard {
  return applyWorkflowAutomation(
    {
      ...card,
      indicators: {
        ...card.indicators,
        scheduleLater: true,
        sameDayRequested: false,
        readyForTechnician: false,
      },
      assignment: {
        ...card.assignment,
        scheduleLaterReason: reason,
        callbackWindow,
      },
      timestamps: {
        ...card.timestamps,
        scheduleLaterAt: card.timestamps.scheduleLaterAt ?? nowIso,
      },
      status: "schedule_later",
    },
    nowIso,
  );
}

export function assignRemoteScheduler(
  card: VisitWorkflowCard,
  schedulerId: string,
  nowIso: string,
): VisitWorkflowCard {
  return applyWorkflowAutomation(
    {
      ...card,
      assignment: {
        ...card.assignment,
        remoteSchedulerAssignedTo: schedulerId,
      },
      status: "remote_scheduler_follow_up",
    },
    nowIso,
  );
}

export function bookFutureAppointment(
  card: VisitWorkflowCard,
  nowIso: string,
): VisitWorkflowCard {
  return applyWorkflowAutomation(
    {
      ...card,
      indicators: {
        ...card.indicators,
        futureAppointmentBooked: true,
      },
      timestamps: {
        ...card.timestamps,
        futureAppointmentBookedAt:
          card.timestamps.futureAppointmentBookedAt ?? nowIso,
      },
      status: "future_appointment_booked",
    },
    nowIso,
  );
}

export function completeUpcomingAppointmentConfirmation(
  card: VisitWorkflowCard,
  nowIso: string,
): VisitWorkflowCard {
  return applyWorkflowAutomation(
    {
      ...card,
      indicators: {
        ...card.indicators,
        upcomingAppointmentConfirmationNeeded: false,
        upcomingAppointmentConfirmationComplete: true,
      },
      timestamps: {
        ...card.timestamps,
        upcomingAppointmentConfirmationCompletedAt:
          card.timestamps.upcomingAppointmentConfirmationCompletedAt ?? nowIso,
      },
    },
    nowIso,
  );
}

export function startTechnicianWork(
  card: VisitWorkflowCard,
  nowIso: string,
): VisitWorkflowCard {
  return applyWorkflowAutomation(
    {
      ...card,
      indicators: {
        ...card.indicators,
        withTechnician: true,
      },
      timestamps: {
        ...card.timestamps,
        withTechnicianAt: card.timestamps.withTechnicianAt ?? nowIso,
      },
      status: "with_technician",
    },
    nowIso,
  );
}

export function completeTest(card: VisitWorkflowCard, nowIso: string): VisitWorkflowCard {
  return applyWorkflowAutomation(
    {
      ...card,
      indicators: {
        ...card.indicators,
        withTechnician: false,
        testCompleted: true,
      },
      timestamps: {
        ...card.timestamps,
        testCompletedAt: card.timestamps.testCompletedAt ?? nowIso,
      },
      status: "test_completed",
    },
    nowIso,
  );
}
