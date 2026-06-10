# Call history read-only envelope contract

**Status:** Docs-only (Batch G). No runtime route. No new code. No UI change.
**Date:** 2026-06-10.
**Scope:** Define the safe read-only envelope for prior call history exposed to Team Portal / Playground, so a future portal-scoped read endpoint (Batch I) and any future UI surface cannot accidentally leak PHI, financial data, or cross-tenant rows.
**Cross-references:**
- `engagement-call-list-canonicalization-contract.md` (Batch A).
- `team-member-assignment-terminology-contract.md` (Batch D).
- `team-portal-call-list-consumption-readiness.md` (Batch F).
- `team-portal-playground-wiring-contract.md` §21 + §22 (Bundle 11).
- `patient-directory-readonly-envelope-readiness.md` (Bundle 49).
- `pdf-protection-contract.md`, `billing-invoice-hard-stop-map.md` (Bundle 29).

This document ships zero code. It pins what the envelope MAY surface and what it MUST exclude.

---

## 1. Allowed fields from `outreach_calls`

A future read-only call-history endpoint MAY return these fields per row (and ONLY these fields). The source column is the legacy DB name; product-facing field names are the canonical product layer.

| Product field | Source | Notes |
|---|---|---|
| `id` | `outreach_calls.id` | opaque id; never leaked across tenants |
| `patientScreeningId` | `outreach_calls.patient_screening_id` | scoped to viewer's facility |
| `outcome` | `outreach_calls.outcome` | e.g. `scheduled`, `callback`, `no_answer`, `voicemail`, `wrong_number`, `declined`, `needs_records`, `insurance_prior_auth_issue`, `manager_review`, `facility_specific_issue` |
| `notes` | `outreach_calls.notes` | visibility per §3 |
| `callbackAt` | `outreach_calls.callback_at` | when present |
| `attemptNumber` | `outreach_calls.attempt_number` | |
| `durationSeconds` | `outreach_calls.duration_seconds` | |
| `startedAt` | `outreach_calls.started_at` | ISO 8601 |
| `createdAt` | `outreach_calls.created_at` | ISO 8601 |
| `teamMember.displayName` | derived from `outreach_calls.scheduler_user_id` → `users.name` | display only |
| `teamMember.roleProfile` | `users.role` mapped to PCS / ACS | display only |

That's it. No other column may be returned. A future PR that adds a field MUST update this list.

---

## 2. Forbidden fields

The envelope MUST NOT contain any of:

- **Money / billing fields** — anything from `billing_records`, `billing_documents`, `completed_billing_packages`, `invoices`, `projected_invoices`. Per Bundle 29 hard-stop map §3.
- **Raw Admin Review internals** — raw `reasoning` blob, raw evidence body, model id + prompt hash combinations.
- **Raw PHI outside the viewer's tenant + facility scope** — see §4.
- **Other Team Members' notes outside the viewer's facility scope** — §3.4.
- **Patient name + DOB at the route response level for non-clinical roles** — clinical roles get them; other roles get only `patientScreeningId` (the modal can resolve identity via the Patient Directory envelope).
- **Audit-log row ids or `patient_journey_events.*` body** — audit rows have their own surface; the call-history envelope does not embed them.
- **Cross-tenant rows** — under no circumstances.
- **Raw `scheduler_user_id` numeric** — exposed as a display name only.
- **`outreach_calls.scheduler_assignment_id`** (if present) — this is internal linkage data, not a product field.

---

## 3. Notes visibility rules

`outreach_calls.notes` is free-text logged by the Team Member who made the call. Visibility rules:

1. **The Team Member who logged the note** ALWAYS sees their own note.
2. **Other Team Members in the same facility scope** see the note display as-is.
3. **Admin / manager role** sees all notes within the tenant.
4. **Team Members outside the facility scope** see the note redacted to `<note hidden>` along with the outcome and timestamp. The row is NOT entirely hidden — the existence of the call IS visible (for continuity-of-care), but the body text is not.
5. **Cross-tenant viewers** see nothing — the row is not returned at all.

The route MAY return the note as a literal string. The renderer MUST honour the redaction rules at the route layer, not at the UI layer (defense in depth).

---

## 4. RBAC + tenant / facility scoping

- The viewer's tenant id is the OUTER bound. The endpoint NEVER returns rows from other tenants.
- The viewer's facility scope (from `/api/portal/my-facilities`) is the INNER bound. Calls for a patient outside the viewer's facility scope are NOT returned.
- A cross-tenant or out-of-scope request returns 404 (NOT 403) to avoid existence-revealing.
- The endpoint emits an audit row even for 404 returns (mirrors Bundle 54 §9).

---

## 5. PHI envelope

- Patient identifier fields surface within the scope rules above.
- Patient body / clinical notes from the broader chart are NOT in this envelope (the call note is the only narrative).
- Logs at the observability layer carry counts only — per Bundle 8 PHI-safe logger.
- The audit row uses the existing `appendJourneyEvent` writer (Bundle 12c). The audit row MAY carry `patientScreeningId` and `outcome`; it does NOT carry raw note bodies.

---

## 6. Prior call history display in Team Portal / Playground

When the Team Portal / Playground UI eventually renders prior call history (per Bundle 32 Step E + Batch F §5):

- Render as a chronological list of past calls per patient.
- Show outcome, timestamp, attempt number, duration, callback-at (when set).
- Show the Team Member display name + role profile.
- Show the note body where §3 permits; otherwise show `<note hidden>`.
- Render in the Playground canvas as a pencil-tile per call (Bundle 11 §10).
- Render in Team Portal panels using the existing clinical chrome.
- DO NOT render any money, billing, or admin-only field.
- DO NOT issue a download of the history without going through the future PDF preview/download contract (Bundle 56) — the call-history surface is render-only by default.

---

## 7. Stop conditions for any PR consuming this envelope

A future PR MUST stop and ask if:

1. It would return a column not listed in §1.
2. It would return a row outside the viewer's tenant + facility scope.
3. It would expose another Team Member's note body to a viewer outside the facility scope.
4. It would render money, billing, or admin-only fields.
5. It would skip the audit row.
6. It would emit PHI on a non-audit log.
7. It would change the existing `/api/outreach/calls` route response shape.
8. It would persist any new column on `outreach_calls` without a separately-approved migration plan.
9. It would render call history in the PDF / packet path (the existing PDF families do not include call history; Bundle 9 / 56 protect that surface).
10. It would write a parallel call-history table.

---

## 8. Non-promises

- No commitment to a specific endpoint path. The future Batch I PR may choose `/api/portal/calls?patientScreeningId=<id>` or another additive path.
- No commitment that every legacy `outreach_calls` row carries every field listed in §1 — rows ingested before a column existed leave that field empty.
- No commitment to UI layout for the call-history display.
- No commitment that the existing legacy `/api/outreach/calls` route will be removed.

End of contract.
