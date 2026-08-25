# Phase 4 — Ancillary Service Registry: Decisions and Validation

**Date:** 2026-08-24
**Status:** COMPLETE — validated locally

---

## Summary

Phase 4 introduces two tables:
1. `ancillary_service_registry` — centralized service definitions with CPT codes, qualification criteria, cooldown rules, document requirements, and AI instructions
2. `facility_service_settings` — per-facility service enablement/override layer

All 11 current Plexus services are seeded into the registry.

---

## Files Created / Modified

| File | Action | Purpose |
|------|--------|---------|
| `shared/schema/ancillaryServiceRegistry.ts` | Created | Drizzle table definitions, enums, types |
| `migrations/0058_add_ancillary_service_registry.sql` | Created | DDL + seed data for 11 services |
| `server/repositories/ancillaryServiceRegistry.repo.ts` | Created | Repository layer |
| `server/routes/ancillaryServiceRegistry.ts` | Created | Route file with 7 endpoints |
| `server/routes.ts` | Modified | Import + registration |
| `shared/schema/index.ts` | Modified | Barrel export |

---

## Design Decisions

### Decision 1: `internal_code` matches existing `service_type` strings

The `internal_code` column uses the exact same strings already stored in `patient_ancillary_cases.service_type`, `case_document_readiness.service_type`, `procedure_notes.service_type`, `scheduler_assignments`, etc. This ensures zero-migration compatibility with all existing data. Examples: `"BrainWave"`, `"Bilateral Carotid Duplex"`, `"Echocardiogram TTE"`.

### Decision 2: CPT codes stored but `cpt_confirmed = false`

Per spec requirement: CPT codes must be confirmed by the coding team before being treated as billing truth. All services are seeded with the spec-provided CPT values but `cpt_confirmed` defaults to `false`. The billing/claim generation path should check this flag before using CPT codes in claim generation.

### Decision 3: BrainWave and VitalWave have no CPT code in the registry

These services use proprietary/non-standard coding that exists elsewhere in the repository's billing configuration. The registry stores `NULL` for their CPT codes. This preserves existing billing behavior without imposing a fake CPT.

### Decision 4: Facility enablement uses opt-out model

All globally active services are available at all facilities by default. `facility_service_settings` only needs rows for services that are DISABLED or have overrides at a specific facility. This means: no facility setup required for the common case, and an admin only needs to act when restricting services.

### Decision 5: Qualification criteria columns are JSONB arrays

Using JSONB arrays (not TEXT) for `qualifying_diagnoses`, `relevant_medications`, etc. allows structured queries and future AI prompt construction. Currently empty arrays — will be populated as the AI integration is updated to read from the registry instead of the hardcoded prompt in `screening.ts`.

### Decision 6: No feature flag gate

The registry is inert until consumers start reading from it. The existing `screening.ts` AI prompt still uses its hardcoded service list. The transition from hardcoded prompt → registry-driven prompt is a separate integration step within Phase 4/5 and can be gated by a flag at that point if needed.

---

## Seeded Services

| # | internal_code | CPT | Category |
|---|--------------|-----|----------|
| 1 | BrainWave | — | neurocognitive |
| 2 | VitalWave | — | autonomic |
| 3 | Bilateral Carotid Duplex | 93880 | vascular_carotid |
| 4 | Echocardiogram TTE | 93306 | cardiac |
| 5 | Renal Artery Doppler | 93975 | vascular_renal |
| 6 | Lower Extremity Arterial Doppler | 93925 | vascular_lower_arterial |
| 7 | Upper Extremity Arterial Doppler | 93930 | vascular_upper_arterial |
| 8 | Lower Extremity Venous Duplex | 93970 | vascular_lower_venous |
| 9 | Upper Extremity Venous Duplex | 93970 | vascular_upper_venous |
| 10 | Stress Echocardiogram | 93350 | stress_cardiac |
| 11 | Abdominal Aortic Aneurysm Duplex | 93978 | vascular_aortic |

---

## API Endpoints

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET | `/api/service-registry` | Authenticated | List all (optional `?activeOnly=true`) |
| GET | `/api/service-registry/code/:code` | Authenticated | Get by internal code |
| GET | `/api/service-registry/:id` | Authenticated | Get by ID |
| PATCH | `/api/service-registry/:id` | Admin | Update service configuration |
| GET | `/api/service-registry/facility/:clinicId` | Authenticated | Active services for a facility |
| GET | `/api/service-registry/facility/:clinicId/settings` | Authenticated | Facility override settings |
| PUT | `/api/service-registry/facility/:clinicId/settings` | Admin | Upsert facility service setting |

---

## Validation Results

| Test | Result |
|------|--------|
| Server starts with new routes | PASS |
| GET /api/service-registry returns 11 services | PASS |
| GET by code (BrainWave) returns correct row | PASS |
| GET facility/1 returns all 11 (no exclusions) | PASS |
| Cooldown values populated (Medicare=12, PPO=6) | PASS |
| CPT codes match spec for all vascular/cardiac services | PASS |

---

## Spec Discrepancy Resolution

**D-03 / D-07 reconciled:** The `shared/plexus.ts` `ANCILLARY_TESTS` array (11 items) and the `screening.ts` AI prompt (7 items) are now superseded by this registry as the canonical source of truth. Future work should:
1. Make the AI prompt builder read from `ancillary_service_registry` instead of hardcoded strings
2. Replace `ANCILLARY_TESTS` constant reads with a `listServices({ activeOnly: true })` call where appropriate
3. Keep `ANCILLARY_TESTS` as a derived/cached constant for type safety until all consumers are migrated

---

## Future Integration Points

1. **AI prompt builder** — `screening.ts` should read service definitions + AI instructions from the registry
2. **Cooldown enforcement** — `cooldown.repo.ts` should read cooldown rules from the registry
3. **Billing readiness** — document requirement checks should use `requires_*` flags from the registry
4. **Admin UI** — service configuration should be editable via the Admin Settings panel
5. **VALID_FACILITIES replacement** — when facility config is DB-driven, the morning rebuild should read facilities from DB rather than the hardcoded constant

---

## Next Phase

Phase 5 — Order Note Lifecycle: Extend `generated_notes` with document lifecycle columns (status, signature, versioning). Create `note_addenda` table. Implement Draft → Pending Signature → Signed state machine. Wire scheduling trigger to route existing Order Note to Clinician Portal.
