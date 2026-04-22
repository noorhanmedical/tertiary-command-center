import React from "react";
import type { VisitWorkflowCard } from "../../../../shared/clinicWorkflow";
import {
  DEFAULT_CLINIC_WORKFLOW_ASSIGNMENT,
  DEFAULT_CLINIC_WORKFLOW_INDICATORS,
  DEFAULT_CLINIC_WORKFLOW_TIMESTAMPS,
  applyWorkflowAutomation,
} from "../../../../shared/clinicWorkflow";
import WorkflowIndicators from "./WorkflowIndicators";

type PortalPatient = {
  patientScreeningId: number | null;
  name: string;
  dob: string | null;
  time: string | null;
  facility: string;
  clinicianName: string | null;
  qualifyingTests: string[];
  appointmentStatus: string;
  consentSigned: boolean;
  appointments: Array<{ id: number; testType: string; scheduledTime: string; status: string }>;
};

type Role = "technician" | "liaison";

function deriveWorkflowCard(patient: PortalPatient, selectedDate: string): VisitWorkflowCard {
  const appointmentStatuses = patient.appointments.map((a) => String(a.status || "").toLowerCase());
  const hasAppointments = patient.appointments.length > 0;
  const hasQualifyingTests = patient.qualifyingTests.length > 0;
  const withTechnician =
    appointmentStatuses.some((s) => s.includes("progress")) ||
    appointmentStatuses.some((s) => s.includes("room")) ||
    appointmentStatuses.some((s) => s.includes("started"));

  const testCompleted =
    appointmentStatuses.some((s) => s.includes("complete")) ||
    appointmentStatuses.some((s) => s.includes("done"));

  const futureAppointmentBooked = hasAppointments;
  const scheduleLater = !hasAppointments && hasQualifyingTests;
  const sameDayRequested = hasAppointments;
  const readyForTechnician = Boolean(hasAppointments && patient.consentSigned && !testCompleted);

  return applyWorkflowAutomation(
    {
      patientId: patient.patientScreeningId != null ? String(patient.patientScreeningId) : patient.name,
      visitId: patient.patientScreeningId != null ? `visit-${patient.patientScreeningId}` : `visit-${patient.name}`,
      facility: patient.facility,
      clinicDate: selectedDate,
      appointmentTime: patient.time,
      qualifiedService: patient.qualifyingTests[0] ?? null,
      status: "prescreened_eligible",
      indicators: {
        ...DEFAULT_CLINIC_WORKFLOW_INDICATORS,
        prescreenedEligible: true,
        patientInterested: hasQualifyingTests ? true : null,
        sameDayRequested,
        screeningFormComplete: false,
        informedConsentComplete: patient.consentSigned,
        readyForTechnician,
        withTechnician,
        testCompleted,
        scheduleLater,
        futureAppointmentBooked,
        upcomingAppointmentConfirmationNeeded: false,
        upcomingAppointmentConfirmationComplete: false,
      },
      assignment: {
        ...DEFAULT_CLINIC_WORKFLOW_ASSIGNMENT,
        scheduleLaterReason: scheduleLater ? "patient_requested_later" : null,
      },
      timestamps: {
        ...DEFAULT_CLINIC_WORKFLOW_TIMESTAMPS,
      },
    },
    new Date().toISOString(),
  );
}

export default function PortalWorkflowPanel({
  patient,
  role,
  selectedDate,
}: {
  patient: PortalPatient;
  role: Role;
  selectedDate: string;
}) {
  const card = React.useMemo(() => deriveWorkflowCard(patient, selectedDate), [patient, selectedDate]);

  return (
    <div className="mb-4 space-y-3" data-testid={`portal-workflow-panel-${role}`}>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="text-sm font-semibold text-slate-900">Shared Clinic Workflow</div>
        <div className="text-xs text-slate-500">
          Live shared state for liaison and technician on the selected patient.
        </div>
      </div>
      <WorkflowIndicators card={card} />
    </div>
  );
}
