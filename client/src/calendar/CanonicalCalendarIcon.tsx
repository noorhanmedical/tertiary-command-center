// Reusable calendar icon launcher.
//
// Pages adopt the canonical calendar by mounting <CanonicalCalendarIcon
// profileId="..."  context={...} /> next to their existing chrome — the
// icon manages its own open/close state and renders UniversalCalendarDrawer
// on the right. This is the only entry point pages should use for a
// calendar drawer trigger; do not hand-roll calendar drawers per page.

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { UniversalCalendarDrawer } from "./UniversalCalendarDrawer";
import type { CalendarProfileId } from "./calendarProfiles";
import type { CalendarContext } from "./calendarEventTypes";
import type { CalendarAdminSettingLike } from "./calendarSettings";

export type CanonicalCalendarIconProps = {
  profileId: CalendarProfileId;
  context?: CalendarContext;
  label?: string;
  className?: string;
  buttonClassName?: string;
  drawerTitle?: string;
  settings?: CalendarAdminSettingLike[];
  onSelectDate?: (isoDate: string) => void;
};

export function CanonicalCalendarIcon({
  profileId,
  context,
  label = "Open calendar",
  className,
  buttonClassName,
  drawerTitle,
  settings,
  onSelectDate,
}: CanonicalCalendarIconProps) {
  const [open, setOpen] = useState(false);

  const baseButton =
    "inline-flex items-center justify-center h-9 w-9 rounded-full bg-plexus-navy-800 text-white shadow-sm hover:bg-plexus-navy-700 transition-colors";

  return (
    <span className={className} data-testid="canonical-calendar-icon">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        className={buttonClassName ?? baseButton}
        data-testid="canonical-calendar-icon-button"
      >
        <CalendarDays className="w-4 h-4" />
      </button>
      <UniversalCalendarDrawer
        profileId={profileId}
        context={context}
        open={open}
        onOpenChange={setOpen}
        title={drawerTitle}
        settings={settings}
        onSelectDate={onSelectDate}
      />
    </span>
  );
}
