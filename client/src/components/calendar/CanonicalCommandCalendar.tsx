// Canonical calendar shared by PCS, ACS, Plexus IQ, and Dashboard.
//
// One named entry point on top of the existing canonical primitives:
//   - `UniversalCalendar` — month grid + filter bar + add-action.
//   - `UniversalCalendarDrawer` — Sheet wrapper for "calendar in a
//     right-side drawer" surfaces.
//   - `CanonicalMonthCalendar` — the actual month-grid view.
//
// Callers pick a `mode`:
//   - `"inline"` — renders the month grid inline (PCS left rail,
//     ACS left rail, Dashboard calendar tile).
//   - `"drawer"` — wraps in a right-side Sheet, with caller-owned
//     open state (Plexus IQ expandable right panel, PortalShell
//     team-portal calendar button).
//
// Both modes render the SAME underlying `CanonicalMonthCalendar` —
// this wrapper is purely a single, named import so every surface
// flows through one path.

import {
  UniversalCalendar,
  UniversalCalendarDrawer,
  type CalendarProfileId,
  type CalendarContext,
  type CanonicalMonthCellSummary,
  type CanonicalCalendarUnscheduledItem,
} from "@/calendar";
import type { CalendarAdminSettingLike } from "@/calendar/calendarSettings";

export type CanonicalCommandCalendarMode = "inline" | "drawer";

type CommonProps = {
  profileId: CalendarProfileId;
  context?: CalendarContext;
  title?: string;
  settings?: CalendarAdminSettingLike[];
  cells?: Record<string, CanonicalMonthCellSummary>;
  summary?: unknown[];
  onSelectDate?: (isoDate: string) => void;
  unscheduledItems?: CanonicalCalendarUnscheduledItem[];
  onUnscheduledItemAction?: (item: CanonicalCalendarUnscheduledItem) => void;
  initialMonth?: Date;
};

type InlineProps = CommonProps & {
  mode?: "inline";
  open?: never;
  onOpenChange?: never;
};

type DrawerProps = CommonProps & {
  mode: "drawer";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export type CanonicalCommandCalendarProps = InlineProps | DrawerProps;

export function CanonicalCommandCalendar(props: CanonicalCommandCalendarProps) {
  if (props.mode === "drawer") {
    const {
      mode: _mode,
      profileId,
      context,
      title,
      settings,
      cells,
      summary,
      onSelectDate,
      unscheduledItems,
      onUnscheduledItemAction,
      initialMonth,
      open,
      onOpenChange,
    } = props;
    return (
      <UniversalCalendarDrawer
        profileId={profileId}
        context={context}
        title={title}
        settings={settings}
        cells={cells}
        summary={summary}
        onSelectDate={onSelectDate}
        unscheduledItems={unscheduledItems}
        onUnscheduledItemAction={onUnscheduledItemAction}
        initialMonth={initialMonth}
        open={open}
        onOpenChange={onOpenChange}
      />
    );
  }
  const {
    profileId,
    context,
    settings,
    cells,
    summary,
    onSelectDate,
    unscheduledItems,
    onUnscheduledItemAction,
    initialMonth,
  } = props;
  return (
    <UniversalCalendar
      profileId={profileId}
      context={context}
      settings={settings}
      cells={cells}
      summary={summary}
      onSelectDate={onSelectDate}
      unscheduledItems={unscheduledItems}
      onUnscheduledItemAction={onUnscheduledItemAction}
      initialMonth={initialMonth}
    />
  );
}

// Re-export the canonical types so consumers don't reach into `@/calendar`
// directly to type their data.
export type {
  CalendarProfileId,
  CalendarContext,
  CanonicalMonthCellSummary,
  CanonicalCalendarUnscheduledItem,
};
