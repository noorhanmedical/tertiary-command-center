// Listens for dispatchOpenWorkspace events and routes them to the Playground engine.
// Must be rendered inside PlaygroundWorkspaceProvider.

import { useEffect } from "react";
import { usePlayground } from "./PlaygroundWorkspaceProvider";
import { listenForOpenWorkspace } from "./playgroundEvents";

export function PlaygroundEventListener() {
  const { openWorkspace, goHome } = usePlayground();

  useEffect(() => {
    const unsub = listenForOpenWorkspace((request) => {
      if (request.type === "playground_home") {
        goHome();
      } else {
        openWorkspace(request);
      }
    });
    return unsub;
  }, [openWorkspace, goHome]);

  return null;
}
