// Shared view-model helpers for the canonical command calendar.
//
// Plexus IQ, PCS / ACS portals, and the Home Dashboard all render
// through CanonicalCommandCalendar / UniversalCalendar /
// CanonicalMonthCalendar. They were previously diverging on the
// *data* fed into those primitives — Plexus IQ built rich cells
// (count + ancillary-category dots + procedure-complete badge),
// while the PCS/ACS left rail was building count-only cells from
// `/api/portal/month-summary`.
//
// This module consolidates the Plexus IQ cell + unscheduled-item
// builder into one set of pure helpers so every surface gets the
// same data shape. Pages stay responsible for fetching the rows
// they need; the helpers just convert canonical input rows into
// the `CanonicalMonthCellSummary` / `CanonicalCalendarUnscheduledItem`
// shapes the primitive layer consumes.

import { createElement } from "react";
import { Check } from "lucide-react";
import type {
  CanonicalMonthCellSummary,
  CanonicalCalendarUnscheduledItem,
} from "@/calendar";
import type { GlobalScheduleEvent } from "@shared/schema";

// Input row for the calendar-summary feed (one row per
// screening_batch). Plexus IQ already fetches this shape.
export type CommandCalendarSummaryRow = {
  id: number;
  name: string;
  facility: string | null;
  scheduleDate: string | null;
  status?: string;
  patientCount: number;
  categories?: string[]; // subset of "brainwave" | "vitalwave" | "ultrasound"
};

// Ancillary-category → dot styling. Mirrors the inline map Plexus IQ
// used; exposed here so every surface lights the same colours.
export const ANCILLARY_DOT_CLASS: Record<
  string,
  { className: string; title: string }
> = {
  brainwave: { className: "bg-violet-500", title: "BrainWave" },
  vitalwave: { className: "bg-red-500", title: "VitalWave" },
  ultrasound: { className: "bg-emerald-500", title: "Ultrasound" },
};

export type BuildCommandCalendarCellsInput = {
  summary: CommandCalendarSummaryRow[];
  // Optional facility filter — when present, only rows for the
  // matching facility contribute counts/dots. PCS/ACS surfaces
  // pass this to scope the calendar to the current facility.
  facility?: string | null;
  // Optional completed schedule events feed — used to badge dates
  // where any procedure was completed. Plexus IQ + Dashboard both
  // surface this; PCS/ACS may or may not depending on profile.
  completedEvents?: GlobalScheduleEvent[];
};

function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Build the canonical per-date cell summary the month grid renders.
// Pure function: idempotent on identical input.
export function buildCommandCalendarCells(
  input: BuildCommandCalendarCellsInput,
): Record<string, CanonicalMonthCellSummary> {
  const { summary, facility, completedEvents = [] } = input;
  type Acc = { count: number; cats: Set<string>; completed: boolean };
  const acc: Record<string, Acc> = {};

  for (const row of summary) {
    if (!row.scheduleDate || row.patientCount === 0) continue;
    if (facility && row.facility && row.facility !== facility) continue;
    const cur = acc[row.scheduleDate] ?? {
      count: 0,
      cats: new Set<string>(),
      completed: false,
    };
    cur.count += row.patientCount;
    for (const c of row.categories ?? []) cur.cats.add(c);
    acc[row.scheduleDate] = cur;
  }

  for (const evt of completedEvents) {
    const startsAtRaw = evt.startsAt;
    const startsAt = startsAtRaw
      ? new Date(startsAtRaw as unknown as string)
      : null;
    if (!startsAt || isNaN(startsAt.getTime())) continue;
    if (
      facility &&
      (evt as { facilityId?: string | null }).facilityId &&
      (evt as { facilityId?: string | null }).facilityId !== facility
    ) {
      continue;
    }
    const key = yyyymmdd(startsAt);
    const cur = acc[key] ?? { count: 0, cats: new Set<string>(), completed: false };
    cur.completed = true;
    acc[key] = cur;
  }

  const cells: Record<string, CanonicalMonthCellSummary> = {};
  for (const [key, val] of Object.entries(acc)) {
    cells[key] = {
      count: val.count,
      dots: Array.from(val.cats)
        .map((c) => ANCILLARY_DOT_CLASS[c])
        .filter((x): x is { className: string; title: string } => !!x),
      badge: val.completed
        ? {
            // React-element form so the canonical view can render
            // the icon without callers importing lucide.
            icon: createElement(Check, { className: "w-3 h-3", strokeWidth: 3 }),
            className: "bg-emerald-100 text-emerald-700",
            title: "Procedure completed",
          }
        : undefined,
    };
  }
  return cells;
}

// Build the canonical unscheduled-items list surfaced inside the
// drawer's "Unscheduled" panel. Plexus IQ uses this to surface
// batches without a scheduleDate.
export function buildCommandCalendarUnscheduledItems(
  summary: CommandCalendarSummaryRow[],
  facility?: string | null,
): CanonicalCalendarUnscheduledItem[] {
  return summary
    .filter((row) => {
      if (row.scheduleDate) return false;
      if (row.patientCount === 0) return false;
      if (facility && row.facility && row.facility !== facility) return false;
      return true;
    })
    .map((row) => ({
      id: row.id,
      label: row.facility ? `${row.facility} · ${row.name}` : row.name,
      count: row.patientCount,
      actionLabel: "Assign date",
    }));
}

// Year-window helper used by every surface that fetches the
// procedure-complete events. ±12 months from the current month.
export function defaultCommandCalendarEventWindow(): {
  start: string;
  end: string;
} {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 13, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}
