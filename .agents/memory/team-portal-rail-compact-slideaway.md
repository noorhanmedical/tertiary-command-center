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

# Patient-opens-center slide-away (current design — pill is FIXED)
- `centerPatientOpen = centerMode === "patient"` is the single signal (covers every
  open path AND auto-resets on dismiss — don't track a separate boolean per entry point).
- The trigger PILL never moves. The rail OUTER container is **always
  `pointer-events-none`** with `transition-[width]` only — no transform, no edge strips.
- Only the rail BODY/tile translates: resting state while `centerPatientOpen && !peek`
  is `±translate-x-[82%] opacity-50`; reveal state is `translate-x-0 opacity-100`.
  The collapse animation still uses **translate-y on the BODY** — translate-x +
  translate-y compose on the same body element fine via Tailwind's transform vars.
- Peek-back flag (`left/rightRailPeek`): set true on hover of pill OR body, and on
  pill-click (`openLeftRail/openRightRail` set peek true so the click un-dims).
- **Hover-boundary lesson:** the pill and body are separated by an 8px gap (`mt-2`).
  Put `onMouseLeave`→peek(false) **only on the BODY**, never on the pill. The pill
  only does `onMouseEnter`→peek(true). If both drop peek on leave, crossing the gap
  fires pill-leave before body-enter → flicker/jitter that fails to restore the tile.
  Once the body is revealed (translate-x-0) it sits adjacent to the pill so the gap
  crossing lands on body-enter; leaving the body to the canvas resets it.

# glass-tile on the panel
- Panel body uses `.glass-tile` + `!rounded-[24px]` (glass-tile's own 16px radius is in
  `@layer components`, so the `rounded-[*]` utility wins, but `!` makes intent explicit).
