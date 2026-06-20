---
name: AdminReviewDialog inline variant
description: Rendering the admin-review surface either as a modal or an embedded panel
---

`AdminReviewDialog` accepts a `variant?: "dialog" | "inline"`. "dialog" (default) is the full-screen modal; "inline" renders the identical body/footer as an embedded panel (no overlay) for the `/plexus-iq` operating list, which keeps a Date panel + name rail visible beside the review.

**Pattern:** the component assigns its header+body+footer JSX to a single `shellChildren` fragment (all hooks still run unconditionally above the return), then the return conditionally wraps `shellChildren` in either `<Dialog><DialogContent>` or a plain `<div>` panel. `PacketQaBlockingDialog` is a sibling outside the wrapper (it's its own Dialog).

**Radix gotchas:**
- `DialogTitle` / `DialogDescription` are Radix primitives that require Dialog context — in inline mode swap them for a plain `<h2>` (and drop the sr-only description).
- `DialogHeader` is just a styled `<div>`, so it is safe to reuse in both modes.
- Dialog mode gets a built-in close button from `DialogContent`; inline mode needs an explicit close button wired to `onOpenChange(false)`.

**How to apply:** when embedding any existing shadcn/Radix Dialog inline, only the Root/Content/Title/Description/Close primitives are context-bound; the rest of the body is plain JSX and can be shared verbatim.

## 2-panel layout + toggle-label mismatch (post-restructure)
The review body is a CSS grid: dark `slate-900` banner on top, then a 2-col/2-row grid — ancillary `<main>` on the LEFT (white workspace, `admin-review-middle-column`), tabs `<aside>` on the RIGHT (dark `slate-800`, `admin-review-left-column`, 4 tabs: Source/History/ICD/Engagement), and a full-width decision/actions `<aside>` FOOTER (`admin-review-right-column`, `col-span-2 row-start-2`).

**Gotcha:** the panel toggle state names are now visually inverted from their labels — `leftPanelOpen` controls the tabs aside that now sits on the RIGHT, and `rightPanelOpen` controls the bottom FOOTER aside. The state/testid names (`admin-review-left-column`/`-right-column`, `*-left-panel-toggle`/`*-right-panel-toggle`) were intentionally kept to preserve data-testids; do not "fix" the names to match position — it would break selectors.
