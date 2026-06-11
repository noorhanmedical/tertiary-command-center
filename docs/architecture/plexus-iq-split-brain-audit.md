# Plexus IQ split-brain audit

**Status:** Docs-only (Batch 23 of platform split-brain run). **No Plexus IQ runtime change.**
**Date:** 2026-06-10.
**Companion:** `scripts/qa-plexus-iq-split-brain-audit.mjs`.

## 1. Audit posture

This audit examines whether Plexus IQ owns or mutates operational workflow state in a way that creates split-brain risk. **No Plexus IQ runtime behavior is modified.** If eliminating any identified risk would require runtime change, the run STOPS and reports the proposed architecture to Ali per the run's hard rules.

## 2. What Plexus IQ reads

Verified by source inspection of `server/services/plexusIq/*`:

- `storage.getPatientScreening` — reads patient identity + screening row state for reasoning regeneration.
- ICD search inputs (clinical signal text + age/sex/encounter context).
- Admin Review evidence / ancillary supplemental contexts (`adminReviewEvidenceService.ts`).
- AI client (Anthropic) for generation.

Plus indirect reads through the Admin Review route layer (`server/routes/admin.ts`) which calls these services and passes patient ids.

## 3. What Plexus IQ writes

ONLY `storage.updatePatientScreening` is called from `server/services/plexusIq/*`. The specific call sites:

- `adminReviewSupplementalRegenerateService.ts:146` — writes `{ reasoning: nextReasoning }`.
- `adminReviewRegenerateAncillaryService.ts:218` — writes the merged ancillary regeneration payload.
- `adminReviewRegenerateAllService.ts:106-ish` — writes the merged "regenerate all" payload.
- `adminReviewRegenerateTestService.ts` — writes the regenerated test payload.
- `adminReviewRemoveService.ts` — writes the remove-mutation payload.

All five callers target `patient_screenings.reasoning` (and adjacent reasoning-related fields). NONE of them write `patient_execution_cases`, `outreach_calls`, `scheduler_assignments`, `plexus_tasks`, `patient_journey_events`, or `scheduling_triage_cases` — verified by grep.

The Batch 3 source scanner enforces this as a HARD-failure invariant.

## 4. Does Plexus IQ duplicate Operational Queue?

**No.** Plexus IQ does not project or write the operational-queue surface. Operational Queue is read-only (Batch 1 audit + `qa-operational-queue-readonly-invariant.mjs`).

## 5. Does Plexus IQ duplicate Team Tasks?

**No.** Plexus IQ does not call `storage.createTask`, does not write `plexus_tasks`, and does not project a parallel task surface. ICD suggestion and AI regeneration outputs feed Admin Review reasoning, not actionable team-member work.

## 6. Does Plexus IQ duplicate Patient Directory?

**Partial.** Plexus IQ reads `patient_screenings` rows for context and writes `patient_screenings.reasoning`. The reasoning field is NOT patient identity; it is qualification reasoning derived from clinical signals. So Plexus IQ does NOT duplicate Patient Directory's identity ownership.

However, `patient_screenings` is one physical row carrying multiple logical concerns (identity, appointment status, qualification reasoning, lifecycle status). Plexus IQ is one of several writers to that row. This is the medium risk noted in the Batch 1 audit (#6 Patient Directory + #15 Admin Review): the row has multiple co-writers without a façade. The fix is the Patient Directory canonical-write façade (Bundle 5 / Bundle 20 designs) — out of scope for this run.

## 7. Does Plexus IQ duplicate Execution Case state?

**No.** Plexus IQ does NOT write `patient_execution_cases`. Plexus IQ reads it indirectly through `patient_screenings` and the engagement-board endpoints, but never mutates execution-case state.

## 8. Does Plexus IQ duplicate billing readiness?

**No.** Plexus IQ does NOT write any billing-readiness state. Billing readiness lives in its own routes/services.

## 9. Does Plexus IQ duplicate qualification decisions?

**Partial — by design.** Plexus IQ's `adminReviewRuleEngine.ts` participates in qualification reasoning generation, and `adminReviewIcdSearchService.ts` suggests ICD codes. These FEED Admin Review's approval decisions but do NOT own the final qualification decision — that lives in Admin Review (`routes/admin.ts` + Bundle 31 design). This is the intended separation: Plexus IQ generates suggestions and reasoning, Admin Review approves/commits.

The risk is that Plexus IQ's reasoning regeneration writes `patient_screenings.reasoning` directly, which is functionally a qualification-adjacent field. The canonical ownership registry (Batch 2) names Plexus IQ as the writer for reasoning regeneration explicitly — by design — but the medium risk in Batch 1 #16 (Qualification Engine) reflects that this boundary is fuzzier than it should be.

## 10. Does Plexus IQ duplicate Admin Review?

**No.** Plexus IQ does NOT write approval / commit state. Admin Review owns approval / commit (`routes/admin.ts`).

## 11. Is Plexus IQ a pure read-model / intelligence layer?

**Mostly yes.** Plexus IQ is the intelligence / aggregation / reasoning-generation layer. Its only writes are reasoning regeneration on `patient_screenings`. It is NOT pure read-only because of those writes, but it IS scoped narrowly to a single intelligence-adjacent field family.

## 12. Identified split-brain risks

| Risk | Severity | Runtime fix safe now? | Resolution |
|---|---|---|---|
| `patient_screenings.reasoning` written by Plexus IQ alongside other reasoning writers in admin.ts | low-medium | NO (audit-only this run) | Patient Directory façade (separate Ali-approved track) |
| Plexus IQ rule engine adjacency to Qualification Engine | medium | NO | Bundle 31 qualification cleanup (separate track) |
| ICD suggestion service is wholly inside Plexus IQ; ICD commit lives in Admin Review | low | NO | Already designed correctly; ICD commit hard-stop preserved in this run |

## 13. Required future fix (if any)

If at any point Plexus IQ is asked to write `patient_execution_cases`, `outreach_calls`, `scheduler_assignments`, `plexus_tasks`, `patient_journey_events`, or `scheduling_triage_cases`, the run STOPS and the proposed architecture is reported to Ali BEFORE any wiring is done. The source scanner (Batch 3) enforces this as a hard-failure invariant.

For the medium-risk reasoning co-writer concern (§9 + §12), the path forward is the Patient Directory canonical-write façade. That is a separately-sequenced PR series not in this run.

## 14. No Plexus IQ runtime change in this batch

- No `services/plexusIq/*` file is modified.
- No `routes/plexusIq*.ts` file is modified.
- No Plexus IQ flag is added or flipped.
- No Plexus IQ behavior change of any kind.
- No Plexus IQ UI surface is touched.

End of Plexus IQ split-brain audit.
