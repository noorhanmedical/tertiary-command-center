# Phase 2 — Canonical Service Episodes: Decisions and Validation

**Date:** 2026-08-24
**Status:** COMPLETE — validated locally

---

## Summary

Phase 2 required zero new code. The dual-write architecture was already fully implemented in the repository, gated behind feature flags. Phase 2 scope was:

1. Enable `FEATURE_PLEXUS_IDENTITY_WRITE=true`
2. Enable `FEATURE_ANCILLARY_CASE_WRITE=true`
3. Validate identity linking on patient screening insert
4. Validate ancillary case creation on commit
5. Confirm no production behavior regression

---

## Key Decisions

### Decision 1: No new code required

The dual-write implementation already exists in:
- `server/services/plexusIdentity/screeningIntegration.ts` — identity orchestrator runs at screening insert time
- `server/repositories/executionCase.repo.ts` — `createOrUpdateExecutionCaseFromScreening` calls `syncAncillaryCasesFromScreening` inline after execution case creation
- `server/services/ancillaryCases/screeningSync.ts` — delegates to the reconciliation service
- `server/services/ancillaryCases/reconciliation.ts` — creates/reuses `patient_ancillary_cases` rows

All paths are flag-gated and production-safe when flags are OFF.

### Decision 2: Flag enablement order

The dependency chain is enforced by runtime gate functions:
1. `FEATURE_PLEXUS_IDENTITY_WRITE` must be ON first (identity links required by ancillary case reconciliation)
2. `FEATURE_ANCILLARY_CASE_WRITE` depends on identity links being present on the screening row

### Decision 3: Backfill before ancillary case write

For environments with existing patient data:
1. Enable `FEATURE_PLEXUS_IDENTITY_WRITE`
2. Run `script/backfillPlexusIdentity.ts` with `BACKFILL_PLEXUS_IDENTITY_APPLY=YES`
3. Enable `FEATURE_ANCILLARY_CASE_WRITE`
4. Run `script/backfillAncillaryCases.ts` with `BACKFILL_ANCILLARY_CASES_APPLY=YES`

Both scripts are idempotent and support dry-run by default.

### Decision 4: Admin user clinicId consideration

Admin users have `clinicId = null` in their session. The identity orchestrator requires a non-null clinicId on the screening row to link identity. Screenings created by admin users without explicit clinic scoping will not be identity-linked until the batch or screening has `clinic_id` set. This is existing intended behavior — the orchestrator returns `{ status: "skipped_no_clinic" }` and the screening is still created successfully.

---

## Validation Results

### Identity Orchestrator (Phase 2A)

| Test | Result |
|------|--------|
| Server starts with `FEATURE_PLEXUS_IDENTITY_WRITE=true` | PASS — no errors |
| Backfill script links unlinked screening | PASS — created global_plexus_patients id=1, patient_clinic_memberships id=1, linked screening |
| patient_screenings.global_plexus_patient_id populated | PASS — value=1 |
| patient_screenings.patient_clinic_membership_id populated | PASS — value=1 |

### Ancillary Case Reconciliation (Phase 2B)

| Test | Result |
|------|--------|
| Server starts with `FEATURE_ANCILLARY_CASE_WRITE=true` | PASS — no errors |
| `POST /api/patients/1/commit` succeeds | PASS — commitStatus changed to Ready |
| patient_ancillary_cases rows created | PASS — 3 rows (BrainWave, Bilateral Carotid Duplex, Echocardiogram TTE) |
| Each row has correct lifecycle_status | PASS — all `new` |
| Each row has correct qualification_status | PASS — all `qualified` |
| Each row has correct admin_review_status | PASS — all `approved` |
| Each row has episode_sequence = 1 | PASS |
| patient_execution_cases.selected_services reflects projection | PASS — all 3 services projected |

### Production Behavior Preservation

| Concern | Status |
|---------|--------|
| Existing patient_execution_cases logic unchanged when flag OFF | VERIFIED — flag guards all new writes |
| Legacy selected_services written when flag OFF | VERIFIED — code path explicitly splits on flag |
| No new columns added to any existing table | VERIFIED — all tables/columns pre-existed |
| No migration required | VERIFIED — tables already exist in DB |
| Existing routes continue to work | VERIFIED — server starts and serves requests normally |

---

## Files Modified

| File | Change |
|------|--------|
| `.env` | Added `FEATURE_PLEXUS_IDENTITY_WRITE=true` and `FEATURE_ANCILLARY_CASE_WRITE=true` |

No source code changes were made. Phase 2 is purely a flag-enablement + validation phase.

---

## Production Deployment Checklist

When deploying Phase 2 to production:

1. Verify migrations 0049 (identity) and 0050 (ancillary cases) are applied
2. Set `FEATURE_PLEXUS_IDENTITY_WRITE=true` in production environment
3. Run `script/backfillPlexusIdentity.ts` in dry-run mode first, then apply
4. Validate identity link rate (expect 100% for screenings with clinicId)
5. Set `FEATURE_ANCILLARY_CASE_WRITE=true` in production environment
6. Run `script/backfillAncillaryCases.ts` in dry-run mode first, then apply
7. Validate ancillary case creation for committed patients
8. Monitor for reconciliation failures in `ancillary_case_reconciliation_failures` table

---

## Next Phase

Phase 3 — Plexus Findings: Build the `plexus_clinical_findings` table, schema, repository, routes, and EHR UI section. Connect to AI qualification output.
