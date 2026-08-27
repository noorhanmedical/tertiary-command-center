// Call workspace tab — wraps the existing CallWorkspace component for Playground.
//
// Owns the Playground-facing dirty-state contract for the call workspace:
//   • DispositionSheet draft (outcome/notes/callback) → setDirty(id, true)
//   • successful canonical log → setDirty(id, false)
//   • "Save & Close" on a dirty tab → open the disposition sheet so the user
//     completes the canonical log (a clinical call is never silently persisted;
//     the registered save handler resolves false to keep the tab open until the
//     user logs, at which point onLogged clears dirty and the user can close).

import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayground } from "../PlaygroundWorkspaceProvider";
import type { WorkspaceRenderProps } from "../types";
import { CallWorkspace } from "@/components/portal/CallWorkspace";
import type { CallCaseContext } from "@/components/portal/caseWorkspace";

export function CallWorkspaceTab({ workspace }: WorkspaceRenderProps) {
  const { setDirty, closeWorkspace, registerSaveHandler } = usePlayground();
  const [openDispositionSignal, setOpenDispositionSignal] = useState(0);

  // Track dirty in a ref so the save handler reads the latest value without
  // being re-registered on every draft keystroke.
  const dirtyRef = useRef(false);

  const handleDraftChange = useCallback(
    (dirty: boolean, description?: string) => {
      dirtyRef.current = dirty;
      setDirty(workspace.id, dirty, description);
    },
    [setDirty, workspace.id],
  );

  const handleLogged = useCallback(() => {
    dirtyRef.current = false;
    setDirty(workspace.id, false);
  }, [setDirty, workspace.id]);

  // Register a save handler for the tab bar's "Save & Close". If there is an
  // unsaved disposition draft, open the sheet and keep the workspace open
  // (resolve false) so the user finalizes the canonical write. If there is no
  // draft, resolve true so close proceeds.
  useEffect(() => {
    return registerSaveHandler(workspace.id, async () => {
      if (!dirtyRef.current) return true;
      setOpenDispositionSignal((n) => n + 1);
      return false;
    });
  }, [registerSaveHandler, workspace.id]);

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
        onDraftChange={handleDraftChange}
        onLogged={handleLogged}
        requestOpenDisposition={openDispositionSignal}
      />
    </div>
  );
}
