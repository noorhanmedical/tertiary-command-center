import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { DOCK_ITEMS, type DockItem } from "@/lib/navigation/navigationRegistry";

const COLLAPSED_WIDTH = "w-14";
const EXPANDED_WIDTH = "w-56";

function CalendarPlaceholderPanel() {
  return (
    <div
      className="mt-6 rounded-2xl border border-dashed border-slate-200 dark:border-border bg-slate-50/60 dark:bg-muted/20 p-8 text-center"
      data-testid="dock-calendar-placeholder"
    >
      <p className="text-sm font-medium text-slate-700 dark:text-foreground">
        Calendar panel coming soon.
      </p>
      <p className="mt-2 text-xs text-slate-500 dark:text-muted-foreground">
        Use the Home dashboard for the live monthly clinic calendar today.
      </p>
    </div>
  );
}

function DockRow({
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
  const baseClass =
    "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors w-full min-h-[44px]";
  const stateClass = item.kind === "disabled"
    ? "opacity-40 cursor-not-allowed text-slate-500 dark:text-muted-foreground"
    : active
      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200"
      : "text-slate-700 dark:text-foreground hover:bg-slate-100 dark:hover:bg-muted/40";

  const inner = (
    <>
      <Icon className="w-5 h-5 shrink-0" strokeWidth={1.75} />
      <span
        className={`text-sm font-medium whitespace-nowrap overflow-hidden transition-[max-width,opacity] duration-200 ${
          expanded ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0"
        }`}
      >
        {item.label}
      </span>
    </>
  );

  if (item.kind === "link" && item.href) {
    return (
      <Link href={item.href}>
        <a
          className={`${baseClass} ${stateClass}`}
          data-testid={item.testId}
          aria-current={active ? "page" : undefined}
          title={item.label}
        >
          {inner}
        </a>
      </Link>
    );
  }

  if (item.kind === "panel") {
    return (
      <button
        type="button"
        onClick={() => onActivate(item)}
        className={`${baseClass} ${stateClass} text-left`}
        data-testid={item.testId}
        title={item.label}
      >
        {inner}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled
      className={`${baseClass} ${stateClass} text-left`}
      data-testid={item.testId}
      aria-disabled="true"
      title={`${item.label} (unavailable)`}
    >
      {inner}
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
        className="fixed left-3 top-1/2 -translate-y-1/2 z-50 hidden md:block"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        data-testid="global-floating-dock"
        data-expanded={expanded ? "true" : "false"}
      >
        <div
          className={`${expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH} transition-[width] duration-200 ease-out rounded-2xl border border-slate-200/70 dark:border-border bg-white/90 dark:bg-card/85 backdrop-blur-xl shadow-lg overflow-hidden`}
        >
          <nav className="flex flex-col gap-1 p-2" aria-label="Global navigation dock">
            {DOCK_ITEMS.map((item) => {
              const active = !!item.href && (location === item.href || location.startsWith(item.href + "/"));
              return (
                <DockRow
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

      <div
        className="fixed bottom-4 right-4 z-50 md:hidden"
      >
        <button
          type="button"
          onClick={() => setTapToggled((v) => !v)}
          className="w-12 h-12 rounded-full bg-indigo-600 text-white shadow-lg flex items-center justify-center"
          aria-label="Toggle navigation"
          data-testid="global-floating-dock-mobile-toggle"
        >
          <span className="block w-5 h-0.5 bg-white relative before:absolute before:inset-x-0 before:-top-1.5 before:h-0.5 before:bg-white after:absolute after:inset-x-0 after:top-1.5 after:h-0.5 after:bg-white" />
        </button>
        {tapToggled && (
          <div
            className="absolute bottom-14 right-0 w-56 rounded-2xl border border-slate-200/70 dark:border-border bg-white/95 dark:bg-card/90 backdrop-blur-xl shadow-lg overflow-hidden"
            data-testid="global-floating-dock-mobile-panel"
          >
            <nav className="flex flex-col gap-1 p-2" aria-label="Global navigation dock (mobile)">
              {DOCK_ITEMS.map((item) => {
                const active = !!item.href && (location === item.href || location.startsWith(item.href + "/"));
                return (
                  <DockRow
                    key={item.id}
                    item={item}
                    expanded={true}
                    active={active}
                    onActivate={(it) => {
                      handleActivate(it);
                      if (it.kind === "link") setTapToggled(false);
                    }}
                  />
                );
              })}
            </nav>
          </div>
        )}
      </div>

      <Sheet open={openPanel === "calendar"} onOpenChange={(open) => setOpenPanel(open ? "calendar" : null)}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle data-testid="dock-calendar-title">Calendar</SheetTitle>
            <SheetDescription>
              Quick-glance calendar surface — full monthly view lives on Home.
            </SheetDescription>
          </SheetHeader>
          <CalendarPlaceholderPanel />
        </SheetContent>
      </Sheet>
    </>
  );
}
