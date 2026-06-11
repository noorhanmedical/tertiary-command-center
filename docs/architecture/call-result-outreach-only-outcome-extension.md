# Outreach-only canonical outcome extension — design

**Status:** Docs-only (Batch F of adapter-blockers run). Resolves outreach delegation blocker **B4** (TERMINAL set superset) at the decision layer.
**Date:** 2026-06-10.
**Companion:** `scripts/qa-call-result-outreach-only-outcome-extension.mjs`.

## 1. Current outreach-only outcomes

The legacy outreach route accepts a much broader outcome vocabulary than the canonical-10. From `server/routes/outreach.ts:226-227` (TERMINAL set) and the `OutreachCallOutcome` Zod enum, the outreach-only outcomes the canonical planner does NOT know are:

| Outcome | Currently terminal in outreach route? | Suggested category |
|---|---|---|
| `completed` | yes | terminal-confirmation |
| `dnc` | yes | terminal-refusal |
| `do_not_contact` | yes | terminal-refusal |
| `deceased` | yes | terminal-unreachable |
| `cancelled` | yes | terminal-confirmation |
| `wants_more_info` | no | callback-style |
| `language_barrier` | no | callback-style |
| `mailbox_full` | no | callback-style |
| `hung_up` | no | not-reached |
| `disconnected` | no | not-reached |
| `busy` | no | not-reached |
| `reached` | no | contact-confirmation |
| `refused_dnc` | (no — terminal already covered by `refused_dnc` → `declined` derived appt status) | terminal-refusal |
| `moved` | no (route maps to `declined` appt status) | terminal-unreachable |
| `not_interested` | no (route maps to `declined`) | terminal-refusal |
| `will_think_about_it` | no | callback-style |

## 2. Why these matter

Per Batch 19 B4: today the legacy outreach route handles all these outcomes locally. If the outreach delegation flag is flipped ON without canonical-set extension, the planner throws `unknown outcome` for any of them — visible 500.

The Batch C step-suppression DOES NOT solve this — suppression hides STEPS, not OUTCOMES. The planner itself rejects unknown outcomes before any step suppression takes effect.

## 3. Two design paths

### Path A — Extend the canonical fixture + planner

- Add each outreach-only outcome to `CALL_RESULT_OUTCOMES_FIXTURE` + the planner's `PLAN_BY_OUTCOME` map with a full side-effect envelope (appointmentStatus + engagementStatus + assignmentCompleted + followUpTaskRequired + triageCaseRequired + terminal + taskType + triageType).
- Update the Batch B fixture parity test + the Batch 16 outreach side-effect matrix.
- Once shipped, outreach delegation can handle the full outcome set.
- **Pro:** closes the split-brain.
- **Pro:** future surfaces (Team Portal v2) inherit canonical handling.
- **Con:** Ali must commit to side-effect envelopes for outreach-only outcomes. Some are ambiguous (e.g. should `mailbox_full` open a triage case?).
- **Con:** several outcomes never logged outside the outreach surface — the canonical planner gains knowledge it doesn't need elsewhere.

### Path B — Scope delegation to canonical-10 only

- Outreach delegation route reads the outcome and either delegates (canonical-10) or runs the legacy code path (outreach-only).
- Adapter / planner unchanged.
- **Pro:** zero canonical extension required.
- **Pro:** legacy path stays intact for legacy outcomes.
- **Con:** preserves split-brain inside the route (two code paths).
- **Con:** requires per-outcome branching in the route — easy to forget when adding new outcomes.

## 4. Side effects for each outreach-only outcome

If Path A is chosen, the proposed envelopes are:

| Outcome | appointmentStatus | engagementStatus | assignmentCompleted | followUpTaskRequired | triageCaseRequired | terminal | taskType | triageType |
|---|---|---|---|---|---|---|---|---|
| `completed` | `scheduled` | `contacted` | true | false | false | true | null | null |
| `dnc` | `declined` | `contacted` | true | false | false | true | null | null |
| `do_not_contact` | `declined` | `contacted` | true | false | false | true | null | null |
| `deceased` | `declined` | `contacted` | true | false | false | true | null | null |
| `cancelled` | `declined` | `contacted` | true | false | false | true | null | null |
| `wants_more_info` | `callback` | `needs_followup` | false | false | true | false | null | `callback_scheduled` |
| `language_barrier` | `callback` | `needs_followup` | false | false | true | false | null | `callback_scheduled` |
| `mailbox_full` | `callback` | `not_reached` | false | false | true | false | null | `voicemail` |
| `hung_up` | `no_answer` | `not_reached` | false | false | true | false | null | `no_answer` |
| `disconnected` | `no_answer` | `not_reached` | false | false | true | false | null | `no_answer` |
| `busy` | `no_answer` | `not_reached` | false | false | false | false | null | null |
| `reached` | `callback` | `contacted` | false | false | false | false | null | null |
| `refused_dnc` | `declined` | `contacted` | true | false | false | true | null | null |
| `moved` | `declined` | `contacted` | true | false | false | true | null | null |
| `not_interested` | `declined` | `contacted` | true | false | false | true | null | null |
| `will_think_about_it` | `callback` | `needs_followup` | false | false | true | false | null | `callback_scheduled` |

These rows derive from the existing `deriveAppointmentStatus` mapping in `routes/outreach.ts:37-59`, the outreach route's `TERMINAL` set, and best-judgment guesses for engagement-status + triage requirements. Every row needs Ali confirmation before being committed to the canonical fixture.

## 5. Terminal behavior for each

The "terminal" column in §4 indicates whether `scheduler_assignments.status = "completed"` fires. Outcomes flagged `terminal: true` reach the outreach route's existing `markSchedulerAssignmentCompleted` call. Outcomes flagged `terminal: false` do not.

## 6. appointmentStatus mapping for each

From the existing `deriveAppointmentStatus` function in `routes/outreach.ts`. Preserved exactly so delegation is byte-equivalent for the appointmentStatus column.

## 7. Assignment completion behavior

Per §5: terminal outcomes call `markAssignmentCompleted` (or its DI equivalent). Non-terminal do not. Identical to today.

## 8. Journey Event expectation

The outreach surface currently does NOT append journey events. Per Batch D and Batch 19 B5, this is preserved via `OUTREACH_SUPPRESSED_STEPS` in Batch C — regardless of which outcome is logged.

If Ali approves Batch D Option B (outreach appends journey events), this expectation flips for ALL outcomes uniformly — outreach-only and canonical-10 alike.

## 9. Ali decision required

1. **Pick path:** Path A (extend canonical) or Path B (scope delegation)?
2. **If Path A:** confirm the side-effect envelopes in §4 row by row. Each row is a product behavior decision; "best-judgment" defaults are starting points only.
3. **If Path B:** confirm the in-route branching pattern (`if (canonical_set.has(outcome)) delegate(); else legacy()`) — and accept that this preserves split-brain inside the route.

**Recommendation:** Path A for `completed`, `dnc`, `do_not_contact`, `deceased`, `cancelled`, `refused_dnc`, `moved`, `not_interested` (the unambiguous terminal-refusal / terminal-confirmation outcomes). Path B fallback for the ambiguous callback-style outcomes (`wants_more_info`, `language_barrier`, `mailbox_full`, `hung_up`, `disconnected`, `busy`, `reached`, `will_think_about_it`) until each gets explicit product confirmation.

## 10. Out of scope

- Implementing either path.
- Modifying `recordCallResult.ts` or `CALL_RESULT_OUTCOMES_FIXTURE`.
- Modifying the outreach route.
- Flipping any flag.
- Plexus IQ touched.

## 11. Hard-stops

- No file under `server/services/callResult/recordCallResult.ts` is modified.
- No file under `tests/fixtures/callResultCanonicalization.fixture.ts` is modified.
- No route is modified.
- No flag flipped.
- No migration.
- No UI change.
- No Plexus IQ runtime touched.

End of design doc.
