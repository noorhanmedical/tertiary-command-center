---
name: Redesign-on-a-copy preview route
description: How to build a reviewable visual-redesign preview without touching the live page.
---

# Redesign-on-a-copy preview route

When asked for a "review copy" / visual-only redesign that must leave the live
page byte-for-byte unchanged, build a parallel route instead of branching the
original.

**Pattern that worked (home → /home-preview):**
- `cp` the page file (e.g. `home.tsx` → `home-preview.tsx`), rename only the
  default export, and swap the ONE container component import + its JSX usage
  (`HomeDashboard` → `HomeDashboardPreview`). Everything else (hooks, queries,
  tab state, modals, navigation) stays identical, so behavior matches for free.
- Copy each redesigned child component to a `*Preview.tsx` sibling; restyle
  className/markup only, keep all hrefs, `data-testid`s, props, and data wiring.
  Routes are mutually exclusive so testids can stay identical (no suffixing).
- Add scoped CSS classes in a NEW block inside `client/src/index.css`'s
  `@layer components` — never edit existing shared classes like `.glass-tile`.
- Register the new route in `client/src/App.tsx` mirroring the original's
  `<SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>` wrapper. Note
  App.tsx has TWO route groups — add to the relevant one.

**Why:** swapping one import on a copied page guarantees faithful data/nav
parity with near-zero risk to the live page, and verification reduces to
`tsc --noEmit` + `git diff --stat HEAD -- <originals>` (empty == untouched).

**How to apply:** reuse for any future "preview/prototype of an existing page"
task. The app is auth-gated, so live screenshots stop at the login page — rely
on tsc + git diff for verification when you lack credentials.
