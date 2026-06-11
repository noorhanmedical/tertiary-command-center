# Team Portal canonical call-result write contract

**Status:** Docs-only (Batch 20 of platform split-brain run).
**Date:** 2026-06-10.
**Companion:** `scripts/qa-team-portal-canonical-call-result-write-contract.mjs`.

## 1. Pins

- **Team Portal CONSUMES assigned work; it does NOT generate the work list.**
- **Team Portal does NOT own call-list generation.** That stays in the Engagement Center / scheduler-assignment surface.
- **Team Portal logs call results through the canonical Engagement Center call-result service** (eventually `POST /api/engagement-center/call-results` per Batch 6 contract — until that ships, Team Portal continues to use the legacy endpoints).
- **Team Portal MUST NOT write `outreach_calls` directly.** The canonical write path goes through the Engagement Center service.
- **Team Portal MUST NOT write `scheduler_assignments` directly.** Assignment lifecycle is owned by the assignment / engagement service.
- **Team Portal MUST NOT write `patient_execution_cases` directly.** Engagement-case state is owned by Engagement Center.
- **Team Portal MUST NOT append `patient_journey_events` directly.** The canonical `appendJourneyEvent` writer is the only authorized journey-event writer.

## 2. Role / capability gate

- Team Portal access is gated by session role (`requirePortalRole`) and facility scope (`allowedFacilities` + `ensureFacility`).
- The canonical write surface MUST enforce these gates server-side; the UI's gating is for UX only, not authoritative.
- Only **Team Members** with the **Patient Care Specialist (PCS)** or **Ancillary Care Specialist (ACS)** role profiles may submit call results from Team Portal.
- The legacy "scheduler" string in role storage is preserved per the team-member-assignment terminology contract (Batch D §6) — the canonical capability check translates `scheduler` → "Team Member with PCS profile" at the gate.

## 3. callbackAt rules

- When the outcome is callback-style (`callback`, `no_answer`, `voicemail`), the submitter MAY provide an explicit `callbackAt`. If absent, the canonical service computes the default fallback (per the future canonical-spec — currently 4h on the planner side; legacy engagement route uses an admin-settings 24h default).
- For terminal outcomes (`scheduled`, `declined`), `callbackAt` MUST be ignored.
- `callbackAt` MUST be a valid ISO timestamp at or in the future.

## 4. Notes rules

- Notes are optional free-text up to a reasonable limit (the existing route schemas already cap input).
- Notes MUST NOT contain PHI shaped fields (DOB, MRN, phone, SSN, address) — UI client-side validation is best-effort; server-side scrubbing is out of scope for this contract.
- Notes ARE persisted on the `outreach_calls` row + carried as journey-event metadata.

## 5. Journey Event audit expectations

- EVERY call-result submission from Team Portal MUST result in exactly ONE `patient_journey_events` row with `eventType: "call_result_logged"`.
- The journey event source field is `scheduler_portal` (legacy label preserved per Batch D §6).
- The journey event MUST carry the outcome label, an opaque actorUserId, and (where applicable) the resolved patientExecutionCaseId.
- Today this guarantee holds only via the engagement-center route — the outreach route (which Team Portal also calls) does NOT append a journey event. Until the outreach route is consolidated (gated by Batch 19 blockers), Team Portal continues its dual-write pattern documented in Batch 5.

## 6. What changes (and what stays)

| Concern | Today | Target |
|---|---|---|
| Team Portal disposition writes | DispositionSheet POSTs to outreach AND engagement-center (dual-write) | DispositionSheet POSTs to canonical Engagement Center endpoint once it ships |
| Team Portal call-list reads | `/api/portal/outreach-call-list` | unchanged in this contract |
| Team Portal call-history reads | `/api/portal/calls` (Batch I, flag-gated) | unchanged in this contract |
| Team Portal direct writes to canonical tables | zero today (QA-pinned in Batch 3 scanner as hard invariant) | zero — stays hard invariant |

## 7. Plexus IQ

Untouched. Plexus IQ is the intelligence / read-model / aggregation layer; it does not own Team Portal writes, does not gate them, does not consume them as a direct trigger. Plexus IQ reads `patient_journey_events` for reasoning regeneration — same as today.

## 8. Out of scope

- Implementing the consolidated DispositionSheet write path.
- Removing the legacy outreach-side POST.
- Migrating Team Portal UI to a renamed endpoint or directory.
- Flipping any flag default ON.
- Touching billing / qualification / PDFs / Admin Review behavior.
- Touching `outreach_schedulers` capacity math.

## 9. Hard-stops

- No Team Portal route is added or removed.
- No Team Portal UI change in this batch.
- No `portal.ts` direct write to canonical workflow tables (scanner Batch 3 pins this hard).
- No Plexus IQ runtime touched.

End of contract.
