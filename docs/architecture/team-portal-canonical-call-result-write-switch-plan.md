# Team Portal canonical call-result write switch plan

**Status:** Docs-only (Batch E8 of Phase 1 run).
**Companion:** `scripts/qa-team-portal-canonical-call-result-write-switch-plan.mjs`.

This is the migration plan for flipping `DispositionSheet`'s primary
write from the legacy `/api/outreach/calls` POST to the canonical
Engagement endpoint exposed by `engagementCallResultEndpoint()`. The
actual code change happens in E9 (UI runtime, will require explicit
approval). E8 pins the steps, invariants, and rollback criteria.

## Today (post-E4)

When the structured selector flag is OFF (default):

1. User picks an outcome from the legacy 19-button grid.
2. UI POSTs `/api/outreach/calls` (legacy primary write — owns the
   outreach_calls row).
3. UI then best-effort POSTs the canonical-mirror body to
   `engagementCallResultEndpoint()` (writes journey event, opens
   triage / task as needed). Failure is logged, not surfaced.

When the structured selector flag is ON, an additive panel exposes the
15 canonical outcomes and posts the canonical payload directly via
`engagementCallResultEndpoint()`. The legacy grid is untouched.

## E9 target

Flip the legacy grid to use the canonical endpoint as the PRIMARY
write, with the legacy POST kept ONLY behind a transitional
default-OFF kill-switch flag for one release cycle.

After the switch:

- Primary write: `engagementCallResultEndpoint()` (canonical Engagement
  plural endpoint).
- Legacy `/api/outreach/calls` POST: removed from the client path
  unless `VITE_USE_LEGACY_DISPOSITION_WRITE` is truthy.
- Mirror order is reversed: the canonical write is authoritative; no
  best-effort downstream mirror is needed because the canonical
  planner owns all spine writes.

## Switch-flip plan (E9)

1. Introduce `VITE_USE_LEGACY_DISPOSITION_WRITE` (default OFF).
2. In `DispositionSheet`:
   - Replace the legacy `apiRequest("POST", "/api/outreach/calls", …)`
     in `logCall.mutationFn` with the canonical payload + the
     `engagementCallResultEndpoint()` POST.
   - Behind `VITE_USE_LEGACY_DISPOSITION_WRITE`, KEEP the legacy POST
     as a one-release kill-switch fallback.
   - Remove the trailing best-effort canonical mirror — the primary
     write is now canonical.
3. Update `qa-team-portal-call-result-selector-implementation.mjs` to
   reflect the new primary write path while still asserting the legacy
   grid renders (UI shape is unchanged).
4. Update `qa-team-portal-structured-call-result-selector-contract.mjs`
   allowlist to keep DispositionSheet as the sole consumer of the
   structured flag — no change there.
5. No new endpoint constant.

## Invariants the switch MUST preserve

- The legacy outcome grid renders unchanged.
- All 19 legacy outcome values continue to map cleanly into the
  canonical payload (via `callResult` + `callDisposition`).
- `engagementCallResultEndpoint()` remains the single source of truth
  for the URL. No hardcoded `"/api/engagement/…"` strings in client
  code.
- The endpoint's response shape (byte-equivalent legacy reconstruction
  via closure-capture deps) is unchanged.
- No new server route. No migration.
- No Plexus IQ UI / runtime change.
- No Admin Review UI / runtime change.

## Rollback criteria

If any of the following holds true in staging after the E9 flip, set
`VITE_USE_LEGACY_DISPOSITION_WRITE=1` to restore the legacy primary
write and report the regression:

- Disposition POST round-trip fails for ≥0.5% of calls.
- Patient call-list refresh stops reflecting the just-logged
  disposition.
- Attempt counter pill stops incrementing.
- The canonical endpoint returns a payload shape that breaks the
  existing query-cache shape (`/api/outreach/calls/by-patients`,
  `/api/outreach/dashboard`).
- Any of the canonical spine writes (journey event, triage, task,
  assignment status) disappears.

## Out of scope for E9

- Replacing the legacy grid with the structured selector.
- Removing legacy outcome values from the canonical payload.
- Touching `/api/outreach/calls` server-side.
- Flipping the structured selector flag ON in production.
- Mission Control / billing / claims / remittance.

## Related contracts

- [[team-portal-structured-call-result-selector]]
- [[team-portal-panel-playground-protection]]
- [[phase-1-plexus-iq-boundary-contract]]
- [[phase-1-admin-review-boundary-contract]]

End of plan.
