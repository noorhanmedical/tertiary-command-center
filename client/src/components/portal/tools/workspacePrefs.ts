// Team Portal workspace preferences.
//
// PERSISTED PER USER IN THE DATABASE. Prefs are stored as one jsonb row per
// user in the `workspace_prefs` table via GET/PUT /api/portal/workspace-prefs,
// so they survive a page refresh AND sync across devices/browsers. Until the
// per-user key resolves (auth still loading), prefs live in memory only and
// any edits made in that window are merged over the server row once it lands.

import { useCallback, useEffect, useRef, useState } from "react";

export type TrayTab = "patients" | "direct" | "team";
export type PlaygroundLayout = "docked" | "split";
export type CalendarBehavior = "playground" | "quickSchedule";

export type WorkspacePrefs = {
  /** Which communication-tray tab is selected by default. */
  defaultTrayTab: TrayTab;
  /** Whether sticky notes / playground widgets are shown. */
  stickyNotesVisible: boolean;
  /** Pin the Tools rail open on load. */
  toolsPinnedByDefault: boolean;
  /** Pin the Work Queue rail open on load. */
  workQueuePinnedByDefault: boolean;
  /** Docked (single canvas) vs. split (two-up) Playground layout. */
  playgroundLayout: PlaygroundLayout;
  /** What the Calendar tool does when clicked. */
  calendarBehavior: CalendarBehavior;
};

export const DEFAULT_WORKSPACE_PREFS: WorkspacePrefs = {
  defaultTrayTab: "direct",
  stickyNotesVisible: true,
  toolsPinnedByDefault: false,
  workQueuePinnedByDefault: false,
  playgroundLayout: "docked",
  // Task #698 — the Calendar tool opens the Quick Schedule pop-up by
  // default; "playground" (full calendar view) is the opt-out.
  calendarBehavior: "quickSchedule",
};

// Coalesce rapid toggle flips into one PUT.
const PERSIST_DEBOUNCE_MS = 600;

const TRAY_TABS: TrayTab[] = ["direct", "team"];
const LAYOUTS: PlaygroundLayout[] = ["docked", "split"];
const CAL_BEHAVIORS: CalendarBehavior[] = ["playground", "quickSchedule"];

// Defensive validation of a server payload — never trust the wire blindly.
// Unknown/missing keys fall back to defaults so an older row never breaks a
// newer client.
export function parseWorkspacePrefs(raw: unknown): WorkspacePrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    defaultTrayTab: TRAY_TABS.includes(r.defaultTrayTab as TrayTab)
      ? (r.defaultTrayTab as TrayTab)
      : DEFAULT_WORKSPACE_PREFS.defaultTrayTab,
    stickyNotesVisible:
      typeof r.stickyNotesVisible === "boolean"
        ? r.stickyNotesVisible
        : DEFAULT_WORKSPACE_PREFS.stickyNotesVisible,
    toolsPinnedByDefault:
      typeof r.toolsPinnedByDefault === "boolean"
        ? r.toolsPinnedByDefault
        : DEFAULT_WORKSPACE_PREFS.toolsPinnedByDefault,
    workQueuePinnedByDefault:
      typeof r.workQueuePinnedByDefault === "boolean"
        ? r.workQueuePinnedByDefault
        : DEFAULT_WORKSPACE_PREFS.workQueuePinnedByDefault,
    playgroundLayout: LAYOUTS.includes(r.playgroundLayout as PlaygroundLayout)
      ? (r.playgroundLayout as PlaygroundLayout)
      : DEFAULT_WORKSPACE_PREFS.playgroundLayout,
    calendarBehavior: CAL_BEHAVIORS.includes(r.calendarBehavior as CalendarBehavior)
      ? (r.calendarBehavior as CalendarBehavior)
      : DEFAULT_WORKSPACE_PREFS.calendarBehavior,
  };
}

/**
 * Workspace preferences, persisted per user in the database.
 *
 * @param storageKey Stable per-user key (the logged-in user id). When set,
 *                   prefs are loaded from and saved to the `workspace_prefs`
 *                   table. Until it resolves, prefs live in memory; edits made
 *                   during the load window win over the server row (they are
 *                   merged and persisted once the GET lands). On logout the
 *                   hook resets to defaults so one user's prefs never linger
 *                   into another user's session.
 */
export function useWorkspacePrefs(storageKey?: string | null) {
  const [prefs, setPrefs] = useState<WorkspacePrefs>({ ...DEFAULT_WORKSPACE_PREFS });
  // True once the initial GET for the active key has resolved (saved prefs —
  // or the "no row yet" default — are now reflected in `prefs`). Consumers
  // that seed one-shot state from prefs should wait for this.
  const [hydrated, setHydrated] = useState(false);
  const keyRef = useRef<string | null>(null);
  // The key whose initial GET completed — writes are blocked until then so a
  // default snapshot can never clobber the user's saved row.
  const hydratedRef = useRef<string | null>(null);
  // Keys the user edited while the GET for the active key was in flight.
  const dirtyKeysRef = useRef<Set<keyof WorkspacePrefs>>(new Set());
  const prefsRef = useRef<WorkspacePrefs>(prefs);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendPrefs = useCallback((next: WorkspacePrefs, keepalive: boolean) => {
    fetch("/api/portal/workspace-prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(next),
      keepalive,
    }).catch(() => {
      /* best-effort; next mutation retries */
    });
  }, []);

  const schedulePersist = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      sendPrefs(prefsRef.current, false);
    }, PERSIST_DEBOUNCE_MS);
  }, [sendPrefs]);

  // Bind to a user's server row. On every key change we resolve state FROM
  // the server (or defaults) so one user's prefs can never bleed into
  // another's.
  useEffect(() => {
    const key: string | null = storageKey ?? null;
    const prevKey = keyRef.current;

    if (!key) {
      // Logout / unbind: drop any pending write and reset so the next login —
      // even as the same user — re-hydrates from the DB.
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
      hydratedRef.current = null;
      dirtyKeysRef.current = new Set();
      setHydrated(false);
      if (prevKey !== null) {
        prefsRef.current = { ...DEFAULT_WORKSPACE_PREFS };
        setPrefs({ ...DEFAULT_WORKSPACE_PREFS });
      }
      keyRef.current = null;
      return;
    }

    if (hydratedRef.current === key || keyRef.current === key) {
      keyRef.current = key;
      return;
    }

    const isSwitch = !!prevKey && prevKey !== key;
    if (isSwitch) {
      // Drop the outgoing user's pending write and show defaults immediately.
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
      dirtyKeysRef.current = new Set();
      setHydrated(false);
      prefsRef.current = { ...DEFAULT_WORKSPACE_PREFS };
      setPrefs({ ...DEFAULT_WORKSPACE_PREFS });
    }
    keyRef.current = key;

    let cancelled = false;
    (async () => {
      // Fail CLOSED: writes stay blocked until a read succeeds, so a transient
      // GET failure can never lead to defaults overwriting the saved row.
      let attempt = 0;
      while (!cancelled) {
        let loaded: WorkspacePrefs | null | undefined;
        try {
          const res = await fetch("/api/portal/workspace-prefs", { credentials: "include" });
          if (res.ok) {
            const body = await res.json();
            loaded = body === null ? null : parseWorkspacePrefs(body);
          } else {
            loaded = undefined;
          }
        } catch {
          loaded = undefined;
        }
        if (cancelled) return;

        if (loaded !== undefined) {
          const serverPrefs = loaded ?? { ...DEFAULT_WORKSPACE_PREFS };
          // Edits made during the load window win over the server row.
          const dirty = dirtyKeysRef.current;
          const merged: WorkspacePrefs = { ...serverPrefs };
          for (const k of dirty) {
            (merged as any)[k] = prefsRef.current[k];
          }
          hydratedRef.current = key;
          dirtyKeysRef.current = new Set();
          prefsRef.current = merged;
          setPrefs(merged);
          setHydrated(true);
          if (dirty.size > 0) sendPrefs(merged, false);
          return;
        }

        attempt += 1;
        const delay = Math.min(10000, 500 * 2 ** Math.min(attempt, 5));
        await new Promise((r) => setTimeout(r, delay));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storageKey, sendPrefs]);

  // Flush an in-flight debounced write on unmount / navigate-away.
  useEffect(() => {
    return () => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        persistTimer.current = null;
        if (keyRef.current && hydratedRef.current === keyRef.current) {
          sendPrefs(prefsRef.current, true);
        }
      }
    };
  }, [sendPrefs]);

  const applyChange = useCallback(
    (next: WorkspacePrefs, changedKeys: (keyof WorkspacePrefs)[]) => {
      prefsRef.current = next;
      setPrefs(next);
      const k = keyRef.current;
      if (!k) return;
      if (hydratedRef.current !== k) {
        for (const key of changedKeys) dirtyKeysRef.current.add(key);
        return;
      }
      schedulePersist();
    },
    [schedulePersist],
  );

  const updatePref = useCallback(
    <K extends keyof WorkspacePrefs>(key: K, value: WorkspacePrefs[K]) => {
      applyChange({ ...prefsRef.current, [key]: value }, [key]);
    },
    [applyChange],
  );

  const resetPrefs = useCallback(() => {
    applyChange(
      { ...DEFAULT_WORKSPACE_PREFS },
      Object.keys(DEFAULT_WORKSPACE_PREFS) as (keyof WorkspacePrefs)[],
    );
  }, [applyChange]);

  return { prefs, hydrated, updatePref, resetPrefs } as const;
}
