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

# Independent panels + aside slide-away (current design — pill is FIXED)
- The two panels are FULLY independent: there is intentionally NO shared "active
  panel" / `centerPatientOpen` reactive slide and NO document outside-click handler
  (both removed). Each panel owns `leftRailAside`/`rightRailAside` (persisted bool,
  storage key still `…leftRailCollapsed…`/`…rightRailCollapsed…`), `…Size`, `…Peek`.
- The ONLY thing that slides BOTH aside is clicking the center Playground: the
  `button-focus-playground` pill OR an empty-canvas click (`focusPlayground`, guarded
  with `e.target===e.currentTarget` on the two center padding containers). Bringing
  one panel back never affects the other (per-panel state, no shared flag).
- Each side pill has THREE zones (no arrows): outer edge = compact/small, middle =
  toggle aside/back, inner edge = expanded/normal. Mapping preserved: Work Queue
  right=narrow/left=full, Tools left=narrow/right=full. Handlers `openLeftRail`/
  `openRightRail`(dock+size), `toggleLeftAside`/`toggleRightAside`.
- The trigger PILL never moves. The rail OUTER container is **always
  `pointer-events-none`** with `transition-[width]` only — no transform, no edge strips.
- Only the rail BODY/tile translates: resting state while `aside && !peek` is
  `±translate-x-[82%] opacity-50`; reveal state is `translate-x-0 opacity-100`. There
  is no longer an opacity-0/unmount collapse state — aside is the single hidden visual.
- Peek-back flag (`left/rightRailPeek`): set true on hover of pill OR body; opening a
  panel clears peek so it docks at full opacity.
- **Hover-boundary lesson:** the pill and body are separated by an 8px gap (`mt-2`).
  Put `onMouseLeave`→peek(false) **only on the BODY**, never on the pill. The pill
  only does `onMouseEnter`→peek(true). If both drop peek on leave, crossing the gap
  fires pill-leave before body-enter → flicker/jitter that fails to restore the tile.
  Once the body is revealed (translate-x-0) it sits adjacent to the pill so the gap
  crossing lands on body-enter; leaving the body to the canvas resets it.

# glass-tile on the panel
- Panel body uses `.glass-tile` + `!rounded-[24px]` (glass-tile's own 16px radius is in
  `@layer components`, so the `rounded-[*]` utility wins, but `!` makes intent explicit).
