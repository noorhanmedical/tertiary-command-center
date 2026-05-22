// Right-side drawer wrapper around UniversalCalendar.
//
// Profile-driven: caller passes a profileId + context. Open state can be
// fully controlled (via open + onOpenChange) or uncontrolled (the drawer
// manages its own open state for trigger-less embedding scenarios).

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { UniversalCalendar } from "./UniversalCalendar";
import type {
  CanonicalMonthCellSummary,
  CanonicalCalendarUnscheduledItem,
} from "./views/CanonicalMonthCalendar";
import {
  resolveCalendarProfileSettings,
  type CalendarAdminSettingLike,
} from "./calendarSettings";
import type { CalendarProfileId } from "./calendarProfiles";
import type { CalendarContext } from "./calendarEventTypes";

export type UniversalCalendarDrawerProps = {
  profileId: CalendarProfileId;
  context?: CalendarContext;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  // Pass through admin_settings rows when available; this batch leaves API
  // wiring out, so default is [] and the resolver falls back to code.
  settings?: CalendarAdminSettingLike[];
  // Optional pre-mapped per-date cells for the month-grid body. Callers
  // shape data into CanonicalMonthCellSummary so the drawer stays generic.
  cells?: Record<string, CanonicalMonthCellSummary>;
  // Reserved for future week/day/agenda views.
  summary?: unknown[];
  onSelectDate?: (isoDate: string) => void;
  unscheduledItems?: CanonicalCalendarUnscheduledItem[];
  onUnscheduledItemAction?: (item: CanonicalCalendarUnscheduledItem) => void;
  initialMonth?: Date;
};

export function UniversalCalendarDrawer({
  profileId,
  context = {},
  open,
  onOpenChange,
  title,
  settings = [],
  cells,
  summary,
  onSelectDate,
  unscheduledItems,
  onUnscheduledItemAction,
  initialMonth,
}: UniversalCalendarDrawerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? !!open : internalOpen;

  function handleOpenChange(next: boolean) {
    if (isControlled) onOpenChange?.(next);
    else setInternalOpen(next);
  }

  const profile = resolveCalendarProfileSettings(profileId, context, settings);
  const headerTitle = title ?? profile.label;

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 gap-0 flex flex-col"
        data-testid="canonical-universal-calendar-drawer"
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle className="text-base font-semibold tracking-tight">
            {headerTitle}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-5 py-4">
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
