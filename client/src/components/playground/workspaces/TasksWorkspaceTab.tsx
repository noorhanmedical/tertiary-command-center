// Tasks workspace tab — renders the existing Plexus Tasks system.

import type { WorkspaceRenderProps } from "../types";
import { PortalPlexusTasksTab } from "@/components/portal/PortalPlexusTasksTab";
import { usePlayground } from "../PlaygroundWorkspaceProvider";

export function TasksWorkspaceTab({ workspace }: WorkspaceRenderProps) {
  const { foregroundPatientId } = usePlayground();

  return (
    <div className="h-full overflow-auto" data-testid={`workspace-tasks-${workspace.id}`}>
      <PortalPlexusTasksTab
        patientScreeningId={workspace.patientScreeningId ?? foregroundPatientId}
      />
    </div>
  );
}
