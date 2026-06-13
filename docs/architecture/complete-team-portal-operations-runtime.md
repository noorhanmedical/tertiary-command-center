# Complete Team Portal Operations Runtime — Audit

**Status:** PR A — audit doc + boundary QA + mode contract.
**Working branch:** `fix/team-portal-operations-runtime-audit`
**Base:** `main` at `6940945` (PR #282 merged).
**Premium UI PR #278:** untouched (and will remain untouched until PR B, PR C, and validation against Replit have all landed).

This document is the audit deliverable for the 3-PR Team Portal +
Patient Directory + Operations Runtime wiring sequence:

- **PR A** (this PR): audit doc + boundary QA + mode contract.
- **PR B**: Engagement → PCS/ACS feed wiring + Patient Directory center-canvas wiring.
- **PR C**: Call-result lifecycle + admin settings routing + scheduling + ACS workflow.

The 22 audit questions from Part 1 of the operations-runtime brief
are answered below, followed by the **Anthony / Callista root-cause**
section — the single most important finding of this audit.

---

## A — Mode contract proof (PCS vs ACS)

The user requirement: **PCS and ACS portals are IDENTICAL for now.**
The only allowed runtime differences are:

1. The default workspace mode.
2. The assigned-feed context (which team-member's work is shown).
3. The admin view-as context (which team member the admin is observing).
4. The data shown in the shared shell.

Audited from `client/src/components/workflow/ClinicWorkflowPortal.tsx`:

```ts
const DEFAULT_MODE: Record<WorkspaceRole, TeamMemberWorkspaceMode> = {
  technician: "clinicSchedule",          // legacy
  liaison: "callList",                    // legacy
  ancillaryCareSpecialist: "clinicSchedule",
  patientCareSpecialist: "callList",
};
```

| Workspace | Shell | Default mode | Available modes |
|---|---|---|---|
| PCS (`patientCareSpecialist`) | `TeamPortalShell` | `callList` | `clinicSchedule`, `ancillarySchedule`, `callList` |
| ACS (`ancillaryCareSpecialist`) | `TeamPortalShell` | `clinicSchedule` (**not** `ancillarySchedule` — see §Q6 below) | `clinicSchedule`, `ancillarySchedule`, `callList` |

**Important caveat for the product team:** the ACS default in the
current code is `clinicSchedule`, not `ancillarySchedule`. The
user-facing brief says ACS should default to Ancillary Schedule.
**PR A intentionally does NOT change this** because:

- The current `clinicSchedule` default surfaces both clinic + ancillary
  appointments and consent / screening readiness in one view —
  changing the default in PR A (an audit PR) without product
  confirmation risks regressing the daily-ops view ACS users are
  trained on.
- The QA `qa-team-portals-only-default-mode-differs.mjs` accepts any
  of `callList | clinicSchedule | ancillarySchedule` as the ACS
  default as long as it differs from PCS — so if PR B / PR C / a
  separate single-line change updates the default later, the QA
  passes without modification.
- The audit doc explicitly flags this as Question Q6 for the
  product team to confirm.

The `WorkspaceModeSwitcher` exports all 3 modes as a single
canonical union (`TEAM_MEMBER_WORKSPACE_MODES`). The shell consumes
all 3 feed helpers (`fetchWorkspaceCallList`,
`fetchWorkspaceClinicSchedule`, `fetchWorkspaceAncillarySchedule`).
There is **no per-role mode hiding** — both portals expose all 3
modes uniformly.

This is enforced by:
- `qa-team-portals-both-have-call-list-and-ancillary-schedule.mjs`
- `qa-team-portals-only-default-mode-differs.mjs`

---

## B — Anthony / Callista visibility root cause

> **Why don't patients assigned to Anthony / Callista from
> Engagement Center show up in their PCS / ACS portal Call List
> right panel?**

The audit walks the assignment chain end-to-end and finds **a type-
mismatch / mapping gap** between the assignment writer and the
workspace feed reader.

### B.1 What Engagement Center writes

`POST /api/engagement/assignment-board/assign` (server/routes/
engagementAssignmentBoard.ts):

```ts
// L483
const previousSchedulerId = execCase.assignedTeamMemberId ?? null;
// L499
update(patientExecutionCases).set({
  assignedTeamMemberId: newScheduler.id,
  // ...
}).where(eq(patientExecutionCases.id, ...));
```

Where `newScheduler.id` is **`outreach_schedulers.id`** — an integer
PK from the `outreach_schedulers` table. `outreach_schedulers` has a
one-row-per-scheduler-per-facility mapping, with each row referencing
`users.id` (a UUID string) via `outreach_schedulers.userId`.

### B.2 What `patient_execution_cases.assignedTeamMemberId` stores

`shared/schema/executionCase.ts:41`:

```ts
assignedTeamMemberId: integer("assigned_team_member_id"),
```

An **integer**. It refers to `outreach_schedulers.id`, NOT `users.id`.

### B.3 What the PCS / ACS call-list feed reads

`server/repositories/executionCase.repo.ts:364`:

```ts
if (filters.assignedTeamMemberId != null)
  conditions.push(eq(patientExecutionCases.assignedTeamMemberId, filters.assignedTeamMemberId));
```

The feed CAN filter by `assignedTeamMemberId` if it is passed. But:

### B.4 What the shell actually passes

`client/src/components/portal/TeamPortalShell.tsx:972`:

```ts
fetchWorkspaceCallList({
  facilityId: facility || null,
  startDate: workspaceDayStartIso,
  endDate: workspaceDayEndIso,
  limit: 100,
  viewAsTeamMemberId,   // UUID string (users.id) for view-as
}),
```

It passes `viewAsTeamMemberId` (a `users.id` UUID) for the admin
view-as facility-scope override — but it does **NOT** pass
`assignedTeamMemberId`. So the resulting query is "show ALL cases
for the facility", not "show cases assigned to *this* team member".

### B.5 The root cause, restated

There are two separate identifier systems:

| Identifier | Type | Comes from |
|---|---|---|
| `users.id` | UUID string | `users` table |
| `outreach_schedulers.id` | integer | `outreach_schedulers` table (a row per user-per-facility mapping) |
| `outreach_schedulers.userId` | UUID FK to `users.id` | the bridge |
| `patient_execution_cases.assignedTeamMemberId` | integer (= `outreach_schedulers.id`) | what Engagement writes |

Engagement assigns to an `outreach_schedulers.id`. The shell + admin
view-as work in `users.id`. The two are bridged through
`outreach_schedulers.userId` but **the bridge is not invoked** when
fetching the call list.

So Anthony / Callista (each a row in `users` AND a row in
`outreach_schedulers`) get patients assigned to their
`outreach_schedulers.id` integer — but the PCS workspace asks the
feed for "all cases in this facility" without narrowing to "where
`assignedTeamMemberId = <Anthony's scheduler id>`". The patients are
in the data, but invisible in the visual right rail.

### B.6 The PR B fix (preview, not landed in PR A)

PR B will:

1. Add a helper that resolves `users.id` (UUID) → `outreach_schedulers.id`
   (integer) for a given facility scope. This already exists logically
   in `server/routes/portal.ts:allowedFacilities`; PR B will extract /
   reuse the same lookup.
2. Pass `assignedTeamMemberId` to `fetchWorkspaceCallList` (and the
   other feed helpers) when a team-member context is active —
   either:
   - Non-admin: the logged-in user's own scheduler id.
   - Admin in view-as mode: the selected team-member's scheduler id.
3. Enforce server-side: `assignedTeamMemberId` is treated as a
   filter, not a trust boundary — facility scope still applies.

PR B will land:
- `qa-engagement-assignment-feeds-pcs-right-panel.mjs`
- `qa-engagement-assignment-feeds-acs-right-panel.mjs`
- `qa-team-portal-viewas-anthony-callista-feed-contract.mjs`
- `qa-engagement-to-team-portal-no-split-brain.mjs`
- `smoke-engagement-to-team-portal-assignment.mjs`

PR A intentionally does NOT change runtime behavior — the audit
proves the gap; PR B is the surgical fix.

---

## C — The 22 audit questions

### Q1. Where does Engagement assignment write?

`POST /api/engagement/assignment-board/assign` →
`patient_execution_cases.assignedTeamMemberId =
outreach_schedulers.id` (integer). Source:
`server/routes/engagementAssignmentBoard.ts:499`.

### Q2. How is PCS assignment stored?

Same column. `patient_execution_cases.assignedTeamMemberId` (integer
referencing `outreach_schedulers.id`). PCS and ACS share the same
assignment column — the role/workspace distinction is purely
client-side.

### Q3. How is ACS assignment stored?

Same column as Q2. The assignment row carries no role hint; the
mapping back to "this is a PCS user" vs "this is an ACS user" is
through `users.role` once the scheduler is resolved to its `userId`.

### Q4. Which feed reads PCS assigned work?

- Canonical: `GET /api/scheduler-portal/cases` (legacy URL kept for
  back-compat, mounts `listSchedulerPortalCases`).
- The feed accepts `?assignedTeamMemberId=<integer>` as a filter but
  the shell does NOT currently pass it. **This is the PR B gap.**
- Facility scope still enforced via `resolvePhase1FacilityScope` +
  `requirePortalRole` (PR #280 Slice 1.2).

### Q5. Which feed reads ACS assigned work?

Same as Q4 for the Call List mode. For the Ancillary Schedule mode:
`GET /api/technician-liaison/ancillary-schedule`. For the Clinic
Schedule mode: `GET /api/technician-liaison/clinic-visits`. All three
endpoints honor `?viewAsTeamMemberId` and facility scope.

### Q6. Do both portals expose Call List AND Ancillary Schedule?

Yes — the `WorkspaceModeSwitcher` exposes all 3 modes uniformly and
the shell consumes all 3 feed helpers. The default differs (PCS →
`callList`, ACS → `clinicSchedule`), but the user can switch to any
mode. The brief says ACS default should be `ancillarySchedule`; the
current code uses `clinicSchedule`. **Flagged for product
confirmation** before changing.

### Q7. Which IDs must match for Anthony / Callista to see assigned patients?

The `outreach_schedulers.id` (integer) that Engagement writes to
`patient_execution_cases.assignedTeamMemberId` must match the
`outreach_schedulers.id` that the shell-side feed query filters
against. Today the shell does not query that filter. PR B closes
the gap by resolving the active user's (or the view-as user's)
`users.id` → `outreach_schedulers.id` and passing it as
`assignedTeamMemberId`.

### Q8. Role mapping table (admin / PCS / ACS / legacy)

| Public role | Internal role (legacy) | Default mode | Where defined |
|---|---|---|---|
| `admin` | n/a (sees all) | n/a | `users.role = "admin"` |
| `patientCareSpecialist` | `liaison` | `callList` | `ClinicWorkflowPortal.tsx:INTERNAL_ROLE` |
| `ancillaryCareSpecialist` | `technician` | `clinicSchedule` | same |
| `technician` (legacy) | `technician` | `clinicSchedule` | legacy direct mount |
| `liaison` (legacy) | `liaison` | `callList` | legacy direct mount |

Role mapping is preserved verbatim by the QA
`qa-team-portals-only-default-mode-differs.mjs`.

### Q9. Facility scoping behavior

Phase 1 Slice 1.2 contract is preserved:

- `requirePortalRole` middleware gates the team-portal feed
  endpoints.
- `resolvePhase1FacilityScope(req, res, q.facilityId, q.viewAsTeamMemberId, workspace?)`
  resolves the admin view-as override and validates the requested
  facility against `allowedFacilities(req)`.
- Non-admin missing facilityId → 400.
- Non-admin requesting an unassigned facility → 403.
- Admin pass-through (no view-as) → unfiltered.
- Admin view-as → narrows to the viewed-as user's allow-list (never
  `{ all: true }`).

PR B will reuse this exact scope check; no weakening.

### Q10. Patient Directory data path into center canvas

The center canvas (`PatientCommandCanvas`) consumes
`/api/portal/patient-command-center/:id` via
`fetchPatientCommandCenter`. The response shape includes:

- `cooldownTests`
- `communications` (call history + email log via
  `PatientCallHistoryPanel`)
- `documentReadinessRows`
- `billingReadinessChecks`
- ...etc.

**Gap flagged for PR B:** the canvas does NOT today fetch the
canonical Patient Directory snapshot (`getPatientDirectorySnapshot`)
which surfaces:

- DNC / cooldown reason
- duplicate warning facts
- prior ancillary warnings
- engagement history
- import / source history
- Admin Review history

The Patient Directory profile drawer (`PatientProfileDrawer`) lives
under `client/src/components/patient-directory/` and is currently
reachable only from the `/patient-directory` page, not from the
team-portal center canvas. PR B will wire it into the canvas (or
inline the warning facts via the existing
`useLiveDuplicateWarnings` hook) without creating a duplicate
Patient Directory route.

### Q11. Call result write path

Canonical, by default (Slice 1.4): `POST /api/engagement-center/call-results`.
Legacy: `POST /api/engagement-center/call-result` (kept behind
`LEGACY_CALL_RESULT_ROLLBACK` flag). Both routes share the same
server handler — byte-equivalent.

The write goes through:
- `DispositionSheet` (form) → `engagementCallResultEndpoint()`
  (UI flag) → POST.
- `CanonicalRowActions` → same endpoint.

After save: predicates invalidate `team-workspace-call-list` and the
other queue keys (PR #279 Slice 1.4). Verified in
`qa-team-portals-admin-viewas-routing.mjs` and
`qa-phase-1-patient-care-specialist-call-result.mjs`.

### Q12. LVM / callback / DNC / ready-to-schedule status path

These outcomes ARE first-class call-result `outcome` values today;
the dispatch table is in `DispositionSheet.tsx:OUTCOMES`. The
specific outcomes the brief lists (LVM, no_answer, callback, DNC,
declined, ready_to_schedule, scheduled) are present.

**Gap flagged for PR C:** verifying each outcome's downstream
routing (which writes to which audit table, which next-action
timer fires, which queue refilter happens). PR C will codify each
outcome → next-state contract via QA and add the
`smoke-phone-call-result-lifecycle.mjs` end-to-end smoke.

### Q13. Admin settings controlling next action

Admin settings system: `/api/admin-settings/*` (canonical). Used by
the workspace profile (`fetchTeamMemberProfile`) for facility allow-
list + service-type filtering today.

**Gap flagged for PR C:** LVM retry interval, no-answer retry
interval, max attempts before unable-to-reach — these may be
hardcoded in the call-result handler today (audit unverified). PR
C will read these from admin settings or document scaffold honestly.

### Q14. Scheduling write path

`POST /api/global-schedule-events/schedule-ancillary`
(`server/routes/globalSchedule.ts:248`) is the canonical
patient-specific scheduling write. It:

- Inserts a `global_schedule_events` row of type `ancillary_appointment`.
- Updates the execution case status.
- Appends a `patient_journey_events` row.
- Returns the new event id.

`SchedulePatientDialog` and `SchedulePatientPlayground` both call
through this path. `CanonicalRowActions.tsx` invalidates the workspace
ancillary-schedule key on success (PR #280 Slice 1.4 fix).

### Q15. Global schedule / facility schedule relationship

`global_schedule_events` is the single canonical schedule table.
There is **no separate facility-schedule table** today —
"facility schedule" is a derived view (events filtered by
`facility_id`). The Phase 1 inventory documents this as the
intentional single-source design.

### Q16. ACS consent / screening / report upload / document readiness path

| Workflow | Route | State |
|---|---|---|
| Consent signing | `POST /api/portal/sign-consent` (`server/routes/portal.ts:716`) | **Live** |
| Screening form | TBD per audit (gap flagged for PR C) | flagged |
| Report upload | `POST /api/portal/uploads` (multer + canonical fileStorage) | **Live** |
| Document readiness | `shared/schema/documentReadiness.ts` + `case_document_readiness` | **Live** (read-only on ACS workspace) |
| Order note / procedure note | `generated_notes` + `procedure_notes` schema | **Live** (per Phase 1 Slice 1.7 audit) |
| Physician signing | (no `/api/portal/sign-order` route) | **Scaffold** — Phase 2 |
| Billing readiness | `shared/schema/billingReadiness.ts` + checks | **Live** (read-only on ACS workspace) |

PR C will add `qa-acs-*.mjs` scripts proving each is wired or
honestly scaffolded.

### Q17. What is live?

- Phase 1 Slices 1.0–1.7 (hygiene, portal feeds, facility scoping,
  admin-review surface, canonical call-result default, Patient
  Directory single-source, rule-engine clinical mapping).
- Admin view-as (PR #280).
- Shared left tools rail with Calendar / Email / Marketing /
  Documents / Patient Search / Tasks / Templates (PRs #281 + #282).
- Email backend (Live, requires SMTP env).
- Document Library backend.
- Marketing materials backend.
- Patient Directory page at `/patient-directory`.
- Engagement Center assignment board.
- Canonical call-result writeback (with rollback flag).
- Scheduling write (`/api/global-schedule-events/schedule-ancillary`).
- Consent signing.
- Report upload.

### Q18. What is scaffold?

- Physician order signing route (no `/api/portal/sign-order` —
  documented in Phase 1 Slice 1.7).
- Quick Note left-rail tool (documented Deferred to Phase 2 — no
  canonical patient-note writer).
- Internal Contacts left-rail tool (documented Deferred — no
  canonical contacts source).
- LVM retry timer / max-attempts admin settings (audit TBD in PR C).
- Reschedule / cancel / no-show schedule states (audit TBD in PR C).
- Patient Directory warning facts in center canvas (PR B will wire).

### Q19. What is deferred to Phase 2?

- Wrap Admin Review commit fan-out in a single DB transaction.
- Physician-order signing.
- Billing-readiness write workflow on PCS / ACS workspaces.
- ACS document / signing / billing handoff inline UI.
- Quick Note + canonical patient-note writer.
- Internal Contacts + canonical contacts schema.
- Communication-log auto-write after Email Composer send.

### Q20. What is deferred to Phase 6 integrations?

- Live RingCentral phone events (dormant today; flag-gated).
- SMS / Text send (button disabled with honest label today).
- Insurance eligibility partners.
- EHR adapters.
- Drive-backed marketing materials (current in-code catalog).

### Q21. QA results (PR A)

| Script | Status |
|---|---|
| `qa-team-portals-both-have-call-list-and-ancillary-schedule.mjs` | passes |
| `qa-team-portals-only-default-mode-differs.mjs` | passes |
| `qa-no-scheduler-portal-product.mjs` | passes |
| `qa-no-mission-control-anywhere.mjs` | passes |
| `qa-ringcentral-dormant-honesty.mjs` | passes |
| `qa-no-fake-completed-states-in-team-portal.mjs` | passes |
| `qa-patient-directory-belongs-in-center-canvas.mjs` | passes |

Plus 261 pre-existing QA scripts also pass.

### Q22. Smoke results (PR A)

PR A adds no new smokes (it is an audit + boundary-QA PR). All 8
pre-existing smokes still pass (incl.
`smoke-phase-1-full-system-wiring.mjs` and
`smoke-team-portal-left-tools-rail.mjs`).

---

## D — What does NOT change in PR A

This is an **audit + boundary QA + mode contract** PR. Runtime
behavior is intentionally unchanged. Specifically:

- **No new routes** added.
- **No schema changes**.
- **No call-result, scheduling, or consent route handler edits**.
- **No PCS/ACS layout redesign**.
- **No change to `DEFAULT_MODE`** (ACS still defaults to
  `clinicSchedule`; if the product confirms `ancillarySchedule`,
  that's a one-line change in PR B / C or a follow-up).
- **No change to the engagement assignment column type** (it
  remains `integer → outreach_schedulers.id`).
- **PR #278 premium UI**: untouched.

PR B will land the Engagement → PCS/ACS feed wiring + Patient
Directory canvas wiring fixes. PR C will land the call-result
lifecycle + scheduling + ACS workflow.

---

## E — Branch / PR plan

| PR | Branch | Status |
|---|---|---|
| PR A (this) | `fix/team-portal-operations-runtime-audit` | open after this commit |
| PR B | `fix/team-portal-operations-runtime-wiring-engagement-and-directory` | pending PR A merge |
| PR C | `fix/team-portal-operations-runtime-wiring-call-result-and-acs` | pending PR B merge |

Validation script for each PR:
```
npm run check
npm run build
for s in scripts/qa-*.mjs; do node "$s" || exit 1; done
node scripts/smoke-team-portal-left-tools-rail.mjs
node scripts/smoke-team-portals-admin-viewas-routing.mjs
node scripts/smoke-phase-1-full-system-wiring.mjs
```

All three must remain green at the close of every PR in the series.
