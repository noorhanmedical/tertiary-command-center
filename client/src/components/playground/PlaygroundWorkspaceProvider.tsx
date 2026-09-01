// Playground Workspace Provider — central state management for multi-tab workspaces.
//
// Single source of truth for all open workspaces, active tab, dirty state,
// deduplication, and the openInPlayground API that every launcher uses.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PlaygroundWorkspace, PlaygroundWorkspaceAPI, OpenInPlaygroundRequest } from "./types";
import { getWorkspaceDefinition } from "./registry";
import { saveSession, restoreSession } from "./sessionPersistence";

const PlaygroundCtx = createContext<PlaygroundWorkspaceAPI | null>(null);

export function usePlayground(): PlaygroundWorkspaceAPI {
  const ctx = useContext(PlaygroundCtx);
  if (!ctx) throw new Error("usePlayground must be used within PlaygroundWorkspaceProvider");
  return ctx;
}

/** Optional — returns null outside provider (for components that may exist outside). */
export function usePlaygroundOptional(): PlaygroundWorkspaceAPI | null {
  return useContext(PlaygroundCtx);
}

let nextId = 1;
function generateId(): string {
  return `ws_${nextId++}_${Date.now().toString(36)}`;
}

export function PlaygroundWorkspaceProvider({ children }: { children: ReactNode }) {
  // Restore session on mount.
  const [workspaces, setWorkspaces] = useState<PlaygroundWorkspace[]>(() => {
    const restored = restoreSession();
    return restored?.workspaces ?? [];
  });
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() => {
    const restored = restoreSession();
    return restored?.activeId ?? null;
  });

  // Auto-save session on state changes (debounced).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveSession(workspaces, activeWorkspaceId);
    }, 300);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [workspaces, activeWorkspaceId]);

  // Workspace-owned save handlers, keyed by workspace id. Populated via
  // registerSaveHandler; consumed by saveWorkspace (Save & Close). Kept in a
  // ref so registering does not trigger re-renders.
  const saveHandlers = useRef<Map<string, () => Promise<boolean>>>(new Map());

  // Monotonic focus token source. Every focus-intent open bumps this so a
  // renderer can act on the change exactly once.
  const focusTokenSeq = useRef(0);

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );

  const foregroundPatientId = useMemo(
    () => activeWorkspace?.patientScreeningId ?? activeWorkspace?.patientId ?? null,
    [activeWorkspace],
  );

  const openWorkspace = useCallback((request: OpenInPlaygroundRequest): string => {
    const def = getWorkspaceDefinition(request.type);
    const now = Date.now();

    // Build a partial workspace for deduplication.
    const partial: Partial<PlaygroundWorkspace> = {
      type: request.type,
      patientId: request.patientId ?? null,
      patientScreeningId: request.patientScreeningId ?? null,
      executionCaseId: request.executionCaseId ?? null,
      ancillaryCaseId: request.ancillaryCaseId ?? null,
      serviceEpisodeId: request.serviceEpisodeId ?? null,
      serviceKey: request.serviceKey ?? null,
      documentId: request.documentId ?? null,
      appointmentId: request.appointmentId ?? null,
      taskId: request.taskId ?? null,
      conversationId: request.conversationId ?? null,
    };

    // Deduplication: check if matching workspace already exists.
    if (!request.forceNew && def) {
      const dedupeKey = def.dedupeKey(partial);
      const existing = workspaces.find((w) => {
        const existingDef = getWorkspaceDefinition(w.type);
        return existingDef && existingDef.dedupeKey(w) === dedupeKey;
      });
      if (existing) {
        // Focus existing + optionally update context. Bump the one-shot focus
        // token only when this open carries focus intent, so re-clicking the
        // same queue row scrolls/highlights again without spurious refocus.
        const hasFocusIntent = request.focusSection != null || request.focusObjectId != null;
        const nextToken = hasFocusIntent ? ++focusTokenSeq.current : existing.focusToken;
        setWorkspaces((prev) => prev.map((w) =>
          w.id === existing.id
            ? {
                ...w,
                lastActivatedAt: now,
                focusSection: request.focusSection ?? w.focusSection,
                focusObjectId: request.focusObjectId ?? w.focusObjectId,
                serviceKey: request.serviceKey ?? w.serviceKey,
                executionCaseId: request.executionCaseId ?? w.executionCaseId,
                ancillaryCaseId: request.ancillaryCaseId ?? w.ancillaryCaseId,
                serviceEpisodeId: request.serviceEpisodeId ?? w.serviceEpisodeId,
                // Scheduler context: re-launching for a (new) patient/date must
                // update the singleton workspace so it reflects the new context.
                patientScreeningId: request.patientScreeningId ?? w.patientScreeningId,
                facilityId: request.facilityId ?? w.facilityId,
                patientDob: request.patientDob ?? w.patientDob,
                initialDate: request.initialDate ?? w.initialDate,
                title: request.title ?? w.title,
                focusToken: nextToken,
              }
            : w,
        ));
        setActiveWorkspaceId(existing.id);
        return existing.id;
      }
    }

    // Create new workspace.
    const id = generateId();
    const title = request.title ?? def?.titleResolver?.({ ...partial, title: "" } as PlaygroundWorkspace) ?? request.type;
    const ws: PlaygroundWorkspace = {
      id,
      type: request.type,
      title,
      subtitle: request.subtitle,
      patientId: request.patientId ?? null,
      patientScreeningId: request.patientScreeningId ?? null,
      executionCaseId: request.executionCaseId ?? null,
      ancillaryCaseId: request.ancillaryCaseId ?? null,
      serviceEpisodeId: request.serviceEpisodeId ?? null,
      serviceKey: request.serviceKey ?? null,
      documentId: request.documentId ?? null,
      appointmentId: request.appointmentId ?? null,
      taskId: request.taskId ?? null,
      conversationId: request.conversationId ?? null,
      focusSection: request.focusSection ?? null,
      focusObjectId: request.focusObjectId ?? null,
      focusToken: (request.focusSection != null || request.focusObjectId != null)
        ? ++focusTokenSeq.current
        : 0,
      facilityId: request.facilityId ?? null,
      source: request.source,
      pinned: false,
      dirty: false,
      createdAt: now,
      lastActivatedAt: now,
    };

    setWorkspaces((prev) => [...prev, ws]);
    setActiveWorkspaceId(id);
    return id;
  }, [workspaces]);

  const focusWorkspace = useCallback((id: string) => {
    setWorkspaces((prev) => prev.map((w) =>
      w.id === id ? { ...w, lastActivatedAt: Date.now() } : w,
    ));
    setActiveWorkspaceId(id);
  }, []);

  const closeWorkspace = useCallback((id: string) => {
    saveHandlers.current.delete(id);
    setWorkspaces((prev) => {
      const idx = prev.findIndex((w) => w.id === id);
      const next = prev.filter((w) => w.id !== id);
      // If closing the active workspace, activate the nearest tab.
      if (activeWorkspaceId === id) {
        const neighbor = next[Math.min(idx, next.length - 1)] ?? null;
        setActiveWorkspaceId(neighbor?.id ?? null);
      }
      return next;
    });
  }, [activeWorkspaceId]);

  const closeOtherWorkspaces = useCallback((keepId: string) => {
    // Dirty protection: never silently drop unsaved work. Keep the target, any
    // pinned tabs, and any dirty tabs; close the rest.
    setWorkspaces((prev) => {
      prev.forEach((w) => {
        if (w.id !== keepId && !w.pinned && !w.dirty) saveHandlers.current.delete(w.id);
      });
      return prev.filter((w) => w.id === keepId || w.pinned || w.dirty);
    });
    setActiveWorkspaceId(keepId);
  }, []);

  const closeAllWorkspaces = useCallback(() => {
    // Dirty protection: keep pinned + dirty tabs.
    setWorkspaces((prev) => {
      prev.forEach((w) => {
        if (!w.pinned && !w.dirty) saveHandlers.current.delete(w.id);
      });
      const kept = prev.filter((w) => w.pinned || w.dirty);
      setActiveWorkspaceId(kept[0]?.id ?? null);
      return kept;
    });
  }, []);

  const pinWorkspace = useCallback((id: string, pinned: boolean) => {
    setWorkspaces((prev) => prev.map((w) => w.id === id ? { ...w, pinned } : w));
  }, []);

  const setDirty = useCallback((id: string, dirty: boolean, description?: string) => {
    setWorkspaces((prev) => prev.map((w) =>
      w.id === id ? { ...w, dirty, dirtyDescription: description } : w,
    ));
  }, []);

  const registerSaveHandler = useCallback((id: string, handler: () => Promise<boolean>) => {
    saveHandlers.current.set(id, handler);
    return () => {
      // Only delete if still the same handler (guards against unmount races).
      if (saveHandlers.current.get(id) === handler) saveHandlers.current.delete(id);
    };
  }, []);

  const saveWorkspace = useCallback(async (id: string): Promise<boolean> => {
    const handler = saveHandlers.current.get(id);
    if (!handler) {
      // No registered saver — nothing to persist, treat as a no-op success so
      // the caller can proceed to clear dirty + close.
      return true;
    }
    try {
      const ok = await handler();
      if (ok) {
        setWorkspaces((prev) => prev.map((w) =>
          w.id === id ? { ...w, dirty: false, dirtyDescription: undefined } : w,
        ));
      }
      return ok;
    } catch {
      return false;
    }
  }, []);

  const updateWorkspace = useCallback((id: string, patch: Partial<PlaygroundWorkspace>) => {
    setWorkspaces((prev) => prev.map((w) => w.id === id ? { ...w, ...patch } : w));
  }, []);

  const reorderWorkspace = useCallback((fromIndex: number, toIndex: number) => {
    setWorkspaces((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      if (moved) next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const goHome = useCallback(() => {
    // Focus or create the playground_home workspace.
    const existing = workspaces.find((w) => w.type === "playground_home");
    if (existing) {
      setActiveWorkspaceId(existing.id);
      setWorkspaces((prev) => prev.map((w) =>
        w.id === existing.id ? { ...w, lastActivatedAt: Date.now() } : w,
      ));
    } else {
      const id = generateId();
      const ws: PlaygroundWorkspace = {
        id,
        type: "playground_home",
        title: "Home",
        pinned: false,
        dirty: false,
        createdAt: Date.now(),
        lastActivatedAt: Date.now(),
      };
      setWorkspaces((prev) => [ws, ...prev]);
      setActiveWorkspaceId(id);
    }
  }, [workspaces]);

  const api = useMemo<PlaygroundWorkspaceAPI>(() => ({
    workspaces,
    activeWorkspaceId,
    activeWorkspace,
    openWorkspace,
    focusWorkspace,
    closeWorkspace,
    closeOtherWorkspaces,
    closeAllWorkspaces,
    pinWorkspace,
    setDirty,
    updateWorkspace,
    reorderWorkspace,
    goHome,
    registerSaveHandler,
    saveWorkspace,
    foregroundPatientId,
  }), [workspaces, activeWorkspaceId, activeWorkspace, openWorkspace, focusWorkspace,
    closeWorkspace, closeOtherWorkspaces, closeAllWorkspaces, pinWorkspace, setDirty,
    updateWorkspace, reorderWorkspace, goHome, registerSaveHandler, saveWorkspace,
    foregroundPatientId]);

  return <PlaygroundCtx.Provider value={api}>{children}</PlaygroundCtx.Provider>;
}
