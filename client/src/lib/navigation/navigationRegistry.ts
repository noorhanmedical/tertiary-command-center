import {
  Home as HomeIcon,
  MessageSquare,
  CheckSquare,
  Sparkles,
  CalendarDays,
  Phone,
  TrendingUp,
  Search,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";

export type DockItemKind = "link" | "panel" | "disabled";

export type DockItem = {
  id: string;
  label: string;
  Icon: LucideIcon;
  kind: DockItemKind;
  href?: string;
  panelId?: string;
  testId: string;
};

export const CHAT_ROUTE_AVAILABLE = false;

export const DOCK_ITEMS: DockItem[] = [
  {
    id: "home",
    label: "Home",
    Icon: HomeIcon,
    kind: "link",
    href: "/home",
    testId: "global-floating-dock-home",
  },
  {
    id: "chat",
    label: "Chat",
    Icon: MessageSquare,
    kind: CHAT_ROUTE_AVAILABLE ? "link" : "disabled",
    href: CHAT_ROUTE_AVAILABLE ? "/chat" : undefined,
    testId: "global-floating-dock-chat",
  },
  {
    id: "tasks",
    label: "Tasks",
    Icon: CheckSquare,
    kind: "panel",
    panelId: "tasks",
    testId: "global-floating-dock-tasks",
  },
  {
    id: "plexus-iq",
    label: "Plexus IQ",
    Icon: Sparkles,
    kind: "link",
    href: "/plexus-iq",
    testId: "global-floating-dock-plexus-iq",
  },
  {
    id: "calendar",
    label: "Calendar",
    Icon: CalendarDays,
    kind: "panel",
    panelId: "calendar",
    testId: "global-floating-dock-calendar",
  },
  {
    id: "engagement",
    label: "Engagement",
    Icon: TrendingUp,
    kind: "link",
    href: "/engagement-center",
    testId: "global-floating-dock-engagement",
  },
  {
    id: "communications",
    label: "Communications",
    Icon: Phone,
    kind: "link",
    href: "/scheduler-portal",
    testId: "global-floating-dock-communications",
  },
];

// Simplified dock shown to portal users (scheduler / clinician). Four
// focused items, all opening inline panels so the user never loses their
// place. Admin / biller keep the full DOCK_ITEMS dock above.
export const PORTAL_DOCK_ITEMS: DockItem[] = [
  {
    id: "portal-home",
    label: "Home",
    Icon: HomeIcon,
    kind: "link",
    href: "/home",
    testId: "global-floating-dock-portal-home",
  },
  {
    id: "portal-chat",
    label: "Chat",
    Icon: MessageSquare,
    kind: "panel",
    panelId: "portal-chat",
    testId: "global-floating-dock-portal-chat",
  },
  {
    id: "portal-search",
    label: "Patient Search",
    Icon: Search,
    kind: "panel",
    panelId: "portal-search",
    testId: "global-floating-dock-portal-search",
  },
  {
    id: "portal-tasks",
    label: "Tasks",
    Icon: CheckSquare,
    kind: "panel",
    panelId: "tasks",
    testId: "global-floating-dock-portal-tasks",
  },
  {
    id: "portal-plexus-iq",
    label: "Plexus IQ",
    Icon: Sparkles,
    kind: "panel",
    panelId: "portal-plexus-iq",
    testId: "global-floating-dock-portal-plexus-iq",
  },
  {
    id: "portal-team-ops",
    label: "Team Ops",
    Icon: CalendarClock,
    kind: "panel",
    panelId: "portal-team-ops",
    testId: "global-floating-dock-portal-team-ops",
  },
];

// Roles that get the simplified 4-item portal dock.
export const PORTAL_DOCK_ROLES = new Set(["scheduler", "clinician"]);

export const GLOBAL_NAV_ROUTES: string[] = ["/home", "/clinician-portal"];

export function shouldShowGlobalNav(pathname: string): boolean {
  return GLOBAL_NAV_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/"),
  );
}
