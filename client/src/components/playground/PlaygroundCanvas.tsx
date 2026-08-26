// Playground Canvas — renders the active workspace content.
//
// Performance: only the active workspace is mounted. Inactive workspaces
// with keepAlive=true are preserved via React key stability + Query cache.
// Heavy workspaces (patient_ehr) unmount when inactive to save resources.

import { usePlayground } from "./PlaygroundWorkspaceProvider";
import { getWorkspaceDefinition } from "./registry";
import { PlaygroundTabBar } from "./PlaygroundTabBar";

export function PlaygroundCanvas() {
  const { workspaces, activeWorkspaceId, activeWorkspace } = usePlayground();

  const def = activeWorkspace ? getWorkspaceDefinition(activeWorkspace.type) : null;
  const Renderer = def?.render ?? null;

  return (
    <div className="flex flex-col h-full" data-testid="playground-canvas">
      <PlaygroundTabBar />
      <div className="flex-1 min-h-0 overflow-auto" data-testid="playground-workspace-content">
        {activeWorkspace && Renderer ? (
          <Renderer
            key={activeWorkspace.id}
            workspace={activeWorkspace}
            isActive={true}
          />
        ) : (
          <div className="flex h-full items-center justify-center" data-testid="playground-empty">
            <div className="text-center space-y-3">
              <div className="text-xl font-light text-slate-300 tracking-wide">Your Playground</div>
              <p className="text-sm text-slate-400 max-w-sm">
                Select a patient or open a workspace from the dock, rails, or work queue.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
