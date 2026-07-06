---
name: Team metrics call-log split-brain
description: Engagement team metrics must union both call logs (legacy + canonical journey events) and read the canonical one uncapped
---

# Team metrics call-log split-brain

Engagement Center **team metrics** count per-member call dispositions, but the portal has **two disjoint call-write paths** that never share a table:

- Legacy path → writes the outreach-calls table, attributed by the scheduler user.
- Canonical engagement call-result path (the **default** portal write) → updates the execution case and appends a `call_result_logged` patient-journey event (attributed by the *acting* user), and deliberately does NOT write an outreach-calls row (that step is in the engagement executor's suppressed-steps list, by canonical-workflow ownership design).

**Why it bites:** the metrics read model originally read only outreach-calls, so it missed nearly every current portal call — while the engagement **baskets** read model (which reads execution cases) already reflected them. Same data, two surfaces, opposite answers = the split-brain.

**Guardrails when touching this read model:**
- Converge on the READ side — union both logs. Do NOT make the engagement endpoint also write outreach-calls; that violates the canonical-workflow ownership registry.
- Reuse the ONE shared outcome→disposition mapping. Never re-implement bucketing per surface, or the surfaces drift again.
- Read the canonical journey-event log **uncapped** for the day. The generic `listJourneyEvents` helper silently clamps to 500 rows — using it here means a >500-call day drops calls from metrics. Use a dedicated range query with no row cap (only the columns needed), since "every portal call must be counted" is the whole point.
- Attribute canonical calls by the acting user. Admin "view-as" logs as the admin actor → let those fall to an explicit *unattributed* bucket rather than mis-crediting; surfacing unattributed calls beats dropping them.
- If a rollback dual-write is ever enabled (both a legacy row AND a mirrored journey event for one call), dedup journey mirrors against the legacy primary, keyed from the legacy rows only so two genuinely distinct journey calls are never collapsed into one.
- Verify with `npx tsx script/checkTeamMetrics.ts` (locks mapping, extraction, and high-volume no-drop).
