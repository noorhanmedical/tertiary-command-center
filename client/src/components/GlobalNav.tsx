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
  Shield,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  FolderOpen,
  Library,
  Stethoscope,
  HeartHandshake,
} from "lucide-react";
import { useState, useEffect } from "react";
import type { AuthUser } from "@/App";

type NavItemDef = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number | string }>;
  roles: string[];
};

const NAV_ITEMS: NavItemDef[] = [
  { href: "/home",             label: "Home",             Icon: HomeIcon,     roles: ["admin", "clinician", "scheduler"] },
  { href: "/schedule",         label: "Schedule",         Icon: CalendarDays, roles: ["admin", "clinician", "scheduler"] },
  { href: "/scheduler-portal",         label: "Scheduler Portal",  Icon: Phone,        roles: ["admin", "clinician", "scheduler"] },
  { href: "/ancillary-documents",        label: "Ancillary Documents",   Icon: FileText,     roles: ["admin", "clinician"] },
  { href: "/billing",          label: "Billing",          Icon: CreditCard,   roles: ["admin", "biller"] },
  { href: "/invoices",         label: "Invoices",         Icon: Receipt,      roles: ["admin", "biller"] },
  { href: "/team-ops",         label: "Team Ops",         Icon: Users2,       roles: ["admin"] },
  { href: "/patient-directory", label: "Patient Directory", Icon: Database,     roles: ["admin", "clinician", "biller"] },
  { href: "/plexus-tasks",     label: "Plexus Tasks",     Icon: CheckSquare,  roles: ["admin", "clinician", "scheduler", "biller"] },
  { href: "/drive",            label: "Plexus Drive",     Icon: FolderOpen,   roles: ["admin", "clinician", "scheduler", "biller"] },
  { href: "/document-library", label: "Document Library", Icon: Library,      roles: ["admin"] },
  { href: "/technician-portal", label: "Technician Portal", Icon: Stethoscope,    roles: ["admin", "technician", "liaison"] },
  { href: "/liaison-technician-portal",    label: "Liaison Technician Portal",    Icon: HeartHandshake, roles: ["admin", "technician", "liaison"] },
];

function TodayBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-auto shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-plexus-ice text-plexus-navy-800 text-[10px] font-bold flex items-center justify-center leading-none">
      {count}
    </span>
  );
}

function UnreadBadge({ count, overdue }: { count: number; overdue: boolean }) {
  if (count === 0 && !overdue) return null;
  const color = overdue ? "bg-red-500" : "bg-plexus-blue-500";
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
    return location === href || location.startsWith(href + "/");
  };

  const visibleNavItems = NAV_ITEMS.filter((item) => item.roles.includes(userRole));
  const canSeeAdmin = userRole === "admin";

  return (
    <nav
      className={`flex flex-col h-full bg-white border-r border-slate-200 transition-all duration-200 shrink-0 ${collapsed ? "w-14" : "w-52"}`}
      data-testid="global-nav"
      aria-label="Global navigation"
    >
      <div className={`flex items-center ${collapsed ? "justify-center px-2 py-3" : "justify-between px-3 py-3"} border-b border-slate-200`}>
        {collapsed ? (
          <img
            src="/plexus-logo-icon.png"
            alt="Plexus Ancillary Services"
            className="w-8 h-8 object-contain"
            data-testid="img-nav-logo"
          />
        ) : (
          <img
            src="/plexus-logo.png"
            alt="Plexus Ancillary Services"
            className="h-8 w-auto object-contain rounded-md"
            data-testid="img-nav-logo"
          />
        )}
        <button
          onClick={() => { setManualOverride(true); setCollapsed((c) => !c); }}
          className="text-slate-400 hover:text-slate-700 transition-colors rounded-lg p-1 hover:bg-slate-100"
          data-testid="button-nav-collapse"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="px-4 pt-3 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Workspace</span>
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
                    ? "bg-plexus-ice/60 text-plexus-navy-800"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                } ${collapsed ? "justify-center" : ""}`}
                data-testid={`nav-item-${label.toLowerCase().replace(/\s+/g, "-")}`}
                title={collapsed ? label : undefined}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? "text-plexus-navy-800" : "text-slate-500 group-hover:text-slate-700"}`} strokeWidth={1.75} />
                {!collapsed && (
                  <>
                    <span className="text-[14px] font-medium truncate flex-1">{label}</span>
                    {isSchedule && <TodayBadge count={todayCount} />}
                    {isPlexusTasks && <UnreadBadge count={unreadCount} overdue={overdueCount > 0} />}
                  </>
                )}
                {collapsed && isSchedule && todayCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-plexus-blue-500" />
                )}
                {collapsed && isPlexusTasks && (unreadCount > 0 || overdueCount > 0) && (
                  <span className={`absolute top-1 right-1 w-2 h-2 rounded-full ${overdueCount > 0 ? "bg-red-500" : "bg-plexus-blue-500"}`} />
                )}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="border-t border-slate-200 px-2 py-2 space-y-0.5">
        {canSeeAdmin && (
          <>
            {!collapsed && (
              <div className="px-2 pt-1 pb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Settings</span>
              </div>
            )}
            <Link href="/admin">
              <div
                className={`flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer transition-colors group ${
                  isActive("/admin") || isActive("/admin-ops") || isActive("/settings")
                    ? "bg-plexus-ice/60 text-plexus-navy-800"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                } ${collapsed ? "justify-center" : ""}`}
                data-testid="nav-item-admin"
                title={collapsed ? "Admin" : undefined}
              >
                <Shield className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                {!collapsed && <span className="text-[14px] font-medium truncate">Admin</span>}
              </div>
            </Link>
          </>
        )}

      </div>
    </nav>
  );
}
