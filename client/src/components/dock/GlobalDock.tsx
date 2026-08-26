// GlobalDock — ONE unified bottom dock for the entire platform.
//
// Renders a centered bottom-anchored pill with role-aware app icons.
// Supports: route navigation, popup triggers, workspace launches, and
// custom actions. Visual states: idle (condensed, low opacity), hover
// (expanded, full opacity), active ring, open dot indicators.
//
// This component is consumed BOTH by the App-level global layout AND by
// TeamPortalShell (which passes workspace-aware state via props). The
// visual appearance and interaction model are identical everywhere —
// only the resolved app list differs by role.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { DockAppDefinition, DockActiveState } from "./types";
import { resolveAppsForRole } from "./registry";
import { useDockOwned } from "./DockOwnershipContext";
import { useUnreadCount } from "@/features/plexus-tasks/hooks";

// ─── Props ────────────────────────────────────────────────────────────────

export type GlobalDockProps = {
  /** Override the role used to resolve apps (default: read from /api/auth/me). */
  role?: string;
  /** Whether the current user is admin (default: derived from auth). */
  isAdmin?: boolean;
  /** Workspace-level active/open state (for Team Portal integration). */
  activeState?: DockActiveState;
  /** Handler when a dock app is activated. Default: navigate or no-op. */
  onActivate?: (app: DockAppDefinition) => void;
  /** Badge counts keyed by app ID. */
  badges?: Record<string, number>;
  /** CSS position override. Default: "fixed". Use "absolute" inside portals. */
  position?: "fixed" | "absolute";
  /** Additional className on the outermost wrapper. */
  className?: string;
};

// ─── Auth type ────────────────────────────────────────────────────────────

type AuthMe = { id: string; username: string; role: string } | null;

// ─── Component ────────────────────────────────────────────────────────────

export function GlobalDock({
  role: roleProp,
  isAdmin: isAdminProp,
  activeState,
  onActivate,
  badges,
  position = "fixed",
  className = "",
}: GlobalDockProps) {
  const [location] = useLocation();
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // If another component (e.g. TeamPortalShell) owns the dock AND this
  // instance has no activeState (meaning it's the app-level fallback),
  // skip rendering to prevent duplicate docks.
  const dockOwnedByParent = useDockOwned();
  const isAppLevelInstance = !activeState && position === "fixed";
  if (dockOwnedByParent && isAppLevelInstance) return null;

  // Auth — only fetch if role not provided via props.
  const { data: me } = useQuery<AuthMe>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 5 * 60_000,
    enabled: roleProp == null,
  });

  const role = roleProp ?? me?.role ?? "admin";
  const isAdmin = isAdminProp ?? (me?.role === "admin");

  // Resolve apps for this role.
  const apps = useMemo(() => resolveAppsForRole(role, isAdmin), [role, isAdmin]);

  // Canonical badge: task due count.
  const { data: taskUnread } = useUnreadCount();
  const canonicalBadges = useMemo(() => {
    const b: Record<string, number> = {};
    const count = taskUnread?.count ?? 0;
    if (count > 0) b["plexus-tasks"] = count;
    return { ...b, ...badges };
  }, [taskUnread, badges]);

  // Hover-intent debounce (120ms collapse delay absorbs transition jitter).
  const handleEnter = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    setHovered(true);
  }, []);
  const handleLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => { hoverTimer.current = null; setHovered(false); }, 120);
  }, []);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

  const expanded = hovered;

  // Default onActivate: navigate for route-type apps.
  const [, navigate] = useLocation();
  const handleActivate = useCallback((app: DockAppDefinition) => {
    if (onActivate) {
      onActivate(app);
      return;
    }
    // Default behavior when no parent handler is provided.
    if (app.destinationType === "route" && app.route) {
      navigate(app.route);
    }
  }, [onActivate, navigate]);

  return (
    <div
      ref={rootRef}
      className={`${position} bottom-4 left-1/2 -translate-x-1/2 z-50 ${className}`}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      data-testid="global-dock"
      data-expanded={expanded ? "true" : "false"}
    >
      <nav
        className={[
          "mx-auto flex w-fit items-center gap-1 rounded-2xl border backdrop-blur-xl shadow-lg",
          "transition-all duration-300 ease-out",
          expanded
            ? "gap-2 border-white/20 bg-slate-900/60 px-3 py-2 opacity-100"
            : "border-white/10 bg-slate-900/40 px-2 py-2 opacity-60",
        ].join(" ")}
        aria-label="Platform dock"
      >
        {apps.map((app, idx) => {
          const isActive =
            activeState?.activeAppId === app.id ||
            (app.destinationType === "route" && app.route
              ? location === app.route || location.startsWith(app.route + "/")
              : false);
          const isOpen = activeState?.openAppIds?.includes(app.id) ?? false;
          const badge = canonicalBadges?.[app.id] ?? (typeof app.badge === "function" ? undefined : (app.badge as number | undefined));

          return (
            <div key={app.id} className="flex items-center">
              {idx > 0 && <div className="mx-0.5 h-5 w-px bg-white/10" />}
              <DockButton
                app={app}
                expanded={expanded}
                isActive={isActive}
                isOpen={isOpen}
                badge={typeof badge === "number" && badge > 0 ? badge : undefined}
                onActivate={handleActivate}
              />
            </div>
          );
        })}
      </nav>
    </div>
  );
}

// ─── Individual dock button ───────────────────────────────────────────────

function DockButton({
  app,
  expanded,
  isActive,
  isOpen,
  badge,
  onActivate,
}: {
  app: DockAppDefinition;
  expanded: boolean;
  isActive: boolean;
  isOpen: boolean;
  badge?: number;
  onActivate: (app: DockAppDefinition) => void;
}) {
  const Icon = app.icon;

  const iconEl = (
    <span
      className={[
        "relative inline-flex items-center justify-center rounded-xl shadow-md",
        "transition-all duration-300 ease-out",
        expanded ? "h-10 w-10" : "h-9 w-9",
        isActive
          ? "ring-2 ring-white bg-white/20 text-white"
          : "bg-white/10 text-white/80 hover:-translate-y-0.5 hover:scale-105 hover:bg-white/15 hover:text-white",
      ].join(" ")}
    >
      <Icon className={`transition-all duration-200 ${expanded ? "h-5 w-5" : "h-4 w-4"}`} />
      {badge != null && badge > 0 && (
        <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-slate-900">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {isOpen && (
        <span className="absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white" />
      )}
    </span>
  );

  // Route-type apps render as links for native browser navigation.
  if (app.destinationType === "route" && app.route) {
    return (
      <Link
        href={app.route}
        className="flex flex-col items-center"
        data-testid={app.testId}
        title={app.label}
      >
        {iconEl}
      </Link>
    );
  }

  // All other types use a button that delegates to onActivate.
  return (
    <button
      type="button"
      onClick={() => onActivate(app)}
      className="flex flex-col items-center"
      data-testid={app.testId}
      title={app.label}
    >
      {iconEl}
    </button>
  );
}
