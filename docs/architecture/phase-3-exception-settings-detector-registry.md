# Phase 3 — Exception settings + detector registry (PR 3.1)

## Decision

**Reuse `admin_settings`.** No second settings table. New domain
`exception_intelligence`. Detector definitions live in code
(`detectorRegistry.ts`) — admins override thresholds via
admin_settings.

## Shared contract

`shared/contracts/exceptionIntelligence.ts`:
- `ExceptionType` — 27 canonical exception types across 5 categories.
- `DetectorDefinition` — pure metadata per detector.
- `EffectiveDetectorPolicy` — per-detector resolved policy with source.
- `EffectiveExceptionPolicy` — full bundle + global safety flags.

## Detector registry

`server/services/exceptionIntelligence/detectorRegistry.ts`:
- 27 detectors across `engagement | document | scheduling | billing | operations`.
- Each declares `defaultSeverity`, `defaultOwnerRole`,
  `thresholdSettingKey`, `defaultThresholdValue`, `thresholdUnit`,
  and a human-readable `title` + `explanationTemplate`.

## Effective policy resolver

`getEffectiveExceptionPolicy({ facilityId, testType, userId })`:
1. For each detector: read threshold + severity + owner_role via
   `getAdminSettingValue` with Phase 2 hardening precedence
   (testType → facility → user → global → default).
2. Read global safety flags `human_review_required` and
   `auto_actions_enabled`. **Phase 3 hard-forces
   `auto_actions_enabled = false`** even when a row says otherwise
   — the route layer never executes anyway.

Returns `{ detectors, humanReviewRequired, autoActionsEnabled, sources }`.

## API

- `GET /api/exception-settings/effective?facilityId=&testType=`
- `GET /api/exception-settings/settings`
- `POST /api/exception-settings/settings` (admin-only)
- `PATCH /api/exception-settings/settings/:id` (admin-only)

## Seed

`npm run seed:exception-settings` (uses
`script/seedExceptionSettings.ts`) idempotently inserts global
defaults: `human_review_required: true`, `auto_actions_enabled:
false`, plus thresholds for every detector. Honest skip without
`DATABASE_URL`.

## UI

`/admin/exception-settings` (admin-gated). Effective bundle on top
with source badges + safety-flag chips. Below: settings rows
grouped by category with inline JSON editor.

## Anti-patterns guarded by QA

- No hardcoded thresholds in detector code (use the registry).
- No `auto_actions_enabled: true` defaults in seed.
- No write surface that bypasses the admin guard.
