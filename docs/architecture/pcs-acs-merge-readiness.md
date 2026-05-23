# PCS / ACS — Merge Readiness

> **Scope:** Branch `feat/plexus-iq-real-architecture`. This document
> is the single sign-off page for landing the PCS/ACS portal +
> canonical-calendar work into `main`. It captures every commit in
> the stream, every QA/smoke script that backs it, the remaining
> known gaps (all non-blocking), and a manual checklist for the
> human reviewer.

## Stream commits (in landing order)

| # | Hash | Title |
| --- | --- | --- |
| 1 | `7dcef4b` | Unify command center calendars |
| 2 | `96e4da1` | Add ancillary care specialist calendar profile |
| 3 | `72bf240` | Add calendar profile wiring QA |
| 4 | `0de682d` | Add calendar data shape QA |
| 5 | `c98e6d0` | Add calendar profile override QA |
| 6 | `ac947b0` | Audit PCS ACS portal solidness |
| 7 | `317919a` | Add PCS ACS portal action QA |
| 8 | `bd2f5d1` | Add portal facility access calendar hint |
| 9 | `1f4f44c` | Harden portal workspace role defaults |
| 10 | `17d54fe` | Audit PCS ACS legacy role leaks |
| 11 | `082f739` | Add PCS ACS portal capability resolver |
| 12 | `fa4c26a` | Add PCS ACS capability QA |
| 13 | `4808bee` | Use capability resolver in portal shell |
| 14 | `baac6f7` | Add PCS ACS mini calendar QA |
| 15 | `34934ef` | Expand PCS ACS portal action QA |
| 16 | `2f5975b` | Add PCS ACS portal smoke test |
| 17 | `0b11b05` | Clean up PCS ACS workspace role typing |
| 18 | `5923728` | Add PCS ACS role isolation QA |
| 19 | `1e512e7` | Audit PCS ACS service prevalidation path |
| 20 | `2e520a8` | Prevalidate PCS ACS scheduling services upstream |
| 21 | `c9637a2` | Audit PCS callback action path |
| 22 | `fcb815b` | Harden PCS callback action |
| 23 | `daebacf` | Audit ACS capability onboarding |
| 24 | `7425aad` | Add ACS capability onboarding QA |
| 25 | `003c463` | Add live PCS ACS portal smoke test |

## QA scripts

All scripts run without a DB; results are pure source-/runtime-
contract checks.

| Script | npm command | Last result |
| --- | --- | --- |
| `script/qaCalendarProfileWiring.ts` | `qa:calendar-profile-wiring` | 36/36 |
| `script/qaCalendarDataShape.ts` | `qa:calendar-data-shape` | 26/26 |
| `script/qaCalendarProfileOverrides.ts` | `qa:calendar-profile-overrides` | 18/18 |
| `script/qaPcsAcsPortalActions.ts` | `qa:pcs-acs-portal-actions` | 26/26 |
| `script/qaPcsAcsCapabilities.ts` | `qa:pcs-acs-capabilities` | 30/30 |
| `script/qaPcsAcsMiniCalendar.ts` | `qa:pcs-acs-mini-calendar` | 11/11 |
| `script/qaPcsAcsLegacyRoleIsolation.ts` | `qa:pcs-acs-role-isolation` | 25/25 |
| `script/qaAcsCapabilityOnboarding.ts` | `qa:acs-capability-onboarding` | 30/30 |
| `script/smokePcsAcsPortal.ts` (no-DB) | `smoke:pcs-acs-portal` | 31/31 |
| `script/smokePcsAcsPortalLive.ts` (live) | `smoke:pcs-acs-portal-live` | 11/11 against local dev server |

## Architecture docs added in the stream

- `docs/architecture/tertiary-command-center-canonical-spine.md`
- `docs/architecture/admin-settings-rule-application.md`
- `docs/architecture/integration-outbox-audit.md`
- `docs/architecture/audit-log-coverage.md`
- `docs/architecture/pcs-acs-portal-solidness-audit.md`
- `docs/architecture/pcs-acs-legacy-role-leak-audit.md`
- `docs/architecture/pcs-acs-service-prevalidation-audit.md`
- `docs/architecture/pcs-callback-action-audit.md`
- `docs/architecture/acs-capability-onboarding-audit.md`
- `docs/architecture/pcs-acs-merge-readiness.md` *(this doc)*

## Remaining non-blocking gaps

All items below are documented in the per-gap audit docs above —
none affect the canonical calendar contract, the capability
resolver, or the PCS/ACS profile routing.

1. **Legacy `Role = "technician" | "liaison"` alias** in
   `PortalShell.tsx:74` is still read by historical call sites.
   Audit: `pcs-acs-legacy-role-leak-audit.md`. Risk: Architectural
   (translator-coupled) — no behaviour risk after Batch 9 + 13.
2. **`SchedulePatientDialog` doesn't pick a service.**
   Prevalidation is correctly upstream at the ancillary-row
   schedule button (Batch 24). If a service picker ever lands on
   the dialog, repeat the pattern there.
3. **Admin Users onboarding paper-cut.** New ACS users with empty
   `assignedFacilityIds` see the "No facility assigned" hint.
   Audit: `acs-capability-onboarding-audit.md`. Runbook in the
   same doc.
4. **No client-side server-time check on callback past-time.**
   Browser blocks the picker via `min`; the dialog also disables
   submit when local-now is past the picked value. The client
   trusts the local clock — server is still the final
   authority. Acceptable.
5. **`admin-settings/upsert` is not yet in `audit_log`.** Audit:
   `audit-log-coverage.md` gap #5. High-trust surface; close in
   a dedicated batch.
6. **No DLQ on `outbox_items`.** Audit:
   `integration-outbox-audit.md` gap #2. Independent of PCS/ACS
   work.

## Known risks

- **Calendar profile filter universe.** `availableFilters` per
  profile is hard-coded in `calendarProfiles.ts`; an
  admin-settings override can narrow but not widen the set
  (except for manager/admin). Documented and tested by
  `qa:calendar-profile-overrides` (invalidFilterOverride case).
- **`PatientMiniCalendar` re-keys on cursor change.** This
  resets the canonical `CanonicalMonthCalendar` cursor when the
  parent updates `selectedDate`. Verified by manual test:
  selecting a date on the parent re-renders the grid to the new
  month. If a future change moves cursor state up the tree, the
  re-key can be dropped.
- **Smoke test cookie auth.** `smoke:pcs-acs-portal-live` is
  most useful with a `COOKIE` env var carrying the session id.
  The unauthenticated mode validates only that routes are
  mounted + gated, not their response contracts.

## Rollback notes

The stream is purely additive on top of the calendar primitive
layer. No schema migrations, no canonical table changes, no API
contract changes. To roll back any single commit safely:

- Commits adding QA/smoke scripts or docs can be reverted in
  isolation.
- Commits 21 (role type cleanup) + 17 (workspace-role default
  safety) + 13 (capability resolver wired into shell) form a
  coherent unit — revert in reverse order if needed.
- Commits adding the resolver helper (11) and its consumers
  (13) should revert together. Tests covering the resolver
  (12, 28) become noise but don't break the build.

There is no destructive change in the stream.

## Manual QA checklist (human pass)

Before merging:

- [ ] `npm run check` ✓
- [ ] `npm run build` ✓
- [ ] All 8 `qa:*` scripts return PASS.
- [ ] `smoke:pcs-acs-portal` returns PASS without a server.
- [ ] `smoke:pcs-acs-portal-live` against a running local dev
      server returns PASS (auth-wall mode is acceptable).
- [ ] Manually open `/patient-care-specialist-portal` while
      logged in as a PCS user with a populated profile. Confirm:
  - left-rail calendar renders.
  - facility access hint does NOT appear (because the user is
    in their assigned facility).
  - workspace mode toggle to `ancillarySchedule` shows ancillary
    rows with the disabled-button prevalidation when the
    `serviceType` is outside the user's allowed services.
- [ ] Manually open `/ancillary-care-specialist-portal` while
      logged in as an ACS user. Confirm:
  - left-rail calendar renders with the canonical primitive
    (no rectangular tile chips).
  - Procedure Performed button is enabled on an ancillary row.
  - Workspace switches between `clinicSchedule`,
    `ancillarySchedule`, `callList` show real data.
- [ ] Manually log a callback in the canonical row actions
      dialog. Confirm:
  - past-time picker is blocked at the browser layer.
  - submit is disabled when callback time is in the past.
  - timezone hint is visible.

## Cross-references

- `docs/architecture/tertiary-command-center-canonical-spine.md`
- `docs/architecture/pcs-acs-portal-solidness-audit.md`
- `docs/architecture/pcs-acs-legacy-role-leak-audit.md`
- `docs/architecture/pcs-acs-service-prevalidation-audit.md`
- `docs/architecture/pcs-callback-action-audit.md`
- `docs/architecture/acs-capability-onboarding-audit.md`
- `client/src/components/calendar/CanonicalCommandCalendar.tsx`
- `client/src/lib/portal/portalCapabilities.ts`
