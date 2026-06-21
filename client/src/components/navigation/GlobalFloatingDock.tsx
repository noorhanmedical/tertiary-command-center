import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { DOCK_ITEMS, type DockItem } from "@/lib/navigation/navigationRegistry";
import { PlexusIQCalendar, type CalendarSummaryRow } from "@/components/plexus-iq/PlexusIQCalendar";

function DockCalendarPanel({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { data: summary = [] } = useQuery<CalendarSummaryRow[]>({
    queryKey: ["/api/screening-batches/calendar-summary"],
    queryFn: async () => {
      const res = await fetch("/api/screening-batches/calendar-summary", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Calendar summary fetch failed (${res.status})`);
      return res.json();
    },
    staleTime: 15_000,
  });

  function handleSelectDate(isoDate: string) {
    setSelectedDate(isoDate);
  }

  function handleAssignDate(_batchId: number, _batchLabel: string) {
    onClose();
    navigate("/plexus-iq");
  }

  return (
    <div className="overflow-y-auto" data-testid="global-floating-dock-calendar-panel">
      <PlexusIQCalendar
        summary={summary}
        onSelectDate={handleSelectDate}
        onAssignDate={handleAssignDate}
        selectedDate={selectedDate}
        compact={false}
      />
    </div>
  );
}

function DockButton({
  item,
  expanded,
  active,
  onActivate,
}: {
  item: DockItem;
  expanded: boolean;
  active: boolean;
  onActivate: (item: DockItem) => void;
}) {
  const Icon = item.Icon;

  const stateClass = item.kind === "disabled"
    ? "opacity-40 cursor-not-allowed text-white/40"
    : active
      ? "text-white"
      : "text-white/80 hover:text-white";

  const wrapperClass = `group/dock-item flex flex-col items-center gap-1 px-2 transition-all duration-200 ${stateClass}`;

  const iconWrap = (
    <span
      className={`relative inline-flex items-center justify-center transition-all duration-200 ease-out rounded-2xl ${
        active
          ? "bg-white/15"
          : "bg-transparent group-hover/dock-item:bg-white/10"
      } ${expanded ? "h-10 w-10" : "h-7 w-7"}`}
    >
      <Icon
        className={`transition-all duration-200 ease-out ${expanded ? "w-5 h-5" : "w-4 h-4"}`}
        strokeWidth={1.75}
      />
    </span>
  );

  const label = (
    <span
      className={`text-[11px] font-medium leading-none transition-[max-height,opacity] duration-200 overflow-hidden ${
        expanded ? "max-h-[1.25rem] opacity-100" : "max-h-0 opacity-0"
      }`}
    >
      {item.label}
    </span>
  );

  if (item.kind === "link" && item.href) {
    return (
      <Link
        href={item.href}
        className={wrapperClass}
        data-testid={item.testId}
        aria-current={active ? "page" : undefined}
        title={item.label}
      >
        {iconWrap}
        {label}
      </Link>
    );
  }

  if (item.kind === "panel") {
    return (
      <button
        type="button"
        onClick={() => onActivate(item)}
        className={wrapperClass}
        data-testid={item.testId}
        title={item.label}
      >
        {iconWrap}
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled
      className={wrapperClass}
      data-testid={item.testId}
      aria-disabled="true"
      title={`${item.label} (unavailable)`}
    >
      {iconWrap}
      {label}
    </button>
  );
}

export function GlobalFloatingDock() {
  const [location] = useLocation();
  const [hovered, setHovered] = useState(false);
  const [tapToggled, setTapToggled] = useState(false);
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const expanded = hovered || tapToggled;

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setTapToggled(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function handleActivate(item: DockItem) {
    if (item.kind === "panel" && item.panelId) {
      setOpenPanel(item.panelId);
      setTapToggled(false);
    }
  }

  return (
    <>
      <div
        ref={rootRef}
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        data-testid="global-floating-dock"
        data-expanded={expanded ? "true" : "false"}
      >
        <button
          type="button"
          onClick={() => setTapToggled((v) => !v)}
          className="md:hidden absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center justify-center h-6 w-12 rounded-full bg-slate-800/90 text-white/90 border border-slate-600/60 backdrop-blur-xl text-[10px] font-semibold shadow"
          aria-label="Toggle dock labels"
          data-testid="global-floating-dock-mobile-toggle"
        >
          {tapToggled ? "—" : "•••"}
        </button>

        <div
          className={`rounded-full border border-slate-600/50 bg-slate-800/85 backdrop-blur-xl shadow-lg transition-all duration-200 ease-out origin-bottom ${
            expanded
              ? "px-3 py-2 opacity-100 scale-100"
              : "px-2 py-1 opacity-40 scale-90"
          }`}
        >
          <div
            className={`hidden ${expanded ? "" : ""}`}
            data-testid="global-floating-dock-collapsed"
            aria-hidden={expanded ? "true" : "false"}
          />
          <div
            className={`hidden ${expanded ? "" : ""}`}
            data-testid="global-floating-dock-expanded"
            aria-hidden={expanded ? "false" : "true"}
          />
          <nav
            className="flex items-end gap-1"
            aria-label="Global navigation dock"
          >
            {DOCK_ITEMS.map((item) => {
              const active = !!item.href && (location === item.href || location.startsWith(item.href + "/"));
              return (
                <DockButton
                  key={item.id}
                  item={item}
                  expanded={expanded}
                  active={active}
                  onActivate={handleActivate}
                />
              );
            })}
          </nav>
        </div>
      </div>

      <Sheet
        open={openPanel === "calendar"}
        onOpenChange={(open) => setOpenPanel(open ? "calendar" : null)}
      >
        <SheetContent side="right" className="w-full sm:max-w-3xl flex flex-col overflow-hidden">
          <SheetHeader className="shrink-0">
            <SheetTitle>Calendar</SheetTitle>
            <SheetDescription>
              Monthly schedule — ancillary categories and patient counts at a glance.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto -mx-6 px-6">
            <DockCalendarPanel onClose={() => setOpenPanel(null)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
