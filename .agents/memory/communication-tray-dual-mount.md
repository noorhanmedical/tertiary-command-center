---
name: CommunicationTray dual-mount + expand-to-Playground
description: How the Team Portal chat tray shares selection/focus across its docked tray and expanded Playground center view.
---

`CommunicationTray` (client/src/components/portal/tools/CommunicationTray.tsx) renders in
multiple places inside `TeamPortalShell.tsx` at once (split-panel mount, left-rail docked
mount, and an expanded center `centerMode === "chat"` mount). Its three sub-tabs
(Direct / Team / Patients) support OPTIONAL controlled selection via `useControllable`:
pass an `on*Change` handler and the parent owns the selected thread; omit it and the tab
keeps internal state (old behavior). To keep the docked tray and the expanded Playground
chat pointed at the SAME thread, all mounts must be given the same shell-lifted
selection state + setters, or the two views desync.

**Why:** more than one mount is live simultaneously; internal-only state would drift
between them.

**How to apply:** lift `directActiveUserId`, `teamActiveTaskId`, and
`patientSelection` (type `PatientTraySelection`) to the shell and pass them to every
mount. Composer auto-focus uses a `focusNonce` counter (`useComposerFocus`): it focuses
ONLY when nonce > 0, so the slid-aside tray never steals focus on page load. Bump the
nonce on chat dock-tile click and on expand. `expanded` prop only enlarges bubbles/
composer + swaps Maximize2 (docked, needs `onExpand`) for Minimize2 (expanded, needs
`onCollapse`). The generic center-render branch keys on `centerSrc`, so the `chat`
branch must come BEFORE it in the conditional chain.
