import {
  Home as HomeIcon,
  MessageSquare,
  CheckSquare,
  Sparkles,
  CalendarDays,
  Phone,
  TrendingUp,
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
    kind: "link",
    href: "/plexus-tasks",
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

export const GLOBAL_NAV_ROUTES: string[] = ["/home", "/physician-portal"];

export function shouldShowGlobalNav(pathname: string): boolean {
  return GLOBAL_NAV_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/"),
  );
}
