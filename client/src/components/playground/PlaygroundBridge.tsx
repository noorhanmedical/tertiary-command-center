// Playground Bridge — renders the new workspace engine when workspaces exist,
// signals when the old center rendering should yield.
//
// This is the transition component that allows TeamPortalShell to gradually
// migrate from the old portalTabs/centerMode system to the Playground engine.
// When the engine has open workspaces, it renders PlaygroundCanvas (tabs + content).
// When empty, it returns null so the old system can remain as fallback.

import { usePlayground } from "./PlaygroundWorkspaceProvider";
import { PlaygroundCanvas } from "./PlaygroundCanvas";

export function PlaygroundBridge() {
  const { workspaces, goHome } = usePlayground();

  // Always render the Playground engine. When no workspaces exist, the canvas
  // shows its built-in empty state (the winter background scene). We no longer
  // auto-create a "Home" workspace/tab — it was redundant chrome. `goHome`
  // remains available on the API for any explicit caller.
  void goHome;

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col bg-transparent" data-testid="playground-bridge-active">
      <PlaygroundCanvas />
    </div>
  );
}

/** Hook to check if the Playground engine is actively rendering. */
export function usePlaygroundActive(): boolean {
  return true; // Engine is always active now.
}
