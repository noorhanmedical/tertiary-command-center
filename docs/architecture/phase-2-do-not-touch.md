# Phase 2 — Do Not Touch

These surfaces are explicitly off-limits during Phase 2 work. Each is
either out of phase, claimed by another branch, or governed by a
boundary contract that Phase 2 cannot weaken.

## Off-limits surfaces

| Surface | Reason | When it changes |
|---|---|---|
| PR #278 — premium UI redesign | Open PR, not yet merged. Phase 2 must NOT rebase or touch. | After Phase 2 lands and is validated against Replit. |
| Mission Control product surface | Phase 7. | Phase 7. |
| Standalone Scheduler Portal product | PCS + ACS share the call list; no separate product. | Never. |
| RingCentral live call code paths | Dormant until `USE_RINGCENTRAL_ADAPTER=1`. | Phase 6 integrations. |
| Phase 3 AI surfaces | Out of phase. | Phase 3. |
| Phase 4 billing dashboards | Out of phase. | Phase 4. |
| Phase 5 AWS production wiring | Out of phase. | Phase 5. |
| Phase 8 enterprise scale controls | Out of phase. | Phase 8. |

## Layout boundary contract (inherited from Phase 1 → PR A / B / C)

- PCS workspace and ACS workspace render through the same
  `TeamPortalShell` and the same `ClinicWorkflowPortal`. Only
  `DEFAULT_MODE` differs per role.
- Both PCS and ACS expose all 3 workspace modes — Call List, Clinic
  Schedule, Ancillary Schedule — uniformly. Neither portal may hide
  any mode.
- The left rail is general tools only. Patient Directory facts,
  patient timeline, profile drawer, audit history must NEVER mount
  into the left rail.
- The right rail is the assigned work queue / call list / schedule.
  Left-rail tools must NEVER bleed into the right rail.
- The center canvas is the patient playground / active tool. Patient
  Directory facts (DNC / cooldown / prior tests / engagement
  history) live here when a patient row is clicked.
- The global calendar must NOT mutate the Team Portal right queues.
- "Completed" must mean actually completed. No fake completion.

## Patterns to watch for in code review

- A new top-level route that says "Scheduler Portal" or "Mission
  Control" in the page title or path.
- A new `ClinicWorkflowPortal`-bypassing mount for PCS or ACS.
- A new left-rail tool that takes patient identifiers as props
  (those belong in the center canvas).
- A new schedule-event writer that bypasses
  `/api/global-schedule-events/schedule-ancillary`.
- A new "callbackHours = 4" or "lvmHours = 4" constant where an
  admin setting should drive the value.
- A `toast({ title: "Done" })` that fires before the canonical
  writer has actually persisted the change.

QA scripts under `scripts/qa-phase-2-*.mjs` actively guard each of
these.
