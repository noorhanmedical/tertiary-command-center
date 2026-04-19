import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  Phone,
  FileText,
  CreditCard,
  Users2,
  Database,
  Brain,
  Shield,
  ChevronLeft,
  ChevronRight,
  LogOut,
  User,
  CheckSquare,
} from "lucide-react";
import { useState, useEffect } from "react";
const NAV_ITEMS = [
  { href: "/schedule",          label: "Schedule",            Icon: CalendarDays,  domain: true },
  { href: "/outreach",          label: "Outreach Center",     Icon: Phone,         domain: true },
  { href: "/documents",         label: "Ancillary Docs",      Icon: FileText,      domain: true },
  { href: "/billing",           label: "Billing",             Icon: CreditCard,    domain: true },
  { href: "/team-ops",          label: "Team Ops",            Icon: Users2,        domain: true },
  { href: "/patient-database",  label: "Patient Database",    Icon: Database,      domain: true },
  { href: "/plexus-tasks",      label: "Plexus Tasks",        Icon: CheckSquare,   domain: true },
  { href: "/task-brain",        label: "Task Brain",          Icon: Brain,         domain: true },
] as const;

function TodayBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-auto shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-white/20 text-white text-[10px] font-bold flex items-center justify-center leading-none">
      {count}
    </span>
  );
}

function UnreadBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-auto shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-indigo-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
      {count}
    </span>
  );
}

type AuthUser = { id: string; username: string } | null;

export function GlobalNav({ user, onLogout }: { user?: AuthUser; onLogout?: () => void }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth < 1024);
  const [manualOverride, setManualOverride] = useState(false);

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
    refetchInterval: 60_000,
  });
  const unreadCount = unreadData?.count ?? 0;

  const todayCount = todaySummary?.patientCount ?? 0;

  const isActive = (href: string) => {
    if (href === "/schedule") return location === "/schedule" || location === "/";
    return location === href || location.startsWith(href + "/");
  };

  return (
    <nav
      className={`flex flex-col h-full bg-[#1a2744] border-r border-white/10 transition-all duration-200 shrink-0 ${collapsed ? "w-14" : "w-52"}`}
      data-testid="global-nav"
      aria-label="Global navigation"
    >
      <div className={`flex items-center ${collapsed ? "justify-center px-2 py-4" : "justify-between px-4 py-4"} border-b border-white/10`}>
        {!collapsed && (
          <span className="text-white font-bold text-sm tracking-tight truncate">Plexus</span>
        )}
        <button
          onClick={() => { setManualOverride(true); setCollapsed((c) => !c); }}
          className="text-white/50 hover:text-white transition-colors rounded-lg p-1 hover:bg-white/10"
          data-testid="button-nav-collapse"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = isActive(href);
          const isSchedule = href === "/schedule";
          const isPlexusTasks = href === "/plexus-tasks";
          return (
            <Link key={href} href={href}>
              <div
                className={`relative flex items-center gap-3 px-2 py-2.5 rounded-xl cursor-pointer transition-colors group ${
                  active
                    ? "bg-white/15 text-white"
                    : "text-white/60 hover:bg-white/8 hover:text-white/90"
                } ${collapsed ? "justify-center" : ""}`}
                data-testid={`nav-item-${label.toLowerCase().replace(/\s+/g, "-")}`}
                title={collapsed ? label : undefined}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? "text-white" : "text-white/60 group-hover:text-white/80"}`} />
                {!collapsed && (
                  <>
                    <span className="text-sm font-medium truncate flex-1">{label}</span>
                    {isSchedule && <TodayBadge count={todayCount} />}
                    {isPlexusTasks && <UnreadBadge count={unreadCount} />}
                  </>
                )}
                {collapsed && isSchedule && todayCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-400" />
                )}
                {collapsed && isPlexusTasks && unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-indigo-400" />
                )}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="border-t border-white/10 px-2 py-2 space-y-0.5">
        <Link href="/admin">
          <div
            className={`flex items-center gap-3 px-2 py-2 rounded-xl cursor-pointer transition-colors group ${
              isActive("/admin") || isActive("/admin-ops") || isActive("/settings")
                ? "bg-white/15 text-white"
                : "text-white/50 hover:bg-white/8 hover:text-white/70"
            } ${collapsed ? "justify-center" : ""}`}
            data-testid="nav-item-admin"
            title={collapsed ? "Admin" : undefined}
          >
            <Shield className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="text-xs font-medium truncate">Admin</span>}
          </div>
        </Link>

        {user && (
          <div
            className={`flex items-center gap-2 px-2 py-2 rounded-xl ${collapsed ? "justify-center" : ""}`}
            title={collapsed ? `${user.username} — click to sign out` : undefined}
          >
            {!collapsed && (
              <>
                <User className="w-3.5 h-3.5 text-white/30 shrink-0" />
                <span className="text-xs text-white/40 truncate flex-1">{user.username}</span>
              </>
            )}
            {onLogout && (
              <button
                onClick={onLogout}
                className="p-1 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/10 transition-colors"
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
