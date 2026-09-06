import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AuthUser } from "@/App";
import { getSidebarGroups, resolveWorkspace } from "@/lib/navigation/workspaceRegistry";

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
  // Winter shell is scoped to the staged Home redesign only (§9).
  const winter = location === "/home-preview";
  // Hover-driven rail: collapsed to an icon strip by default, expands into an
  // overlay panel while the cursor is over it (no content reflow).
  const [hovered, setHovered] = useState(false);
  const expanded = hovered;
  const collapsed = !expanded;
  const userRole = user?.role ?? "clinician";
  const userPermissions = user?.permissions ?? [];

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

  // Single source of truth: grouped, role-filtered platform apps. Permissions
  // enable permission-aware nav items (e.g. Access Management for scoped admins).
  const groups = getSidebarGroups(userRole, userPermissions);
  // Active item derives from the route (nested routes keep the parent active).
  const activeId = resolveWorkspace(location)?.id ?? null;

  const expandedWidth = winter ? "w-[244px]" : "w-56";

  return (
    // Reserves the collapsed rail width in the layout; the actual nav is an
    // overlay so expanding on hover never pushes/reflows the page content.
    <div
      className="relative h-full w-14 shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid="global-nav-rail"
    >
      <nav
        className={`absolute inset-y-0 left-0 flex flex-col h-full border-r transition-[width] duration-200 ease-out ${
          winter ? "border-white/10" : "bg-[#05060f] border-finance-dark-3"
        } ${expanded ? `${expandedWidth} z-30 shadow-2xl` : "w-14 z-20"}`}
        style={winter ? { background: "#0b0f17" } : undefined}
        data-testid="global-nav"
        aria-label="Global navigation"
      >
        {/* Top spacer keeps the first group clear of the panel edge. */}
        <div className="h-3 shrink-0" />

        <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-2">
          {groups.map((grp, gi) => (
            <div key={grp.group} className={gi > 0 ? "mt-3" : ""}>
              {/* Section heading only when expanded; a hairline stands in as a
                  subtle group divider while collapsed. */}
              {expanded ? (
                <div className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                  {grp.label}
                </div>
              ) : (
                gi > 0 && <div className="mx-2 mb-1 h-px bg-finance-dark-3" />
              )}
              <div className="space-y-0.5">
                {grp.items.map((item) => {
                  const Icon = item.sidebar!.icon;
                  const active = activeId === item.id;
                  const isSchedule = item.id === "global-schedule";
                  const isPlexusTasks = item.id === "plexus-tasks";
                  return (
                    <Link key={item.id} href={item.canonicalRoute}>
                      <div
                        className={`relative flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer transition-colors group ${
                          active
                            ? winter
                              ? "winter-nav-active shadow-sm"
                              : "bg-white text-finance-text shadow-sm"
                            : winter
                              ? "text-slate-300 hover:bg-white/5 hover:text-white"
                              : "text-slate-300 hover:bg-finance-dark-3 hover:text-white"
                        } ${collapsed ? "justify-center" : ""}`}
                        data-testid={`nav-item-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                        title={collapsed ? item.title : undefined}
                      >
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            active
                              ? winter
                                ? "text-white"
                                : "text-finance-text"
                              : "text-slate-400 group-hover:text-white"
                          }`}
                          strokeWidth={1.75}
                        />
                        {expanded && (
                          <>
                            <span className="text-[14px] font-medium truncate flex-1 whitespace-nowrap">{item.title}</span>
                            {isSchedule && <TodayBadge count={todayCount} />}
                            {isPlexusTasks && <UnreadBadge count={unreadCount} overdue={overdueCount > 0} />}
                          </>
                        )}
                        {collapsed && isSchedule && todayCount > 0 && (
                          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-finance-periwinkle" />
                        )}
                        {collapsed && isPlexusTasks && (unreadCount > 0 || overdueCount > 0) && (
                          <span className={`absolute top-1 right-1 w-2 h-2 rounded-full ${overdueCount > 0 ? "bg-red-500" : "bg-finance-periwinkle"}`} />
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>
    </div>
  );
}
