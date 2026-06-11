# Team Portal panel / playground protection contract

**Status:** Docs-only (Batch E1 of Phase 1 run).
**Companion:** `scripts/qa-team-portal-panel-playground-protection.mjs`.

Pins the Team Portal surfaces that MUST NOT be removed, renamed, restructured, or replaced in Phase 1. The QA enforces presence on disk; any future PR that deletes one of these files trips the check.

## Protected surfaces

| Surface | Path |
|---|---|
| Team Portal shell | `client/src/components/portal/TeamPortalShell.tsx` |
| Portal shell (older) | `client/src/components/portal/PortalShell.tsx` |
| Patient Command Canvas | `client/src/components/portal/PatientCommandCanvas.tsx` |
| Schedule Patient Playground | `client/src/components/portal/SchedulePatientPlayground.tsx` |
| Call List Panel | `client/src/components/outreach/CallListPanel.tsx` |
| Disposition Sheet | `client/src/components/outreach/DispositionSheet.tsx` |
| Canonical Row Actions | `client/src/components/outreach/CanonicalRowActions.tsx` |

## Allowed Phase 1 modifications

- Add buttons / sections inside an existing panel.
- Add a structured call-result selector inside the existing disposition surface.
- Add RingCentral click-to-call button inside the existing call-list panel (feature-flagged).
- Add patient call-list actions (with feature flag).
- Add a call history panel/section to an existing patient surface.
- Add callback / task / triage chips to existing panels.
- Add Patient Directory detail rendering inside the existing patient card.
- Add ancillary / document / billing blocker chips to existing panels.
- Wire existing actions to canonical Engagement endpoints behind default-OFF flags.
- Add QA / source checks protecting the layout.

## NOT allowed in Phase 1

- Remove any protected file.
- Replace the rendered panel tree.
- Redesign the layout (column order, panel placement, shell structure).
- Rename / move large component trees.
- Break current panel navigation.
- Break current patient call-list visibility.
- Change Plexus IQ UI in `client/src/components/plexus-iq/*`.
- Change Admin Review UI in `client/src/components/qualification/AdminReviewDialog.tsx`.

## Phase 1 rule

The Team Portal is the execution cockpit. It evolves by ADDITION, not REPLACEMENT, in Phase 1.

End of contract.
