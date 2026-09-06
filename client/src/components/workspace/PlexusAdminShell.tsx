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

import { useLocation } from "wouter";
import type { ReactNode } from "react";
import type { AuthUser } from "@/App";
import { TopBanner } from "@/components/TopBanner";
import { GlobalNav } from "@/components/GlobalNav";
import { GlobalDock } from "@/components/dock";
import { WorkspaceTabBar } from "@/components/workspace/WorkspaceTabBar";
import { isAdminWorkspaceRoute } from "@/lib/navigation/workspaceRegistry";

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
          <div className="flex-1 min-h-0 overflow-auto bg-[#e2e8f0]">{children}</div>
        </div>
      </div>
    </div>
  );
}
