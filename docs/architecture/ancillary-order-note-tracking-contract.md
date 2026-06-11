# Ancillary order / note tracking contract

**Status:** Docs-only (Batch F4 of Phase 1 run).
**Companion:** `scripts/qa-ancillary-order-note-tracking-contract.mjs`.

Defines how the ancillary track records two adjacent artifacts:

- **Order / referral notes** — the upstream physician's order document
  that authorizes the procedure.
- **Post-procedure notes** — the operator's note written after the
  procedure runs.

Both are first-class document kinds within the existing `documents`
table; this contract pins the kinds, the surfaces, and the state
transitions the ancillary read-model expects.

## Document kinds in scope

| kind | Origin | Required for billing readiness? |
|---|---|---|
| `order_note` | Referring physician's office | Yes |
| `post_procedure_note` | Procedure operator (post-op) | Yes |

Both kinds use `documents.surface=ancillary` and follow the F3 upload
storage path (`document_blobs` + `documents` row).

## State pieces tracked per kind

| State | Source field | Meaning |
|---|---|---|
| Present | `documents` row exists | Document was uploaded / generated |
| Latest version | `documents.createdAt` (most recent) | Used by readiness aggregator |
| Marked obsolete | (future) `documents.obsoletedAt` | Reserved for F6 / G — not in this batch |

## Read-model surface (F2)

`getAncillarySnapshot(...)` already emits an `AncillaryDocumentSummary`
per kind. F4 confirms that the snapshot's `documents` field MUST cover
`order_note` and `post_procedure_note` as REQUIRED_KINDS (in addition
to `report`). The current scaffold already includes all three.

## Boundaries

- Tracking is observation-only. Write-side ingress happens through the
  same F3 upload route for both kinds (kind discriminator on the
  multipart payload).
- Tracking does NOT decide billing readiness. Segment G aggregates.
- Tracking does NOT trigger signing. Signing is F5/F6.
- Tracking does NOT mutate qualification or Admin Review state.

## Feature flag

No new flag in F4 — the read-model is already behind
`USE_ANCILLARY_READ_MODEL` (F2). F4 adds documentation only.

## Related contracts

- [[phase-1-ancillary-boundary-contract]]
- [[ancillary-report-upload-contract]]
- [[phase-1-plexus-iq-boundary-contract]]
- [[phase-1-admin-review-boundary-contract]]

End of contract.
