// Global Dock — app registry + role configurations.
//
// This is the single source of truth for every dock app definition and
// per-role default configuration. The GlobalDock component reads from here.
// Admin settings can override defaults in the future via a stored matrix.

import {
  Home,
  Sparkles,
  BarChart3,
  Phone,
  Users,
  CheckSquare,
  CalendarDays,
  Atom,
  MessageSquare,
  FileText,
  TrendingUp,
  Receipt,
  Gamepad2,
  PenTool,
  HeartPulse,
  LayoutGrid,
} from "lucide-react";
import { NovaDockIcon } from "@/components/nova/NovaDockIcon";
import type { DockAppDefinition, RoleDockConfig } from "./types";

// ─── Core app definitions ─────────────────────────────────────────────────

export const DOCK_APPS: DockAppDefinition[] = [
  {
    id: "home",
    label: "Home",
    icon: Home,
    destinationType: "route",
    route: "/home",
    order: 0,
    locked: true,
    configurable: false,
    preserveContext: false,
    testId: "dock-app-home",
  },
  {
    id: "nova",
    label: "AI Assistant",
    icon: NovaDockIcon,
    destinationType: "action",
    order: 999,
    locked: true,
    configurable: false,
    preserveContext: true,
    testId: "dock-app-nova",
  },
  {
    id: "metrics",
    label: "Metrics",
    icon: BarChart3,
    destinationType: "popup",
    popupId: "metrics",
    order: 20,
    locked: false,
    configurable: true,
    preserveContext: true,
    testId: "dock-app-metrics",
  },
  {
    id: "phone",
    label: "Phone",
    icon: Phone,
    destinationType: "popup",
    popupId: "phone",
    order: 30,
    locked: false,
    configurable: true,
    preserveContext: true,
    testId: "dock-app-phone",
  },
  {
    id: "team-ops",
    label: "Team Ops",
    icon: Users,
    destinationType: "popup",
    popupId: "team-ops",
    order: 40,
    locked: false,
    configurable: true,
    preserveContext: true,
    testId: "dock-app-team-ops",
  },
  {
    id: "plexus-tasks",
    label: "Plexus Tasks",
    icon: CheckSquare,
    destinationType: "popup",
    popupId: "plexus-tasks",
    order: 50,
    locked: false,
    configurable: true,
    preserveContext: true,
    testId: "dock-app-plexus-tasks",
  },
  {
    id: "schedule",
    label: "Calendar",
    icon: CalendarDays,
    destinationType: "route",
    route: "/schedule",
    order: 70,
    locked: false,
    configurable: true,
    preserveContext: true,
    testId: "dock-app-schedule",
  },
  {
    id: "plexus-nucleus",
    label: "Plexus Nucleus",
    icon: Atom,
    destinationType: "route",
    route: "/plexus-nucleus",
    order: 70,
    locked: false,
    configurable: true,
    preserveContext: false,
    testId: "dock-app-plexus-nucleus",
  },

  // ─── Optional/configurable apps ─────────────────────────────────────
  {
    id: "messages",
    label: "Messages",
    icon: MessageSquare,
    destinationType: "popup",
    popupId: "messages",
    order: 80,
    locked: false,
    configurable: true,
    preserveContext: true,
    testId: "dock-app-messages",
  },
  {
    id: "patients",
    label: "Plexus EHR",
    icon: HeartPulse,
    destinationType: "route",
    route: "/patient-directory",
    order: 10,
    locked: false,
    configurable: true,
    preserveContext: false,
    testId: "dock-app-patients",
  },
  {
    id: "documents",
    label: "Ancillary Documents",
    icon: FileText,
    destinationType: "workspace",
    workspaceType: "documents",
    order: 100,
    locked: false,
    configurable: true,
    preserveContext: true,
    testId: "dock-app-documents",
  },
  {
    id: "engagement",
    label: "Engagement",
    icon: TrendingUp,
    destinationType: "route",
    route: "/engagement-center",
    allowedRoles: ["admin"],
    order: 30,
    locked: false,
    configurable: true,
    preserveContext: false,
    testId: "dock-app-engagement",
  },
  {
    id: "team-portals",
    label: "Team Portals",
    icon: LayoutGrid,
    destinationType: "route",
    route: "/team-member-portals",
    order: 40,
    locked: false,
    configurable: true,
    preserveContext: false,
    testId: "dock-app-team-portals",
  },
  {
    id: "plexus-iq",
    label: "Plexus IQ",
    icon: Sparkles,
    destinationType: "route",
    route: "/plexus-iq",
    allowedRoles: ["admin"],
    order: 20,
    locked: false,
    configurable: true,
    preserveContext: false,
    testId: "dock-app-plexus-iq",
  },
  {
    id: "billing",
    label: "Plexus Bank",
    icon: Receipt,
    destinationType: "route",
    route: "/plexus-bank",
    allowedRoles: ["admin", "biller"],
    order: 60,
    locked: false,
    configurable: true,
    preserveContext: false,
    testId: "dock-app-billing",
  },
  {
    id: "whiteboard",
    label: "Whiteboard",
    icon: PenTool,
    destinationType: "workspace",
    workspaceType: "whiteboard",
    order: 140,
    locked: false,
    configurable: true,
    preserveContext: true,
    testId: "dock-app-whiteboard",
  },
  {
    id: "games",
    label: "Games",
    icon: Gamepad2,
    destinationType: "workspace",
    workspaceType: "game",
    order: 150,
    locked: false,
    configurable: true,
    preserveContext: false,
    testId: "dock-app-games",
  },
];

// ─── Index for fast lookup ────────────────────────────────────────────────

const APP_BY_ID = new Map(DOCK_APPS.map((a) => [a.id, a]));

export function getDockApp(id: string): DockAppDefinition | undefined {
  return APP_BY_ID.get(id);
}

// ─── Role configurations ──────────────────────────────────────────────────

// Canonical primary dock structure (exact order):
// Home → Plexus EHR → Plexus IQ → Engagement → Team Portals →
// Ancillary Documents → Plexus Bank → Calendar → AI Assistant.
//
// App-id mapping: patients=Plexus EHR, documents=Ancillary Documents,
// billing=Plexus Bank, schedule=Calendar, nova=AI Assistant.
//
// Role gating still applies via each app's `allowedRoles`
// (engagement/plexus-iq: admin; billing: admin+biller). resolveAppsForRole
// filters those out for roles that lack access, so the visible dock is the
// canonical order minus any items the role cannot see.
const PRIMARY_DOCK_ORDER = [
  "home",
  "patients",
  "plexus-iq",
  "engagement",
  "team-portals",
  "documents",
  "billing",
  "schedule",
  "nova",
];

const PRIMARY_OPTIONAL = [
  "metrics", "phone", "team-ops", "plexus-tasks", "plexus-nucleus", "messages", "whiteboard", "games",
];

export const ROLE_DOCK_CONFIGS: RoleDockConfig[] = [
  {
    role: "admin",
    defaultApps: [...PRIMARY_DOCK_ORDER],
    lockedApps: ["home", "nova"],
    optionalApps: [...PRIMARY_OPTIONAL],
  },
  {
    role: "pcs",
    defaultApps: [...PRIMARY_DOCK_ORDER],
    lockedApps: ["home", "nova"],
    optionalApps: [...PRIMARY_OPTIONAL],
  },
  {
    role: "acs",
    defaultApps: [...PRIMARY_DOCK_ORDER],
    lockedApps: ["home", "nova"],
    optionalApps: [...PRIMARY_OPTIONAL],
  },
  {
    role: "scheduler",
    defaultApps: [...PRIMARY_DOCK_ORDER],
    lockedApps: ["home", "nova"],
    optionalApps: [...PRIMARY_OPTIONAL],
  },
  {
    role: "clinician",
    defaultApps: [...PRIMARY_DOCK_ORDER],
    lockedApps: ["home", "nova"],
    optionalApps: [...PRIMARY_OPTIONAL],
  },
  {
    role: "biller",
    defaultApps: [...PRIMARY_DOCK_ORDER],
    lockedApps: ["home", "nova"],
    optionalApps: [...PRIMARY_OPTIONAL],
  },
];

const CONFIG_BY_ROLE = new Map(ROLE_DOCK_CONFIGS.map((c) => [c.role, c]));

/** Get the dock config for a role. Falls back to admin config for unknown roles. */
export function getRoleDockConfig(role: string): RoleDockConfig {
  // Map legacy/internal role names to dock config roles.
  const mapped = ROLE_ALIAS[role] ?? role;
  return CONFIG_BY_ROLE.get(mapped) ?? CONFIG_BY_ROLE.get("admin")!;
}

/** Map internal role strings to dock config role keys. */
const ROLE_ALIAS: Record<string, string> = {
  liaison: "pcs",
  technician: "acs",
  patientCareSpecialist: "pcs",
  ancillaryCareSpecialist: "acs",
};

/** Resolve the ordered list of DockAppDefinitions for a user's role,
 *  respecting allowedRoles and returning only apps the user can see. */
export function resolveAppsForRole(role: string, isAdmin: boolean): DockAppDefinition[] {
  const config = getRoleDockConfig(role);
  const apps: DockAppDefinition[] = [];

  for (const appId of config.defaultApps) {
    const app = APP_BY_ID.get(appId);
    if (!app) continue;
    // Check role restriction (empty allowedRoles = everyone can see).
    if (app.allowedRoles && app.allowedRoles.length > 0) {
      const mapped = ROLE_ALIAS[role] ?? role;
      if (!app.allowedRoles.includes(mapped) && !isAdmin) continue;
    }
    apps.push(app);
  }

  return apps;
}
