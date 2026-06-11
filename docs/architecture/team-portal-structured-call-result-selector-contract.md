# Team Portal structured call-result selector contract

**Status:** Docs-only (Batch E3 of Phase 1 run).
**Companion:** `scripts/qa-team-portal-structured-call-result-selector-contract.mjs`.

The "structured call-result selector" is the UI control inside the
existing DispositionSheet that lets a Team Portal user pick one of the
15 canonical outcomes (no free text, no off-canon outcomes) and submit
a structured payload to the canonical Engagement endpoint.

E3 is docs+QA only. The selector is NOT yet rendered. The UI runtime
change happens in E4 (which is likely the first UI approval STOP).

## Canonical outcome set (15)

Pinned by `tests/fixtures/callResultCanonicalization.fixture.ts` /
`CALL_RESULT_OUTCOMES_FIXTURE`.

10 canonical outcomes:
- `scheduled`
- `callback`
- `no_answer`
- `voicemail`
- `wrong_number`
- `declined`
- `needs_records`
- `insurance_prior_auth_issue`
- `manager_review`
- `facility_specific_issue`

5 outreach-terminal outcomes:
- `completed`
- `dnc`
- `do_not_contact`
- `deceased`
- `cancelled`

The selector MUST present exactly these 15 — nothing more, nothing less.
"Other" / free-text outcomes are NOT allowed in Phase 1.

## Payload shape

The selector posts to the canonical endpoint
(see [[team-portal-canonical-call-result-write-switch-plan]] when E8 lands)
with this shape:

```jsonc
{
  "outcome": "scheduled" | "callback" | ... ,    // one of the 15
  "notes": "string|null",                         // free text annotation
  "callbackAt": "string|null",                    // RFC 3339, required when outcome=callback
  "desiredAppointmentStatus": "string|null",      // set when outcome=scheduled
  "schedulerUserId": "string|null",               // set when outcome=scheduled
  "callMetadata": {
    "source": "team-portal",
    "ringCentralCallId": "string|null"
  },
  "terminalCompletionReason": "string|null"       // set for outreach terminals
}
```

The selector MUST NOT invent new fields. Adapter argument extensions
already shipped (`CreateOutreachCallArgs`, `MarkAssignmentCompletedArgs`,
`RecordCallResultExecutionOptions`) cover all 15 outcomes.

## Posting target

The selector POSTs to whichever URL `engagementCallResultEndpoint()`
returns. The plural canonical endpoint is preferred when the VITE flag is
ON; the singular legacy endpoint is the OFF fallback. This indirection
already exists in `client/src/lib/engagementCanonicalCallResultsUiFlag.ts`
and is used by `DispositionSheet.tsx` and `CanonicalRowActions.tsx`.

The selector MUST NOT introduce a NEW endpoint constant or hardcode a
new URL.

## Validation rules (UI-side)

| Rule | Reason |
|---|---|
| `outcome` required | canonical set is closed |
| `callbackAt` required when `outcome=callback` | planner mandates schedule slot |
| `desiredAppointmentStatus` required when `outcome=scheduled` | downstream appointment creation |
| `terminalCompletionReason` required when outcome is an outreach terminal | per `MarkAssignmentCompletedArgs` |
| `notes` optional everywhere | annotation only |

Server still re-validates — UI-side rules are UX guards, not security.

## Feature flag

| Flag | Default | Purpose |
|---|---|---|
| `VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR` | OFF | Renders the new selector inside DispositionSheet |

E3 is docs+QA only; the flag must remain dormant (no code reference)
until E4 lands.

## NOT allowed in Phase 1

- No new outcome value (canon set is closed).
- No new endpoint or endpoint constant.
- No replacement of DispositionSheet.
- No removal of existing outcome buttons until the flag is flipped ON by
  Ali and validated end-to-end.
- No Plexus IQ UI / Admin Review UI changes.

## Related contracts

- [[team-portal-panel-playground-protection]]
- [[team-portal-patient-directory-wiring]]

End of contract.
