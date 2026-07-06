---
name: Admin Review source-edit regeneration gate (REMOVED)
description: The AdminReviewDialog Approve/PDF blocking gate was intentionally removed; regenerate is now optional/non-blocking.
---

# Admin Review source-edit regeneration gate — REMOVED

The old behavior: editing clinical source (Hx/Dx/Rx) blocked Approve **and**
Documents/PDF until an AI re-analysis ran (`needsRegeneration = staleTargetIds.length > 0 || sourceDataSaved`).

**This gate was deliberately removed** per an explicit user request ("get rid of
blocking rules"). Current behavior in `AdminReviewDialog.tsx`:

- The "Blocking Rules" section (under-16 / missing-ICD / regeneration-required)
  was deleted from the right rail.
- Approve and the Documents trigger are **no longer disabled** by
  `needsRegeneration`. Approve label is just "Approve" (or "Admin Override
  Approve" when under 16).
- `needsRegeneration` still exists, but now only controls whether the
  **Regenerate** button is shown inside the Updates panel — regenerate is
  available but optional, never blocking.

**Why:** the user wanted a frictionless, premium Admin Review with no
hard blocks; approving against not-yet-regenerated source is now allowed by design.

**How to apply:** do NOT re-introduce a hard block on Approve/PDF tied to
source edits unless the product owner reverses this decision. Keep regenerate
as a voluntary action. The `regeneratePending()` success-only clear of
`sourceDataSaved` is still fine to preserve for the Regenerate button's own state.
