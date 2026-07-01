// Team Portal workspace preferences (Task #643).
//
// IN-SESSION ONLY. These preferences intentionally do NOT persist across
// reloads in this pass — there is no DB table or settings endpoint wired.
// The shape is deliberately serializable so a future pass can persist it
// (e.g. via /api/adminSettings or a per-user workspace_prefs row) without
// touching call sites. The Settings dialog clearly marks this limitation.

import { useCallback, useState } from "react";

export type TrayTab = "patient" | "team" | "email" | "notes";
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
  defaultTrayTab: "email",
  stickyNotesVisible: true,
  toolsPinnedByDefault: false,
  workQueuePinnedByDefault: false,
  playgroundLayout: "docked",
  calendarBehavior: "playground",
};

export function useWorkspacePrefs(initial?: Partial<WorkspacePrefs>) {
  const [prefs, setPrefs] = useState<WorkspacePrefs>({
    ...DEFAULT_WORKSPACE_PREFS,
    ...initial,
  });

  const updatePref = useCallback(
    <K extends keyof WorkspacePrefs>(key: K, value: WorkspacePrefs[K]) => {
      setPrefs((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const resetPrefs = useCallback(() => {
    setPrefs({ ...DEFAULT_WORKSPACE_PREFS });
  }, []);

  return { prefs, updatePref, resetPrefs } as const;
}
