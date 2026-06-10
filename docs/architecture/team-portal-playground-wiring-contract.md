# Team Portal + Playground Wiring Contract

**Status:** Docs-only (Bundle 11). No runtime change. No source code modified.
**Date:** 2026-06-09.
**Branch of record:** `architecture/team-portal-playground-wiring-contract`.
**Author:** Architecture orchestrator (Dr. Ali Imran, Noorhan Medical).
**Related docs:**
- `full-21-batch-orchestrator-review.md` (program of record)
- `protected-flows.md` (working flows that must not regress)
- `do-not-touch.md` (hard-stop file list)
- `operational-queue-design.md`, `operational-queue-call-list-projection-design.md` (Batch 11 read-models)
- `team-task-spine-design.md` (Batch 11 unified task shape)
- `execution-case-state-machine.md` (Batch 10 spine)
- `journey-event-standardization-design.md` (Batch 12 audit spine)
- `patient-directory-design.md` (Batch 5 read-side helpers)
- `pdf-protection-contract.md` (Batch 9 packet protection)

This document is a **contract**, not a roadmap. Every claim is verifiable against the files cited inline. PRs that touch Team Portal or Playground wiring must reference §-numbers from this contract in the PR description; PRs that violate any rule below MUST be paused for explicit approval, not merged.

This contract does NOT prescribe schedules, sprint plans, or runtime cutovers. It defines the rules new code must obey when wiring portals to the read-models that already exist in the tree.

---

## 1. Purpose and scope

**Purpose.** Bind the Team Portal surfaces and the Command-Center Playground to the canonical read-models already added by Batches 5, 10, 11, 12, and 13 (`server/modules/{patient-directory, execution-cases, operational-queue, journey-events, team-tasks, engagement-board}/`). Today those modules are dormant — no portal reads through them. This contract specifies how future PRs may wire them in safely.

**In scope.**
- Read paths from portals/Playground into the canonical modules.
- Visual rules separating side panels (clinical/EMR feel) from the Playground canvas (pencil-on-blank-paper feel).
- RBAC envelope for team-member surfaces.
- Cutover order behind feature flags.

**Out of scope.**
- Admin Review approval, commit, qualification logic, AI prompts, model IDs.
- PDF / patient-packet generation behavior (`client/src/lib/pdfGeneration.ts`, `client/src/lib/pdfPacketGrouping.ts`).
- Billing money: claim calculation, remittance, projected invoices, completed billing packages.
- Mutation paths: assignment writes, scheduler assignments, admin-approval POSTs.
- Migrations, schema renames, table additions.
- AWS production cutover.

Hard-stop areas above remain governed by `do-not-touch.md` and the matching contracts (`pdf-protection-contract.md`, `billing-cleanup-design.md`).

---

## 2. Team member roles

Two canonical roles exist in code today:

- **`patientCareSpecialist`** (PCS) — clinical engagement of the patient. Outreach, scheduling, consent, day-of follow-up.
- **`ancillaryCareSpecialist`** (ACS) — procedure-side execution. Test prep, procedure completion, document upload, ancillary follow-ups.

Source of record: `client/src/components/portal/TeamPortalShell.tsx:52-55` (the `workspaceRole` union) and `TeamPortalShell.tsx:803` (the ACS branch). The roles are persisted on the user via `/api/admin-settings/effective` keyed by `("team_member", "workspace_profile", currentUserId)` — see `TeamPortalShell.tsx:843-859`.

Both roles share one shell (`TeamPortalShell`), one auth surface, one calendar, one document library, and one task queue. Role gates filter the visible columns and the available actions, not which shell loads.

Legacy roles (`technician`, `liaison`) MAY appear in stored profiles. Treat them as ancillary-care-specialist for read-side resolution; do not migrate stored values in any contract-bound PR.

---

## 3. Patient Care Specialist workflow

A PCS opens `TeamPortalShell` and lands on the day's clinic schedule. Their working loop is:

1. Open today's **call list** for an assigned facility/date (`/api/scheduler-portal/cases`, see `TeamPortalShell.tsx:1017-1037`).
2. Pick a patient row → open the per-patient panel → optionally promote to **Playground** for cross-tab work.
3. Run outreach / consent / scheduling actions through the panel's existing handlers (no contract-bound change to those handlers in this batch).
4. Append a journey event for every operational action (existing route, see `journey-event-standardization-design.md`).
5. Hand the patient to ACS when procedure-day prep begins. Hand-off is observable via the engagement-board row (`server/modules/engagement-board/contracts.ts`).

PCS surfaces consume the **operational-queue** read-model with `itemKind ∈ {call_list_item, scheduler_task, global_calendar_event}` (`server/modules/operational-queue/contracts.ts:OPERATIONAL_QUEUE_ITEM_KINDS`). PCS surfaces do not need `visit_appointment` rows.

---

## 4. Ancillary Care Specialist workflow

An ACS opens the same `TeamPortalShell`. The shell selects the ACS profile via `workspaceRole === "ancillaryCareSpecialist"` (`TeamPortalShell.tsx:803`). Their working loop is:

1. Open today's **ancillary schedule** for an assigned facility/date (`workspaceAncillarySchedule` query, `TeamPortalShell.tsx:1055-1063`).
2. Pick a procedure row → open per-patient panel → optionally promote to Playground.
3. Run procedure-side actions through the panel's existing handlers (procedure-complete, document upload, consent sign).
4. Append a journey event for every operational action.
5. Hand the patient back to PCS or to billing/operational follow-up via the existing engagement-board route — billing money paths remain untouched.

ACS surfaces consume the operational-queue read-model with `itemKind ∈ {visit_appointment, scheduler_task}`. The schedule view filters by `ownerType === "ancillary_appointment"`.

---

## 5. Team Portal as the only employee operating system

There is exactly one shell for team-member work: **`TeamPortalShell`** (`client/src/components/portal/TeamPortalShell.tsx`). No new top-level "employee app" surface may be introduced under this contract — additions land as panels inside the shell or as Playground bodies promoted from those panels.

`PortalShell` (`client/src/components/portal/PortalShell.tsx`) is the legacy/role-agnostic precursor and remains in place for back-compat. Contract-bound PRs:
- MAY add hooks/queries that are reused by both `PortalShell` and `TeamPortalShell` (extracted under `client/src/hooks/api/`, matching Batch 4's pattern).
- MUST NOT add a new sibling shell.
- MUST NOT delete `PortalShell` until a separately approved deprecation PR ships with parity tests.

Routing: `TeamPortalShell` owns `/team-portal` and the role-aware deep links. Playground is a child of the shell's center-mode owner (see §7); it has no standalone route.

---

## 6. Side panels remain clinical / EMR-like

Side panels overlay the shell layout (left rail, right rail, modal-style center popovers) and represent the existing patient-record interaction. Their look-and-feel is **explicitly clinical / EMR-like** and is preserved by this contract:

- Existing portal colors (clinical bluish accents, slate-tinted neutrals) remain.
- Existing panel chrome (Card, Dialog, Tabs, Select primitives from `@/components/ui/*`) remains.
- Panels MAY overlay the Playground canvas; the canvas does not change color or texture when a panel opens.
- Panels are the surface where mutations happen (outreach handlers, document upload, consent sign). The Playground itself is read-side surface.

Source of truth for the panel visual surface: existing `PortalShell.tsx` + `TeamPortalShell.tsx` markup. Contract-bound PRs may not restyle panel chrome.

---

## 7. Playground center canvas rules

The Playground is the **center canvas** when `centerMode === "playground"` and a `PanelPlaygroundContext` is set (see `client/src/features/command-center/playground/CommandPlayground.tsx:26-30`). The contract for what may appear inside that canvas:

- The canvas renders the body matched by `playgroundContext.componentType` (the dispatch is `CommandPlayground.tsx:44-65`). New body types MUST extend `PANEL_PLAYGROUND_COMPONENT_TYPES` in `client/src/lib/playground/panelPlaygroundContext.ts:22-30` and add a matching `as const` entry — not a parallel registry.
- The canvas treats read-models (operational-queue, engagement-board, team-tasks, execution-cases) as **snapshot inputs**. The canvas may re-query for freshness but MUST NOT issue mutations. Mutations originate from panels.
- A patient promoted into the Playground from a call-list row passes its identity via `PanelPlaygroundContext.patientUuid` / `patientName` / `patientDob` so the Playground does not re-fetch identity from a different source — eliminating dual-source drift.

The Playground center canvas is forbidden from carrying any of the data listed in §22.

---

## 8. Blank white canvas, no grid

The Playground canvas background is **blank white**. Specifically:

- No grid background. No dot-grid. No ruled lines.
- No paper texture image.
- No colored fills behind the canvas root.
- Edge gradients/shadows from the surrounding shell are allowed (they are part of the shell chrome) but they do not encroach onto the canvas surface.

Rationale: the Playground is intended to feel like a **premium blank sketchbook / architect concept board** — the absence of a grid is the visual signature that distinguishes it from the panel/EMR surfaces. Future canvas helpers (e.g., snap-to-baseline) MAY exist as a tooling layer above the surface but MUST NOT add visible grid lines.

---

## 9. Existing portal colors preserved

The Team Portal's existing color tokens (slate/indigo clinical palette, status accents on summary cards) remain unchanged by this contract. The Playground does not introduce a new palette — it introduces an **absence**: white background + dark pencil ink. Color in the Playground appears only via:

- Existing accent colors used by panels overlaying the canvas (these read as overlays, not as canvas content).
- Status chips inherited from `engagement-board` / `operational-queue` rows when those rows are rendered as objects on the canvas (see §10) — the chip's color comes from its semantic state, not from a new design token.

No contract-bound PR may introduce a new shared color token under the guise of "Playground style".

---

## 10. Pencil/sketch object rules inside Playground only

Every object the Playground places on its canvas — patient tabs, workspace modules, task tiles, chat bubbles, connectors, annotations, sticky-note callouts — is drawn in a **pencil/sketch visual language**. Rules:

- The visual language applies **only inside the Playground canvas root**. Panels and shell chrome are unaffected.
- Object borders read as hand-drawn pencil strokes (slightly uneven weight, dark graphite color).
- Object fills are off-white / paper-white. No saturated panel-style backgrounds.
- Connectors between objects are pencil arcs/lines, not vector-perfect straight lines.
- Object shadow is minimal pencil shading; no Material-style elevation.
- When a patient is promoted from a call-list panel, the Playground renders a **patient tab object** with the Patient Directory canonical view (§12) inside it, organized like an EMR section list (Demographics, Encounters, Procedures, Documents, Journey) but rendered in the pencil canvas style. The structure is EMR-like; the surface is sketchbook.

The above applies **only** to objects placed on the canvas. Modal dialogs that overlay the canvas remain in the panel/EMR visual language.

---

## 11. Black-pencil lettering requirement for Playground objects

Text rendered inside Playground canvas objects (titles, labels, body copy, chip text, connector annotations) MUST read as **refined black pencil lettering**. Concretely:

- Color: dark graphite (near-black) only. No status hues for text content.
- Weight: regular / medium; no heavy bold blocks.
- Texture: subtly hand-drawn (e.g., a hand-written-style typeface or a refined sans with a sketch filter). The choice of typeface is owned by the design pass, not this contract — but the contract pins the *intent*: black pencil, refined, never marker-like.
- Status color (badge backgrounds, semantic chips) is allowed as a small accent inside an object; the **letters** stay graphite.

This rule overrides default text-color tokens **only within the canvas root**. The same labels rendered inside a panel keep the panel's existing typography.

---

## 12. Patient Directory wiring

Source module: `server/modules/patient-directory/` (Batch 5, PR #65). The module exposes read-only helpers (`getCanonicalPatientByScreeningId`, `listCanonicalPatients`) computed from `patient_screenings` grouped on `(lower(name), dob, facility)`.

Wiring contract:

- Portals and Playground objects that show "patient identity" MUST resolve through `getCanonicalPatientByScreeningId(screeningId)` once the helper is exposed via a flag-gated additive endpoint — **never** by re-querying `patient_screenings` directly from the portal.
- Until that additive endpoint exists, existing portal code paths remain in place; no in-place rewrite of identity lookups is allowed by this contract.
- The cutover lives behind a feature flag analogous to `USE_OPERATIONAL_QUEUE_CALL_LIST` (PR #80) — see §23 for the safe sequence.
- No new write paths. The Patient Directory helpers are read-only.

---

## 13. Operational Queue wiring

Source module: `server/modules/operational-queue/` (Batches 11a–11d, PRs #70, #75, #76, #80). The module unifies four sources into one `OperationalQueueItem` view (`OPERATIONAL_QUEUE_ITEM_KINDS = ["call_list_item", "scheduler_task", "visit_appointment", "global_calendar_event"]`).

Wiring contract:

- `TeamPortalShell` call-list, clinic-schedule, and ancillary-schedule queries (`TeamPortalShell.tsx:1017-1063`) are the eventual consumers.
- Adoption is **shadow-read first**: the existing query stays primary; the operational-queue query runs in parallel under `USE_OPERATIONAL_QUEUE_CALL_LIST` (existing flag from PR #80) and its rows are diff-asserted against the legacy response.
- Flip the flag default only after the parity test (`server/modules/operational-queue/__tests__/`) is green for ≥ one calendar week of staging traffic. This contract does not set the date.
- Mutations remain on the legacy assignment endpoints. The operational-queue module is read-only.

The projection design lives in `operational-queue-call-list-projection-design.md` (PR #88). This contract does not re-derive that design — it binds future portal PRs to it.

---

## 14. Team Task wiring

Source module: `server/modules/team-tasks/` (Batch 11, PR #64). Defines `TeamTask` as a unified view across `plexus_tasks` and `scheduler_assignments` with a composite `id` (`pt:<n>` / `sa:<n>`) to avoid numeric collisions across the two source tables.

Wiring contract:

- Task surfaces inside Team Portal (today: `/api/portal/my-tasks` flow per `TeamPortalShell.tsx:1138-1139` and the tasks tab in the panel) MUST read through the `TeamTask` shape once an additive endpoint exposes it — never through both source tables in the same UI surface.
- The composite `id` is the only stable identifier; portal code MUST NOT split it back into source-table primary keys outside the team-tasks repo layer.
- Mutations to either source table remain on their existing routes.

---

## 15. Execution Case wiring

Source module: `server/modules/execution-cases/` (Batches 10/12, PR #73). State machine spec: `docs/architecture/execution-case-state-machine.md`.

Wiring contract:

- Portal surfaces that display engagement state (the engagement-board row, the patient's commit/qualification status) read the **execution-case row** as the source of truth — not derived screening flags. This is unchanged from current code; the contract pins it.
- Promoting a patient to Playground passes the execution-case id where available so the Playground renders the same state the panel did, not a re-derived state.
- No state-machine transitions originate from the Playground. Transitions remain on existing mutation routes (admin-approval, commit, engagement-board POSTs).

---

## 16. Journey Event / audit wiring

Source module: `server/modules/journey-events/` (Batches 10/12, PR #73). Typed writer: `appendJourneyEvent` (PRs #78, #79).

Wiring contract:

- Every operational action initiated from a Team Portal panel MUST append a journey event via the typed writer, with `actorUserId` set to the team member's user id.
- Playground itself does not append journey events directly — it triggers a panel action that does.
- Audit is append-only. No portal PR may delete or back-date a journey event.

---

## 17. Patient Packet wiring

Source: `client/src/lib/pdfGeneration.ts`, `client/src/lib/pdfPacketGrouping.ts`. Protection contract: `pdf-protection-contract.md` (Batch 9, PR #63).

Wiring contract:

- The Team Portal panel surface MAY surface existing packet entry points (`openPatientPacketPrintPreview`, `openSchedulerPacketPrintPreview`) via the existing button placements. No new packet generator may be added.
- The Playground canvas MUST NOT render packet content as a canvas object. A click that requests a packet opens the existing print-preview window.
- No change to the data source feeding the packet. No change to the packet markup. This is a hard-stop region — see `pdf-protection-contract.md`.

---

## 18. Communication / chat wiring

Today's Team Portal does not ship an in-product chat surface. This contract anticipates one:

- Chat MUST land as a panel (right rail) and as Playground sketch-style chat-bubble objects, never as a standalone shell.
- Chat data MUST live in a dedicated table addressed by an additive endpoint — not in `patient_journey_events` or `plexus_tasks`.
- Chat MUST be scoped per the RBAC envelope (§21) — team members see threads they are participants in; admins do not see all employee chats by default.
- This contract does NOT design the chat schema. A separate design doc owns that. This contract only fixes the surface rules so a future chat PR cannot leak chat into the journey-event audit spine.

---

## 19. Admin announcements

Admin-originated announcements are read-only inside the Team Portal:

- Surface: a panel (top of shell or notification rail). Not a Playground object.
- Source: a dedicated `admin_announcements` table reached via an additive endpoint. Not `patient_journey_events`. Not `plexus_tasks`.
- Lifecycle: announcement create/edit/delete is an Admin-only surface and is out of scope for this contract.
- RBAC: visible to all authenticated team members in scope; not redacted by patient/facility.

---

## 20. Time-off / request workflow

Existing PTO surface: `server/routes/pto.ts`. Approval flow already lives there. Wiring contract:

- Team-member submit + status views render inside the Team Portal as panels.
- Approval surface remains on the manager surface (not in the Team Portal). The Team Portal MAY surface a "request submitted / approved / denied" status panel, but it MUST NOT expose other employees' PTO rows unless the viewer is the manager.
- PTO redistribution (e.g., re-routing assignments when PTO is approved) remains in the existing pipeline (`pto.ts:97-127`). No portal PR alters that pipeline under this contract.

---

## 21. RBAC / security boundaries

Authoritative role and identity source: `/api/auth/me` (see `TeamPortalShell.tsx:831-838`) + the admin-settings workspace profile (`TeamPortalShell.tsx:843-859`).

Rules for any portal PR:

- **Team-member portal surfaces NEVER reveal other team members' work product** unless the viewer holds a manager role. Examples: another scheduler's call list, another tech's task list, another employee's PTO.
- **Facility scoping**: portal queries MUST be scoped by `/api/portal/my-facilities` (`TeamPortalShell.tsx:820-825`). A team member assigned to Facility A does not see Facility B data even if the row would otherwise match their role.
- **PHI minimization**: portal-side logs and any new analytics events MUST use the PHI-safe logger (`server/lib/phiSafeLogger` contract, Bundle 8, PR #89). No raw patient names, DOBs, or MRNs in log output.
- **Mutation auth**: every mutation route the portal calls remains responsible for its own auth. The portal cannot widen access by composing read endpoints.
- **Playground identity**: a Playground promotion that carries `patientUuid` MUST NOT reveal a patient the user couldn't otherwise read from the originating panel.

---

## 22. Data that must never appear in Team Portal

The following data classes are explicitly out of bounds for Team Portal surfaces and the Playground canvas:

- **Financial data of any kind** — claim amounts, projected invoices, completed invoices, line-item dollar values, payment status, revenue share, contract terms, company-level financial summaries.
- **Admin-only audit** — admin announcement edit history, admin approval reasoning notes intended for compliance, raw audit-log dumps.
- **Cross-team employee records** — other employees' PTO history (except for managers), payroll data, performance review notes.
- **Patient PHI outside the viewer's facility scope** — see §21.
- **Raw ICD codes in patient-facing or operator-facing summaries** — preserves the existing PDF rule (`pdf-protection-contract.md`).

A portal PR that surfaces any of the above is non-compliant with this contract and MUST be paused.

---

## 23. Safe cutover sequence

For every wiring listed in §12–§16, the safe sequence is the same:

1. **Read-only module exists** (already true for §12–§16; see the source-module references).
2. **Additive endpoint** added alongside the existing route. Same auth. Returns the canonical-module shape.
3. **Shadow-read** behind a feature flag. The legacy endpoint remains primary. The shadow runs in parallel and logs a diff against the legacy response.
4. **Parity test** under `server/modules/<module>/__tests__/` asserts shape + content equivalence on a representative input.
5. **Flag flip** to make the canonical-module endpoint primary, with the legacy endpoint as fallback for one release.
6. **Legacy retirement** PR removes the old endpoint *after* the canonical endpoint is primary for at least one full release cycle and the parity test is green.

This contract does not set timelines for steps 5 and 6. Each is its own PR with its own approval.

The flag pattern of record is `USE_OPERATIONAL_QUEUE_CALL_LIST` (PR #80) — new flags follow the same naming and gating style.

---

## 24. Stop conditions before runtime wiring

A wiring PR MUST stop and request explicit approval if any of the following is true:

- The PR would edit a file listed in `do-not-touch.md`.
- The PR would change a request or response shape on an existing route (only additive endpoints are allowed).
- The PR would introduce a mutation path from the Playground canvas.
- The PR would surface any data class listed in §22.
- The PR would flip a feature-flag default without a green parity test for ≥ one full release cycle on staging.
- The PR would remove a legacy endpoint that is still consumed elsewhere in the tree.
- The PR would touch Admin Review approval/commit, qualification, PDF/packet, billing money, or migrations.
- The PR cannot ground a visual claim against an actual file/line in the tree.

---

## 25. QA / regression requirements

A wiring PR must satisfy, at minimum:

- `npm run check` — clean.
- `npm run build` — clean.
- All `scripts/qa-*.mjs` scripts pass (the list in §15 of `full-21-batch-orchestrator-review.md`).
- `scripts/qa-docs-architecture-integrity.mjs` recognises any new architecture doc the PR adds (an additive `info()` entry per the script's own pattern).
- For shadow-read PRs: a parity test under `server/modules/<module>/__tests__/` that asserts shape + content equivalence for a representative input.
- Manual checklist: open Team Portal in PCS mode, ACS mode, and Playground; confirm no regression to the working flows enumerated in `protected-flows.md`.

A wiring PR is NOT required to ship a UI redesign of panels — panel visuals are governed by §6, not by this checklist.

---

## Appendix A — File and module index

| Surface | File | Line anchors |
|---|---|---|
| Legacy portal shell | `client/src/components/portal/PortalShell.tsx` | 1–1816 |
| Team portal shell (canonical) | `client/src/components/portal/TeamPortalShell.tsx` | role enum 52–55; ACS branch 803; workspace profile 843–859; call list 1017; clinic schedule 1039; ancillary schedule 1055; tech-tasks ensure 1138 |
| Playground dispatch | `client/src/features/command-center/playground/CommandPlayground.tsx` | 26–65 |
| Playground context types | `client/src/lib/playground/panelPlaygroundContext.ts` | SOURCES 13–19; COMPONENT_TYPES 22–30; isPanelPlaygroundContext 51– |
| Patient Directory module | `server/modules/patient-directory/` | Batch 5 |
| Execution Case module | `server/modules/execution-cases/` | Batches 10/12 |
| Operational Queue module | `server/modules/operational-queue/` | Batches 11a–11d |
| Team Task module | `server/modules/team-tasks/` | Batch 11 |
| Journey Events module | `server/modules/journey-events/` | Batches 10/12 |
| Engagement Board module | `server/modules/engagement-board/` | Batch 13 / Bundle 5 |
| Cutover flag pattern | `server/modules/operational-queue/call-list-flag.ts` | Batch 11d |

---

## Appendix B — Non-goals

This contract is not:

- A roadmap. Sequencing decisions live in `full-21-batch-orchestrator-review.md`.
- A design document for any single module. Those exist per module under `docs/architecture/`.
- A UI spec. Visual rules (§6–§11) bind intent; final typography, stroke weights, and ink color tokens are owned by the design pass.
- An auth specification. RBAC details (§21) reference the existing auth surface; new auth design is out of scope.
- A schema proposal. No new tables proposed here.
