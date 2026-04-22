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

function createDemoCard(): VisitWorkflowCard {
  return {
    patientId: "liaison-demo-patient",
    visitId: "liaison-demo-visit",
    facility: "Main Clinic",
    clinicDate: new Date().toISOString().slice(0, 10),
    appointmentTime: "10:00 AM",
    qualifiedService: "BrainWave",
    status: "prescreened_eligible",
    indicators: { ...DEFAULT_CLINIC_WORKFLOW_INDICATORS },
    assignment: { ...DEFAULT_CLINIC_WORKFLOW_ASSIGNMENT },
    timestamps: { ...DEFAULT_CLINIC_WORKFLOW_TIMESTAMPS },
  };
}

export default function WorkflowInlinePanel() {
  const [card, setCard] = React.useState<VisitWorkflowCard>(() => createDemoCard());

  const nowIso = () => new Date().toISOString();
  const applyLocal = (next: VisitWorkflowCard) => setCard(applyWorkflowAutomation(next, nowIso()));

  return (
    <div className="mb-6 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Shared Clinic Workflow</h2>
        <p className="text-sm text-slate-600">Liaison, technician, and remote scheduler indicator flow.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => applyLocal(engageLiaison(card, nowIso()))}>Engage Liaison</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => applyLocal(markPatientInterested(card, true, nowIso()))}>Interested</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => applyLocal(markPatientInterested(card, false, nowIso()))}>Declined</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => applyLocal(requestSameDay(card, nowIso()))}>Same-Day</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => applyLocal(completeScreeningForm(card, nowIso()))}>Screening Complete</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => applyLocal(completeInformedConsent(card, nowIso()))}>Consent Complete</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => applyLocal(scheduleLater(card, "patient_requested_later", "Later Today", nowIso()))}>Schedule Later</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => applyLocal(assignRemoteScheduler(card, "scheduler-01", nowIso()))}>Assign Scheduler</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => applyLocal(bookFutureAppointment(card, nowIso()))}>Book Future Appointment</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => applyLocal(completeUpcomingAppointmentConfirmation(card, nowIso()))}>Complete Upcoming Confirmation</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => applyLocal(startTechnicianWork(card, nowIso()))}>Start Technician</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => applyLocal(completeTest(card, nowIso()))}>Complete Test</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => setCard(createDemoCard())}>Reset</button>
      </div>

      <WorkflowIndicators card={card} />
    </div>
  );
}
