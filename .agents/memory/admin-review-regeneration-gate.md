---
name: Admin Review source-edit regeneration gate
description: Non-obvious invariants for the AdminReviewDialog gate that blocks Approve/PDF until clinical-source edits are regenerated.
---

# Admin Review source-edit regeneration gate

In `AdminReviewDialog.tsx`, editing clinical source data (Hx/Dx/Rx) must block
Admin Approve **and** the Documents/PDF action until the AI re-analysis is
regenerated. The gate is `needsRegeneration = staleTargetIds.length > 0 ||
sourceDataSaved`. Saving source data sets `sourceDataSaved = true`.

Invariants future edits must preserve (each was a real bug caught in review):

1. **Clear the block ONLY on a fully successful regenerate.** Never call
   `setSourceDataSaved(false)` from the Edit-toggle / cancel path — re-opening
   and cancelling edit mode would otherwise unlock approval without
   regenerating. `regeneratePending()` clears it only when `failures.length === 0`;
   any partial or total failure returns early keeping the block.

**Why:** spec requires a failed regeneration to remain blocking (otherwise an
admin could approve against source data the AI never re-analyzed).

2. **Regenerate payloads must use the local mirrors `localDx/localRx/localHx`,
   not `patient.diagnoses/medications/history`.** The local mirrors are set
   synchronously on Save and resynced on `patient.id` change; the parent prop
   may not have re-propagated by the time the user clicks Regenerate, so the
   prop path can send stale source. Applies to BOTH the per-ancillary and
   per-test regenerate mutations.

3. **`recordAdminReviewUpdate()` merges into `lastWrittenReasoningRef.current`**
   (not a rebuild from `patient.reasoning`), so an audit-log write cannot
   clobber freshly written `assignedEvidence` / stale flags.

**How to apply:** when touching the source-edit toggle, the regenerate
callbacks, or the gating boolean, re-verify all three above before approving.
