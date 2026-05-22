# ACS Capability Onboarding — Audit

> **Scope:** Where admins set the ACS-specific capabilities on a
> team-member profile, what defaults a new user inherits, and the
> onboarding risks that show up in practice. Read-only audit — no
> code changes here.

## Surface

`client/src/pages/admin-users.tsx` is the canonical editor. The
profile dialog renders five capability toggles plus the workspace
type / default mode / assigned facilities / allowed service types
fields. The profile is persisted via
`POST /api/admin-settings/upsert` (settingDomain=`"team_member"`,
settingKey=`"workspace_profile"`, userId=`<user>`).

## Capability matrix in the editor

| Capability | Editor line | Gating |
| --- | --- | --- |
| `callAndSchedule` | admin-users.tsx:568 | Available to both PCS and ACS profiles |
| `completeProcedure` | admin-users.tsx:574 | `disabled={!isAncillary}` — only enabled when workspaceType is ACS |
| `primaryConsentScreening` | admin-users.tsx:581 | `disabled={!isAncillary}` |
| `uploadProcedureReport` | admin-users.tsx:588 | `disabled={!isAncillary}` |
| `viewAllFacilities` | admin-users.tsx:595 | Available to both PCS and ACS |

So the editor already enforces the canonical rule: PCS profiles
can't toggle procedure-side capabilities at all.

## Workspace type selector

`profile.workspaceType` is a select at admin-users.tsx:499 with
the two canonical options (`patientCareSpecialist` /
`ancillaryCareSpecialist`). Switching from PCS → ACS keeps the
capability map intact; the disabled checkboxes simply become
enabled with their existing (likely-false) value.

## Defaults

A fresh profile inherits from the canonical
`defaultPatientCareSpecialistProfile` or
`defaultAncillaryCareSpecialistProfile`
(`shared/teamMemberProfile.ts:62-92`):

| Field | PCS default | ACS default |
| --- | --- | --- |
| `callAndSchedule` | true | true |
| `completeProcedure` | false | true |
| `primaryConsentScreening` | false | true |
| `uploadProcedureReport` | false | true |
| `viewAllFacilities` | false | false |
| `defaultMode` | `callList` | `clinicSchedule` |
| `assignedFacilityIds` | `[]` | `[]` |
| `allowedServiceTypes` | `[]` | `[]` |

So a new ACS user gets the procedure-side capabilities **on by
default**, but `assignedFacilityIds` and `allowedServiceTypes`
both start empty. That's the canonical safe default — the user
sees nothing until the admin assigns at least one facility +
service.

## Onboarding risks (named)

1. **`assignedFacilityIds = []` blocks the workspace.**
   The PortalShell `effectiveFacilities` memo returns nothing
   when the user has no view-all permission and no assigned
   facilities. The portal renders an explicit hint:
   "No facility assigned. Ask an admin to update your Team
   Member Profile." This is correct behaviour, but it's the
   #1 onboarding paper-cut: a new user logs in and sees an
   empty workspace. Admins need a runbook step that says "set
   `assignedFacilityIds` before the user logs in."
2. **`allowedServiceTypes = []` means "all services allowed."**
   Because the implicit filter on
   `filteredAncillarySchedule` treats an empty allow-list as
   "no restriction." This is the inverse of what a careful
   admin might expect — they may set the field expecting it
   to opt the user *in* to a subset, but if they leave it
   empty the user sees everything. Worth a clearer
   editor-side hint.
3. **Switching workspaceType from PCS → ACS doesn't auto-flip
   capability bits.**
   The procedure-side checkboxes remain `false` from the PCS
   defaults. Admins routinely have to remember to toggle
   `completeProcedure` / `primaryConsentScreening` /
   `uploadProcedureReport` after the type switch. The
   editor could prompt to apply
   `defaultAncillaryCareSpecialistProfile.capabilities` on
   switch, but doesn't today.
4. **No audit log on `admin-settings/upsert`.** Cross-referenced
   in `docs/architecture/audit-log-coverage.md` gap #5. Profile
   changes are a high-trust surface and should always appear
   in `audit_log` so admins can see who promoted whom to ACS.
5. **No visible "effective capability" preview.** Editor shows
   the raw bits, but doesn't tell the admin what the user will
   actually be able to do (e.g. "callAndSchedule + ACS →
   schedule ancillary, mark procedure complete, …"). A future
   surfacing of `resolvePortalCapabilities()` against the
   pending profile would close the loop.

## Onboarding runbook (recommended, not implemented in this batch)

For every new ACS user:

1. Create user (admin-users page).
2. Open profile dialog. Set `workspaceType =
   ancillaryCareSpecialist`.
3. Set `assignedFacilityIds` to at least one facility.
4. Set `allowedServiceTypes` to the explicit list (do not
   leave empty unless you want all services visible).
5. Confirm all four procedure-side toggles are on
   (`callAndSchedule`, `completeProcedure`,
   `primaryConsentScreening`, `uploadProcedureReport`).
6. Save. Verify in the portal that the workspace renders.

For every new PCS user:

1. Same as above, with `workspaceType =
   patientCareSpecialist`.
2. Procedure-side toggles must stay off (they're disabled in
   the editor — defense-in-depth confirms server-side too).

## Cross-references

- `client/src/pages/admin-users.tsx` — capability editor.
- `shared/teamMemberProfile.ts` — defaults + capability ids.
- `client/src/lib/portal/portalCapabilities.ts` — resolver.
- `docs/architecture/pcs-acs-portal-solidness-audit.md` — broader
  portal audit (this doc focuses on onboarding side).
- `docs/architecture/audit-log-coverage.md` gap #5 — admin
  settings upsert audit gap (related).
