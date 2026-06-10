# Engagement → call-list bridge contract

**Status:** Docs-only (Batch E). No runtime change. No flag flip. No UI change.
**Date:** 2026-06-10.
**Scope:** Pin the contract for `server/modules/operational-queue/bridge.ts` — the engagement-board → day-of-call-list bridge — so a future runtime PR cannot silently drop safety guarantees or introduce a parallel writer.
**Cross-references:**
- `engagement-call-list-canonicalization-contract.md` (Batch A).
- `team-member-assignment-terminology-contract.md` (Batch D).
- `operational-queue-design.md` (existing).
- Bundle 46 (operational-queue read-only invariant).
- Bundle 50 (engagement cancel-many invariant).

---

## 1. What the bridge does

When the env flag `ENGAGEMENT_TO_CALL_LIST_BRIDGE` is ON, a successful engagement-board assignment ALSO writes (or finds) the corresponding `scheduler_assignments` row so that:

- The Scheduler Portal call list immediately includes the patient.
- The Team Portal call list immediately includes the patient.

…without waiting for the next morning rebuild. When the flag is OFF (default), production behavior is unchanged.

Source: `server/modules/operational-queue/bridge.ts` (header lines 1-30). Flag accessor: `server/modules/operational-queue/bridge-flag.ts`.

---

## 2. Canonical safety rules (already coded, pinned here)

The bridge already implements these rules; this contract pins them so a future PR cannot relax them:

1. **Never throws to the caller.** Errors are returned as a typed outcome variant; the parent engagement-board assignment cannot fail because of the bridge.
2. **Never creates a duplicate active `scheduler_assignments` row.** The partial unique index `uq_scheduler_assignments_active_per_patient_day` on `(patient_screening_id, as_of_date) WHERE status = 'active'` remains the source of truth; the bridge checks for an existing active row before inserting.
3. **Never modifies an existing active `scheduler_assignments` row** even if the team-member id differs. The engagement-board assignment is the SOURCE OF TRUTH for team-member assignment; the call list reflects a daily snapshot. Conflict-guard semantics from the engagement-board route are preserved by NOT touching an existing active row from the bridge.

---

## 3. Future canonical behavior requirements

These are requirements every future runtime PR adjacent to the bridge MUST satisfy:

1. **When the Engagement Center assigns a patient, the canonical future behavior MUST mirror that into the day-of call/work assignment** so PCS and ACS team members see the assignment without a morning-rebuild delay. Today, the bridge does this only when the flag is ON; a future explicitly-approved PR may flip the flag default after a staging-window observation (mirroring the `USE_OPERATIONAL_QUEUE_CALL_LIST` Bundle 18 readiness checklist pattern).
2. **The bridge is currently flag-gated.** Default OFF. No PR may flip the default in production without satisfying the §7 staging gate.
3. **Bridge failures MUST NOT be silent in the future runtime PR.** Today's bridge writes a console log on failure (line 562-567 of `engagementAssignmentBoard.ts`) but does not surface the failure to the parent response or to an audit row. A future runtime PR MUST add:
   - A PHI-safe failure log line that includes `tenantId`, the originating `executionCaseId`, and the failure reason category (network / db / dup / unknown). Counts only at INFO; full body at DEBUG only.
   - A journey-event audit row (`engagement_to_call_list_bridge_failed`) so the failure is queryable from the audit trail.
4. **Team Portal MUST NOT trust assigned work until the bridge or the canonical day-of queue is stable.** Until then, Team Portal continues to consume `/api/portal/outreach-call-list`, which derives eligibility independently and is therefore resilient to bridge failures.

---

## 4. Module boundary rules

The bridge module:

- MUST live at `server/modules/operational-queue/bridge.ts` + `bridge-flag.ts` (paths frozen).
- MUST NOT import any UI / client code (it's a server-side module).
- MUST write ONLY through the existing `scheduler_assignments` schema identifier from `@shared/schema`. No parallel writer module is introduced.
- MUST consume the `ENGAGEMENT_TO_CALL_LIST_BRIDGE` flag through `bridge-flag.ts` (no inline `process.env` reads).
- MUST NOT write to `patient_execution_cases`, `outreach_calls`, `patient_journey_events`, `patient_screenings`, `plexus_tasks`, or any other table — the only write target is `scheduler_assignments`.
- The flag accessor module `bridge-flag.ts` MUST have ZERO runtime dependencies (no DB pool import). Bundle 14's flag-purity rule applies.

---

## 5. Operational Queue stays read-only

The bridge writes to `scheduler_assignments`, BUT `server/modules/operational-queue/repo.ts` + `service.ts` themselves remain read-only (per Bundle 46). The bridge is a separate file in the same module folder; the read-only invariant only constrains `repo.ts` and `service.ts`.

The bridge is the ONLY write path inside the `operational-queue` folder. This contract pins that.

---

## 6. Stop conditions

A future PR touching the bridge or the flag MUST stop and ask if:

1. It would flip `ENGAGEMENT_TO_CALL_LIST_BRIDGE` default to ON in production.
2. It would make the bridge throw to the caller.
3. It would allow the bridge to UPDATE an existing active `scheduler_assignments` row.
4. It would allow the bridge to write to any table other than `scheduler_assignments`.
5. It would add a parallel writer for engagement → call-list mirroring.
6. It would move the bridge out of `server/modules/operational-queue/`.
7. It would make the flag accessor module depend on the DB pool.
8. It would change the partial unique index that the bridge relies on for dup-row safety.
9. It would silently swallow a bridge failure without producing the audit row described in §3.3.
10. It would couple the bridge to UI code or run it from the client.

---

## 7. Staging gate before a future default-ON flag flip

Mirrors `operational-queue-staging-runbook.md` + `portal-cutover-readiness-checklist.md`:

1. Bundle 50 cancel-many invariant green.
2. Batch C call-result source invariant green.
3. The bridge has been ON in staging for ≥ 7 consecutive UTC days.
4. Bridge failure rate < 0.1% of engagement-board assigns across the window.
5. Zero duplicate-row creation events in the partial-unique-index logs.
6. Rollback drill: flip flag OFF on staging; confirm engagement-board assigns still succeed; confirm the next morning's rebuild still produces the same call-list as before.
7. Production-flip PR cites this contract by §-number and attaches the staging report.

---

## 8. Non-promises

- No commitment that the flag will ever default to ON.
- No commitment to a specific bridge-failure audit-row shape (named in §3.3 but defined in the future PR).
- No commitment to remove or rename the bridge module.
- No UI work alongside the bridge — UI follows in a separate explicitly-approved series.

End of contract.
