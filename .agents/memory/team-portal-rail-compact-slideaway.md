---
name: Team Portal rail compact mode + patient slide-away
description: How the TeamPortalShell right/left rails do thin-mode and the patient-canvas slide-away without transform conflicts.
---

# Compact ("thin") right-rail mode
- `rightRailSize === "small"` (220px) renders **dedicated compact row components**
  (`CompactCallRow`/`CompactClinicRow`/`CompactAncillaryRow` in
  `client/src/components/portal/CompactCallRow.tsx`), via an early `return` inside
  each mode's `.map`. It is NOT the normal card squeezed with CSS — narrowing the
  full cards produced unreadable/overflowing rows.
- **Why:** the full cards carry multi-button action clusters that don't fit ~200px
  usable width; a separate branch keeps each mode legible.

# Patient-opens-center slide-away
- `centerPatientOpen = centerMode === "patient"` is the single signal (covers every
  open path AND auto-resets on dismiss — don't track a separate boolean per entry point).
- Slide-away animates **translate-x on the rail OUTER container**; the existing
  collapse animation already uses **translate-y on the BODY panel**.
- **Why:** putting both transforms on the same element fights (last `transform` wins).
  Keep them on different elements (outer vs body) so collapse + slide-away compose.
- Peek-back: 8px screen-edge strips (`pointer-events-auto`, z-30) set a peek flag on
  hover; while `centerPatientOpen` the rail outer flips to `pointer-events-auto` so its
  own `onMouseLeave` fires at the column boundary. When off-screen it's translated
  `±140%` so it isn't hit-tested over the center canvas.

# glass-tile on the panel
- Panel body uses `.glass-tile` + `!rounded-[24px]` (glass-tile's own 16px radius is in
  `@layer components`, so the `rounded-[*]` utility wins, but `!` makes intent explicit).
