export type {
  DockAppDefinition,
  DockDestinationType,
  RoleDockConfig,
  DockActiveState,
  DockContext,
} from "./types";

export {
  DOCK_APPS,
  ROLE_DOCK_CONFIGS,
  getDockApp,
  getRoleDockConfig,
  resolveAppsForRole,
} from "./registry";

export { GlobalDock } from "./GlobalDock";
export type { GlobalDockProps } from "./GlobalDock";
