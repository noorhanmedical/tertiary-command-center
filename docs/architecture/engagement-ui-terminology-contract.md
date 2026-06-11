# Engagement UI terminology contract

**Status:** Docs-only (Batch 22 of platform split-brain run).
**Date:** 2026-06-10.
**Companion:** `scripts/qa-engagement-ui-terminology-contract.mjs`.

## 1. Canonical product vocabulary

Use these terms in any new UI surface, new documentation, new contract, new TypeScript type, new component name, new file name, and new feature description:

- **Engagement Center** — the product surface.
- **Call List** — the prioritized list of patients to contact today.
- **Call Attempt** — a single phone-call attempt (the act of dialing).
- **Call Result** — the outcome of a call attempt (scheduled, callback, no-answer, declined, etc.).
- **Next Action** — the next thing to do for this patient (callback time, follow-up task, triage routing).
- **Team Member** — the operational role of a person who works call lists.
- **Patient Care Specialist (PCS)** — role profile for primary engagement Team Members.
- **Ancillary Care Specialist (ACS)** — role profile for ancillary-specific Team Members.

## 2. Avoid

In NEW UI strings, NEW documentation, NEW contract names, NEW component names, NEW file names:

- "Scheduler" as a product role / surface title (e.g. "Scheduler Portal"). The product role is **Team Member**.
- "Outreach" as a standalone module owner (e.g. "Outreach Dashboard"). Outreach is a sub-workflow inside Engagement Center.
- Legacy route names treated as product names ("scheduler-portal", "outreach-call-list" as label).
- Plexus IQ described as an operational workflow owner. Plexus IQ is the **intelligence / read-model / aggregation** layer.

## 3. Legacy carve-out

The following legacy identifiers MUST be preserved (per the team-member-assignment terminology contract, Batch D §6) — the contract here ONLY governs NEW surfaces:

- Database tables: `scheduler_assignments`, `outreach_schedulers`. NO rename without a separately-approved migration plan.
- Database columns: `schedulerId`, `originalSchedulerId`, etc. NO rename.
- Route paths: `/api/scheduler-assignments`, `/api/outreach/calls`, `/api/outreach/dashboard`, `/api/scheduler-portal/*`. NO removal in this run.
- Page route `/scheduler-portal`. NO rename in this run.

## 4. UI string review policy

When EXISTING UI strings are touched for an unrelated reason (e.g. a bug fix in a component), they SHOULD be brought into compliance with this contract opportunistically. They MUST NOT be changed for the SOLE purpose of renaming — string renames are an Ali-approved standalone PR series so operators can be notified.

## 5. Contract type / file name convention

| Concern | NEW naming |
|---|---|
| TypeScript type for the call-result row | `CallResult`, `CallResultOutcome`, `CallResultSideEffectEnvelope` |
| TypeScript type for a call attempt | `CallAttempt` |
| TypeScript type for a call-list item | `CallListItem`, `TeamPortalCallListItem` |
| TypeScript type for a team-member assignment | `WorkAssignment` or `CallListAssignment` (NOT "SchedulerAssignment") |
| Service module file name | `recordCallResult.ts`, `recordEngagementCallResult.ts`, `recordOutreachCallResult.ts` |
| Flag accessor file name | `recordCallResult*PreviewFlag.ts`, `recordCallResult*DelegateFlag.ts` |
| Doc title | "Engagement \<surface\> contract", "Call List \<concern\> readiness", "Team Portal \<surface\> contract" |

## 6. Plexus IQ wording

Wherever Plexus IQ is referenced in UI / docs / types:

- DO call it: "intelligence layer", "read-model surface", "aggregation surface", "reasoning regeneration".
- DO NOT call it: "operational queue", "workflow owner", "task owner", "approval surface", "call-list owner".

## 7. Hard-stops

- No EXISTING string is changed by this batch.
- No EXISTING component is renamed.
- No EXISTING file is renamed.
- No EXISTING route path is renamed.
- No EXISTING type is renamed.
- No EXISTING admin / Plexus IQ runtime is touched.

## 8. Out of scope

- The "Scheduler" → "Team Member" rename project (separate Ali-approved sequence per Batch D §6).
- The `components/outreach/*` directory rename.
- UI string sweeps (per §4 — opportunistic only).

End of terminology contract.
