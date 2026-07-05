---
name: Workspace-prefs restore-vs-persist gating
description: How to persist last-active UI selections through useWorkspacePrefs without pre-hydration auto-selects clobbering the saved value.
---

When persisting a "last-selected X" (chat tab/thread, etc.) through the Team
Portal `useWorkspacePrefs` hook, you cannot naively wire the selection setter to
`updateWorkspacePref`.

**Why:** child tabs auto-select a first entry (roster[0]/threads[0]/task[0]) as
soon as their data loads. If that fires *before* prefs hydrate, and it persists,
`useWorkspacePrefs` records it as a *dirty key* that WINS over the server row on
the hydration merge — so the auto-selected default overwrites the user's saved
selection.

**How to apply:**
- Seed shell state from prefs ONCE, only after `workspacePrefsHydrated` (reuse a
  single `initRef` guard, same pattern as the tray-tab seed).
- Gate every persist effect behind that same `initRef.current` — pre-hydration
  auto-selects update local state but must NOT write prefs.
- After restore, tabs self-correct if the saved target no longer exists
  (`activeX != null && !list.some(...) -> onChange(list[0] ?? null)`). For the
  patient tab, only fall back when `screeningId == null` (a saved thread) so a
  pending new-conversation pick — which carries a screeningId but isn't in
  `threads` yet — is left intact.
- Server `prefsSchema` uses `z.object` which STRIPS unknown keys; any new pref
  field must be added there or it silently never persists.
