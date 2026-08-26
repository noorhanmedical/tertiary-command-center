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
  const { workspaces } = usePlayground();

  // When the Playground engine has workspaces, it takes over the center.
  if (workspaces.length > 0) {
    return (
      <div className="h-full w-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-hidden" data-testid="playground-bridge-active">
        <PlaygroundCanvas />
      </div>
    );
  }

  // When empty, return null — the old rendering system stays active.
  return null;
}

/** Hook to check if the Playground engine is actively rendering. */
export function usePlaygroundActive(): boolean {
  const { workspaces } = usePlayground();
  return workspaces.length > 0;
}
