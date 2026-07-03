---
name: Admin Review CI evidence mirror
description: How Admin Review attach actions mirror into Clinical Intelligence evidence (attach = approval, dedupe key, reconcile-on-open)
---

# Admin Review CI evidence mirror

- Attaching a Dx/Hx/Rx chip to an ancillary IS the approval: `assignToTarget` auto-records an approved CI evidence decision with `assignedAncillary` — no separate "Approve evidence" click.
- The bubble attach flow records its own evidence (with any label edits), so the dialog's bubble `onAttach` passes `skipEvidenceRecord: true` to avoid duplicate writes.
- Evidence dedupe key is `sourceType::label.toLowerCase()` per patient (server dedupes patient+label+sourceType and merges forward). Any client-side skip logic must use the same key or badges/records diverge.
- Mirror writes are fire-and-forget (never gate the attach); a reconcile-on-open effect retries missed/legacy assignments once per patient, gated on CI store loaded + current user known (`useClinicalIntelligenceLoaded` exposes `isLoaded`).

**Why:** pre-feature assignments existed only in `patient.reasoning`; without reconcile the knowledge layer silently under-reports, and without the skip-key discipline every dialog open would bump audit timestamps or overwrite rejections.
**How to apply:** any new attach/assign surface that touches ancillary evidence must record through the same path (or explicitly opt out when another layer already records).
