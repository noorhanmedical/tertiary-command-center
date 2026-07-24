---
name: Radix ScrollArea display:table clipping
description: Why wide non-wrapping content inside a Radix ScrollArea gets razor-clipped instead of shrinking, and the fix.
---

Radix `ScrollArea`'s viewport wraps children in `<div style="min-width:100%; display:table">`. Table layout sizes to **max-content**, so any non-wrapping descendant (e.g. `flex-nowrap` chip rows) silently widens the whole content block past the visible panel — cards then get a straight razor-cut right edge (rounded corners and trailing buttons clipped), and no amount of `min-w-0` on the flex chain fixes it because table max-content sizing ignores it.

**Why:** hit in the Admin Review dialog — ancillary cards were clipped on the right and per-item `min-w-0`/`overflow-hidden` tweaks kept failing until the ScrollArea itself was identified.

**How to apply:** when content inside a ScrollArea gets clipped on the right, either swap to a plain `overflow-y-auto overflow-x-hidden` div, or ensure all descendants can wrap. Don't debug the flex chain first — check the viewport's table wrapper.
