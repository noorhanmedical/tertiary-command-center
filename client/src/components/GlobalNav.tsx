import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  Home as HomeIcon,
  Phone,
  FileText,
  CreditCard,
  Users2,
  Database,
  Shield,
  ChevronLeft,
  ChevronRight,
  LogOut,
  CheckSquare,
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
  { href: "/outreach",         label: "Outreach Center",  Icon: Phone,        roles: ["admin", "clinician", "scheduler"] },
  { href: "/documents",        label: "Ancillary Docs",   Icon: FileText,     roles: ["admin", "clinician"] },
  { href: "/billing",          label: "Billing",          Icon: CreditCard,   roles: ["admin", "biller"] },
  { href: "/team-ops",         label: "Team Ops",         Icon: Users2,       roles: ["admin"] },
  { href: "/patient-database", label: "Patient Database", Icon: Database,     roles: ["admin", "clinician", "biller"] },
  { href: "/plexus-tasks",     label: "Plexus Tasks",     Icon: CheckSquare,  roles: ["admin", "clinician", "scheduler", "biller"] },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  clinician: "Clinician",
  scheduler: "Scheduler",
  biller: "Biller",
};

function TodayBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-auto shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-indigo-100 text-indigo-900 text-[10px] font-bold flex items-center justify-center leading-none">
      {count}
    </span>
  );
}

function UnreadBadge({ count, overdue }: { count: number; overdue: boolean }) {
  if (count === 0 && !overdue) return null;
  const color = overdue ? "bg-red-500" : "bg-indigo-500";
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

function UserAvatar({ username, collapsed }: { username: string; collapsed: boolean }) {
  const initials = username
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  return (
    <div
      className="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center shrink-0"
      title={collapsed ? username : undefined}
      data-testid="avatar-user"
      aria-label={`Signed in as ${username}`}
    >
      <span className="text-white text-[10px] font-bold leading-none">{initials || "?"}</span>
    </div>
  );
}

export function GlobalNav({ user, onLogout }: { user?: AuthUser; onLogout?: () => void }) {
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
      <div className={`flex items-center ${collapsed ? "justify-center px-2 py-4" : "justify-between px-4 py-4"} border-b border-slate-200`}>
        {!collapsed && (
          <span className="text-slate-900 font-bold text-sm tracking-tight truncate">Plexus</span>
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
                    ? "bg-indigo-50 text-indigo-900"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                } ${collapsed ? "justify-center" : ""}`}
                data-testid={`nav-item-${label.toLowerCase().replace(/\s+/g, "-")}`}
                title={collapsed ? label : undefined}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? "text-indigo-900" : "text-slate-500 group-hover:text-slate-700"}`} strokeWidth={1.75} />
                {!collapsed && (
                  <>
                    <span className="text-[14px] font-medium truncate flex-1">{label}</span>
                    {isSchedule && <TodayBadge count={todayCount} />}
                    {isPlexusTasks && <UnreadBadge count={unreadCount} overdue={overdueCount > 0} />}
                  </>
                )}
                {collapsed && isSchedule && todayCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-indigo-500" />
                )}
                {collapsed && isPlexusTasks && (unreadCount > 0 || overdueCount > 0) && (
                  <span className={`absolute top-1 right-1 w-2 h-2 rounded-full ${overdueCount > 0 ? "bg-red-500" : "bg-indigo-500"}`} />
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
                    ? "bg-indigo-50 text-indigo-900"
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

        {user && (
          <div
            className={`flex items-center gap-2 px-2 py-2 rounded-lg ${collapsed ? "justify-center" : ""}`}
            title={collapsed ? `${user.username} (${ROLE_LABELS[userRole] ?? userRole}) — click to sign out` : undefined}
          >
            <UserAvatar username={user.username} collapsed={collapsed} />
            {!collapsed && (
              <>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs text-slate-700 font-medium truncate" data-testid="text-username">{user.username}</span>
                  <span className="text-[10px] text-slate-400 truncate" data-testid="text-user-role">{ROLE_LABELS[userRole] ?? userRole}</span>
                </div>
              </>
            )}
            {onLogout && (
              <button
                onClick={onLogout}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
                title="Sign out"
                data-testid="button-logout"
                aria-label="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
