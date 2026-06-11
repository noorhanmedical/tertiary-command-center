# Engagement UI terminology — implementation plan

**Status:** Docs-only (Batch 18 of Engagement completion run).
**Date:** 2026-06-11.
**Companion:** `scripts/qa-engagement-ui-terminology-implementation-plan.mjs`.

## 1. Target vocabulary

Per the engagement UI terminology contract (#181 Batch 22 of split-brain run):

- **Scheduler** → **Team Member** / **Patient Care Specialist (PCS)** / **Ancillary Care Specialist (ACS)** for product role labels.
- **Outreach** (as a standalone owner / module title) → **Call Attempt** / **Call List** under Engagement Center for product copy.
- **Call Result** — preferred over "Disposition" in new UI labels.
- **Next Action** — preferred over "callback time" / "follow-up time" in new UI labels.

## 2. Legacy carve-out (preserved)

Per Batch D §6 of the split-brain run, DO NOT rename:

- Database tables: `scheduler_assignments`, `outreach_schedulers`, `outreach_calls`.
- Database columns: `schedulerId`, `originalSchedulerId`.
- Route paths: `/api/scheduler-assignments`, `/api/outreach/calls`, `/api/outreach/dashboard`, `/api/scheduler-portal/*`.
- Page route path `/scheduler-portal`.
- TypeScript identifier `schedulerAssignments` in `shared/schema/outreach.ts`.

## 3. Files most likely to need wording updates (audit-only)

From a quick grep, the following UI files reference the legacy "Scheduler" / "Outreach" strings:

- `client/src/components/engagement/EngagementAssignmentBoard.tsx`
- `client/src/components/PatientCard.tsx`
- `client/src/components/HomeDashboard.tsx`
- `client/src/features/command-center/tiles/VisitOutreachKindToggle.tsx`
- `client/src/features/command-center/tiles/OutreachCommandTile.tsx`
- `client/src/features/command-center/tiles/commandTileProfiles.ts`
- `client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx`
- `client/src/components/plexus-iq/PlexusIQRecentQualificationCards.tsx`
- `client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx`
- `client/src/components/plexus-iq/PlexusIQWorkspace.tsx`

Additional surfaces (Team Portal shells, DispositionSheet, CanonicalRowActions, etc.) may also contain operator-facing strings — full audit recommended before any sweep.

## 4. Risk classification

Any UI label change is **operator-visible**. Per #181 Batch 22 §3, the operator-visible Scheduler→Team Member rename requires Ali's communicated approval and a separately-sequenced PR series that:

- Identifies every operator-visible occurrence.
- Coordinates with the support/training team.
- Stages the change behind a feature flag if possible.
- Ships rollback for each affected page.

## 5. Recommended sequence

1. **Batch 19 (next):** is NOT a sweep. Instead, ship blockers doc explaining why a sweep cannot land in this run without Ali's communicated approval + training coordination. STOP after Batch 19's blockers doc.
2. **Future Ali-approved PR series (out of scope):**
   - Sub-batch 19.A — audit each file, list every operator-visible string.
   - Sub-batch 19.B — coordinate with support/training.
   - Sub-batch 19.C — ship flag-gated string changes per surface.
   - Sub-batch 19.D — remove the flag after operator notification windows close.

## 6. What is safe to ship NOW

Nothing in this run. The vocabulary CONTRACT exists already (#181 Batch 22 of split-brain run); the IMPLEMENTATION requires Ali's communicated approval per §4 above.

## 7. Plexus IQ

Untouched. Plexus IQ wording changes (e.g. "operational queue" → "intelligence layer" if any UI string says that) are out of scope and would also require Ali's communicated approval.

## 8. Hard-stops

- No client/src file edited in this plan or its companion Batch 19.
- No label rename.
- No directory rename.
- No flag added.
- No Plexus IQ touched.

End of plan.
