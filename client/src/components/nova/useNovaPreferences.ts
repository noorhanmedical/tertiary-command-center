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
// Preference version — used to detect stale old defaults that should
// be migrated to the new larger size. Old v1 default was ~90–105px.
const PREFS_VERSION = 2;
const OLD_DEFAULT_SIZE_MAX = 110; // Any saved size ≤110 that wasn't explicitly customized → migrate.

function loadPrefs(userId: string | null): NovaUserPreferences {
  if (!userId) return DEFAULT_NOVA_PREFERENCES;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}`);
    if (!raw) return DEFAULT_NOVA_PREFERENCES;
    const parsed = JSON.parse(raw);
    const prefs: NovaUserPreferences = {
      appearance: { ...DEFAULT_NOVA_PREFERENCES.appearance, ...(parsed.appearance ?? {}) },
      position: { ...DEFAULT_NOVA_PREFERENCES.position, ...(parsed.position ?? {}) },
    };
    // Version migration: if stored size matches old system default range
    // and no explicit version marker exists, upgrade to new default.
    if (!parsed._v || parsed._v < PREFS_VERSION) {
      if (prefs.appearance.size <= OLD_DEFAULT_SIZE_MAX) {
        prefs.appearance.size = DEFAULT_NOVA_PREFERENCES.appearance.size;
        prefs.appearance.particleDensity = DEFAULT_NOVA_PREFERENCES.appearance.particleDensity;
        prefs.appearance.idleVisibility = DEFAULT_NOVA_PREFERENCES.appearance.idleVisibility;
        prefs.appearance.glowIntensity = DEFAULT_NOVA_PREFERENCES.appearance.glowIntensity;
        prefs.appearance.opacity = DEFAULT_NOVA_PREFERENCES.appearance.opacity;
      }
    }
    return prefs;
  } catch {
    return DEFAULT_NOVA_PREFERENCES;
  }
}

function savePrefs(userId: string | null, prefs: NovaUserPreferences): void {
  if (!userId) return;
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}`, JSON.stringify({ ...prefs, _v: PREFS_VERSION }));
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
    updateAppearance({ size: Math.max(120, Math.min(320, size)) });
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
