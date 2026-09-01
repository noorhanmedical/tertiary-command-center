# Phase 7 — Screening Addendum: Decisions and Validation

**Date:** 2026-08-24
**Status:** COMPLETE — validated locally

---

## Summary

Phase 7 wires the screening form completion trigger to automatically create a structured addendum attached to the signed Order Note. The trigger fires inside the existing `POST /api/case-document-readiness/complete` route when `documentType = "screening_form"`. The addendum is stored in `note_addenda` (created in Phase 5) and never mutates the parent Order Note's signed content.

---

## Files Created / Modified

| File | Action | Purpose |
|------|--------|---------|
| `server/services/screeningAddendum.ts` | Created | Service: resolves Order Note, builds addendum content, creates note_addenda row |
| `server/routes/documentReadiness.ts` | Modified | Added screening addendum trigger after billing readiness evaluation |

---

## Design Decisions

### Decision 1: Trigger point = existing document readiness completion route

The spec says "attach to the existing workflow rather than introducing a disconnected mechanism." The canonical screening form completion event is `POST /api/case-document-readiness/complete` with `documentType = "screening_form"`. The addendum trigger is added as an additional step at the end of this handler, after billing readiness evaluation.

### Decision 2: Best-effort — never blocks readiness completion

If addendum creation fails (e.g., no Order Note exists yet, ancillary case resolution fails, or a DB error occurs), the primary document readiness write is already committed. The failure is logged and surfaced in the response (`screeningAddendumResult.status = "failed"`) but does NOT roll back the screening form completion. This matches the spec rule: "A valid completed screening form remains a valid completed screening form."

### Decision 3: Idempotent by (parentNoteId, sourceRecordId, addendumType)

Duplicate calls (retries, network replays) do not create duplicate addenda. The `sourceRecordId` is constructed as `cdr:{readinessRowId}` — deterministic from the triggering row. If an addendum already exists for the same parent note + source + type, returns `{ status: "idempotent_existing" }`.

### Decision 4: Graceful when no Order Note exists

If the screening form is completed before an Order Note exists (possible for non-committed patients or edge cases), the service returns `{ status: "skipped_no_order_note" }`. The addendum can be created later via a reconciliation pass or when the Order Note is eventually created. This is not an error state.

### Decision 5: Ancillary case resolution from execution case

The route resolves `ancillaryCaseId` by:
1. Checking if the `case_document_readiness` row or execution case already carries it
2. Falling back to `listAncillaryCasesForExecutionCase` and matching by `serviceType`

This bridges the legacy (execution-case-centric) and canonical (ancillary-case-centric) models during migration.

### Decision 6: Content structure is extensible

The addendum content builder handles:
- `note` — free-text screening notes
- `responses` — structured question/answer pairs
- `positiveFindings` — array of relevant positive findings
- `negativeFindings` — array of relevant negative findings

All from the `metadata` object passed in the completion request. The `structuredData` jsonb on the addendum row stores the full raw metadata for future consumption by Procedure Note generation.

---

## Trigger Flow

```
POST /api/case-document-readiness/complete
  documentType = "screening_form"
        ↓
  [Primary flow: upsert readiness row, journey event,
   billing readiness, document reference index]
        ↓
  [Phase 7 trigger: documentType === "screening_form"?]
        ↓ YES
  Resolve ancillaryCaseId for this (patient, service)
        ↓
  Find active Order Note for ancillary case
        ↓
  Check idempotency (same parent + source + type)
        ↓ not duplicate
  Build addendum content from screening metadata
        ↓
  INSERT note_addenda row
        ↓
  Return { status: "created" } in response
```

---

## Validation Results

| Test | Result |
|------|--------|
| Server starts with trigger wired | PASS |
| Complete screening form → addendum created | PASS |
| Addendum linked to correct Order Note (id=1) | PASS |
| Addendum has correct title, sourceType, addendumType | PASS |
| Repeat call → idempotent_existing | PASS |
| Content includes screening metadata (findings, notes) | PASS |
| Primary readiness completion not blocked by addendum | PASS |
| Response includes `screeningAddendumResult` | PASS |

---

## Spec Rules Satisfied

| Rule | Implementation |
|------|---------------|
| Screening answers become Order Note Addendum | Addendum created in note_addenda linked to parent Order Note |
| Do not silently rewrite signed Order Note | Parent note `generated_text` never modified |
| Screening findings available to Procedure Note | `structuredData` on addendum stores full metadata for future Procedure Note generation |
| Preserve source attribution | `sourceType = "screening_form"`, `sourceRecordId = "cdr:{id}"` |
| Idempotent | Duplicate prevention by (parentNoteId, sourceRecordId, addendumType) |

---

## Next Phase

Phase 8 — Procedure Note Generation Trigger: Add the generation trigger to `POST /api/case-document-readiness/complete` when `documentType = "report"`. Generate Procedure Note incorporating Order Note + Screening Addendum + report reference. The `procedure_notes` lifecycle, signing, and billing readiness trigger already exist — only the generation step is missing.
