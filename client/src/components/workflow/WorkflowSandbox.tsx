import React from "react";
import type { VisitWorkflowCard } from "../../../../shared/clinicWorkflow";
import {
  DEFAULT_CLINIC_WORKFLOW_ASSIGNMENT,
  DEFAULT_CLINIC_WORKFLOW_INDICATORS,
  DEFAULT_CLINIC_WORKFLOW_TIMESTAMPS,
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
} from "../../../../shared/clinicWorkflow";
import WorkflowIndicators from "./WorkflowIndicators";
import WorkflowQueueBoard from "./WorkflowQueueBoard";

function createDemoCard(overrides?: Partial<VisitWorkflowCard>): VisitWorkflowCard {
  return {
    patientId: "demo-patient-001",
    visitId: "demo-visit-001",
    facility: "Main Clinic",
    clinicDate: new Date().toISOString().slice(0, 10),
    appointmentTime: "10:00 AM",
    qualifiedService: "BrainWave",
    status: "prescreened_eligible",
    indicators: { ...DEFAULT_CLINIC_WORKFLOW_INDICATORS },
    assignment: { ...DEFAULT_CLINIC_WORKFLOW_ASSIGNMENT },
    timestamps: { ...DEFAULT_CLINIC_WORKFLOW_TIMESTAMPS },
    ...overrides,
  };
}

export default function WorkflowSandbox() {
  const [card, setCard] = React.useState<VisitWorkflowCard>(() => createDemoCard());

  const nowIso = () => new Date().toISOString();

  const update = (next: VisitWorkflowCard) => setCard(applyWorkflowAutomation(next, nowIso()));

  const liaisonQueue = [card];
  const technicianQueue = card.indicators.readyForTechnician || card.indicators.withTechnician ? [card] : [];
  const remoteSchedulerQueue =
    card.indicators.scheduleLater || card.indicators.upcomingAppointmentConfirmationNeeded ? [card] : [];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-lg font-semibold text-slate-900">Liaison Technician Portal Sandbox</div>
        <div className="mb-4 text-sm text-slate-600">
          This is a safe local demo of the canonical clinic workflow state model.
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => update(engageLiaison(card, nowIso()))}>
            Engage Liaison
          </button>
          <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => update(markPatientInterested(card, true, nowIso()))}>
            Mark Interested
          </button>
          <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => update(markPatientInterested(card, false, nowIso()))}>
            Mark Declined
          </button>
          <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => update(requestSameDay(card, nowIso()))}>
            Request Same-Day
          </button>
          <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => update(completeScreeningForm(card, nowIso()))}>
            Screening Complete
          </button>
          <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => update(completeInformedConsent(card, nowIso()))}>
            Consent Complete
          </button>
          <button
            className="rounded-xl border px-3 py-2 text-sm"
            onClick={() =>
              update(
                scheduleLater(card, "patient_requested_later", "Later Today", nowIso()),
              )
            }
          >
            Schedule Later
          </button>
          <button
            className="rounded-xl border px-3 py-2 text-sm"
            onClick={() => update(assignRemoteScheduler(card, "scheduler-01", nowIso()))}
          >
            Assign Scheduler
          </button>
          <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => update(bookFutureAppointment(card, nowIso()))}>
            Book Future Appointment
          </button>
          <button
            className="rounded-xl border px-3 py-2 text-sm"
            onClick={() => update(completeUpcomingAppointmentConfirmation(card, nowIso()))}
          >
            Complete Upcoming Confirmation
          </button>
          <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => update(startTechnicianWork(card, nowIso()))}>
            Start Technician Work
          </button>
          <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => update(completeTest(card, nowIso()))}>
            Complete Test
          </button>
          <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => setCard(createDemoCard())}>
            Reset Demo
          </button>
        </div>
      </div>

      <WorkflowIndicators card={card} />

      <WorkflowQueueBoard
        liaison={liaisonQueue}
        technician={technicianQueue}
        remoteScheduler={remoteSchedulerQueue}
      />
    </div>
  );
}
