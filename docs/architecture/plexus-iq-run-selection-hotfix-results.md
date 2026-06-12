# Plexus IQ run selection hotfix — results

**Status:** Review-only PR (hotfix branch).
**Companion:** `scripts/qa-phase-1-final-completion-results.mjs` (existing).

This is the review record for the
`fix/plexus-iq-compact-run-selector-selected-run-only` branch.
The PR is **open but UNMERGED** pending Ali's review.

> Replit must NOT pull this branch. Replit pulls only from `main`
> after the PR is approved and merged.

## What was wrong

The previous round shipped a giant standalone "Qualification runs"
card with embedded date dropdowns + RunComparisonSelector at the top
of the Plexus IQ workspace. Three concrete defects:

1. **Wrong layout** — the run organization sat in its own full-width
   tile above the actual facility tiles and tabs. It wasted vertical
   space and disconnected runs from their parent date card.
2. **No selected-run-only behavior** — selecting a date pulled in
   patients from every batch on that date instead of the active run.
3. **Packet popup bypassed** — clicking Plexus / Clinician Packet
   inside a clinic detail went straight to print preview with no
   checkbox confirmation step.
4. **Alphabetical / appointment-time ordering** — the helper existed
   and was unit-tested, but the visible patient list rendered raw
   API/upload order.

## What this branch ships

### Giant panel removed

- `client/src/components/plexus-iq/PlexusIQRunOrganizationPanel.tsx` is
  **deleted**.
- `PlexusIQWorkspace.tsx` no longer imports it, no longer renders it,
  and no longer carries the `runOrgBatches` projection memo. The
  string `"Qualification runs"` is gone from the workspace.

### Compact run selector under the existing date card

- New `client/src/components/plexus-iq/PlexusIQRunSelector.tsx`
  renders inside each `WorklistGroupCard` body, ABOVE the patient
  list.
- Each sibling batch shows as one compact row:
  `▸ Run N - h:mm AM/PM · X patients · Active`
- The active row is highlighted (indigo ring) and a per-row
  `Compare` chip is on the right edge.
- An explicit "All runs for this date" row appears only when more
  than one sibling exists and is labelled *explicit only — never
  default*.

### Selected run only

- Workspace state separates date from run:
  - `selectedBatchByBucket: Map<bucketKey, batchId>` — explicit pick.
  - `allRunsModeByBucket: Set<bucketKey>` — explicit toggle.
  - `resolveSelection(bucket) → { selectedBatchId, allRunsMode }` — defaults to the most recent sibling when nothing is picked.
- `siblingBucketsByGroupKey` buckets all `PlexusIQWorklistGroup`s by
  `(facility, scheduleDate)`. Sibling runs collapse into one card.
- `reduceToActive(groups)` filters the per-tab lists so only ONE
  card per bucket renders — the one tied to the currently active
  batch.
- `allRunsPatientsFor(group, mode)` aggregates the sibling patient
  sets only when the operator explicitly flips the all-runs row.

### Visible alphabetical / appointment-time order

- `WorklistGroupCard` now derives:
  ```ts
  const sourcePatients = allRunsMode ? allRunsPatients : ...mode-derived list;
  const patientsToRender = orderPatientsWithinRun(sourcePatients.map(...))
    .map((r) => sourcePatients.find((p) => p.id === r.patientId))
    .filter(Boolean);
  ```
- `QualificationPatientCardsPane` receives this ordered array.
- New `tests/unit/visibleOrdering.test.ts` proves the invariants on
  the actual helper:
  - Outreach: raw `Zimmerman, Brown, Adams, Miller` → visible
    `Adams, Brown, Miller, Zimmerman`.
  - Visit: raw `10:00, 8:30, 9:15` → visible `8:30, 9:15, 10:00`.
  - Mixed: outreach alphabetical first, then visit by appointment.

### Packet checkbox popup before generation

- `ClinicDetailPackets` now gates both packet buttons via
  `openPacketPicker(mode, scheduleDate, eligible)` which sets a
  `packetSel` state.
- The state controls a `<PdfPatientSelectDialog>` rendered at the
  bottom of the function. The dialog gives the operator Select All /
  Clear All / Cancel / Generate selected only + per-patient
  checkboxes.
- On `onGenerate`, the workspace filters
  `packetSel.patients` to the selected subset and only then calls
  `handlePacket(mode, scheduleDate, filtered)` which routes through
  the existing print-preview path.
- `PdfPatientSelectDialog` continues to sort via
  `orderPatientsWithinRun` so the order on screen matches the order
  in the PDF.

### Compact compare chip

- The full-width "Compare against prior runs" panel is gone.
- Per-run rows in the new selector have a compact `Compare` chip on
  the right (icon + label). Wired via `onCompareRun` callback for the
  workspace to drive a future compact compare popover. The reusable
  `RunComparisonSelector` module is still on disk for that surface.

## Validation snapshot

| Check | Result |
|---|---|
| `npm run check` | green |
| `npm run build` | green |
| Full QA sweep | **207 / 207 green** |
| `smoke-phase-1-end-to-end.mjs` | PASS |
| `smoke-patient-directory-duplicates.mjs` | PASS |
| `smoke-patient-directory-full-activation.mjs` | PASS |
| `smoke-phase-1-full-completion.mjs` | PASS |
| `smoke-plexus-iq-run-selection-hotfix.mjs` | **14 / 14 PASS** |

## New QA scripts (regression guards)

- `qa-plexus-iq-no-giant-run-panel.mjs` — fails if
  `PlexusIQRunOrganizationPanel.tsx` returns or if `"Qualification
  runs"` re-appears in the workspace.
- `qa-plexus-iq-compact-run-selector-under-date.mjs` — pins the
  selector module shape + workspace consumption.
- `qa-plexus-iq-selected-run-only-live.mjs` — pins
  `selectedBatchByBucket` / `allRunsModeByBucket` / `resolveSelection`
  / `reduceToActive` + asserts the source-patient picker reads
  `allRunsMode ? allRunsPatients : …`.
- `qa-plexus-iq-visible-alpha-order-live.mjs` — asserts the workspace
  builds `patientsToRender` via `orderPatientsWithinRun(...)` AND runs
  the new unit test.
- `qa-plexus-iq-packet-popup-required.mjs` — fails if the packet
  buttons regress to direct `handlePacket` calls, asserts the dialog
  shape and the filter-before-generate behavior.

## Files changed

```
client/src/components/plexus-iq/PlexusIQRunOrganizationPanel.tsx   DELETED
client/src/components/plexus-iq/PlexusIQRunSelector.tsx            ADDED
client/src/components/plexus-iq/PlexusIQWorkspace.tsx              MODIFIED (additive selector + state + ordering + packet popup)
scripts/qa-plexus-iq-no-giant-run-panel.mjs                        ADDED
scripts/qa-plexus-iq-compact-run-selector-under-date.mjs           ADDED
scripts/qa-plexus-iq-selected-run-only-live.mjs                    ADDED
scripts/qa-plexus-iq-visible-alpha-order-live.mjs                  ADDED
scripts/qa-plexus-iq-packet-popup-required.mjs                     ADDED
scripts/qa-plexus-iq-live-run-ordering-wiring.mjs                  UPDATED (hotfix expectations)
scripts/qa-plexus-iq-live-run-comparison-selector.mjs              UPDATED (hotfix expectations)
scripts/qa-phase-1-visible-duplicate-warning-wiring.mjs            UPDATED (giant panel gone)
scripts/qa-patient-directory-live-audit-trail-wiring.mjs           UPDATED (surface list)
scripts/smoke-phase-1-full-completion.mjs                          UPDATED (giant panel gone)
scripts/smoke-plexus-iq-run-selection-hotfix.mjs                   ADDED
tests/unit/visibleOrdering.test.ts                                 ADDED
docs/architecture/plexus-iq-run-selection-hotfix-results.md        ADDED (this doc)
```

## Safe to merge?

Yes — the hotfix is surgical, doesn't touch unrelated Phase 1 logic,
defaults the activation flag remains OFF, the protected
`PdfGeneration` and `PdfPacketGrouping` libraries are unchanged, and
every regression guard is wired. Use a **merge commit** (not squash)
so the hotfix history stays legible.

End of report.
