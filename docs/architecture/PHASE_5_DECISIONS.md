# Phase 5 — Order Note Lifecycle: Decisions and Validation

**Date:** 2026-08-24
**Status:** COMPLETE — validated locally

---

## Summary

Phase 5 establishes the Order Note lifecycle (Draft → Pending Signature → Signed) and the Note Addenda model for traceable post-signature additions. The key architectural finding was that `procedure_notes` is already the canonical document lifecycle table for both Order Notes and Procedure Notes — no changes to `generated_notes` were needed.

---

## Critical Architectural Finding

**The spec's assumption that `generated_notes` needs lifecycle columns was incorrect.**

Repository inspection revealed:
- `generated_notes` is a **legacy content store** (blobs of text used for PDF generation, linked to batches)
- `procedure_notes` is the **canonical document lifecycle table** with `note_type` supporting both `"order_note"` and `"post_procedure_note"`
- `procedure_notes` already has: `signature_status`, `signed_at`, `signed_by_user_id`, `supersedes_note_id`, `superseded_at`, `ancillary_case_id`, `generation_status`, `source_data`, `effective_clinical_date`, `report_document_reference_id`

Therefore Phase 5 used `procedure_notes` directly with `note_type = 'order_note'` rather than extending `generated_notes`. This aligns with the spec's core principle: "do not create a third architecture."

---

## Files Created / Modified

| File | Action | Purpose |
|------|--------|---------|
| `shared/schema/noteAddenda.ts` | Created | Drizzle table definition for `note_addenda` |
| `migrations/0059_add_note_addenda.sql` | Created | DDL for note_addenda table + indexes |
| `server/repositories/orderNoteLifecycle.repo.ts` | Created | Repository: draft creation, routing, addenda CRUD |
| `server/routes/orderNoteLifecycle.ts` | Created | Route file with 8 endpoints |
| `server/routes.ts` | Modified | Import + registration |
| `shared/schema/index.ts` | Modified | Barrel export for noteAddenda |

---

## Design Decisions

### Decision 1: Order Notes live in `procedure_notes` table

Both Order Notes and Procedure Notes share the same lifecycle infrastructure:
- `procedure_notes` with `note_type = 'order_note'`
- Same signature workflow (the existing `physicianPortal/signatureWorkflow.ts` already handles signing via `listSignatureItems`, `signProcedureNote`, etc.)
- Same supersession model for versioning

This means: **signing an Order Note uses the exact same physician portal worklist and signing endpoints that already exist.** No new signing infrastructure was needed.

### Decision 2: Draft state = `signature_status IS NULL`

The Order Note lifecycle:
| State | signature_status | Meaning |
|-------|-----------------|---------|
| Draft | `NULL` | Created at qualification, not yet routed to clinician |
| Pending Signature | `needs_signature` | Routed to clinician after scheduling |
| Ready to Sign | `ready_to_sign` | Clinician can sign |
| Signed | `signed` | Immutable signed document |
| Returned | `returned_for_correction` | Sent back for fix |

The `route-to-clinician` endpoint transitions from NULL → `needs_signature`.

### Decision 3: Draft creation is idempotent by `ancillary_case_id`

If an active (non-superseded) Order Note already exists for the same `ancillary_case_id`, the create endpoint returns the existing row rather than creating a duplicate. This satisfies the spec rule: "Scheduling must not create a duplicate Order Note."

### Decision 4: Addenda never mutate the parent document

The `note_addenda` table stores addenda as separate records linked to the parent via `parent_note_id`. The parent's `generated_text` is never modified. This satisfies: "Do not silently rewrite a previously signed Order Note."

### Decision 5: Addenda optionally require signature

Some addenda (e.g., screening findings that materially change clinical indication) may require clinician review. The `requires_signature` flag + `signature_status` on the addendum row supports this without forcing all addenda through a signature queue.

---

## Order Note Lifecycle Flow

```
PATIENT QUALIFIES FOR SERVICE
        ↓
POST /api/order-notes/draft
        ↓
    [Draft created in procedure_notes with note_type='order_note',
     signature_status=NULL]
        ↓
ADMIN REVIEW (may update draft via existing update paths)
        ↓
PATIENT SCHEDULED
        ↓
POST /api/order-notes/:id/route-to-clinician
        ↓
    [signature_status → 'needs_signature']
    [Note appears in Clinician Portal signature worklist]
        ↓
CLINICIAN SIGNS (via existing POST /api/physician-portal/signature-items/:id/sign)
        ↓
    [signature_status → 'signed', signed_at stamped]
        ↓
SCREENING FORM COMPLETED
        ↓
POST /api/note-addenda
        ↓
    [Addendum created, linked to signed Order Note]
    [Parent note content unchanged]
```

---

## API Endpoints

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| POST | `/api/order-notes/draft` | Admin | Create Order Note Draft (idempotent by case) |
| POST | `/api/order-notes/:id/route-to-clinician` | Admin | Set signature_status to needs_signature |
| GET | `/api/order-notes/case/:ancillaryCaseId` | Authenticated | Get active Order Note for a case |
| GET | `/api/order-notes/screening/:screeningId` | Authenticated | List Order Notes for a screening |
| POST | `/api/note-addenda` | Admin/Clinician/Technician | Create addendum |
| GET | `/api/note-addenda/note/:noteId` | Authenticated | List addenda for a note |
| GET | `/api/note-addenda/:id` | Authenticated | Get single addendum |
| POST | `/api/note-addenda/:id/sign` | Admin/Clinician | Sign addendum |

---

## Validation Results

| Test | Result |
|------|--------|
| Server starts with new routes | PASS |
| POST create Order Note Draft | PASS — created=true, note_type=order_note, signature_status=null |
| POST route to clinician | PASS — signature_status=needs_signature |
| Idempotent draft creation (same case) | PASS — returns existing, created=false |
| POST create screening addendum | PASS — linked to parent note |
| GET addenda for note | PASS — returns array |
| GET order note by case | PASS — returns active note |

---

## Spec Discrepancy Update

**D-06 updated:** The architecture map stated "Order Note lifecycle = BUILD ON CURRENT, extend generated_notes." The actual implementation uses `procedure_notes` directly (which already exists with full lifecycle support). The `generated_notes` table remains untouched — it continues to serve its legacy PDF content role. This is architecturally cleaner and avoids adding lifecycle columns to a table not designed for them.

---

## Next Phase

Phase 6 — Engagement/PCS Canonical Migration + Clinician Portal Client: Shadow validate engagement board against canonical service episodes. Build the clinician-facing frontend against existing server APIs.
