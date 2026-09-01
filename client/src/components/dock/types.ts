// Global Dock — shared contracts.
//
// ONE dock system across the entire platform. What differs by role is
// which apps/icons appear. The dock component, position, animation,
// and interaction model are always the same.

import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

// ─── Destination types ────────────────────────────────────────────────────

/** How clicking a dock app resolves. */
export type DockDestinationType =
  | "route"            // navigate to a URL
  | "popup"            // open a lightweight floating panel (quick interaction)
  | "workspace"        // open a Playground workspace tab
  | "action";          // fire a custom callback (e.g. toggle Nova)

// ─── App definition ───────────────────────────────────────────────────────

export type DockAppDefinition = {
  /** Unique stable identifier (e.g. "home", "nova", "metrics"). */
  id: string;
  /** Human-readable label shown on hover / expanded state. */
  label: string;
  /** Primary icon (Lucide or custom SVG component). */
  icon: LucideIcon | ComponentType<{ className?: string }>;
  /** How the app resolves when clicked. */
  destinationType: DockDestinationType;
  /** Route path (when destinationType === "route"). */
  route?: string;
  /** Workspace type key opened in Playground (when destinationType === "workspace"). */
  workspaceType?: string;
  /** Popup component ID or key (when destinationType === "popup"). */
  popupId?: string;
  /** Custom action handler (when destinationType === "action"). */
  onAction?: () => void;
  /** Roles that are allowed to see this app. Empty = all roles. */
  allowedRoles?: string[];
  /** Named permission required (future: checked against profile). */
  requiredPermission?: string;
  /** Dynamic badge content (number, dot, or ReactNode). */
  badge?: ReactNode | (() => ReactNode);
  /** Sort order within the dock (lower = further left). */
  order: number;
  /** Whether admin can remove this from a role's dock config. */
  locked?: boolean;
  /** Whether the app is user-configurable (show/hide/reorder). */
  configurable?: boolean;
  /** Whether switching to this app should preserve selected patient context. */
  preserveContext?: boolean;
  /** Test ID for the dock button. */
  testId?: string;
};

// ─── Role configuration ───────────────────────────────────────────────────

export type RoleDockConfig = {
  /** Role identifier (e.g. "admin", "pcs", "acs", "scheduler", "clinician"). */
  role: string;
  /** App IDs shown by default for this role (in order). */
  defaultApps: string[];
  /** App IDs that cannot be removed from this role's dock. */
  lockedApps: string[];
  /** App IDs available to add but not shown by default. */
  optionalApps: string[];
};

// ─── Dock state (consumed by the component) ───────────────────────────────

export type DockActiveState = {
  /** Currently focused/active app ID (ring highlight). Null = none. */
  activeAppId: string | null;
  /** App IDs that are "open" (dot indicator below icon). */
  openAppIds: string[];
};

// ─── Dock context (passed down to the component) ──────────────────────────

export type DockContext = {
  /** Current user role. */
  role: string;
  /** Whether current user is admin. */
  isAdmin: boolean;
  /** Current route path (for link-type active detection). */
  currentPath: string;
  /** Active state from the workspace (for workspace-type docks). */
  activeState?: DockActiveState;
  /** Handler when a dock app is activated. */
  onActivate: (app: DockAppDefinition) => void;
  /** Optional badge values keyed by app ID. */
  badges?: Record<string, number>;
};
