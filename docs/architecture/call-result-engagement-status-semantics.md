# engagementStatus semantics — decision doc

**Status:** Docs-only (Batch E of adapter-blockers run). Resolves engagement delegation blocker **B1** at the decision layer (does not implement either option).
**Date:** 2026-06-10.
**Companion:** `scripts/qa-call-result-engagement-status-semantics.mjs`.

## 1. Why this decision matters

The legacy engagement-center route (`server/routes/executionCases.ts:369-371`) writes `engagementStatus = "in_progress"` for ALL non-terminal results. The canonical planner (`server/services/callResult/recordCallResult.ts`) writes per-outcome transitions:

| Outcome | Legacy route | Canonical planner |
|---|---|---|
| `scheduled` | (no change unless current was terminal) | `contacted` |
| `callback` | `in_progress` | `needs_followup` |
| `no_answer` | `in_progress` | `not_reached` |
| `voicemail` | `in_progress` | `not_reached` |
| `wrong_number` | `in_progress` | `needs_followup` |
| `declined` | (no change unless current was terminal) | `contacted` |
| `needs_records` | `in_progress` | `in_progress` |
| `insurance_prior_auth_issue` | `in_progress` | `in_progress` |
| `manager_review` | `in_progress` | `needs_followup` |
| `facility_specific_issue` | `in_progress` | `in_progress` |

Delegating without resolving this difference would CHANGE engagement-case state on most outcomes. Visible behavior change. Engagement Center board would re-bucket patients. This is Batch 12 blocker B1.

## 2. Current behavior

- The legacy route writes a single coarse `"in_progress"` value for non-terminal outcomes.
- The engagement-case `engagementStatus` field is consumed by board bucketing logic (`listEngagementCenterCases`) and by Operational Queue projection.
- Operators currently see most active patients in "in_progress" regardless of why the last call attempt didn't terminate.

## 3. Proposed canonical behavior

- Per-outcome transitions per the planner's `PLAN_BY_OUTCOME` mapping.
- Engagement Center board would bucket patients more granularly:
  - `contacted` — reached but no immediate follow-up needed (after a scheduled or declined).
  - `needs_followup` — explicit follow-up commitment (callback, manager_review, wrong_number).
  - `not_reached` — did not contact the patient (no_answer, voicemail).
  - `in_progress` — actively being worked (needs_records, insurance, facility-specific).

## 4. UI impact

### Option 1 (preserve legacy)
- No UI change.
- Board buckets, filters, badges look exactly as today.
- Operators see no difference.

### Option 2 (adopt canonical)
- Engagement Center board bucket counts will shift.
- Filter dropdowns referencing engagementStatus values may need new option labels.
- "Status" column on patient cards may surface new values.
- Team Portal call-list view bucketing may shift.
- Operators MUST be notified of the new vocabulary BEFORE deployment.
- Reports / dashboards / Plexus IQ read models that aggregate by engagementStatus may need re-keying.

## 5. API impact

### Option 1 (preserve legacy)
- Engagement-center endpoints continue to surface `engagementStatus: "in_progress" | ...` with the legacy distribution.
- No response shape change.
- No new enum values.

### Option 2 (adopt canonical)
- Engagement-center endpoints' `engagementStatus` field starts surfacing `"contacted"`, `"needs_followup"`, `"not_reached"` more frequently.
- API consumers (Team Portal, Operational Queue, internal reports) that filter by `engagementStatus = "in_progress"` will see fewer matches — they should be updated to include the new values OR keep the old filter and accept narrower coverage.
- TypeScript types referencing the engagementStatus enum may need to assert the new values are supported.

## 6. Migration / no-migration path

### Option 1 (preserve legacy)
- **Adapter-level fix:** modify the planner's `PLAN_BY_OUTCOME` to collapse all non-terminal transitions to `"in_progress"`. Then the canonical adapter writes the legacy value, and delegation is byte-equivalent.
- **Trade-off:** the canonical service surface no longer carries the richer per-outcome semantics. Future granularity work has to re-introduce them.
- **Migration:** none. Existing data is already coarse.

### Option 2 (adopt canonical)
- **Adapter-level fix:** keep `PLAN_BY_OUTCOME` as-is. The canonical adapter writes the per-outcome values once the engagement delegation flag flips ON.
- **Trade-off:** behavior change visible to operators on flag flip.
- **Migration:** none required for existing rows (the change applies to NEW writes only). Historical rows stay at whatever value they were written with. Reports keyed on engagementStatus may need a back-fill if granular historical accuracy is desired.

### Option 3 (hybrid — Ali-preferred middle ground)
- Add a configuration flag at the planner level: `ENGAGEMENT_STATUS_SEMANTICS = "coarse" | "canonical"`. Default `"coarse"` until Ali sign-off, then flip per-environment.
- **Trade-off:** more knobs. But also lowest-risk path: staging proves canonical, then production flips.
- **Migration:** none.

## 7. Rollback strategy

### Option 1 — no rollback risk
- Delegation flag flip is reversible; the value written stays `"in_progress"`.

### Option 2 — rollback by flipping the delegation flag OFF
- Reverts to legacy route's coarse `"in_progress"`. New rows after rollback are coarse again.
- Existing rows written with canonical values during the ON period stay; they're valid engagement-status values per the schema.

### Option 3 — rollback by flipping `ENGAGEMENT_STATUS_SEMANTICS = "coarse"`
- Cleanest. Switches the planner mapping back without touching the delegation flag.

## 8. Ali decision required

**Which option should be the adapter-level fix for Batch 12 B1?**

- **Option 1** (preserve legacy) — lowest risk, abandons per-outcome semantics.
- **Option 2** (adopt canonical) — best long-term, requires operator notification + reporting updates.
- **Option 3** (hybrid) — safest staged rollout, adds a configuration knob.

**Recommendation:** Option 3. It lets us:
- Land delegation behind the delegate flag with `ENGAGEMENT_STATUS_SEMANTICS = "coarse"` (zero behavior change).
- Then in a separate staged PR, flip to `"canonical"` after operator comms + reporting updates.
- Roll back to `"coarse"` at any point without flipping the delegate flag.

## 9. Out of scope

- Implementing any of the three options. This batch is decision-only.
- Modifying `recordCallResult.ts` or `PLAN_BY_OUTCOME`.
- Modifying the engagement-center route.
- Flipping any flag.
- Plexus IQ touched.

## 10. Hard-stops

- No file under `server/services/callResult/recordCallResult.ts` is modified.
- No route is modified.
- No flag flipped.
- No migration.
- No UI change.
- No Plexus IQ runtime touched.

End of decision doc.
