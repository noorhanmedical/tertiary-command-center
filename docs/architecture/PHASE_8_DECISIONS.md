# Phase 8 — Procedure Note Generation Trigger: Decisions and Validation

**Date:** 2026-08-24
**Status:** COMPLETE — validated locally

---

## Summary

Phase 8 adds the Procedure Note generation trigger to `POST /api/case-document-readiness/complete` when `documentType = "report"`. This is the single workflow integration that connects the existing report upload event to the existing Procedure Note lifecycle — the primary BUILD gap identified in the architecture map.

---

## Files Created / Modified

| File | Action | Purpose |
|------|--------|---------|
| `server/services/procedureNoteGenerator.ts` | Created | Generates Procedure Note content from the full clinical chain |
| `server/routes/documentReadiness.ts` | Modified | Added Procedure Note generation trigger for `documentType = "report"` |

---

## Design Decisions

### Decision 1: Attachment point = same route as Screening Addendum

The spec confirmed `POST /api/case-document-readiness/complete` with `documentType = "report"` is the canonical report upload event. The Procedure Note trigger is added as an additional step after billing readiness evaluation and after the screening addendum trigger, matching the established pattern.

### Decision 2: Uses existing `procedure_notes` table with `note_type = 'post_procedure_note'`

No new table or schema. The generated Procedure Note uses the same table and lifecycle that already has:
- `signature_status` state machine
- `signed_at` / `signed_by_user_id`
- `supersedes_note_id` for versioning
- `ancillary_case_id` linkage
- `report_document_reference_id` (available for later linkage)

### Decision 3: Generated note immediately enters clinician worklist

`signature_status = 'needs_signature'` is set at creation time so the note immediately appears in the existing physician portal `SignaturesTab` worklist without any additional routing step. The existing `listSignatureItems` query picks it up automatically.

### Decision 4: Idempotent by (ancillaryCaseId, noteType, non-superseded)

If a non-superseded `post_procedure_note` already exists for the same `ancillary_case_id`, returns `{ status: "idempotent_existing" }`. This prevents duplicate notes from retries, network replays, or re-uploads.

### Decision 5: Best-effort — never blocks report completion

Same pattern as the Screening Addendum (Phase 7). If Procedure Note generation fails:
- The report upload is NOT rolled back (a valid report stays valid)
- The failure is logged and surfaced in the response
- `procedureNoteGenerationResult.status = "failed"` is returned
- The note can be generated manually or via a retry service later

### Decision 6: Content incorporates the full clinical chain

The generated Procedure Note content includes:
1. **Original Order Indication / Justification** — pulled from the signed Order Note `generated_text`
2. **Screening Addendum / Additional Clinical Justification** — all `screening_addendum` type addenda from `note_addenda`
3. **Procedure Performed** — service type, date, facility
4. **Diagnostic Report Reference** — report status, reference ID, notes

This satisfies the spec's requirement: "Procedure Note must include Order justification + Screening Addendum + relevant Screening answers + procedure details + uploaded report reference."

### Decision 7: `generatedByAi = false`

The current implementation assembles the note from existing structured data (no GPT call). This makes it deterministic, fast, and testable. When AI-enhanced generation is later needed (via `FEATURE_PROCEDURE_NOTE_GENERATOR` flag), the existing flag infrastructure in `featureFlags.ts` already supports it.

---

## Trigger Flow

```
POST /api/case-document-readiness/complete
  documentType = "report"
        ↓
  [Primary flow: upsert readiness row, journey event,
   document reference index, billing readiness evaluation]
        ↓
  [Phase 8 trigger: documentType === "report"?]
        ↓ YES
  Resolve ancillaryCaseId for (patient, service)
        ↓
  Check idempotency (existing non-superseded post_procedure_note?)
        ↓ no existing
  Gather clinical chain:
    - Active Order Note for case
    - All screening addenda for that Order Note
        ↓
  Build Procedure Note content (deterministic assembly)
        ↓
  INSERT procedure_notes row:
    note_type = "post_procedure_note"
    generation_status = "generated"
    signature_status = "needs_signature"
        ↓
  Note appears in Clinician Portal signature worklist
        ↓
  Clinician signs → billing readiness re-evaluated (existing hook)
```

---

## Validation Results

| Test | Result |
|------|--------|
| Server starts with trigger wired | PASS |
| Complete report → Procedure Note generated (id=2) | PASS |
| Note has `note_type = 'post_procedure_note'` | PASS |
| Note has `signature_status = 'needs_signature'` | PASS |
| Note has `ancillary_case_id = 1` (BrainWave) | PASS |
| Note has `generation_status = 'generated'` | PASS |
| Content includes signed Order Note text | PASS |
| Content includes Screening Addendum | PASS |
| Content includes procedure details | PASS |
| Content includes report reference | PASS |
| Repeat call → `idempotent_existing` | PASS |
| Response includes `procedureNoteGenerationResult` | PASS |

---

## Spec Rules Satisfied

| Rule | Implementation |
|------|---------------|
| Report Uploaded = Report Finalized for workflow | Trigger fires on `documentType = "report"` completion |
| Report upload triggers Procedure Note generation | Implemented as inline trigger in the same route handler |
| Procedure Note includes Order Note justification | Content section 1 pulls from `orderNote.generatedText` |
| Procedure Note includes Screening Addendum | Content section 2 pulls from `note_addenda` for parent Order Note |
| Procedure Note is generated only after report upload | Trigger ONLY fires when `documentType = "report"` |
| Do not build another Procedure Note system | Uses existing `procedure_notes` table — no new table |
| Do not build another signature system | Uses existing `signature_status` + physician portal worklist |
| Generation must be idempotent | Checks for existing non-superseded row before insert |
| Failure must not roll back valid report | Best-effort: caught, logged, surfaced — never throws |

---

## Existing Infrastructure Reused (not rebuilt)

| Component | How it's reused |
|-----------|----------------|
| `procedure_notes` table | Generated note inserted directly |
| `signature_status` state machine | Set to `needs_signature` at creation |
| Clinician signature worklist | `listSignatureItems` picks up new rows automatically |
| `signProcedureNote` / `bulkSignNotes` | Existing signing flow works unchanged |
| `returnProcedureNoteForCorrection` | Correction flow works unchanged |
| Billing readiness trigger on signature | Existing `triggerBillingReadinessForCommittedCase` fires when signed |
| `supersedes_note_id` versioning | Available if note needs correction/regeneration |
| `ancillary_case_id` linkage | Set at creation — canonical service episode link |

---

## Next Phase

Phase 9 — Billing Canonical Chain: Enable the canonical billing readiness flags (`FEATURE_CANONICAL_BILLING_READINESS`, `FEATURE_CANONICAL_BILLING_DOCUMENT`). These connect Procedure Note signature to billing document generation. The existing infrastructure is fully built and flag-gated — Phase 9 scope is flag enablement + validation (same pattern as Phases 2 and 6).
