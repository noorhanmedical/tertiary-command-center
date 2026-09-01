// Schedule workspace tab — renders the ONE unified scheduler.
//
// Both the "schedule" and "calendar" workspace types render this. The entry
// CONTEXT (patient / facility / service preselected or not) flows in via the
// workspace descriptor; the UI is always the same UnifiedScheduler.

import type { WorkspaceRenderProps } from "../types";
import { UnifiedScheduler } from "@/components/portal/scheduler/UnifiedScheduler";

export function ScheduleWorkspaceTab({ workspace }: WorkspaceRenderProps) {
  const hasPatientContext =
    workspace.patientScreeningId != null || workspace.executionCaseId != null;

  return (
    <div className="h-full min-h-0" data-testid={`workspace-schedule-${workspace.id}`}>
      <UnifiedScheduler
        context={{
          patientScreeningId: workspace.patientScreeningId ?? null,
          executionCaseId: workspace.executionCaseId ?? null,
          // Only treat the title as a patient name when there is real patient
          // context; a generic "Schedule"/"Calendar" tab must start empty.
          patientName: hasPatientContext ? (workspace.title ?? null) : null,
          patientDob: (workspace.patientDob as string | undefined) ?? null,
          facility: (workspace.facilityId as string) ?? null,
          serviceType: workspace.serviceKey ?? null,
          initialDate: (workspace.initialDate as string | undefined) ?? null,
        }}
      />
    </div>
  );
}
