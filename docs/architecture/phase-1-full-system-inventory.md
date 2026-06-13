# Phase 1 Full-System Inventory

**Status:** Slice 1.0 baseline snapshot, captured at the start of the
Phase 1 audit. This document evolves as each later slice (1.1–1.8)
discovers more.

**Branch:** `fix/phase-1-full-system-audit-and-completion`
**Base:** `main` at `d02f2ca` (PR #275 merged)

The purpose of this file is to give every subsequent slice a single
honest place to look for the current state of the operating workflow.
Each finding tagged as **🚧 GAP**, **⚠️ DUPLICATE**, or **📝 OBSERVE**
is a candidate for the relevant slice.

---

## 1. Repo baseline

- TypeScript check (`npm run check` / `tsc`): clean.
- Production build (`npm run build`): clean (with pre-existing
  chunk-size warnings).
- Migrations: 33 SQL files under `migrations/` (0000–0029). Note: two
  files share id `0021` (`0021_add_invoice_payments.sql` +
  `0021_invoice_email_metadata.sql`) — possible merge artifact, flagged
  for Slice 1.7 doc.
- Untracked dev dirs found (`CLAUDE.md`, `artifacts/mockup-sandbox`,
  `tmp_recovery/<broken-backups>`). None committed.
- `.gitignore` had a corrupted glued line (`*.tar.gzstorage/`); fixed
  as part of Slice 1.0.
- No `.env`, secret, or credential file is committed (verified by
  `git ls-files | grep -iE 'env$|secret|credentials'`).

---

## 2. Canonical routes (from `client/src/App.tsx`)

| Path | Component | Notes |
|---|---|---|
| `/plexus-iq` | `PlexusIQPage` | Core qualification workspace |
| `/patient-care-specialist-portal` | `PatientCareSpecialistPortalPage` | PCS Workspace |
| `/ancillary-care-specialist-portal` | `AncillaryCareSpecialistPortalPage` | ACS Workspace |
| `/patient-directory` | `PatientDatabasePage` | Legacy / original Patient Directory |
| `/patient-directory/live` | `PatientDirectoryLiveRoute` | **⚠️ DUPLICATE — created by prior work; guardrails forbid this route** |

### Sidebar / nav entries

| Surface | Label | Target | Notes |
|---|---|---|---|
| `HomeSidebar.tsx` | "Patient Directory" | `/patient-directory` (via testid `sidebar-patient-directory`) | Canonical |
| `GlobalNav.tsx:40` | "Patient Directory · Live" | `/patient-directory/live` | **⚠️ DUPLICATE — name explicitly forbidden by guardrails** |

**🚧 GAP / Slice 1.5:** consolidate to a single Patient Directory
route + a single sidebar entry. The `/patient-directory/live` route
and the "Patient Directory · Live" nav item must be removed or
redirected to `/patient-directory`. Any backend/API/migrations created
by the prior "Live" work must be preserved if useful, but wired into
the existing `/patient-directory` UI.

---

## 3. Care-tech portal surfaces

### Files of interest

- `client/src/pages/patient-care-specialist-portal.tsx`
- `client/src/pages/ancillary-care-specialist-portal.tsx`
- `client/src/lib/workflow/teamMemberWorkspaceApi.ts` (expected)
- `client/src/components/` for `TeamPortalShell`, `WorkspaceModeSwitcher`,
  `PatientCommandCanvas`, `SchedulePatientPlayground`, `CallListPanel`,
  `DispositionSheet`, `CanonicalRowActions`

**Slice 1.1** will inventory each of these against the canonical
concepts list and document the actual wiring + identify
demo-patient fallback paths.

### Feed routes (expected from prompt)

- `/api/scheduler-portal/cases`
- `/api/technician-liaison/clinic-visits`
- `/api/technician-liaison/ancillary-schedule`

### Feed helpers (expected from prompt)

- `fetchWorkspaceCallList`
- `fetchWorkspaceClinicSchedule`
- `fetchWorkspaceAncillarySchedule`
- `fetchTeamMemberProfile`

**📝 OBSERVE / Slice 1.1:** verify all of the above exist and are wired
into the actual PCS/ACS pages, not demo-only.

---

## 4. Admin Review commit fan-out

### Files of interest

- `client/src/components/qualification/AdminReviewDialog.tsx`
- `server/routes/patients.ts` — exposes
  `POST /api/patient-screenings/:id/admin-approval`
- `server/services/journey/appendJourneyEvent.ts` — audit gate
- `shared/schema/executionCase.ts` — execution case schema present
- `migrations/0025_add_patient_screening_admin_approval.sql`

Downstream surfaces written during commit (per prompt):

- Patient Directory facts/history
- Engagement handoff
- execution case / assigned work
- call list feed
- scheduler/ancillary handoff scaffold
- audit events

**Slice 1.3** will inventory each fan-out destination + identify
whether the writes are transactional today.

---

## 5. Canonical call-result writeback

### Files of interest

- `DispositionSheet` component (location to be confirmed by Slice 1.4)
- `CanonicalRowActions` component
- Call-result routes / services on the server

**Slice 1.4** will identify:

- the canonical endpoint (vs legacy POST)
- whether DispositionSheet defaults to canonical
- which React-Query keys must be invalidated after save
- whether a transitional rollback flag exists

---

## 6. PHI / logging hygiene

Pre-existing log lines that include patient names (NOT introduced by
Phase 1; documented here for awareness):

```
server/routes/batches.ts:390    console.error(`Failed to analyze patient ${patient.name}: ...`)
server/routes/patients.ts:756   console.error(`AI screening failed for patient ${patient.name}: ...`)
server/routes/patients.ts:918   console.error(`AI analyze-test failed for ${patient.name} / ${testName}: ...`)
server/services/screening.ts:165 console.error(`AI response truncated for patient: ${patient.name}. ...`)
server/services/screening.ts:168 console.warn(`Partial recovery succeeded for patient: ${patient.name}. ...`)
```

**📝 OBSERVE / out-of-Phase-1-scope:** these pre-date this work. The
hygiene rule is "ensure PHI logging is safe where Phase 1 *touches*
logs"; no Phase 1 slice touches these log lines, so they are left
intact and flagged here for a future hygiene pass (likely Phase 4
billing readiness or Phase 5 AWS activation, where PHI redaction will
be a hard requirement).

---

## 7. Plexus IQ behavior status (pre-Slice-1.6)

These behaviors are already enforced by
`scripts/qa-plexus-iq-interior.mjs` (verified green before Phase 1):

- Compact run selector under the date card (no giant Runs panel)
- `PLEXUS_IQ_BUCKET_LABELS` keys present
- Plexus IQ packets route through `openPatientPacketPrintPreview`
  (no direct `generatePlexusPDF(` / `generateClinicianPDF(` calls in
  `PlexusIQWorkspace.tsx` or `AdminReviewDialog.tsx`)
- `#7283B0` contained panel + `plexus-iq-dropdown-white-row` inner
  wrapper preserved
- Print-preview popup-blocked + error surfaces present
- Required testIds for facility tile / clinic interior / status tiles

Rule-engine mapping (HTN ↛ LE Venous Duplex; HTN → Renal Artery
Doppler / TTE; LE Venous Duplex requires venous indications) is
**📝 OBSERVE / Slice 1.6** — no QA script enforces this today; the
slice will add one.

---

## 8. Downstream module status (pre-Slice-1.7)

To be classified by Slice 1.7 against the
**Live / Scaffold / Dormant / Flag-gated / Read-only / Requires
activation / Requires staging DB** label set:

- Documents
- Report upload
- Physician signing
- Billing readiness
- Invoicing
- AWS production
- External integrations
- Mission Control (must remain Phase 7)

---

## 9. Known untouched protected systems

These are **not** edited during Phase 1:

- `client/src/lib/pdfGeneration.ts`
- `client/src/lib/pdfPacketGrouping.ts`
- `client/src/lib/patientPacketOrdering.ts`
- `client/src/components/PdfPatientSelectDialog.tsx`
- `client/src/components/qualification/PatientPdfActions.tsx`
- `client/src/print/*`
- `openPatientPacketPrintPreview` signature/callers

---

## 10. Risk register for downstream slices

| Slice | Risk | Mitigation |
|---|---|---|
| 1.2 | Adding a facilities table mid-phase could break facility joins | Inspect first. Only act if migration is proven missing. |
| 1.3 | Wrapping Admin Review commit fan-out can change failure modes | Document current behavior + non-transactional cases first. |
| 1.4 | Flipping DispositionSheet default to canonical can split-brain | Keep transitional rollback flag. Verify React-Query invalidation. |
| 1.5 | Removing `/patient-directory/live` may break existing bookmarks | Add a redirect, not a 404. Preserve backend wiring. |

Authored as part of Slice 1.0. Updated by each later slice.
