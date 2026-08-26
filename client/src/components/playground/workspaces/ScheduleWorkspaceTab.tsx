// Schedule workspace tab — renders the existing scheduling/calendar surface.

import type { WorkspaceRenderProps } from "../types";
import { SchedulingWorkspace } from "@/components/portal/SchedulingWorkspace";
import type { CallCaseContext } from "@/components/portal/caseWorkspace";

export function ScheduleWorkspaceTab({ workspace }: WorkspaceRenderProps) {
  // Build a minimal context for the scheduling workspace.
  const ctx: CallCaseContext = {
    patientScreeningId: workspace.patientScreeningId ?? null,
    executionCaseId: workspace.executionCaseId ?? null,
    patientName: workspace.title ?? "Schedule",
    patientDob: null,
    facilityId: (workspace.facilityId as string) ?? null,
    callReason: "",
    targetServices: workspace.serviceKey ? [workspace.serviceKey] : [],
    ancillaryCaseId: workspace.ancillaryCaseId ?? null,
    serviceType: workspace.serviceKey ?? null,
    sourcePortal: "PCS",
    engagementStatus: null,
    lifecycleStatus: null,
  };

  return (
    <div className="h-full overflow-auto" data-testid={`workspace-schedule-${workspace.id}`}>
      <SchedulingWorkspace
        ctx={ctx}
        facility={(workspace.facilityId as string) ?? null}
        selectedDate={new Date().toISOString().slice(0, 10)}
        onClose={() => {}}
      />
    </div>
  );
}
