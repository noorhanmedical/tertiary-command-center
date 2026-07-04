---
name: Canonical calendar embedding
description: Which layer of the canonical calendar stack to render for clean vs full surfaces, and how per-cell popovers work.
---

# Canonical calendar stack

Layers (top → bottom): `CanonicalCommandCalendar` (mode "inline"|"drawer") → `UniversalCalendar` / `UniversalCalendarDrawer` → `CanonicalMonthCalendar` (the actual 6-week grid). Data is shaped by `buildCommandCalendarCells` in `client/src/lib/calendar/commandCalendarViewModel.ts`, fed from `/api/screening-batches/calendar-summary` (+ optional `procedure_complete` global_schedule_events for the ✓ badge).

## Rule: for a chrome-free embed, render `CanonicalMonthCalendar` directly
`UniversalCalendar` adds a profile header ("<profile> · Canonical calendar profile active · default view…"), a `CalendarFilterBar`, and a `CalendarAddActionButton`. That dev-ish chrome is unwanted on polished surfaces (e.g. the home dashboard calendar tile).

**Why:** the home page needed a clean grid (count + ancillary dots + completion check only, no inline name text). Going through `CanonicalCommandCalendar`/`UniversalCalendar` would have dragged in the filter bar + add button. `CanonicalMonthCalendar` is exported from `@/calendar` and is the genuinely shared grid both Home and Plexus IQ ultimately render, so importing it directly still satisfies "share one component".

**How to apply:** clean/minimal calendar surface → `import { CanonicalMonthCalendar } from "@/calendar"` directly. Full-featured surface that wants filters/profile/add-action → use `CanonicalCommandCalendar`.

## Per-cell popover (anchored, not modal)
`CanonicalMonthCalendar` takes an optional `renderDayPopoverContent?: (isoDate) => ReactNode`. When provided AND the day has content (`hasAny`), the cell button is wrapped in a Shadcn `Popover` anchored to that cell; internal `openPopoverKey` state means only one is open at a time. Return `null` to suppress (empty days never open). Surfaces that omit the prop keep the legacy "click → caller-owned modal/drawer" behavior unchanged — that is how Plexus IQ stays unaffected.
