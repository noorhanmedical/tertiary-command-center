# Patient Directory + duplicate-warning runtime — final report

**Status:** Final report (Batch B16, review branch).
**Companion:** `scripts/qa-patient-directory-duplicate-warning-results.mjs`.

This is the review record for the
`feat/patient-directory-duplicate-warning-runtime` branch. The PR is
**open but UNMERGED** pending Ali's review.

> Replit must NOT pull this branch. Replit pulls only from `main`
> after the PR is approved + merged.

## Branch + PR

| Item | Value |
|---|---|
| Branch | `feat/patient-directory-duplicate-warning-runtime` |
| Base | `main` @ `11d73c39100fda1705cd5bd0a1d8d97fb74046c4` (Phase 1 close) |
| PR | (URL inserted by the runner; see PR description below) |
| Merge plan | DO NOT merge until Ali approves. No squash to main. No production deploy. |

## Files added (this branch)

```
shared/patientIdentity.ts
shared/contactRestrictions.ts
shared/priorAncillaryHistory.ts
server/services/patientDirectory/patientDirectoryService.ts
server/services/patientDirectory/__tests__/patientDirectoryService.test.ts
client/src/lib/qualificationRunOrdering.ts
client/src/lib/patientDuplicateWarnings.ts
client/src/lib/patientDirectoryImport.ts
client/src/lib/patientDirectoryAuditTypes.ts
client/src/components/patient-directory/DuplicateWarningBadge.tsx
client/src/components/patient-directory/AdminReviewDuplicateGuard.tsx
client/src/components/patient-directory/EngagementHandoffDuplicateBar.tsx
client/src/components/patient-directory/PatientAuditTrailModal.tsx
client/src/components/patient-directory/PatientProfileDrawer.tsx
client/src/components/patient-directory/PatientDirectoryPage.tsx
client/src/components/plexus-iq/RunComparisonSelector.tsx
client/src/components/plexus-iq/PacketPatientSelectionDialog.tsx
tests/unit/patientIdentity.test.ts
tests/unit/qualificationRunOrdering.test.ts
tests/unit/patientDuplicateWarnings.test.ts
tests/unit/patientDirectoryImport.test.ts
tests/unit/contactRestrictions.test.ts
tests/unit/priorAncillaryHistory.test.ts
scripts/qa-patient-identity-helper.mjs
scripts/qa-qualification-run-ordering.mjs
scripts/qa-patient-directory-runtime-implementation-audit.mjs
scripts/qa-patient-directory-api-runtime-or-scaffold.mjs
scripts/qa-patient-duplicate-warning-engine.mjs
scripts/qa-run-comparison-selector-ui.mjs
scripts/qa-plexus-iq-duplicate-warning-ui.mjs
scripts/qa-admin-review-duplicate-warning-ui.mjs
scripts/qa-engagement-team-portal-duplicate-warning-ui.mjs
scripts/qa-patient-audit-trail-modal.mjs
scripts/qa-patient-directory-ui-scaffold.mjs
scripts/qa-patient-directory-import-preview.mjs
scripts/qa-patient-directory-contact-restrictions-cooldown.mjs
scripts/qa-prior-ancillary-history-warning.mjs
scripts/qa-pdf-packet-patient-selection-dialog.mjs
scripts/smoke-patient-directory-duplicates.mjs
scripts/qa-patient-directory-duplicate-warning-results.mjs
docs/architecture/patient-directory-runtime-implementation-audit.md
docs/architecture/patient-directory-runtime-blockers.md
docs/architecture/patient-directory-duplicate-warning-results.md  (this file)
```

## Files modified (this branch)

None of the protected surfaces were modified. Specifically untouched:
- `client/src/components/plexus-iq/PlexusIQWorkspace.tsx`
- `client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx`
- `client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx`
- `client/src/components/qualification/AdminReviewDialog.tsx`
- `client/src/components/qualification/AdminApprovalControl.tsx` (n/a — not present in repo)
- `client/src/components/portal/TeamPortalShell.tsx`
- `client/src/components/portal/PortalShell.tsx`
- `client/src/components/portal/PatientCommandCanvas.tsx`
- `client/src/components/portal/SchedulePatientPlayground.tsx`
- `client/src/components/outreach/CallListPanel.tsx`
- `client/src/components/outreach/DispositionSheet.tsx`
- `client/src/components/outreach/CanonicalRowActions.tsx`
- `client/src/components/PatientDirectoryView.tsx`
- `client/src/lib/pdfGeneration.ts`
- `client/src/lib/pdfPacketGrouping.ts`

## Schema / migration status

| Item | Value |
|---|---|
| Migrations added | **NONE** |
| Migrations proposed | 4 (0026 mrn / 0027 dnc flag / 0028 source file / 0029 patient_directory_events) — see [[patient-directory-runtime-blockers]] |
| Schema breaking changes | None |

## Duplicate warning surfaces added

| Surface | Component | Severity behavior |
|---|---|---|
| Plexus IQ qualification cards | `DuplicateWarningBadge` | Badge + tooltip; opens audit modal |
| Admin Review approval | `AdminReviewDuplicateGuard` | Inline strip; `isApprovalHardBlocked()` hooks the existing approve button |
| Engagement handoff confirmation | `EngagementHandoffDuplicateBar` | Roll-up banner above the existing list |
| Team Portal patient list | `EngagementHandoffDuplicateBar` (read-only) | Same banner; warnings render only |
| Patient Directory page rows | `DuplicateWarningSummary` | Static chip list per row |
| Patient Profile drawer header | `PatientProfileDrawer` + summary | DNC / cooldown / sent-to-engagement / prior-tests / dup-match chips |

Warning engine output keys: `matched_prior_run`,
`previously_sent_to_engagement`, `do_not_contact`, `active_cooldown`,
`expired_cooldown_historical`, `prior_ancillary_test`.
Severities: `info` / `warn` / `block`. `block` warnings flip
`blockedFromOutreach=true` and hard-block approval.

## Patient Directory runtime status

| Surface | Status |
|---|---|
| Schema | EXISTING — patient_screenings + screening_batches + outreach_calls + scheduler_assignments + cooldown_records + patient_journey_events + patient_test_history + audit_log + documents all already present |
| Service projection | SCAFFOLD — `patientDirectoryService.ts` returns a deps-injected `PatientDirectorySnapshot`; no route imports it |
| Search endpoint | NOT YET — uses scaffolded UI; route deferred per blockers doc |
| Profile endpoint | NOT YET — drawer accepts an injected snapshot |
| Audit endpoint | NOT YET — modal accepts caller-provided events + shows clear unavailable state |
| Existing legacy view | UNCHANGED — `PatientDirectoryView` + `patient-database.tsx` keep working |

## Audit trail status

Per-event kinds supported by the modal (icons + labels):

`patient_created`, `imported`, `qualification_generated`,
`admin_review_approved`, `admin_review_rejected`,
`admin_review_needs_info`, `sent_to_engagement`,
`added_to_call_list`, `call_completed`, `call_callback_scheduled`,
`dnc_set`, `dnc_cleared`, `cooldown_set`, `cooldown_cleared`,
`prior_test_logged`, `packet_generated`, `document_uploaded`,
`soft_deleted`, `restored`, `other`.

Until the dedicated `patient_directory_events` table lands (per
0029), the modal accepts caller-provided events from the duplicate-
warning engine and any stitched lookups callers already do.

## Import status

| Format | Behavior |
|---|---|
| CSV | parsed with header aliases (`name/full name/patient name`, `dob/date of birth/birthdate`, `phone/mobile/cell`, `mrn/medical record number/chart`, `facility/site/clinic`) |
| TXT (pipe-separated) | `Name \| DOB \| Phone \| Facility \| MRN` |
| DOC / DOCX / PDF | **Deferred** — no existing parser in repo, heavy dependency, blocker note in [[patient-directory-runtime-blockers]] |
| Classification | new / matched_existing / missing_required_fields / duplicate_in_import / dnc / active_cooldown / prior_ancillary / previously_sent_to_engagement |

## DNC / cooldown status

| Surface | Status |
|---|---|
| Helper | `shared/contactRestrictions.ts` — presets `30d/60d/90d/6m/12m/custom`, `gateOutreach({dnc, cooldown})` returns typed block reason |
| Today's runtime | Existing `cooldown_records` table + implicit `refused_dnc` outcome. No explicit DNC column. |
| Future runtime | Migration 0027 adds explicit `do_not_contact` flag (see blockers doc) |

## Prior ancillary status

| Item | Value |
|---|---|
| Helper | `shared/priorAncillaryHistory.ts` |
| Restricted-test table | 9 cardiac/arterial @ 365 days + 2 venous @ 180 days |
| Used by | warning engine (`prior_ancillary_test`), Profile drawer "Prior tests" tab, Patient Directory row badges |
| Today's data | `patient_test_history` already persists `testName / dateOfService / facility / source / notes` |

## PDF / packet selection status

| Surface | Status |
|---|---|
| Dialog | `PacketPatientSelectionDialog` — splits outreach (alphabetical) + visit (appointment time); Select All / Clear All / Confirm; outputs narrowed roster to caller |
| PDF generator | UNCHANGED — `pdfGeneration.ts` and `pdfPacketGrouping.ts` were not modified |
| Visual format | Unchanged. Only the patient roster handed to the generator can be narrowed. |

## Validation snapshot

| Check | Result |
|---|---|
| `npm run check` | green |
| `npm run build` | green |
| `for s in scripts/qa-*.mjs; do node "$s"; done` | **179/179 PASS** |
| `node scripts/smoke-phase-1-end-to-end.mjs` | 23 PASS / 1 SKIP / 0 FAIL |
| `node scripts/smoke-patient-directory-duplicates.mjs` | **18 PASS / 0 SKIP / 0 FAIL** |

## Remaining blockers (deferred, not in this branch)

1. **Schema migrations 0026-0029** — Ali review required (see
   [[patient-directory-runtime-blockers]]).
2. **Patient Directory routes** — `GET /api/patient-directory/search`,
   `/:id`, `/:id/audit`, etc. The service scaffold is ready to wire.
3. **DOC/DOCX/PDF import parsing** — requires either an existing
   parser in the repo (none found) or a new dependency
   (blocker — needs approval).
4. **CI workflow file** — covered by the existing
   `phase-1-scanner-enforcement-plan` deferral.

## Replit readiness checklist

| Item | Value |
|---|---|
| Branch name | `feat/patient-directory-duplicate-warning-runtime` |
| PR URL | (added at PR open time) |
| Final main/base commit used | `11d73c39100fda1705cd5bd0a1d8d97fb74046c4` |
| npm install needed | **No** — no new dependencies added |
| `npm run check` status | green |
| `npm run build` status | green |
| All QA status | 179/179 green |
| Smoke test status | both smokes pass |
| Migrations added | **No** |
| Env vars added | **No** new required env vars. Optional: `USE_PATIENT_DIRECTORY_SERVICE` (defaults OFF) |
| Feature flags added | `USE_PATIENT_DIRECTORY_SERVICE` (server, default OFF). No new VITE flags. |
| Files Replit must pull | **None until the PR is merged**. After merge, pull main. |
| Replit pull commands | `git fetch origin && git checkout main && git pull --ff-only` |
| Branch to pull | `main` (after PR merge). **DO NOT pull `feat/patient-directory-duplicate-warning-runtime` directly.** |
| Flags needed in Replit | None — all flags default OFF |

## Review checklist for Ali

- [ ] Inspect the 4 migration proposals in
      `docs/architecture/patient-directory-runtime-blockers.md`.
      Approve or amend each.
- [ ] Review the warning severities (`info` / `warn` / `block`) and
      confirm DNC + active cooldown should hard-block approval.
- [ ] Confirm the restricted-test list + intervals
      (`shared/priorAncillaryHistory.ts`) match clinical policy.
- [ ] Confirm import parser scope (CSV + TXT today; DOC/DOCX/PDF
      deferred without a heavy dependency).
- [ ] Confirm the Patient Directory page rendering is the desired
      route placement (no route wired yet — current plan is
      `/patient-directory` under the existing sidebar).
- [ ] Confirm no production flag is to be flipped during this PR.
- [ ] After approval, decide merge strategy (no-squash recommended
      so the commit history is preserved for audit).

## What is real runtime vs scaffold

| Surface | Real runtime today | Scaffold |
|---|---|---|
| `shared/patientIdentity.ts` | YES — pure module, no DB |  |
| `shared/contactRestrictions.ts` | YES — pure module |  |
| `shared/priorAncillaryHistory.ts` | YES — pure module |  |
| `client/src/lib/qualificationRunOrdering.ts` | YES — pure module |  |
| `client/src/lib/patientDuplicateWarnings.ts` | YES — pure module |  |
| `client/src/lib/patientDirectoryImport.ts` | YES — pure module (CSV + TXT) |  |
| `DuplicateWarningBadge` | YES — renders inline anywhere |  |
| `AdminReviewDuplicateGuard` | YES — drop-in component | route wiring in a follow-up batch |
| `EngagementHandoffDuplicateBar` | YES — drop-in component | route wiring in a follow-up batch |
| `RunComparisonSelector` | YES — drop-in component | route wiring in a follow-up batch |
| `PacketPatientSelectionDialog` | YES — drop-in component | route wiring in a follow-up batch |
| `PatientAuditTrailModal` | YES — accepts injected events |  |
| `PatientProfileDrawer` | partial | needs the search endpoint to feed the snapshot |
| `PatientDirectoryPage` | partial | search endpoint + route registration needed |
| `patientDirectoryService.ts` |  | SCAFFOLD — needs route + DB-bound deps |

## End of report.
