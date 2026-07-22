import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  Home as HomeIcon,
  Phone,
  FileText,
  CreditCard,
  Receipt,
  Users2,
  Database,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  FolderOpen,
  Library,
  Stethoscope,
  HeartHandshake,
  Shield,
  Radar,
  ScanLine,
  BarChart3,
  ClipboardCheck,
  Landmark,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useHoverCapable, EDGE_HOVER_LEAVE_DELAY_MS } from "@/hooks/use-edge-hover";
import type { AuthUser } from "@/App";

export type NavItemDef = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number | string }>;
  roles: string[];
};

export const NAV_ITEMS: NavItemDef[] = [
  { href: "/home",             label: "Home",             Icon: HomeIcon,     roles: ["admin", "clinician", "scheduler"] },
  { href: "/mission-control",  label: "Mission Control",  Icon: Radar,        roles: ["admin"] },
  { href: "/schedule",         label: "Schedule",         Icon: CalendarDays, roles: ["admin", "clinician", "scheduler"] },
  { href: "/imaging-central",  label: "Imaging Central",  Icon: ScanLine,     roles: ["admin", "clinician", "technician", "liaison"] },
  // Phase-1 team-portal correction: there is no standalone Scheduler
  // Portal product. The legacy /scheduler-portal route mounts the
  // OutreachPage (marketing / scheduler-coverage metrics) and is
  // relabeled here as "Outreach Center" so users find the correct
  // surface. Patient call execution lives in PCS Workspace; ancillary
  // execution lives in ACS Workspace. The route path stays
  // /scheduler-portal for back-compat with deep links.
  { href: "/scheduler-portal",         label: "Outreach Center",   Icon: Phone,        roles: ["admin", "clinician", "scheduler"] },
  { href: "/ancillary-documents",        label: "Ancillary Documents",   Icon: FileText,     roles: ["admin", "clinician"] },
  { href: "/billing",          label: "Billing",          Icon: CreditCard,   roles: ["admin", "biller"] },
  { href: "/invoices",         label: "Invoices",         Icon: Receipt,      roles: ["admin", "biller"] },
  { href: "/team-ops",         label: "Team Ops",         Icon: Users2,       roles: ["admin"] },
  { href: "/clinic-analytics", label: "Clinic Analytics", Icon: BarChart3,      roles: ["admin"] },
  { href: "/clinic-onboarding", label: "Clinic Onboarding", Icon: ClipboardCheck, roles: ["admin"] },
  { href: "/patient-directory", label: "Patient EHR", Icon: Database,     roles: ["admin", "clinician", "biller"] },
  // Slice 1.5: legacy duplicate Patient-Directory-live nav item
  // removed. The /patient-directory/live URL still redirects to
  // /patient-directory for back-compat with existing bookmarks.
  { href: "/plexus-bank",      label: "Plexus Bank",      Icon: Landmark,     roles: ["admin"] },
  { href: "/plexus-tasks",     label: "Plexus Tasks",     Icon: CheckSquare,  roles: ["admin", "clinician", "scheduler", "biller"] },
  { href: "/document-library", label: "Document Library", Icon: Library,      roles: ["admin"] },
  { href: "/clinician-portal", label: "Clinician Portal", Icon: Stethoscope,    roles: ["admin", "clinician"] },
  { href: "/technician-portal", label: "Technician Portal", Icon: Stethoscope,    roles: ["admin", "technician", "liaison"] },
  { href: "/liaison-technician-portal",    label: "Liaison Technician Portal",    Icon: HeartHandshake, roles: ["admin", "technician", "liaison"] },
  { href: "/admin/settings",   label: "Admin",            Icon: Shield,       roles: ["admin"] },
];

function TodayBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-auto shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-finance-periwinkle text-white text-[10px] font-bold flex items-center justify-center leading-none">
      {count}
    </span>
  );
}

function UnreadBadge({ count, overdue }: { count: number; overdue: boolean }) {
  if (count === 0 && !overdue) return null;
  const color = overdue ? "bg-red-500" : "bg-finance-periwinkle";
  const label = count > 0 ? count : "!";
  return (
    <span
      className={`ml-auto shrink-0 min-w-[20px] h-5 px-1.5 rounded-full ${color} text-white text-[10px] font-bold flex items-center justify-center leading-none`}
      data-testid={overdue ? "badge-plexus-overdue" : "badge-plexus-unread"}
      title={overdue ? "You have overdue tasks" : undefined}
    >
      {label}
    </span>
  );
}

export function GlobalNav({ user }: { user?: AuthUser; onLogout?: () => void }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth < 1024);
  const [manualOverride, setManualOverride] = useState(false);
  // Edge-hover expand (task #781): the collapsed rail sits flush against the
  // left screen edge, so hovering it temporarily expands the nav; moving the
  // pointer away collapses it again after a short debounce. A manual toggle
  // always takes precedence (manually expanded nav never auto-collapses).
  // Hover-only — touch devices keep the tap toggle.
  const hoverCapable = useHoverCapable();
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);
  const userRole = user?.role ?? "clinician";

  useEffect(() => {
    function handleResize() {
      if (!manualOverride) {
        setCollapsed(window.innerWidth < 1024);
      }
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [manualOverride]);

  const { data: todaySummary } = useQuery<{ patientCount: number; batchCount: number }>({
    queryKey: ["/api/schedule/today-summary"],
    refetchInterval: 60_000,
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/plexus/tasks/unread-count"],
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const unreadCount = unreadData?.count ?? 0;

  const { data: overdueData } = useQuery<{ overdueCount: number; dueTodayCount: number }>({
    queryKey: ["/api/plexus/tasks/overdue"],
    refetchInterval: 60_000,
  });
  const overdueCount = overdueData?.overdueCount ?? 0;

  const todayCount = todaySummary?.patientCount ?? 0;

  const isActive = (href: string) => {
    if (href === "/home") return location === "/home" || location === "/";
    if (href === "/schedule") return location === "/schedule";
    if (href === "/admin/settings") {
      return (
        location === "/admin/settings" ||
        location === "/admin" ||
        location === "/admin-ops" ||
        location.startsWith("/admin/") ||
        location.startsWith("/admin-ops/") ||
        location === "/audit-log" ||
        location === "/call-list-audit" ||
        location === "/settings" ||
        location === "/billing/auditor" ||
        location === "/billing/remittance"
      );
    }
    return location === href || location.startsWith(href + "/");
  };

  const visibleNavItems = NAV_ITEMS.filter((item) => item.roles.includes(userRole));

  // Hover expansion only applies while the nav is collapsed; a manually
  // expanded nav ignores hover entirely.
  const effectiveCollapsed = collapsed && !hoverExpanded;

  return (
    <nav
      className={`flex flex-col h-full bg-finance-dark border-r border-finance-dark-3 transition-all duration-200 shrink-0 ${effectiveCollapsed ? "w-14" : "w-52"}`}
      data-testid="global-nav"
      aria-label="Global navigation"
      onMouseEnter={
        hoverCapable
          ? () => {
              if (hoverTimer.current) {
                clearTimeout(hoverTimer.current);
                hoverTimer.current = null;
              }
              if (collapsed) setHoverExpanded(true);
            }
          : undefined
      }
      onMouseLeave={
        hoverCapable
          ? () => {
              if (hoverTimer.current) clearTimeout(hoverTimer.current);
              hoverTimer.current = setTimeout(() => {
                hoverTimer.current = null;
                setHoverExpanded(false);
              }, EDGE_HOVER_LEAVE_DELAY_MS);
            }
          : undefined
      }
    >
      <div className={`flex items-center ${effectiveCollapsed ? "justify-center px-2 py-3" : "justify-end px-3 py-3"} border-b border-finance-dark-3`}>
        <button
          onClick={() => { setManualOverride(true); setHoverExpanded(false); setCollapsed((c) => !c); }}
          className="text-slate-400 hover:text-white transition-colors rounded-lg p-1 hover:bg-finance-dark-3"
          data-testid="button-nav-collapse"
          aria-label={effectiveCollapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {effectiveCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {!effectiveCollapsed && (
        <div className="px-4 pt-3 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Workspace</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
        {visibleNavItems.map(({ href, label, Icon }) => {
          const active = isActive(href);
          const isSchedule = href === "/schedule";
          const isPlexusTasks = href === "/plexus-tasks";
          return (
            <Link key={href} href={href}>
              <div
                className={`relative flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer transition-colors group ${
                  active
                    ? "bg-white text-finance-text shadow-sm"
                    : "text-slate-300 hover:bg-finance-dark-3 hover:text-white"
                } ${effectiveCollapsed ? "justify-center" : ""}`}
                data-testid={`nav-item-${label.toLowerCase().replace(/\s+/g, "-")}`}
                title={effectiveCollapsed ? label : undefined}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? "text-finance-text" : "text-slate-400 group-hover:text-white"}`} strokeWidth={1.75} />
                {!effectiveCollapsed && (
                  <>
                    <span className="text-[14px] font-medium truncate flex-1">{label}</span>
                    {isSchedule && <TodayBadge count={todayCount} />}
                    {isPlexusTasks && <UnreadBadge count={unreadCount} overdue={overdueCount > 0} />}
                  </>
                )}
                {effectiveCollapsed && isSchedule && todayCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-finance-periwinkle" />
                )}
                {effectiveCollapsed && isPlexusTasks && (unreadCount > 0 || overdueCount > 0) && (
                  <span className={`absolute top-1 right-1 w-2 h-2 rounded-full ${overdueCount > 0 ? "bg-red-500" : "bg-finance-periwinkle"}`} />
                )}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="border-t border-finance-dark-3 px-2 py-2 space-y-0.5">
      </div>
    </nav>
  );
}
