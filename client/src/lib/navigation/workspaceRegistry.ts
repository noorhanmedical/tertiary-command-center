// Canonical Plexus navigation registry.
//
// This is the SINGLE source of truth for:
//   - the left GlobalNav (grouped platform-app directory)
//   - main-app route classification / shell visibility
//   - workspace-tab eligibility
//   - active-workspace resolution (incl. nested routes → parent workspace)
//   - role-based navigation visibility
//
// Design rules (locked by product):
//   - Top-level entries represent MAJOR Plexus applications, not every route.
//   - Nested routes resolve to their PARENT workspace. Example:
//       /schedule, /schedule/123, /schedule/anything  →  workspace
//       "global-schedule". No extra tab is created for the detail route.
//   - The URL remains authoritative (wouter). The active workspace is ALWAYS
//       derived from the pathname via resolveWorkspace(); we never store a
//       second "active route" that can drift from wouter.
//   - `allowedRoles` / `sidebar.roles` are navigation-visibility only. They
//       are NOT authorization — AdminGuard / RoleGuard on the routes remain
//       the source of truth for access. Role filtering here only prevents
//       unauthorized tabs/nav from being shown or restored; it can never
//       grant access.
//
// Team Portals (PCS / ACS, rendered full-screen through TeamPortalShell /
// ClinicWorkflowPortal) are intentionally NOT tab/shell workspaces. They are
// a separate operating environment. See isTeamPortalRoute() below.

import {
  Home as HomeIcon,
  Radar,
  CalendarDays,
  Sparkles,
  Database,
  ScanLine,
  FileText,
  TrendingUp,
  BarChart3,
  ClipboardCheck,
  CreditCard,
  Receipt,
  Landmark,
  CheckSquare,
  Users2,
  Library,
  HeartHandshake,
  Stethoscope,
  Shield,
  KeyRound,
  Brain,
  type LucideIcon,
} from "lucide-react";

// ─── Left-nav grouping ───────────────────────────────────────────────────

export type NavGroup =
  | "core"
  | "clinical-operations"
  | "finance"
  | "operations"
  | "portals"
  | "administration";

export const NAV_GROUP_ORDER: NavGroup[] = [
  "core",
  "clinical-operations",
  "finance",
  "operations",
  "portals",
  "administration",
];

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  core: "CORE",
  "clinical-operations": "CLINICAL OPERATIONS",
  finance: "FINANCE",
  operations: "OPERATIONS",
  portals: "PORTALS",
  administration: "ADMINISTRATION",
};

/** Left-nav (GlobalNav) placement + visibility for a workspace. */
export interface SidebarMeta {
  group: NavGroup;
  order: number;
  icon: LucideIcon;
  /** Sidebar visibility (navigation only — never authorization). */
  roles: string[];
  /**
   * Phase 4B — permission-aware sidebar visibility (navigation only). When set,
   * the item is ALSO visible if the current user holds ANY of these effective
   * permissions, even when their legacy role is not in `roles`. This lets an
   * Organization/Clinic Admin discover the Access Management workspace without
   * converting the whole registry to the new role model. It NEVER grants
   * access — the route guard + backend remain authoritative.
   */
  visibleWithAnyPermission?: string[];
}

export interface WorkspaceDefinition {
  /** Stable workspace identifier (persisted to sessionStorage). */
  id: string;
  /** Human-readable tab / nav label. */
  title: string;
  /** Default route used when a tab has no remembered lastRoute. */
  canonicalRoute: string;
  /** Returns true when a pathname belongs to this workspace (incl. nested). */
  matches: (pathname: string) => boolean;
  /**
   * Roles allowed to SEE this workspace tab. Undefined = every authenticated
   * role. `admin` is always allowed regardless of this list.
   */
  allowedRoles?: string[];
  /** When false, the tab cannot be closed (Home). Defaults to true. */
  closeable?: boolean;
  /**
   * When false, visiting this workspace does NOT open a workspace tab.
   * Home is intentionally not tab-eligible. Defaults to true.
   */
  allowWorkspaceTab?: boolean;
  /**
   * Left-nav placement + visibility. Omit to hide the workspace from the
   * GlobalNav sidebar (it can still be a tab / resolvable workspace).
   */
  sidebar?: SidebarMeta;
}

/** true when pathname === base OR is a nested child of base (base + "/..."). */
function underRoute(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + "/");
}

// ─── Workspace definitions ──────────────────────────────────────────────
//
// Order here is used only for deterministic resolution; matchers are
// effectively mutually exclusive by route prefix. Left-nav order is driven by
// `sidebar.group` + `sidebar.order`, not array position.

export const WORKSPACES: WorkspaceDefinition[] = [
  {
    id: "home",
    title: "Home",
    canonicalRoute: "/home",
    matches: (p) =>
      p === "/" || underRoute(p, "/home") || underRoute(p, "/visit-patients"),
    closeable: false,
    // Home is the base dashboard — it never gets its own workspace tab.
    allowWorkspaceTab: false,
    sidebar: { group: "core", order: 1, icon: HomeIcon, roles: ["admin", "clinician", "scheduler"] },
  },
  {
    id: "plexus-iq",
    title: "Plexus IQ",
    canonicalRoute: "/plexus-iq",
    // Patient Intake / qualification is the IQ intake funnel (surface
    // "plexusIq") and resolves here too. Clinical Intelligence & Governance
    // is now its OWN workspace (see below), not part of Plexus IQ.
    matches: (p) =>
      underRoute(p, "/plexus-iq") ||
      underRoute(p, "/patient-intake") ||
      underRoute(p, "/qualification"),
    // Route is unguarded — visible to every authenticated main-app user.
    // (No allowedRoles = all roles; empty sidebar.roles = all roles.)
    // Pinned to the top of the CORE group per product direction.
    sidebar: { group: "core", order: 2, icon: Sparkles, roles: [] },
  },
  {
    id: "mission-control",
    title: "Mission Control",
    canonicalRoute: "/mission-control",
    matches: (p) => underRoute(p, "/mission-control"),
    allowedRoles: ["admin"],
    sidebar: { group: "core", order: 3, icon: Radar, roles: ["admin"] },
  },
  {
    id: "plexus-ehr",
    title: "Plexus EHR",
    canonicalRoute: "/patient-directory",
    matches: (p) => underRoute(p, "/patient-directory"),
    allowedRoles: ["admin", "clinician", "biller"],
    sidebar: { group: "core", order: 4, icon: Database, roles: ["admin", "clinician", "biller"] },
  },
  {
    id: "engagement",
    title: "Engagement Center",
    canonicalRoute: "/engagement-center",
    // Outreach-patient qualification + per-scheduler call console resolve here.
    matches: (p) =>
      underRoute(p, "/engagement-center") ||
      underRoute(p, "/outreach-patients") ||
      underRoute(p, "/outreach/scheduler"),
    // Route is unguarded — visible to every authenticated main-app user.
    // (No allowedRoles = all roles; empty sidebar.roles = all roles.)
    sidebar: { group: "core", order: 5, icon: TrendingUp, roles: [] },
  },
  {
    id: "team-portals",
    title: "Team Member Portals",
    // The Team Portals HUB (a normal in-shell landing page with PCS/ACS
    // tiles). The PCS/ACS workspaces it links to are full-screen portals and
    // are intentionally NOT part of this registry (see isTeamPortalRoute).
    canonicalRoute: "/team-member-portals",
    matches: (p) => underRoute(p, "/team-member-portals"),
    allowedRoles: ["admin", "clinician", "technician", "liaison"],
    sidebar: { group: "core", order: 6, icon: HeartHandshake, roles: ["admin", "clinician", "technician", "liaison"] },
  },
  {
    id: "team-ops",
    title: "Team Ops",
    canonicalRoute: "/team-ops",
    matches: (p) => underRoute(p, "/team-ops"),
    allowedRoles: ["admin"],
    sidebar: { group: "core", order: 7, icon: Users2, roles: ["admin"] },
  },
  {
    id: "plexus-tasks",
    title: "Plexus Tasks",
    canonicalRoute: "/plexus-tasks",
    matches: (p) => underRoute(p, "/plexus-tasks"),
    allowedRoles: ["admin", "clinician", "scheduler", "biller"],
    sidebar: { group: "core", order: 8, icon: CheckSquare, roles: ["admin", "clinician", "scheduler", "biller"] },
  },
  {
    id: "imaging-central",
    title: "Imaging Central",
    canonicalRoute: "/imaging-central",
    matches: (p) => underRoute(p, "/imaging-central"),
    allowedRoles: ["admin", "clinician", "technician", "liaison"],
    sidebar: { group: "core", order: 9, icon: ScanLine, roles: ["admin", "clinician", "technician", "liaison"] },
  },
  {
    id: "ancillary-documents",
    title: "Ancillary Documents",
    canonicalRoute: "/ancillary-documents",
    // Document Upload has been unwired from the surfaced UI (per product
    // direction). The /document-upload route file + App.tsx registration are
    // retained on disk, but no nav item or workspace claims it anymore.
    matches: (p) => underRoute(p, "/ancillary-documents"),
    allowedRoles: ["admin", "clinician"],
    sidebar: { group: "core", order: 10, icon: FileText, roles: ["admin", "clinician"] },
  },
  {
    id: "clinic-onboarding",
    title: "Clinic Onboarding",
    canonicalRoute: "/clinic-onboarding",
    matches: (p) => underRoute(p, "/clinic-onboarding"),
    allowedRoles: ["admin"],
    // Standalone left-nav item (NOT nested under Clinician Portal).
    sidebar: { group: "core", order: 11, icon: ClipboardCheck, roles: ["admin"] },
  },
  {
    id: "clinic-analytics",
    title: "Clinic Analytics",
    canonicalRoute: "/clinic-analytics",
    matches: (p) => underRoute(p, "/clinic-analytics") || underRoute(p, "/analytics"),
    allowedRoles: ["admin"],
    // Standalone left-nav item (NOT nested under Clinician Portal).
    sidebar: { group: "core", order: 12, icon: BarChart3, roles: ["admin"] },
  },
  {
    id: "clinician-portal",
    title: "Clinician Portal",
    canonicalRoute: "/clinician-portal",
    matches: (p) => underRoute(p, "/clinician-portal"),
    allowedRoles: ["admin", "clinician"],
    sidebar: { group: "core", order: 13, icon: Stethoscope, roles: ["admin", "clinician"] },
  },
  {
    id: "clinical-intelligence",
    title: "Clinical Intelligence",
    canonicalRoute: "/clinical-intelligence",
    matches: (p) => underRoute(p, "/clinical-intelligence"),
    // Route is unguarded — visible to every authenticated main-app user.
    sidebar: { group: "core", order: 14, icon: Brain, roles: [] },
  },
  {
    id: "global-schedule",
    title: "Global Schedule",
    canonicalRoute: "/schedule",
    // /schedule and every /schedule/:id detail belong to this one workspace.
    // Appointment booking and the schedule dashboard are scheduling surfaces
    // that resolve to Global Schedule (no separate tab).
    matches: (p) =>
      underRoute(p, "/schedule") ||
      underRoute(p, "/appointments") ||
      underRoute(p, "/dashboard") ||
      underRoute(p, "/schedule-dashboard"),
    allowedRoles: ["admin", "clinician", "scheduler"],
    sidebar: { group: "core", order: 15, icon: CalendarDays, roles: ["admin", "clinician", "scheduler"] },
  },
  {
    id: "billing",
    title: "Billing",
    canonicalRoute: "/billing",
    matches: (p) => underRoute(p, "/billing"),
    allowedRoles: ["admin", "biller"],
    sidebar: { group: "finance", order: 1, icon: CreditCard, roles: ["admin", "biller"] },
  },
  {
    id: "invoices",
    title: "Invoices",
    canonicalRoute: "/invoices",
    matches: (p) => underRoute(p, "/invoices"),
    allowedRoles: ["admin", "biller"],
    sidebar: { group: "finance", order: 2, icon: Receipt, roles: ["admin", "biller"] },
  },
  {
    id: "plexus-bank",
    title: "Plexus Bank",
    canonicalRoute: "/plexus-bank",
    matches: (p) => underRoute(p, "/plexus-bank"),
    allowedRoles: ["admin"],
    sidebar: { group: "finance", order: 3, icon: Landmark, roles: ["admin"] },
  },
  {
    id: "document-library",
    title: "Document Library",
    canonicalRoute: "/document-library",
    matches: (p) => underRoute(p, "/document-library"),
    allowedRoles: ["admin"],
    sidebar: { group: "operations", order: 1, icon: Library, roles: ["admin"] },
  },
  {
    // Phase 4B — Access Management console (/admin/access). Distinct from the
    // legacy admin-only Settings workspace so a scoped Organization/Clinic Admin
    // can reach it. Placed BEFORE "admin" so /admin/access resolves here (the
    // admin matcher also covers /admin, but this specific match wins by order).
    // Nav visibility is permission-aware; the route guard + backend enforce
    // actual access.
    id: "access",
    title: "Access Management",
    canonicalRoute: "/admin/access",
    matches: (p) => underRoute(p, "/admin/access"),
    // No allowedRoles: tab eligibility is navigation-state only; entry is
    // governed by AccessSettingsGuard and every /api/access/* call.
    sidebar: {
      group: "administration",
      order: 1,
      icon: KeyRound,
      roles: ["admin"],
      visibleWithAnyPermission: [
        "users.view",
        "users.manage",
        "organization.view",
        "organization.manage",
        "clinic.view",
        "clinic.manage",
        "platform.audit.view",
        "audit.organization.view",
      ],
    },
  },
  {
    id: "admin",
    title: "Admin",
    canonicalRoute: "/admin/settings",
    matches: (p) => underRoute(p, "/admin"),
    allowedRoles: ["admin"],
    sidebar: { group: "administration", order: 2, icon: Shield, roles: ["admin"] },
  },
];

const WORKSPACE_BY_ID = new Map(WORKSPACES.map((w) => [w.id, w]));

/** Resolve the workspace that owns a pathname, or null if none. */
export function resolveWorkspace(pathname: string): WorkspaceDefinition | null {
  for (const ws of WORKSPACES) {
    if (ws.matches(pathname)) return ws;
  }
  return null;
}

export function getWorkspaceById(id: string): WorkspaceDefinition | undefined {
  return WORKSPACE_BY_ID.get(id);
}

/** True when a workspace should open/restore a tab (Home never does). */
export function isWorkspaceTabEligible(ws: WorkspaceDefinition): boolean {
  return ws.allowWorkspaceTab !== false;
}

/**
 * Routes that intentionally render inside the main-app shell but do NOT own
 * or belong to any workspace: previews, prototypes, demos, and per-item
 * detail surfaces launched from within a workspace. They deliberately resolve
 * to no workspace tab. Declared explicitly so route ownership is a conscious
 * decision and nothing falls through the classification by accident.
 */
export const TRANSIENT_ROUTES: string[] = [
  "/home-preview",               // staged winter Home redesign (preview)
  "/ui-system-preview",          // design-system gallery (preview)
  "/ancillary-documents-mockup", // pixel-faithful mockup (not production)
  "/plexus-iq-prototype",        // design prototype (mock data)
  "/clinic-workflow-demo",       // demo surface
  "/ancillary-screening",        // per-case screening detail (launched in-flow)
];

/** True when a pathname is an intentionally workspace-less transient route. */
export function isTransientRoute(pathname: string): boolean {
  return TRANSIENT_ROUTES.some((base) => underRoute(pathname, base));
}

/**
 * Roles that render as a full-screen Team Portal (TeamPortalShell /
 * ClinicWorkflowPortal) and therefore must be FULLY isolated from the main
 * shell (no TopBanner, GlobalDock, GlobalNav, or WorkspaceTabs). The legacy
 * redirect routes are included defensively; they resolve to the PCS/ACS
 * routes anyway.
 */
export function isTeamPortalRoute(pathname: string): boolean {
  return (
    underRoute(pathname, "/patient-care-specialist-portal") ||
    underRoute(pathname, "/ancillary-care-specialist-portal") ||
    underRoute(pathname, "/technician-portal") ||
    underRoute(pathname, "/liaison-technician-portal") ||
    underRoute(pathname, "/liaison-portal") ||
    underRoute(pathname, "/team-portal-glass-preview")
  );
}

/**
 * Whether a pathname should render inside the persistent main-app shell.
 * Everything that is NOT a true full-screen Team Portal route is a main-app
 * workspace route. This deliberately replaces the old simplistic
 * GLOBAL_NAV_ROUTES allow-list.
 */
export function isAdminWorkspaceRoute(pathname: string): boolean {
  return !isTeamPortalRoute(pathname);
}

/**
 * Navigation-visibility check (NOT authorization). `admin` sees everything;
 * a workspace with no allowedRoles is visible to every authenticated role.
 */
export function canRoleSeeWorkspace(
  ws: WorkspaceDefinition,
  role: string | undefined | null,
): boolean {
  if (role === "admin") return true;
  if (!ws.allowedRoles || ws.allowedRoles.length === 0) return true;
  return role != null && ws.allowedRoles.includes(role);
}

/**
 * Sidebar-visibility check (NOT authorization). Mirrors canRoleSeeWorkspace
 * but reads the sidebar-specific role list. `admin` always sees the item.
 */
export function canRoleSeeInSidebar(
  ws: WorkspaceDefinition,
  role: string | undefined | null,
  permissions?: string[] | null,
): boolean {
  if (!ws.sidebar) return false;
  if (role === "admin") return true;
  if (ws.sidebar.roles.length === 0) return true;
  if (role != null && ws.sidebar.roles.includes(role)) return true;
  // Phase 4B — permission-aware fallback (navigation only). Visible if the user
  // holds any of the item's declared permissions, even when their legacy role
  // is not listed. Never grants access; the route guard + backend enforce it.
  const permGate = ws.sidebar.visibleWithAnyPermission;
  if (permGate && permGate.length > 0 && permissions && permissions.length > 0) {
    return permGate.some((p) => permissions.includes(p));
  }
  return false;
}

/**
 * Grouped, ordered left-nav items visible to `role` (and optionally the user's
 * effective `permissions`, for permission-aware items). Single source of truth
 * for GlobalNav rendering.
 */
export function getSidebarGroups(
  role: string | undefined | null,
  permissions?: string[] | null,
): { group: NavGroup; label: string; items: WorkspaceDefinition[] }[] {
  return NAV_GROUP_ORDER.map((group) => ({
    group,
    label: NAV_GROUP_LABELS[group],
    items: WORKSPACES.filter(
      (w) => w.sidebar?.group === group && canRoleSeeInSidebar(w, role, permissions),
    ).sort((a, b) => (a.sidebar!.order - b.sidebar!.order)),
  })).filter((g) => g.items.length > 0);
}
