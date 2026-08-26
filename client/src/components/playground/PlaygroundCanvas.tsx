// Playground Canvas — renders the active workspace content.
//
// Performance: only the active workspace is mounted. Inactive workspaces
// with keepAlive=true are preserved via React key stability + Query cache.
// Heavy workspaces (patient_ehr) unmount when inactive to save resources.

import { usePlayground } from "./PlaygroundWorkspaceProvider";
import { getWorkspaceDefinition } from "./registry";
import { PlaygroundTabBar } from "./PlaygroundTabBar";
import { PlaygroundHomeArtwork } from "./workspaces/PlaygroundHomeArtwork";

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
          <div className="h-full" style={{ background: "#FAFBFD" }} data-testid="playground-empty">
            <PlaygroundHomeArtwork />
          </div>
        )}
      </div>
    </div>
  );
}
