// PlexusAdminShell — the persistent Plexus Admin operating environment.
//
// Owns the stable chrome that must never unmount while navigating between
// Admin workspaces:
//   - TopBanner            (persistent structural header)
//   - GlobalNav            (persistent left sidebar, Admin routes only)
//   - WorkspaceTabBar      (application-level workspace switcher)
//   - GlobalDock           (single app-level dock; unchanged)
//   - content outlet       (the routed workspace content)
//
// Changing workspaces only swaps the content outlet — the shell stays
// mounted. True full-screen Team Portal routes (PCS / ACS) deliberately do
// NOT get the sidebar or tab bar: TeamPortalShell renders its own chrome as
// a fixed overlay and owns its own dock via DockOwnershipContext. On those
// routes we still mount TopBanner + GlobalDock (harmless — the portal overlay
// covers the banner and suppresses the app dock), preserving prior behavior.

import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useLocation } from "wouter";
import type { AuthUser } from "@/App";
import { TopBanner } from "@/components/TopBanner";
import { GlobalNav } from "@/components/GlobalNav";
import { GlobalDock } from "@/components/dock";
import { WorkspaceTabBar } from "@/components/workspace/WorkspaceTabBar";
import { isAdminWorkspaceRoute } from "@/lib/navigation/workspaceRegistry";

// RouteTransition — centralized page-enter animation (Pass 3B).
//
// A PERSISTENT presentation wrapper. It is never keyed and never remounts, so
// the routed subtree (wouter <Switch> + matched page), providers, shell chrome,
// and workspace state are untouched — a same-route pathname change keeps the
// page component mounted with its local state and scroll intact, exactly as
// before. On each pathname change we simply RESTART the CSS keyframe animation
// imperatively (drop the class → force one reflow → re-add it) so the new route
// content plays a single subtle fade+rise. This is purely visual.
//
// Full-screen page roots that render INSIDE this shell as `position: fixed`
// overlays opt out: a transform on an ancestor re-bases fixed descendants, so
// those routes never receive the transition class. Team portals (PCS/ACS) and
// login render outside this shell entirely and are excluded structurally.
function RouteTransition({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const excluded =
    location.startsWith("/outreach/scheduler") || location.startsWith("/access-pending");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Restart the animation without remounting children. Removing the class,
    // reading offsetWidth (forces a synchronous reflow that resets the running
    // animation), then re-adding the class replays the keyframes. Runs before
    // paint (useLayoutEffect) so there is no flash of the previous frame.
    el.classList.remove("plexus-route-transition");
    void el.offsetWidth;
    if (!excluded) {
      el.classList.add("plexus-route-transition");
    }
  }, [location, excluded]);

  // React only ever manages the stable `h-full` class here; the transition
  // class is owned imperatively above so the two never conflict.
  return (
    <div ref={ref} className="h-full">
      {children}
    </div>
  );
}

export function PlexusAdminShell({
  user,
  onLogout,
  children,
}: {
  user: AuthUser;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [location] = useLocation();
  const adminRoute = isAdminWorkspaceRoute(location);

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden">
      <TopBanner user={user} onLogout={onLogout} />
      {/* One app-level dock. On Team Portal routes it self-suppresses via
          DockOwnershipContext so the portal's owned dock is the only one. */}
      <GlobalDock />
      {/* Persistent application-level workspace tab strip. Full main-app width,
          directly beneath the TopBanner and above the GlobalNav + content row.
          Self-hides when no workspace tabs are open (e.g. on Home). Gated on
          adminRoute so it never appears on any non-admin shell surface; Team
          Portal routes never mount this shell at all, so they are already
          isolated. */}
      {adminRoute && <WorkspaceTabBar />}
      <div className="flex flex-1 min-h-0 min-w-0">
        {adminRoute && <GlobalNav user={user} onLogout={onLogout} />}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Single primary workspace scroll container. Platform-wide canvas
              background (team portals bypass this shell, so they're excluded). */}
          <div className="flex-1 min-h-0 overflow-auto bg-[#e2e8f0]">
            {/* Centralized route transition (Pass 3B). The wrapper is
                persistent (never keyed/remounted); only its CSS animation is
                retriggered on pathname change. Query-string changes (e.g.
                ?tab=) don't alter the pathname, so in-page tab switches don't
                re-trigger it. */}
            <RouteTransition>{children}</RouteTransition>
          </div>
        </div>
      </div>
    </div>
  );
}
