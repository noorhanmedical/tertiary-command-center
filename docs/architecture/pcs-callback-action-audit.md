# PCS Callback Action — Audit

> **Scope:** Where callback creation happens, what canonical
> tables it writes to, what loading/error/success affordances
> already exist, and where the remaining gaps are. Read-only
> inventory — no code changes here.

## Surface

`client/src/components/outreach/CanonicalLogCallDialog`
(declared inline in `CanonicalRowActions.tsx`). Opened from the
Engagement Center / scheduler portal row actions when a user logs
a call result; "callback" is one of the result options, alongside
`patient_requested_call_later`, `no_answer`, `voicemail`, and
the various reach/no-reach outcomes mapped in
`server/routes/executionCases.ts:69-93`.

## Canonical write path

`POST /api/engagement-center/call-result`

The handler in `server/routes/executionCases.ts` accepts:

```ts
{
  executionCaseId,
  patientScreeningId?,
  patientName,
  patientDob?,
  facilityId?,
  callResult,            // "callback", "patient_requested_call_later",
                         //  "no_answer", "voicemail", "reached", ...
  note?,
  nextActionAt?,         // ISO string when callResult === "callback"
}
```

The canonical effect:

1. Updates `patient_execution_cases.engagementStatus` /
   `lifecycleStatus` per the mapping at
   `server/routes/executionCases.ts:65-93`.
2. Creates a `scheduling_triage_cases` row for callback-style
   results (mainType `"callback"`, subtype mirrors the result —
   `patient_requested_call_later`, `no_answer`, `voicemail_left`,
   etc.).
3. Appends a `patient_journey_events` row (`eventType:
   "call_result_logged"`).
4. Updates `outreach_calls` (history of dispositions).
5. Writes a `patient_communications` row when applicable.

So the action is already a single canonical write that fans out
correctly. There is no "callback creation" endpoint distinct from
`call-result` — callback IS a call result.

## Loading / error / success affordances (today)

| State | Present? | Source |
| --- | --- | --- |
| Loading (`mutation.isPending`) | **Yes** | `submit.isPending` on the submit button (TanStack Query mutation) |
| Error toast | **Yes** | `onError` → toast destructive with the server error message |
| Success toast | **Yes** | `onSuccess` → "Call result logged" toast |
| Cache invalidation | **Yes** | invalidates `/api/scheduler-portal/cases`, `/api/engagement-center/cases`, `/api/patient-journey-events` |
| Dialog close on success | **Yes** | `onOpenChange(false)` in `onSuccess` |

## Validation today

- `callResult` is a select with a fixed option list
  (`CALL_RESULT_OPTIONS`) — invalid values cannot be submitted.
- `nextActionAt` is a `<datetime-local>` input — browser validates
  shape. Seeded with `defaultCallbackIso()` (a same-time-next-day
  default).
- `note` is optional and trimmed.
- Patient context (`executionCaseId`, `patientName`) is required
  by the server and provided by the caller — never user-entered.

## Validation gaps (named)

1. **No future-time guard on the client.** A user can pick a
   callback at a time in the past (today, but earlier). Server
   accepts it. Worth adding a `min={now}` on the datetime input
   plus a friendly disabled state when picked time is in the
   past.
2. **No timezone display.** The datetime input is local browser
   time; the server stores it as ISO. The dialog doesn't tell
   the user which timezone the callback will be scheduled in.
   Adding a one-line subtle hint (`new Date(nextActionAt).toLocaleString()`)
   would close the loop.
3. **Note isn't required when `callResult === "manager_review"`**
   or other escalation results — these probably should have a
   required note. Out of scope for callback-specific hardening
   but worth flagging.
4. **No journey-event audit cross-link** between the
   `scheduling_triage_cases` row and the `patient_journey_events`
   row created by the same write. They share the same
   `executionCaseId` but no `triage_case_id` is recorded on the
   journey event.

## Audit / journey gaps

- The canonical write already appends a `call_result_logged`
  journey event with the call result + nextActionAt. Coverage is
  good.
- There is no separate `logAudit` row for `audit_log` — the
  call-result mutation is not in the system-wide actor + action
  log surfaced by the audit-log page. Cross-referenced in
  `docs/architecture/audit-log-coverage.md` gap #3.

## Recommendation

The Batch-26 hardening pass should be limited to:

1. Add `min` attribute on the callback `datetime-local` input set
   to `new Date().toISOString().slice(0, 16)` so past times are
   not selectable in compliant browsers.
2. Inline timezone hint under the input
   (`Scheduling for {{local timezone}}`).
3. Optional: when the picked time evaluates to the past at submit
   time, disable the submit button with a tooltip rather than
   submitting.

Each is a single-file change in `CanonicalRowActions.tsx`. No new
endpoints. No backend changes.

## Cross-references

- `client/src/components/outreach/CanonicalRowActions.tsx` —
  dialog declaration + submit mutation.
- `client/src/components/outreach/DispositionSheet.tsx` — second
  surface that also writes via `callResult`.
- `server/routes/executionCases.ts:65-93` — call-result →
  triage mapping.
- `docs/architecture/audit-log-coverage.md` gap #3 — outreach
  call-result `audit_log` coverage gap.
- `docs/architecture/pcs-acs-portal-solidness-audit.md` — broader
  PCS/ACS audit.
