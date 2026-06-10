# Playground design-system — implementation plan

**Status:** Docs-only (Bundle 32). No UI source code added. No CSS added. No design tokens added.
**Date:** 2026-06-09.
**Purpose:** Translate the visual contract pinned in `team-portal-playground-wiring-contract.md` §6–§11 into a sequenced implementation plan a future UI PR can execute one step at a time, with QA checkpoints between every step.

**Cross-references:**
- `team-portal-playground-wiring-contract.md` (Bundle 11 — visual contract, RBAC envelope, forbidden data).
- `patient-directory-design.md` + `patient-directory-shadow-read-contract.md` (Bundle 20).
- `operational-queue-design.md` + `team-task-spine-design.md`.
- `protected-flows.md` (Plexus IQ workspace; Engagement Center; Team Portals).
- `do-not-touch.md`.

This document does NOT modify any UI source. Every change it describes is for a future explicitly approved UI PR.

---

## 1. Source-of-record visual contract (verbatim)

From Bundle 11 (PR #93):

- **Side panels** may overlay the canvas and remain bluish/clinical.
- **Playground** should NOT look like an EMR.
- **Playground** should feel like a premium blank white sketchbook / architect concept board.
- **Objects inside Playground** should look drawn onto the blank canvas.
- **Patient tabs, patient workspace modules, task tiles, chat bubbles, connectors, annotations** should use pencil-drawn visual language.
- **Text inside Playground** should feel like refined black pencil lettering.
- When a patient is clicked from a call list and pushed into Playground, the **Playground shows Patient Directory information in an organized EMR-like structure**, but rendered in the pencil canvas style.
- **No grid background**.
- **No financials, invoices, revenue share, company financials, or admin-only sensitive data**.

This document does not re-debate any of these rules. It sequences their delivery.

---

## 2. Constraints carried forward

- The existing `client/src/components/portal/PortalShell.tsx` and `TeamPortalShell.tsx` color tokens, panel chrome, and layout stay UNCHANGED. The Playground introduces an absence (blank white) plus a new object visual language; it does NOT introduce a new shared color palette.
- Existing `data-testid` attributes on Team Portal surfaces are preserved.
- All RBAC checks (Bundle 11 §21) remain server-side. The new visual layer adds zero auth surface.
- No new dependency. The pencil/sketch visual language is achieved with existing Tailwind / CSS primitives.
- No financials, claim amounts, revenue share, payment status, or admin-only metadata are rendered inside the Playground canvas (Bundle 11 §22).

---

## 3. Sequenced implementation plan (8 PRs)

Each step ships as its own PR, validated by the strict QA pass.

### Step A — Canvas root container (zero visual change)

- Add `client/src/components/playground/PlaygroundCanvas.tsx` with an explicit "blank canvas root" — a single `<div>` with white background, no grid, no children yet.
- Wrap the existing `CommandPlayground.tsx` body in the new root with zero visual difference (the existing inner JSX renders unchanged).
- New `data-testid="playground-canvas-root"` on the wrapper.
- QA invariant under `scripts/qa-playground-canvas-root.mjs` asserts the wrapper exists, the white background is sourced from existing tokens (no new color), and no grid utility class is applied.

### Step B — Pencil object primitives (dormant)

- Add `client/src/components/playground/objects/` directory with three primitive components: `PencilTab.tsx`, `PencilTile.tsx`, `PencilBubble.tsx`. Each accepts children and applies the pencil-stroke borders + paper-white fill + minimal shading rules from Bundle 11 §10.
- DORMANT — none of the three is imported by any other client file yet.
- QA invariant in `scripts/qa-playground-pencil-primitives.mjs` (Bundle 33 — added separately) walks `client/src/` and confirms no non-Playground file imports the primitives.

### Step C — Pencil typography helper (dormant)

- Add `client/src/lib/playground-typography.ts` exporting a className helper `pencilLettering()` that returns the Tailwind composition implementing "refined black pencil lettering" (graphite color, regular/medium weight, subtle hand-drawn texture).
- DORMANT — not imported anywhere yet.

### Step D — Adopt root on real Playground

- `CommandPlayground.tsx` switches from `EmptyPlayground` / per-componentType bodies to render via `PlaygroundCanvas` root. Visual output unchanged. The dispatch table for `componentType` stays in place.
- All `componentType` body renderers (calendarDate, callList, etc.) wrap their content in a single `PencilTab` shell (Step B's primitive).
- Side panels overlay the canvas at the same z-index as today. Color of panel chrome unchanged.
- Walkthrough: open the Playground from a PCS call-list panel → confirm canvas is blank white, panel overlay still clinical bluish.

### Step E — Patient Directory render

- Inside the patient `componentType` body (from `PANEL_PLAYGROUND_COMPONENT_TYPES` in `client/src/lib/playground/panelPlaygroundContext.ts`), render the canonical Patient Directory view (per Bundle 11 §12, Bundle 20).
- The view is structured EMR-style: Demographics, Encounters, Procedures, Documents, Journey — but every section is rendered as a pencil-tab object on the canvas.
- Data source: the Patient Directory read helpers (PR #65 + Bundle 20 shadow-read contract). The patient promotion already carries `patientUuid` so the Playground does not re-fetch identity.
- NO financial section. NO admin-only audit. The §22 list from Bundle 11 is enforced by `scripts/qa-playground-data-envelope.mjs` (added at Step G).

### Step F — Operational-queue + Team-task tabs

- The Playground's `callList` and tasks-related component types adopt the operational-queue + team-task read-models per Bundle 11 §13, §14.
- Rendered as `PencilTile` objects. No mutations from the canvas — every action opens an overlay panel (the existing clinical surface).

### Step G — Data envelope QA invariant

- `scripts/qa-playground-data-envelope.mjs` walks every file under `client/src/components/playground/` and `client/src/features/command-center/playground/` and asserts no import names a money type, an admin-audit type, or any field listed in Bundle 11 §22.
- This is the contract enforcer. Once shipped, any future Playground PR that adds a forbidden field fails CI.

### Step H — Journey-event annotation overlay

- A `PencilBubble` for journey events overlays the patient tab with the most recent activity summary (counts only on aggregate, PHI-safe per Bundle 8).
- No journey-event WRITE from the Playground (Bundle 11 §15 + §16).

Each step's PR is small enough that the strict QA pass completes in under a minute. No step changes the response shape of any backend route.

---

## 4. Visual rules — operational form

Implementation-side reading of Bundle 11 §6–§11.

| Rule | Implementation form |
|---|---|
| Blank white canvas | `<div className="bg-white relative h-full w-full">` on PlaygroundCanvas. NO `bg-grid-*`. NO repeated SVG background. NO opacity layer. |
| No grid | No `bg-[image:linear-gradient(...)]` utilities. No `data-grid="..."` attribute. |
| Existing portal colors preserved | Side panel chrome uses the same Tailwind tokens that PortalShell + TeamPortalShell use today. No new token introduced. |
| Side panels stay clinical/EMR | Panels render with the existing Card, Dialog, Tabs primitives from `@/components/ui/*`. Z-index unchanged. |
| Pencil-drawn objects | `PencilTab` / `PencilTile` / `PencilBubble` apply: stroke width 1.5px, color `slate-700` (existing token), slight stroke jitter via SVG-mask, paper-white fill (`#fafaf7`), minimal shadow (`shadow-sm` only). |
| Black-pencil lettering | `pencilLettering()` returns `text-slate-900 font-medium tracking-tight` plus a typeface class. Typeface choice is made in Step C — pinned to an existing font (no new web font loaded). |
| Patient Directory in EMR-like structure | Sections rendered as nested `PencilTab` objects. Section titles use `pencilLettering()`. No new section type. |

---

## 5. RBAC + data envelope reminder

Every step enforces:

- Patients visible in the Playground are scoped per `/api/portal/my-facilities` (Bundle 11 §21).
- No cross-team employee data (PTO history, payroll, performance) appears in the canvas (Bundle 11 §22).
- No financial data appears (Bundle 11 §22 + Bundle 29).
- Patient name / DOB / MRN render in the canvas only via the Patient Directory read; they are NEVER logged via the Playground (PHI-safe logger, Bundle 8).
- Raw ICD codes do not render (carried over from PDF protection contract — Bundle 11 §22).

---

## 6. Stop conditions for every step's PR

A step PR MUST stop and ask if:

1. It introduces a new shared color token.
2. It modifies the panel / EMR visual surface outside the Playground canvas root.
3. It adds a grid background or any utility-class equivalent.
4. It renders any field listed in Bundle 11 §22.
5. It changes any `data-testid` on existing Team Portal surfaces.
6. It writes from the canvas (mutations must originate from panels, not from canvas objects).
7. It re-fetches patient identity from a source other than the Patient Directory read.
8. It introduces a new HTTP route.
9. It re-styles the side panels (their look stays clinical bluish per §6 of Bundle 11).

---

## 7. Acceptance criteria for the full series

After Step H ships:

- `npm run check`, `npm run build`, every `scripts/qa-*.mjs` is green.
- A manual walkthrough opens the Playground from a PCS call-list panel; confirms blank-white canvas, pencil objects, black-pencil lettering, side panel overlay still clinical, Patient Directory tab renders Demographics → Journey sections.
- A manual walkthrough opens the Playground from an ACS procedure-day panel; same look, with the procedure-relevant Operational Queue + team-task tabs visible.
- `scripts/qa-playground-data-envelope.mjs` (Step G) reports no forbidden field across the Playground tree.
- No regression in any `protected-flows.md` flow.

---

## 8. Non-promises

- No date for any step.
- No CSS source code added in this bundle. The descriptions in §3 + §4 are implementation guidance, not implementation.
- No design tokens added.
- No font choice locked. Step C selects from existing project fonts.
- No animation library introduced. Pencil strokes are achieved with existing primitives.
- The Admin Review modal is NOT modified by this plan. The Playground does not embed the modal.

End of plan.
