# Team-member assignment terminology contract

**Status:** Docs-only (Batch D). No code change. No DB rename. No migration.
**Date:** 2026-06-10.
**Scope:** Pin the terminology + migration-safety rules every future PR in the engagement / call-list / work-assignment surface MUST respect, so the legacy "scheduler" naming inside tables/routes/columns does not propagate into product-facing UI, contracts, or new code paths.
**Cross-references:**
- `engagement-call-list-canonicalization-contract.md` (Batch A).
- `team-portal-playground-wiring-contract.md` §2 (Bundle 11 — team-member roles).
- `team-portal-runtime-wiring-readiness-checklist.md` (Bundle 54).
- `do-not-touch.md`, `protected-flows.md`.

This contract introduces zero runtime code. It defines the terms every adjacent PR will use.

---

## 1. Product terms vs legacy terms

### 1.1 Legacy / internal implementation terms (DB + code as-is)

These names appear in the database, in route paths, in column names, and in service files. They are LEGACY and MUST NOT be renamed without a separately-approved migration plan.

- **`scheduler_assignments`** (table) — the day-of work-assignment table.
- **`schedulerAssignments`** (TypeScript table identifier from `shared/schema/outreach.ts`).
- **`schedulerId`** (column on `scheduler_assignments`) — references `outreach_schedulers.id`.
- **`originalSchedulerId`** (column on `scheduler_assignments`).
- **`outreach_schedulers`** (table) — the legacy team-member-with-capacity table.
- **`/api/scheduler-assignments`** (route path) — read + rebuild + redistribute.
- **`/scheduler-portal`** (client-side path).
- **"Scheduler Portal"** (legacy surface name).
- **"scheduler"** as a string identifier or label.

When these names appear in code, the reader should treat them as **legacy implementation language**.

### 1.2 Product terms (new code + contracts + UI)

- **Team Member** — the human a call/work assignment is given to.
- **Patient Care Specialist (PCS)** — a role / capability profile a Team Member may hold.
- **Ancillary Care Specialist (ACS)** — a role / capability profile a Team Member may hold.
- **CallListAssignment** — the product concept that maps to a row in `scheduler_assignments`. One day-of assignment of one patient to one Team Member.
- **TeamWorkAssignment** — the broader work concept that includes call-list assignments and other actionable work surfaces (plexus tasks, ancillary follow-ups, etc.). One row may project from multiple legacy sources.
- **Team Portal** — the team-member operating surface (per Bundle 11 §5).

PCS and ACS are PROFILES on top of the Team Member concept. Both PCS and ACS may receive CallListAssignment / TeamWorkAssignment rows; capability profile + facility scope + RBAC decide which assignments each Team Member is eligible for.

---

## 2. Mapping rules

When a new contract / module / fixture / type definition references the day-of assignment table, the following mapping applies:

| Product field | Legacy source |
|---|---|
| `callListAssignment.id` | `scheduler_assignments.id` |
| `callListAssignment.legacySchedulerAssignmentId` | `scheduler_assignments.id` (same value, alias for migration tracking) |
| `callListAssignment.assignedTeamMemberId` | derived from `scheduler_assignments.schedulerId → outreach_schedulers.userId` (string user id) |
| `callListAssignment.legacySchedulerId` | `scheduler_assignments.schedulerId` (numeric legacy id) |
| `callListAssignment.originalAssignedTeamMemberId` | derived from `scheduler_assignments.originalSchedulerId → outreach_schedulers.userId` |
| `callListAssignment.legacyOriginalSchedulerId` | `scheduler_assignments.originalSchedulerId` |
| `callListAssignment.asOfDate` | `scheduler_assignments.asOfDate` |
| `callListAssignment.status` | `scheduler_assignments.status` |
| `callListAssignment.source` | `scheduler_assignments.source` |
| `callListAssignment.reason` | `scheduler_assignments.reason` |
| `callListAssignment.assignedAt` | `scheduler_assignments.assignedAt` |
| `callListAssignment.completedAt` | `scheduler_assignments.completedAt` |

Future shared contracts SHOULD use the product names on the LEFT. Legacy `legacySchedulerAssignmentId` / `legacySchedulerId` / `legacyOriginalSchedulerId` MAY appear ONLY as alias / migration-tracking fields. The Drizzle table identifier (`schedulerAssignments`) stays unchanged.

Similarly for the broader work concept:

| Product field | Legacy source |
|---|---|
| `teamWorkAssignment.id` | composite id (`pt:<n>` / `sa:<n>` from `TeamTask`) |
| `teamWorkAssignment.ownerType` | TeamTask.ownerType |
| `teamWorkAssignment.assignedTeamMemberId` | the same derivation as `callListAssignment.assignedTeamMemberId` for sa rows; `plexus_tasks.assignedToUserId` for pt rows |
| `teamWorkAssignment.legacyOwnerId` | TeamTask.ownerId (numeric) |

---

## 3. Rules every future PR MUST follow

1. **DB tables are not renamed.** `scheduler_assignments`, `outreach_schedulers`, `schedulerId`, `originalSchedulerId` stay. Drizzle table identifiers (`schedulerAssignments` from `shared/schema/outreach.ts:75-103`) stay.
2. **Migrations are out of scope** for any safe bundle / canonicalisation work. A future migration plan ships in its own approved PR.
3. **New code uses product names** at the type-contract layer. `shared/contracts/callListAssignment.ts` (path reserved; not created here) will define the product shape; consumers import from there, not from `shared/schema/outreach.ts`.
4. **Legacy field aliases** are allowed in product contracts ONLY as `legacy*` mapping fields (per §2). No product contract may name a field literally `schedulerId` or `originalSchedulerId` at the top level.
5. **UI labels never display "scheduler"** for the role of PCS or ACS. UI surfaces show "Team Member", "Patient Care Specialist", or "Ancillary Care Specialist".
6. **Route paths stay as they are.** `/api/scheduler-assignments`, `/scheduler-portal` continue to exist; a future PR may add additive product-facing aliases (e.g. `/api/team-portal/call-list`) but MUST NOT remove the legacy paths.
7. **Audit + log lines stay byte-stable.** Existing journey-event eventSource / eventType strings continue to use the existing values; new event types may reference "team_member_*" but legacy event types are NOT renamed.
8. **No automated rewrite of "scheduler" → "team member" in existing code.** Doing so risks silently changing semantics; the wrapping happens at the new product-contract layer, not by find-and-replace.

---

## 4. When a new product contract introduces the mapping

A future contract that wants to expose CallListAssignment / TeamWorkAssignment MUST:

- Live under `shared/contracts/` and be type-only (no Drizzle runtime imports).
- Define the legacy mapping fields explicitly per §2.
- Include a header comment naming the legacy source (`shared/schema/outreach.ts:75-103`).
- Ship behind a dormancy invariant (matching Bundle 19 / 23 / 27 / 34 / 46 / 47 patterns) so non-consuming code paths do not adopt the contract silently.

---

## 5. UI label rules

Any UI surface that renders a Team Member's role:

- MUST render `Patient Care Specialist` or `Ancillary Care Specialist` (the role labels).
- MUST NOT render the string `Scheduler` as the role label for a PCS or ACS.
- MAY render "Scheduler Portal" as the **page title** for the legacy `/scheduler-portal` route until that route is renamed (separate future PR).
- MAY render team-member display names (e.g. from `outreach_schedulers.name`) without prefacing them with a role title.

The Team Portal Shell (`client/src/components/portal/TeamPortalShell.tsx`) already uses `patientCareSpecialist` / `ancillaryCareSpecialist` as the canonical workspace-role enum (line 52-55 of that file). This contract pins that pattern.

---

## 6. Migration-safety rules

If a future PR proposes a DB rename in this surface:

1. It MUST be a dedicated migration PR — NOT bundled with feature work.
2. It MUST ship a Drizzle migration file under `migrations/`.
3. It MUST preserve byte-identical data — the rename is a column/table rename, not a schema change.
4. It MUST add a backward-compatible read layer that accepts both the legacy name AND the new name during the cutover window.
5. It MUST flag-gate the cutover with default OFF on production.
6. It MUST include a rollback migration (rename back).
7. It MUST pass every existing `scripts/qa-*.mjs` script before AND after the rename.

This contract does NOT propose the rename. It pins the safety rules so that when the rename PR eventually ships, it cannot bypass them.

---

## 7. Stop conditions for any PR in this terminology surface

A future PR MUST stop and ask if:

1. It would rename `scheduler_assignments`, `outreach_schedulers`, `schedulerId`, or `originalSchedulerId` in the live schema without the §6 safety plan.
2. It would change route paths under `/api/scheduler-assignments` or `/scheduler-portal` in a breaking way.
3. It would rename existing journey-event eventSource or eventType strings.
4. It would do a project-wide find-and-replace of "scheduler" → "team member" in source code.
5. It would surface "Scheduler" as a role label for a PCS or ACS in UI.
6. It would expose `schedulerId` at the top level of a new product-facing contract.

---

## 8. Non-promises

- No commitment that the DB tables will be renamed.
- No commitment that the legacy routes will be retired.
- No commitment that the legacy event types will be renamed.
- No commitment to a specific product contract module path (the `shared/contracts/callListAssignment.ts` path is reserved, not promised).
- No UI redesign tied to this contract.

End of contract.
