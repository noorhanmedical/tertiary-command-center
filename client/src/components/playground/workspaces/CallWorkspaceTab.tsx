// Call workspace tab — wraps the existing CallWorkspace component for Playground.

import { useState } from "react";
import { usePlayground } from "../PlaygroundWorkspaceProvider";
import type { WorkspaceRenderProps } from "../types";
import { CallWorkspace } from "@/components/portal/CallWorkspace";
import type { CallCaseContext } from "@/components/portal/caseWorkspace";

export function CallWorkspaceTab({ workspace, isActive }: WorkspaceRenderProps) {
  const { setDirty, closeWorkspace } = usePlayground();
  const [notesDraft, setNotesDraft] = useState("");

  // Build CallCaseContext from workspace fields.
  const ctx: CallCaseContext = {
    patientScreeningId: workspace.patientScreeningId ?? null,
    executionCaseId: workspace.executionCaseId ?? null,
    patientName: workspace.title ?? "Patient",
    patientDob: null,
    facilityId: (workspace.facilityId as string) ?? null,
    callReason: workspace.subtitle ?? "Engagement call",
    targetServices: workspace.serviceKey ? [workspace.serviceKey] : [],
    ancillaryCaseId: workspace.ancillaryCaseId ?? null,
    serviceType: workspace.serviceKey ?? null,
    sourcePortal: "PCS",
    engagementStatus: null,
    lifecycleStatus: null,
  };

  return (
    <div className="h-full overflow-auto" data-testid={`workspace-call-${workspace.id}`}>
      <CallWorkspace
        ctx={ctx}
        onScheduleCase={() => {
          // Future: open schedule workspace for this patient
        }}
        onOpenCase={() => {
          // Future: open case overview
        }}
        onClose={() => closeWorkspace(workspace.id)}
      />
    </div>
  );
}
