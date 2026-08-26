// Nova preferences hook — persists appearance + position per user.
//
// Uses localStorage keyed by userId. Falls back to defaults when no
// stored value exists. Debounces writes to avoid thrashing on drag.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_NOVA_PREFERENCES,
  type NovaUserPreferences,
  type NovaAppearanceProfile,
  type NovaPositionState,
  type NovaColorPreset,
  type NovaShape,
  type NovaPositionMode,
} from "./contracts";

const STORAGE_KEY_PREFIX = "plexus_nova_prefs_";
const DEBOUNCE_MS = 500;

function loadPrefs(userId: string | null): NovaUserPreferences {
  if (!userId) return DEFAULT_NOVA_PREFERENCES;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}`);
    if (!raw) return DEFAULT_NOVA_PREFERENCES;
    const parsed = JSON.parse(raw);
    return {
      appearance: { ...DEFAULT_NOVA_PREFERENCES.appearance, ...(parsed.appearance ?? {}) },
      position: { ...DEFAULT_NOVA_PREFERENCES.position, ...(parsed.position ?? {}) },
    };
  } catch {
    return DEFAULT_NOVA_PREFERENCES;
  }
}

function savePrefs(userId: string | null, prefs: NovaUserPreferences): void {
  if (!userId) return;
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}`, JSON.stringify(prefs));
  } catch { /* quota / unavailable */ }
}

export function useNovaPreferences(userId: string | null) {
  const [prefs, setPrefs] = useState<NovaUserPreferences>(() => loadPrefs(userId));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-hydrate on userId change.
  useEffect(() => {
    setPrefs(loadPrefs(userId));
  }, [userId]);

  // Debounced persist.
  const persist = useCallback((next: NovaUserPreferences) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { savePrefs(userId, next); }, DEBOUNCE_MS);
  }, [userId]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const updateAppearance = useCallback((patch: Partial<NovaAppearanceProfile>) => {
    setPrefs((prev) => {
      const next = { ...prev, appearance: { ...prev.appearance, ...patch } };
      persist(next);
      return next;
    });
  }, [persist]);

  const updatePosition = useCallback((patch: Partial<NovaPositionState>) => {
    setPrefs((prev) => {
      const next = { ...prev, position: { ...prev.position, ...patch } };
      persist(next);
      return next;
    });
  }, [persist]);

  const setSize = useCallback((size: number) => {
    updateAppearance({ size: Math.max(40, Math.min(180, size)) });
  }, [updateAppearance]);

  const setColorPreset = useCallback((preset: NovaColorPreset) => {
    updateAppearance({ colorPreset: preset });
  }, [updateAppearance]);

  const setShape = useCallback((shape: NovaShape) => {
    updateAppearance({ shape });
  }, [updateAppearance]);

  const setPositionMode = useCallback((mode: NovaPositionMode) => {
    updatePosition({ mode });
  }, [updatePosition]);

  const setFreePosition = useCallback((x: number, y: number) => {
    updatePosition({ mode: "free", x, y });
  }, [updatePosition]);

  return {
    prefs,
    updateAppearance,
    updatePosition,
    setSize,
    setColorPreset,
    setShape,
    setPositionMode,
    setFreePosition,
  };
}
