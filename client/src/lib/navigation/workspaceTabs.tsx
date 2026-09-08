// WorkspaceTabsProvider — application-level workspace tab state.
//
// This holds ONLY which major workspaces are open and, per workspace, the
// most-recent route visited within it (lastRoute). The ACTIVE workspace is
// always derived from the current URL via resolveWorkspace(), so it can never
// drift out of sync with wouter. We do not keep a second "active route".
//
// Persistence: open workspace ids + their lastRoute are mirrored to
// sessionStorage so returning from a full-screen Team Portal (or a refresh)
// restores the previously open tabs. On load every stored entry is validated
// against the current registry AND the current user's role — unauthorized or
// unknown entries are discarded. This is navigation state only and never
// grants access; the route guards remain authoritative.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import {
  canRoleSeeWorkspace,
  getWorkspaceById,
  isWorkspaceTabEligible,
  resolveWorkspace,
  type WorkspaceDefinition,
} from "./workspaceRegistry";

export interface WorkspaceTab {
  id: string;
  title: string;
  /** Most recent route visited within this workspace. */
  lastRoute: string;
}

interface WorkspaceTabsContextValue {
  openTabs: WorkspaceTab[];
  /** Active workspace id, derived from the current URL (or null). */
  activeId: string | null;
  /** Navigate to a tab, restoring its remembered route. */
  activateTab: (id: string) => void;
  /** Close a tab; if it was active, activate the nearest neighbor. */
  closeTab: (id: string) => void;
}

const WorkspaceTabsContext = createContext<WorkspaceTabsContextValue | null>(null);

/** sessionStorage key for persisted open workspace tabs. */
export const WORKSPACE_TABS_STORAGE_KEY = "plexus.admin.workspaceTabs.v1";
const STORAGE_KEY = WORKSPACE_TABS_STORAGE_KEY;

/**
 * Clear persisted workspace-tab state. Call on logout so a different user /
 * role signing into the same browser session never inherits the previous
 * user's open-workspace history (UI hygiene — role filtering would remove
 * unauthorized tabs anyway, but this avoids any cross-user leakage).
 */
export function clearWorkspaceTabsStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(WORKSPACE_TABS_STORAGE_KEY);
  } catch {
    /* sessionStorage unavailable — non-fatal */
  }
}

type StoredTab = { id: string; lastRoute: string };

function readStored(): StoredTab[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is StoredTab => e && typeof e.id === "string" && typeof e.lastRoute === "string")
      .map((e) => ({ id: e.id, lastRoute: e.lastRoute }));
  } catch {
    return [];
  }
}

/**
 * Build a validated tab from a workspace id + a candidate lastRoute.
 * Falls back to the canonical route when the remembered route no longer
 * belongs to the workspace (registry changed, stale bookmark, etc.).
 */
function toTab(ws: WorkspaceDefinition, lastRoute: string | undefined): WorkspaceTab {
  const route = lastRoute && ws.matches(lastRoute) ? lastRoute : ws.canonicalRoute;
  return { id: ws.id, title: ws.title, lastRoute: route };
}

export function WorkspaceTabsProvider({
  role,
  children,
}: {
  role: string | null | undefined;
  children: ReactNode;
}) {
  const [location, navigate] = useLocation();

  // Seed from sessionStorage, validated against the registry + role.
  const [openTabs, setOpenTabs] = useState<WorkspaceTab[]>(() => {
    const stored = readStored();
    const seen = new Set<string>();
    const tabs: WorkspaceTab[] = [];
    for (const entry of stored) {
      if (seen.has(entry.id)) continue;
      const ws = getWorkspaceById(entry.id);
      if (!ws) continue;
      if (!isWorkspaceTabEligible(ws)) continue;
      if (!canRoleSeeWorkspace(ws, role)) continue;
      seen.add(entry.id);
      tabs.push(toTab(ws, entry.lastRoute));
    }
    return tabs;
  });

  const activeWorkspace = useMemo(() => resolveWorkspace(location), [location]);
  const activeId = activeWorkspace?.id ?? null;

  // Keep openTabs in sync with the URL: ensure the current workspace is open
  // (append if new) and record its lastRoute. Never duplicates; never
  // reorders existing tabs.
  useEffect(() => {
    if (!activeWorkspace) return; // route with no owning workspace (e.g. previews)
    if (!isWorkspaceTabEligible(activeWorkspace)) return; // Home is not tab-eligible
    if (!canRoleSeeWorkspace(activeWorkspace, role)) return; // guard-backed safety
    setOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === activeWorkspace.id);
      if (idx === -1) {
        return [...prev, toTab(activeWorkspace, location)];
      }
      if (prev[idx].lastRoute === location) return prev;
      const next = prev.slice();
      next[idx] = { ...next[idx], lastRoute: location };
      return next;
    });
  }, [activeWorkspace, location, role]);

  // Persist open tabs (id + lastRoute, order preserved).
  const persistRef = useRef<string>("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const payload = JSON.stringify(openTabs.map((t) => ({ id: t.id, lastRoute: t.lastRoute })));
    if (payload === persistRef.current) return;
    persistRef.current = payload;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, payload);
    } catch {
      /* sessionStorage unavailable — non-fatal */
    }
  }, [openTabs]);

  const activateTab = useCallback(
    (id: string) => {
      const tab = openTabs.find((t) => t.id === id);
      const ws = getWorkspaceById(id);
      if (!ws) return;
      const target = tab?.lastRoute && ws.matches(tab.lastRoute) ? tab.lastRoute : ws.canonicalRoute;
      if (target !== location) navigate(target);
    },
    [openTabs, location, navigate],
  );

  const closeTab = useCallback(
    (id: string) => {
      const ws = getWorkspaceById(id);
      if (ws && ws.closeable === false) return; // Home is non-closeable
      setOpenTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx === -1) return prev;
        const next = prev.filter((t) => t.id !== id);
        const wasActive = id === activeId;
        if (wasActive) {
          if (next.length === 0) {
            navigate("/home");
          } else {
            // Activate nearest neighbor: prefer the previous tab, else next.
            const neighbor = next[Math.max(0, idx - 1)];
            const nWs = getWorkspaceById(neighbor.id);
            const target =
              neighbor.lastRoute && nWs?.matches(neighbor.lastRoute)
                ? neighbor.lastRoute
                : nWs?.canonicalRoute ?? "/home";
            navigate(target);
          }
        }
        return next;
      });
    },
    [activeId, navigate],
  );

  const value = useMemo<WorkspaceTabsContextValue>(
    () => ({ openTabs, activeId, activateTab, closeTab }),
    [openTabs, activeId, activateTab, closeTab],
  );

  return <WorkspaceTabsContext.Provider value={value}>{children}</WorkspaceTabsContext.Provider>;
}

export function useWorkspaceTabs(): WorkspaceTabsContextValue {
  const ctx = useContext(WorkspaceTabsContext);
  if (!ctx) {
    throw new Error("useWorkspaceTabs must be used within a WorkspaceTabsProvider");
  }
  return ctx;
}
