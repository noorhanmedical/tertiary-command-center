// Phase 2I — compatibility re-export. The workspace composition now lives in
// WorkspaceWorkQueueComposition.tsx (mode-switcher header + canonical section in
// the scrollable body + existing mode-body children). Kept as a thin re-export so
// existing importers/tests need no path churn.
export { WorkspaceWorkQueueComposition } from "./WorkspaceWorkQueueComposition";
