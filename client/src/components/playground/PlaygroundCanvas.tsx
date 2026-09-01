// Playground Canvas — renders open workspace content.
//
// Performance + context isolation:
//   • keepAlive=true workspaces (call, tasks, schedule, ...) stay MOUNTED while
//     inactive but hidden, so in-progress drafts (e.g. a Jane call disposition)
//     survive switching to another tab and back. Each keeps its own React tree
//     keyed by workspace id, so per-patient context never leaks between tabs.
//   • keepAlive=false workspaces (patient_ehr) unmount when inactive to drop
//     their observers/queries and save resources.
// Only the active tab is visible; hidden tabs are display:none (still mounted).

import { usePlayground } from "./PlaygroundWorkspaceProvider";
import { getWorkspaceDefinition } from "./registry";
import { PlaygroundTabBar } from "./PlaygroundTabBar";
import { PlaygroundHomeArtwork } from "./workspaces/PlaygroundHomeArtwork";
import { PlaygroundSketchProvider } from "./sketch/PlaygroundSketchProvider";

export function PlaygroundCanvas() {
  const { workspaces, activeWorkspaceId, activeWorkspace } = usePlayground();

  // Keep-alive workspaces that should remain mounted regardless of active tab.
  const keptAlive = workspaces.filter((w) => {
    const def = getWorkspaceDefinition(w.type);
    return def?.keepAlive && def.render;
  });
  // The active workspace, if it is NOT keep-alive, is mounted on demand only
  // while active (heavy EHRs unmount on switch away).
  const activeDef = activeWorkspace ? getWorkspaceDefinition(activeWorkspace.type) : null;
  const activeIsEphemeral =
    !!activeWorkspace && !!activeDef?.render && !activeDef.keepAlive;

  const showHome = !activeWorkspace || !activeDef?.render;

  return (
    <div className="flex flex-col h-full" data-testid="playground-canvas">
      <PlaygroundTabBar />
      {/*
        Everything inside the Playground canvas lives under the SketchUI
        visual environment. Shared Plexus components can read useSketchEnv()
        to render their playground-sketch variant. Shell chrome (dock, rails,
        top controls) is rendered OUTSIDE this provider and stays Liquid Glass.
      */}
      <PlaygroundSketchProvider className="flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1" data-testid="playground-workspace-content">
          {/* Keep-alive workspaces stay mounted; only the active one is shown. */}
          {keptAlive.map((w) => {
            const def = getWorkspaceDefinition(w.type)!;
            const Renderer = def.render;
            const isActive = w.id === activeWorkspaceId;
            return (
              <div
                key={w.id}
                className="absolute inset-0 overflow-auto"
                style={{ display: isActive ? "block" : "none" }}
                aria-hidden={!isActive}
                data-testid={`playground-pane-${w.id}`}
              >
                <Renderer workspace={w} isActive={isActive} />
              </div>
            );
          })}

          {/* Ephemeral (non-keep-alive) active workspace, e.g. patient_ehr. */}
          {activeIsEphemeral && activeWorkspace && activeDef?.render && (
            <div
              key={activeWorkspace.id}
              className="absolute inset-0 overflow-auto"
              data-testid={`playground-pane-${activeWorkspace.id}`}
            >
              <activeDef.render workspace={activeWorkspace} isActive={true} />
            </div>
          )}

          {/* Home artwork when nothing renderable is active. */}
          {showHome && <PlaygroundHomeArtwork />}
        </div>
      </PlaygroundSketchProvider>
    </div>
  );
}
