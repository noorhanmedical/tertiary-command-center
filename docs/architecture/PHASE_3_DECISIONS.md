# Phase 3 — Plexus Clinical Findings: Decisions and Validation

**Date:** 2026-08-24
**Status:** COMPLETE — validated locally

---

## Summary

Phase 3 introduces the `plexus_clinical_findings` table — a structured, provenance-tracked store for AI-found and human-confirmed clinical findings that exist independently of the EMR problem list. This is a full BUILD (nothing similar existed).

---

## Files Created / Modified

| File | Action | Purpose |
|------|--------|---------|
| `shared/schema/plexusClinicalFindings.ts` | Created | Drizzle table definition, enums, insert schema, types |
| `migrations/0057_add_plexus_clinical_findings.sql` | Created | DDL for table + 9 indexes |
| `server/repositories/plexusClinicalFindings.repo.ts` | Created | Repository layer (CRUD + review + bulk) |
| `server/routes/plexusClinicalFindings.ts` | Created | Route file with 8 endpoints |
| `server/routes.ts` | Modified | Import + registration of new route |
| `shared/schema/index.ts` | Modified | Barrel export |

---

## Design Decisions

### Decision 1: No feature flag gate at schema/route level

The `plexus_clinical_findings` table is not gated behind a feature flag. Rationale:
- It is a new, independent table with no downstream consumers yet
- No existing production behavior is affected by its existence
- The table is additive and inert until Plexus IQ starts writing findings into it
- A future `FEATURE_PLEXUS_FINDINGS` flag can be added at the route level if staged rollout is needed

### Decision 2: Use `text` columns for enums instead of Postgres enum types

Follows existing repository convention (all other Plexus tables use `text` columns with TypeScript-side enum arrays). This allows adding new finding types, source types, and review statuses without DDL migrations.

### Decision 3: `globalPlexusPatientId` as the primary patient linkage

The canonical patient identity link is the foreign key to `global_plexus_patients`. Findings also carry `patientScreeningId` for provenance (which specific screening run surfaced this finding) but the patient relationship is via the canonical identity system.

### Decision 4: Separate `suggestedIcd10` vs `confirmedIcd10`

Per spec requirement: AI-found does not automatically mean clinician-confirmed. `suggestedIcd10` is what the AI proposed. `confirmedIcd10` is what a human reviewer confirms. These may differ (reviewer may correct the code) or `confirmedIcd10` may remain null (finding not yet reviewed).

### Decision 5: Review endpoint accessible to admin + clinician roles

The `/api/plexus-findings/:id/review` endpoint allows both `admin` and `clinician` roles to confirm/reject findings. Write operations (create, update, delete, bulk) are admin-only. Read operations are available to all authenticated users.

### Decision 6: `sourceRecordId` is a text field, not an integer FK

Source records may come from different tables (encounters, medications, labs, screenings, etc.) or from external systems (future EMR integration). A polymorphic text identifier is more flexible than a typed FK and matches the existing pattern in `ancillary_document_references.source_table` + `source_id`.

---

## API Endpoints

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET | `/api/plexus-findings` | Authenticated | List with filters |
| GET | `/api/plexus-findings/patient/:globalPatientId` | Authenticated | All findings for a patient |
| GET | `/api/plexus-findings/screening/:screeningId` | Authenticated | Findings from a specific screening |
| GET | `/api/plexus-findings/:id` | Authenticated | Single finding |
| POST | `/api/plexus-findings` | Admin | Create single finding |
| POST | `/api/plexus-findings/bulk` | Admin | Bulk create (up to 200) |
| PATCH | `/api/plexus-findings/:id` | Admin | Update finding |
| POST | `/api/plexus-findings/:id/review` | Admin/Clinician | Review (confirm/reject/modify) |
| DELETE | `/api/plexus-findings/:id` | Admin | Delete finding |

---

## Validation Results

| Test | Result |
|------|--------|
| Server starts with new routes | PASS |
| POST create single finding | PASS — returns 201 with full row |
| POST bulk create (2 findings) | PASS — returns both created |
| GET by patient ID | PASS — returns array |
| GET by screening ID | PASS — returns array |
| POST review (confirm with ICD-10) | PASS — reviewStatus=confirmed, confirmedIcd10 set, reviewedAt stamped |
| Role enforcement (admin for writes) | PASS — verified in route handler |

---

## Future Integration Points

1. **Plexus IQ AI qualification** — after running AI screening, the system should extract findings from the AI response and write them to this table via the bulk endpoint
2. **Admin Review UI** — display findings in the Admin Review dialog alongside qualification reasoning
3. **Screening Form** — when screening reveals new clinical information, create findings with `sourceType = 'screening_form'`
4. **Plexus EHR** — display findings as a dedicated section in the Patient Directory / EHR view
5. **Order Note justification** — confirmed findings should be available as clinical evidence for Order Note generation

---

## Next Phase

Phase 4 — Service Registry: Centralize ancillary service definitions and CPT configuration. Replace hardcoded `ANCILLARY_TESTS` in `shared/plexus.ts` and service-specific logic in `screening.ts` AI prompt with a configurable registry.
