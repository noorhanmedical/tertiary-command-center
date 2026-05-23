# Panel → Popup → Playground

> **Scope:** Canonical pattern for every PCS / ACS panel component:
> render compactly in the left/right rail, surface a popup preview
> on interaction, and (via the expand arrow) promote the same
> context into the Playground for richer detail. Read-only
> reference — the contracts are enforced by tests, not by manual
> review.

## The three-stage pattern

```
panel component (compact)
   │
   ▼
popup preview (compact, in-place summary)
   │  ┌──────────────────────────────┐
   ├──┤ ┃ promote-to-playground arrow ┃
   │  └──────────────────────────────┘
   ▼
Playground (center workspace, expanded detail)
```

Every panel component in PCS / ACS that surfaces a per-thing
summary (a patient, a date, an ancillary row, a call-list row,
a procedure / billing / document row) should support the same
three stages. The popup gives the user a quick read; the
Playground gives them workroom.

## What is a panel component?

A panel component is anything that renders in the left rail, the
right rail, the header drawer, or the workspace mode body of the
PCS / ACS PortalShell **and** carries a single piece of canonical
context (a date, a patient, an ancillary, a task, a billing
candidate, …). Calendar grids, patient lists, call lists,
ancillary lists, document checklists, billing-readiness panels —
each renders many panel components.

## What is popup mode?

Compact, in-place inline preview that surfaces:

- the selected context (one line of identity)
- per-context summary fields (count, ancillary dots, status,
  badges)
- a small set of context-appropriate inline actions
- the canonical expand-to-Playground arrow

Popups are NOT modal dialogs. They render directly inside the
panel — close on outside click, on Esc, or when the parent
selection changes. They never block the rest of the workspace.

## What is Playground mode?

The full center workspace area of PortalShell, owned by the
`centerMode` state. When a popup is promoted, the parent calls
the existing `setCenterMode("playground")` (or a more specific
mode) and sets the matching context state so the Playground body
re-renders with the rich detail.

Playground mode shows:

- the original context (date / patient / ancillary / …)
- joined canonical data (linked records, history, related
  patients)
- inline actions appropriate for the context
- breadcrumb back to the panel source

## Required context fields (canonical)

Every panel popup that supports promotion must pass a
`PanelPlaygroundContext` carrying:

| Field | Required? | Meaning |
| --- | --- | --- |
| `sourceSurface` | yes | `"pcs"` / `"acs"` / `"plexusIq"` / `"dashboard"` |
| `componentType` | yes | `"calendarDate"` / `"patient"` / `"ancillary"` / `"callList"` / `"procedure"` / `"document"` / `"billing"` |
| `title` | yes | One-line human-facing title for the Playground header |
| `selectedDate?` | when relevant | ISO `YYYY-MM-DD` for date-bound contexts |
| `patientUuid?` | when relevant | canonical patient screening id link |
| `patientName?` | when relevant | snapshot for display |
| `facilityId?` | when relevant | scoping facility |
| `ancillaryType?` | when relevant | brainwave / vitalwave / ultrasound / specific service |
| `filters?` | when relevant | active calendar / list filter ids |
| `metadata?` | optional | jsonb-shaped escape hatch for component-specific extras |

## Components that must support this pattern

The pattern is a *contract*; not every component is wired
today. The list below names every panel surface in PCS / ACS and
what context type it should carry on promote:

| Surface | Today | Required componentType |
| --- | --- | --- |
| Left-rail calendar (`PatientMiniCalendar`) | calendar grid + Schedule CTA | `"calendarDate"` |
| Right-panel `clinicSchedule` patient card | inline list rows | `"patient"` |
| Right-panel `ancillarySchedule` row | inline list rows | `"ancillary"` |
| Right-panel `callList` row | inline list rows | `"callList"` |
| Procedure-complete card | inline action | `"procedure"` |
| Document readiness checklist row | inline status | `"document"` |
| Billing readiness chip | inline status | `"billing"` |

The current PortalShell already has `openSchedulePatientPlayground`
+ `expandScheduleToPlayground` (covering `"patient"` and
day-schedule contexts). The new helpers
(`buildCalendarDatePlaygroundContext` etc.) extend this pattern
to every other panel component.

## Promote handler contract

```ts
type PromoteHandler = (context: PanelPlaygroundContext) => void;
```

The handler is owned by PortalShell (the same level that owns
`centerMode`). It validates the context, calls
`setCenterMode("playground")` (or the appropriate mode), sets the
matching context state, and triggers a focus on the Playground
header. The popup closes on success.

## What this pattern does NOT do

- Does not create a new component for every surface. The popup
  is rendered inline in the panel that owns the context (the
  calendar shows the date popup; the patient list shows the
  patient popup). Only the *promote button* and the *context
  builder* are shared.
- Does not replace existing modal dialogs (`SchedulePatientDialog`).
  Modals continue to exist for actions that need form input;
  popups are for *previews* with a promotion path.
- Does not change `centerMode` semantics. Promotion uses the
  existing modes (`playground`, `scheduleDay`, `patient`, etc.).

## QA contract

- `qa:panel-popup-playground` (new) — enforces the helper
  exports, the calendar-date popup wiring, and the promote
  button presence.
- `qa:calendar-true-parity` continues to pass — the popup
  pattern doesn't alter the canonical calendar data.
- `qa:pcs-acs-complete` continues to pass — capability +
  profile mapping unchanged.

## Cross-references

- `client/src/lib/playground/panelPlaygroundContext.ts` — context
  types + builders.
- `client/src/components/playground/PromoteToPlaygroundButton.tsx`
  — reusable expand control.
- `client/src/components/portal/PatientMiniCalendar.tsx` — first
  callsite (calendar date popup).
- `client/src/components/portal/PortalShell.tsx` —
  `openSchedulePatientPlayground` (existing patient context) +
  the `centerMode` state that owns Playground rendering.
- `docs/architecture/calendar-source-of-truth.md` — calendar
  feed reference.
- `docs/architecture/pcs-acs-portal-solidness-audit.md` — broader
  PCS / ACS context.
