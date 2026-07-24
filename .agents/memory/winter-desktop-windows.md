---
name: Winter desktop multi-window + contained dialogs
description: How /winter-home floating windows contain app modals and host other apps
---

- Winter-home is a real multi-window desktop: `windows[]` state, drag via title-bar pointer capture, resize grip (min 480x320), no full-screen scrim; while dragging/resizing over iframes, render a transparent shield div or the iframe eats pointer events.
- Dialog containment: `DialogPortalContainerContext` (in the shared shadcn dialog) portals DialogContent into the window body and flips Radix `modal={false}`.
  - **Why:** modal dialogs set body pointer-events:none, freezing the whole desktop; portal alone isn't enough.
  - **How to apply:** the host element must create a containing block (`transform: translateZ(0)`) so `fixed` overlay/content resolve against it; non-modal Radix dialogs auto-dismiss on outside interaction, so preventDefault onInteractOutside/onPointerDownOutside/onFocusOutside when contained; and beware JSX spread order — `{...props}` after a computed prop silently reverts it (bit us twice).
- Other dock apps open as iframes `href?embed=1`; App.tsx hides TopBanner + GlobalFloatingDock when `embed` search param present (GlobalNav stays for in-window navigation).
- Dock: pin state in localStorage `winterHome.dockPinned`; minimized windows show a per-icon count badge whose own click (stopPropagation) opens the restore panel; icon click always spawns a NEW window.

- Contained-dialog sizing: dialog.tsx appends `!max-w-[calc(100%-1rem)]` when portaled into a winter window, overriding any caller `max-w-*`. To size a popup reliably in both contexts, set an explicit `w-[NNNpx]` (plus a viewport-safe max-w) instead of relying on max-w.
