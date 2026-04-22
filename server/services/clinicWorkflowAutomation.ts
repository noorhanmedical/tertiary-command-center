import type {
  VisitWorkflowCard,
  ScheduleLaterReason,
} from "../../shared/clinicWorkflow";
import {
  engageLiaison,
  markPatientInterested,
  requestSameDay,
  completeScreeningForm,
  completeInformedConsent,
  scheduleLater,
  assignRemoteScheduler,
  bookFutureAppointment,
  completeUpcomingAppointmentConfirmation,
  startTechnicianWork,
  completeTest,
  applyWorkflowAutomation,
} from "../../shared/clinicWorkflow";

export type WorkflowMutation =
  | { type: "engage_liaison" }
  | { type: "mark_interested"; interested: boolean }
  | { type: "request_same_day" }
  | { type: "complete_screening_form" }
  | { type: "complete_informed_consent" }
  | { type: "schedule_later"; reason: ScheduleLaterReason; callbackWindow: string | null }
  | { type: "assign_remote_scheduler"; schedulerId: string }
  | { type: "book_future_appointment" }
  | { type: "complete_upcoming_appointment_confirmation" }
  | { type: "start_technician_work" }
  | { type: "complete_test" };

export function applyWorkflowMutation(
  card: VisitWorkflowCard,
  mutation: WorkflowMutation,
  nowIso = new Date().toISOString(),
): VisitWorkflowCard {
  switch (mutation.type) {
    case "engage_liaison":
      return engageLiaison(card, nowIso);
    case "mark_interested":
      return markPatientInterested(card, mutation.interested, nowIso);
    case "request_same_day":
      return requestSameDay(card, nowIso);
    case "complete_screening_form":
      return completeScreeningForm(card, nowIso);
    case "complete_informed_consent":
      return completeInformedConsent(card, nowIso);
    case "schedule_later":
      return scheduleLater(card, mutation.reason, mutation.callbackWindow, nowIso);
    case "assign_remote_scheduler":
      return assignRemoteScheduler(card, mutation.schedulerId, nowIso);
    case "book_future_appointment":
      return bookFutureAppointment(card, nowIso);
    case "complete_upcoming_appointment_confirmation":
      return completeUpcomingAppointmentConfirmation(card, nowIso);
    case "start_technician_work":
      return startTechnicianWork(card, nowIso);
    case "complete_test":
      return completeTest(card, nowIso);
    default:
      return applyWorkflowAutomation(card, nowIso);
  }
}

export function getWorkflowQueues(cards: VisitWorkflowCard[]) {
  const automated = cards.map((card) => applyWorkflowAutomation(card, new Date().toISOString()));
  return {
    liaison: automated.filter((c) => !c.indicators.testCompleted && !c.indicators.futureAppointmentBooked),
    technician: automated.filter((c) => c.indicators.readyForTechnician || c.indicators.withTechnician),
    remoteScheduler: automated.filter(
      (c) => c.indicators.scheduleLater || c.indicators.upcomingAppointmentConfirmationNeeded,
    ),
  };
}
