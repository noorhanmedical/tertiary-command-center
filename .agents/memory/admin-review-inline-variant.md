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
