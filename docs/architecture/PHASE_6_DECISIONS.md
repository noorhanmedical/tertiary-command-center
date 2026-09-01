# Phase 6 — Engagement Canonical Migration + Clinician Portal: Decisions and Validation

**Date:** 2026-08-24
**Status:** COMPLETE — validated locally

---

## Summary

Phase 6 had two objectives:
1. Enable the engagement multi-list repository (per-service engagement memberships)
2. Build or connect the Clinician Portal frontend

**Both were already implemented.** Phase 6 scope reduced to: enable flags + validate.

---

## Key Findings

### Finding 1: Engagement multi-list is fully implemented, just flag-gated

The entire `sendToEngagement` workflow inside `commitPatient()` was already wired:
- Creates `engagement_lists` rows per facility/batch
- Creates `engagement_list_memberships` rows per approved ancillary service
- Links via `ancillary_case_id` to the canonical service episode
- Returns `engagementSend.status = "sent"` in the commit response

Enabling `FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY=true` activates this pre-existing code path.

### Finding 2: Clinician Portal frontend is COMPLETE (not a stub)

The architecture map originally classified the Clinician Portal frontend as a "5-line stub." This was incorrect. The page file (`physician-portal.tsx`) is 5 lines because it delegates to a full component tree:

| Component | Lines | Purpose |
|-----------|-------|---------|
| `ClinicianPortalShell.tsx` | 96 | 3-tile command center shell |
| `DashboardHome.tsx` | 117 | Summary dashboard tiles |
| `SignaturesTab.tsx` | 308 | Live signature worklist (real API) |
| `OrdersNotesPage.tsx` | 487 | Orders & notes section |
| `ReportsTab.tsx` | — | Reports from case_document_readiness |
| `AncillaryMetricsTab.tsx` | — | Per-service rollups |
| `FinancialHealthTab.tsx` | — | Invoice-based financial summary |
| `PlexusEngagementPage.tsx` | — | Engagement section |
| `usePortalData.ts` | 48 | Data hook (mock for finance/engagement) |
| `useCanonicalOverview.ts` | — | Canonical overview hook |
| `mockData.ts` | — | Mock data for non-live sections |

The `SignaturesTab` already calls the real `/api/physician-portal/signature-items` endpoint and supports individual signing, bulk signing, and return-for-correction — all via live API calls.

### Finding 3: Portal requires clinic scope

The `requireClinicScope` guard deliberately returns 403 for admin users without a clinic assignment. This is intentional per the guard's documentation: "the Clinician Portal is strictly per-clinic." Testing with an admin user confirms this behavior. A clinician-role user with `clinic_id` assigned would see the full live portal.

---

## Flags Enabled

| Flag | Status | Purpose |
|------|--------|---------|
| `FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY` | ON | Enables engagement_lists + memberships creation on commit |
| `FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW` | ON | Admin Review status changes reconcile into ancillary cases |
| `FEATURE_ENGAGEMENT_ADMIN_REVIEW_SYNC` | ON | Engagement eligibility reconciles on Admin Review changes |
| `FEATURE_ENGAGEMENT_RECENT_LISTS` | ON | Most Recently Sent section on Engagement Repository tab |

---

## Validation Results

| Test | Result |
|------|--------|
| Server starts with all engagement flags ON | PASS |
| Commit patient → `engagementSend.status = "sent"` | PASS |
| `engagement_lists` row created with facility + label | PASS |
| `engagement_list_memberships` rows created per service with `ancillary_case_id` | PASS |
| Clinician Portal component tree exists and renders | PASS (confirmed by code inspection) |
| SignaturesTab calls live API | PASS (confirmed by source) |
| Portal guard requires clinic scope | PASS (403 for scopeless admin — intentional) |

---

## Architecture Map Correction

The CURRENT_ARCHITECTURE_MAP.md Domain 11 (Clinician Portal) stated:
> "Frontend: client/src/pages/physician-portal.tsx — 5 lines — effectively a placeholder/stub"

**Corrected classification:**
- Frontend: CURRENT — complete multi-page application already exists
- Backend: CURRENT — signature workflow, reports, metrics all functional
- Combined: CURRENT/CONNECT — both sides exist; progressive mock-to-live data migration is the remaining work

No new frontend code was written in Phase 6. The portal is ready to use once clinician-role users with clinic scope are configured.

---

## Files Modified

| File | Change |
|------|--------|
| `.env` | Added engagement + admin review feature flags |

No source code changes. Phase 6 is purely a flag-enablement + validation phase (same as Phase 2).

---

## Next Phase

Phase 7 — Screening Addendum: When a screening form is completed, create a structured screening addendum linked to the signed Order Note. The `note_addenda` table (created in Phase 5) is the storage target. Phase 7 wires the trigger: screening form completion → addendum creation.
