export type {
  PlaygroundWorkspace,
  PlaygroundWorkspaceType,
  PlaygroundWorkspaceDefinition,
  PlaygroundWorkspaceAPI,
  OpenInPlaygroundRequest,
  WorkspaceRenderProps,
} from "./types";

export {
  PlaygroundWorkspaceProvider,
  usePlayground,
  usePlaygroundOptional,
} from "./PlaygroundWorkspaceProvider";

export { PlaygroundCanvas } from "./PlaygroundCanvas";
export { PlaygroundTabBar } from "./PlaygroundTabBar";
export { PlaygroundBridge, usePlaygroundActive } from "./PlaygroundBridge";
export { PlaygroundEventListener } from "./PlaygroundEventListener";
export { dispatchOpenWorkspace } from "./playgroundEvents";
export { DirtyCloseDialog } from "./DirtyCloseDialog";
export type { DirtyCloseAction } from "./DirtyCloseDialog";

export {
  getWorkspaceDefinition,
  registerWorkspaceDefinition,
  getAllWorkspaceDefinitions,
} from "./registry";
