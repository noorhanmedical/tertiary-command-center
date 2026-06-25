---
name: Team Portal rail size pill
description: How the left/right rail "Tools"/"Work Queue" pills resize their panels in TeamPortalShell.
---

# Team Portal rail size pill (two sizes, no arrows, click-away closes)

The rail trigger pills are NOT discrete buttons and have NO arrows/chevrons. Each
pill is ONE click region split into two invisible halves that select between
exactly two sizes (`small` | `normal`). The split is SPATIAL toward the screen
edge:
- **Left rail:** clicking the LEFT half (outer edge) opens `small`, the RIGHT
  half opens `normal`.
- **Right rail:** clicking the RIGHT half (outer edge) opens `small`, the LEFT
  half opens `normal`.

Opening always un-collapses. **Clicking anywhere outside an open rail collapses
it** (a document `pointerdown` listener; ignores clicks inside
`[role="dialog"], [data-radix-popper-content-wrapper]` so popups/dialogs don't
collapse the rail).

**Why:** the user rejected the earlier 3-size ladder with chevron hints and asked
for only two sizes, no arrows, half-of-pill-selects-size, and click-away-to-close.

**How to apply:**
- `RailSize = "small" | "normal"`; `RAIL_SIZES`; `LEFT_RAIL_WIDTH` {small ~84px,
  normal ~320px}, `RIGHT_RAIL_WIDTH` {small ~220px, normal ~340px}. The old
  `RailLevel`/`RAIL_LEVELS`/`railLevelOf`/`stepRailLevel` ladder is GONE.
- Handlers are `openLeftRail(size)`/`openRightRail(size)` = `setCollapsed(false)`
  + `setSize(size)`. Click-away uses `leftRailRef`/`rightRailRef` on the
  `portal-left-rail`/`portal-right-rail` divs + a `pointerdown` useEffect.
- The two halves are transparent `absolute inset-y-0 w-1/2` buttons. testids kept
  stable: `button-narrow-*-rail` (small) and `button-widen-*-rail` (normal).
- The left rail "small" size is a compact ICON rail: tools render single-column
  with `LeftRailToolsButton compact` (label hidden), compact calendar hidden;
  gate is `leftNarrow = leftRailSize === "small"`.
- Cards inside the rails use a "sticker glass" look: `bg-white/45 backdrop-blur-md
  border-white/40` translucent over the frosted rail body.
