import { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Brain,
  X,
  Minus,
  Maximize2,
  ChevronRight,
  ChevronLeft,
  Pin,
  PinOff,
} from "lucide-react";
import { NAV_ITEMS } from "@/components/GlobalNav";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DialogPortalContainerContext } from "@/components/ui/dialog";
import { CanonicalMonthCalendar } from "@/calendar";
import { buildCommandCalendarCells } from "@/lib/calendar/commandCalendarViewModel";
import type { CalendarSummaryRow } from "@/components/plexus-iq/PlexusIQCalendar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SIDEBAR_STYLE, type AuthUser } from "@/App";

const PlexusIQPage = lazy(() => import("@/pages/plexus-iq"));

const PRIMARY_HREFS = [
  "/home",
  "/mission-control",
  "/schedule",
  "/scheduler-portal",
  "/patient-directory",
  "/ancillary-documents",
  "/billing",
  "/plexus-tasks",
];

const DOCK_PIN_KEY = "winterHome.dockPinned";

type WinterWin = {
  id: number;
  appId: string; // "plexus-iq" or a NAV_ITEMS href
  mode: "tab" | "window";
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  maximized: boolean;
  z: number;
};

type AppDef = {
  appId: string;
  label: string;
  Icon: (typeof NAV_ITEMS)[number]["Icon"];
  href?: string; // iframe-hosted apps
};

const slugOf = (appId: string) => (appId === "plexus-iq" ? "plexus-iq" : appId.replace(/\//g, ""));

/**
 * Full-screen frosted pane hosting an app opened as a banner tab. All panes
 * stay mounted (so iframes keep their state); only the active one is shown.
 */
function WinterTabPane({
  win,
  app,
  title,
  active,
}: {
  win: WinterWin;
  app: AppDef;
  title: string;
  active: boolean;
}) {
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const slug = slugOf(win.appId);
  return (
    <div
      className={`absolute left-0 right-0 top-12 bottom-0 z-30 bg-white/30 backdrop-blur-2xl pointer-events-auto ${
        active ? "" : "hidden"
      }`}
      data-testid={`tab-pane-${slug}-${win.id}`}
      data-winter-app={slug}
    >
      <div ref={setBodyEl} className="relative h-full w-full overflow-auto" data-winter-window>
        {win.appId === "plexus-iq" ? (
          <DialogPortalContainerContext.Provider value={bodyEl}>
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                  Opening Plexus IQ…
                </div>
              }
            >
              <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
                <PlexusIQPage />
              </SidebarProvider>
            </Suspense>
          </DialogPortalContainerContext.Provider>
        ) : (
          <iframe
            src={`${app.href}?embed=1`}
            title={title}
            className="absolute inset-0 w-full h-full border-0 bg-transparent"
            data-testid={`tab-iframe-${win.id}`}
          />
        )}
      </div>
    </div>
  );
}

/**
 * One floating desktop window. Draggable by its title bar, resizable via the
 * bottom-right grip. Plexus IQ renders inline (glass treatment + dialogs
 * portaled INTO the window body so app modals only cover this window);
 * every other app is hosted in an ?embed=1 iframe so multiple full apps can
 * run side by side.
 */
function WinterWindow({
  win,
  app,
  title,
  onFocus,
  onClose,
  onMinimize,
  onToggleMax,
  onGeometry,
}: {
  win: WinterWin;
  app: AppDef;
  title: string;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMax: () => void;
  onGeometry: (patch: Partial<Pick<WinterWin, "x" | "y" | "w" | "h">>) => void;
}) {
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [interacting, setInteracting] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    ow: number;
    oh: number;
    dir: string;
  } | null>(null);
  const slug = slugOf(win.appId);

  const startDrag = (e: React.PointerEvent) => {
    if (win.maximized) return;
    onFocus();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: win.x, oy: win.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setInteracting(true);
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const nx = Math.min(Math.max(d.ox + e.clientX - d.sx, -win.w + 160), vw - 160);
    const ny = Math.min(Math.max(d.oy + e.clientY - d.sy, 48), vh - 90);
    onGeometry({ x: nx, y: ny });
  };
  const endDrag = () => {
    dragRef.current = null;
    setInteracting(false);
  };

  const startResize = (dir: string) => (e: React.PointerEvent) => {
    if (win.maximized) return;
    e.stopPropagation();
    onFocus();
    resizeRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      ox: win.x,
      oy: win.y,
      ow: win.w,
      oh: win.h,
      dir,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setInteracting(true);
  };
  const moveResize = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    const dx = e.clientX - r.sx;
    const dy = e.clientY - r.sy;
    const patch: Partial<Pick<WinterWin, "x" | "y" | "w" | "h">> = {};
    if (r.dir.includes("e")) patch.w = Math.max(480, r.ow + dx);
    if (r.dir.includes("s")) patch.h = Math.max(320, r.oh + dy);
    if (r.dir.includes("w")) {
      const nw = Math.max(480, r.ow - dx);
      patch.w = nw;
      patch.x = r.ox + (r.ow - nw);
    }
    if (r.dir.includes("n")) {
      const nh = Math.max(320, r.oh - dy);
      patch.h = nh;
      patch.y = r.oy + (r.oh - nh);
    }
    onGeometry(patch);
  };
  const endResize = () => {
    resizeRef.current = null;
    setInteracting(false);
  };

  const geometry = win.maximized
    ? { left: 0, top: 0, width: "100%", height: "100%" }
    : { left: win.x, top: win.y, width: win.w, height: win.h };

  return (
    <div
      className={`absolute flex flex-col border border-white/40 bg-white/35 backdrop-blur-2xl shadow-[0_40px_120px_rgba(15,23,42,0.45)] overflow-hidden pointer-events-auto ${
        win.maximized ? "rounded-none" : "rounded-lg"
      } ${win.minimized ? "hidden" : ""}`}
      style={{ ...geometry, zIndex: win.z, transform: "translateZ(0)" }}
      onPointerDown={onFocus}
      data-testid={`window-${slug}-${win.id}`}
      data-winter-app={slug}
    >
      <div
        className="flex items-center gap-2 h-10 px-4 bg-gradient-to-b from-sky-700/90 to-blue-900/90 backdrop-blur-xl border-b border-white/15 shrink-0 cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onToggleMax}
        data-testid={`titlebar-${win.id}`}
      >
        <div className="flex items-center gap-2 text-[13px] font-semibold text-white/95 select-none">
          <app.Icon className="w-4 h-4 text-sky-200" />
          {title}
        </div>
        <div
          className="ml-auto flex items-center gap-2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onMinimize}
            className="w-6 h-6 rounded-md flex items-center justify-center text-white/70 hover:text-white hover:bg-white/15 transition-colors"
            aria-label="Minimize to dock"
            data-testid={`button-minimize-${win.id}`}
          >
            <Minus className="w-3.5 h-3.5" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={onToggleMax}
            className="w-6 h-6 rounded-md flex items-center justify-center text-white/70 hover:text-white hover:bg-white/15 transition-colors"
            aria-label={win.maximized ? "Restore window size" : "Expand window"}
            data-testid={`button-maximize-${win.id}`}
          >
            <Maximize2 className="w-3 h-3" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded-md flex items-center justify-center text-white/70 hover:text-white hover:bg-rose-500/70 transition-colors"
            aria-label="Close window"
            data-testid={`button-close-${win.id}`}
          >
            <X className="w-3.5 h-3.5" strokeWidth={2.2} />
          </button>
        </div>
      </div>
      <div ref={setBodyEl} className="relative flex-1 min-h-0 overflow-auto" data-winter-window>
        {win.appId === "plexus-iq" ? (
          <DialogPortalContainerContext.Provider value={bodyEl}>
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                  Opening Plexus IQ…
                </div>
              }
            >
              <SidebarProvider defaultOpen={false} style={SIDEBAR_STYLE}>
                <PlexusIQPage />
              </SidebarProvider>
            </Suspense>
          </DialogPortalContainerContext.Provider>
        ) : (
          <iframe
            src={`${app.href}?embed=1`}
            title={title}
            className="absolute inset-0 w-full h-full border-0 bg-transparent"
            data-testid={`window-iframe-${win.id}`}
          />
        )}
        {/* While dragging/resizing, shield iframes so pointer events keep
            flowing to the captured handle. */}
        {interacting && <div className="absolute inset-0 z-10" />}
      </div>
      {!win.maximized && (
        <>
          {/* Edge + corner resize handles. Thin invisible strips; the SE
              corner keeps its visible grip (and legacy testid). */}
          {(
            [
              ["n", "top-0 left-3 right-3 h-1.5 cursor-ns-resize"],
              ["s", "bottom-0 left-3 right-3 h-1.5 cursor-ns-resize"],
              ["w", "left-0 top-3 bottom-3 w-1.5 cursor-ew-resize"],
              ["e", "right-0 top-3 bottom-3 w-1.5 cursor-ew-resize"],
              ["nw", "top-0 left-0 w-3 h-3 cursor-nwse-resize"],
              ["ne", "top-0 right-0 w-3 h-3 cursor-nesw-resize"],
              ["sw", "bottom-0 left-0 w-3 h-3 cursor-nesw-resize"],
            ] as const
          ).map(([dir, cls]) => (
            <div
              key={dir}
              className={`absolute ${cls} touch-none z-30`}
              onPointerDown={startResize(dir)}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              aria-label={`Resize window (${dir})`}
              data-testid={`resize-${dir}-${win.id}`}
            />
          ))}
          <div
            className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize touch-none z-30"
            onPointerDown={startResize("se")}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            aria-label="Resize window"
            data-testid={`resize-${win.id}`}
          >
            <svg viewBox="0 0 20 20" className="w-full h-full text-slate-500/70">
              <path d="M17 9v2l-6 6H9l8-8zM17 14v2l-1 1h-2l3-3z" fill="currentColor" />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}

export default function WinterHomePage({ user }: { user?: AuthUser }) {
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");
  const [dockExpanded, setDockExpanded] = useState(false);
  const [dockPinned, setDockPinned] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DOCK_PIN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [windows, setWindows] = useState<WinterWin[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [panelApp, setPanelApp] = useState<string | null>(null);
  const tabDragRef = useRef<{ id: number; sx: number; sy: number } | null>(null);
  const idRef = useRef(1);
  const zRef = useRef(100);
  const spawnCountRef = useRef(0);

  const userRole = user?.role ?? "clinician";

  useEffect(() => {
    try {
      localStorage.setItem(DOCK_PIN_KEY, dockPinned ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [dockPinned]);

  useEffect(() => {
    const anyOpen = windows.some((w) => !w.minimized);
    document.body.classList.toggle("winter-window-open", anyOpen);
    return () => document.body.classList.remove("winter-window-open");
  }, [windows]);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
      setDate(now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const { data: todaySummary } = useQuery<{ patientCount: number; batchCount: number }>({
    queryKey: ["/api/schedule/today-summary"],
    refetchInterval: 60_000,
  });

  const { data: calendarSummary = [] } = useQuery<CalendarSummaryRow[]>({
    queryKey: ["/api/screening-batches/calendar-summary"],
    staleTime: 60_000,
  });
  const bannerCalendarCells = useMemo(
    () => buildCommandCalendarCells({ summary: calendarSummary }),
    [calendarSummary],
  );

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(userRole));
  const primaryItems = visibleItems.filter((i) => PRIMARY_HREFS.includes(i.href));
  const overflowItems = visibleItems.filter((i) => !PRIMARY_HREFS.includes(i.href));

  const apps = useMemo<Record<string, AppDef>>(() => {
    const map: Record<string, AppDef> = {
      "plexus-iq": { appId: "plexus-iq", label: "Plexus IQ", Icon: Brain },
    };
    for (const item of visibleItems) {
      map[item.href] = { appId: item.href, label: item.label, Icon: item.Icon, href: item.href };
    }
    return map;
  }, [visibleItems]);

  const bringToFront = (id: number) => {
    setWindows((prev) => {
      const win = prev.find((w) => w.id === id);
      if (!win || win.z === zRef.current) return prev;
      zRef.current += 1;
      const z = zRef.current;
      return prev.map((w) => (w.id === id ? { ...w, z } : w));
    });
  };

  const spawnWindow = (appId: string, mode: "tab" | "window" = "tab") => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(1180, vw - 120);
    const h = Math.min(680, vh - 180);
    const step = spawnCountRef.current % 5;
    spawnCountRef.current += 1;
    zRef.current += 1;
    const id = idRef.current++;
    setWindows((prev) => [
      ...prev,
      {
        id,
        appId,
        mode,
        x: Math.max(20, (vw - w) / 2 + step * 30),
        y: Math.min(64 + step * 26, vh - h - 40 > 48 ? 64 + step * 26 : 56),
        w,
        h,
        minimized: false,
        maximized: false,
        z: zRef.current,
      },
    ]);
    if (mode === "tab") setActiveTabId(id);
  };

  const patchWindow = (id: number, patch: Partial<WinterWin>) =>
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  const closeWindow = (id: number) =>
    setWindows((prev) => {
      const next = prev.filter((w) => w.id !== id);
      setActiveTabId((cur) => {
        if (cur !== id) return cur;
        const remaining = next.filter((w) => w.mode === "tab");
        return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      });
      return next;
    });

  /** Detach a banner tab into a floating window near the pointer. */
  const detachTab = (id: number, cx: number, cy: number) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(1180, vw - 120);
    const h = Math.min(680, vh - 180);
    zRef.current += 1;
    const z = zRef.current;
    setWindows((prev) => {
      const next = prev.map((t) =>
        t.id === id
          ? {
              ...t,
              mode: "window" as const,
              x: Math.min(Math.max(cx - w / 2, 8), Math.max(8, vw - w - 8)),
              y: Math.min(Math.max(cy - 16, 48), Math.max(48, vh - 90)),
              w,
              h,
              maximized: false,
              minimized: false,
              z,
            }
          : t,
      );
      setActiveTabId((cur) => {
        if (cur !== id) return cur;
        const remaining = next.filter((t) => t.mode === "tab");
        return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      });
      return next;
    });
  };

  const windowsFor = (appId: string) => windows.filter((w) => w.appId === appId);
  const minimizedFor = (appId: string) => windowsFor(appId).filter((w) => w.minimized);

  const titleFor = (win: WinterWin) => {
    const app = apps[win.appId];
    const siblings = windowsFor(win.appId);
    if (siblings.length <= 1) return app?.label ?? win.appId;
    const idx = siblings.findIndex((w) => w.id === win.id) + 1;
    return `${app?.label ?? win.appId} ${idx}`;
  };

  const dockIconBase =
    "w-10 h-10 rounded-[10px] flex items-center justify-center shadow-lg transition-all duration-200 border border-white/20 bg-gradient-to-b from-sky-700/90 to-blue-900/90 group-hover:from-cyan-400 group-hover:to-teal-500 group-hover:shadow-[0_0_18px_rgba(45,212,191,0.8)] group-hover:border-cyan-200/60";

  const renderDockIcon = (
    Icon: (typeof NAV_ITEMS)[number]["Icon"],
    label: string,
    isActive: boolean,
    testId: string,
    minimizedCount: number,
    onBadgeClick?: () => void,
  ) => (
    <div className="relative group flex flex-col items-center cursor-pointer" data-testid={testId}>
      <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 backdrop-blur text-white text-[11px] px-2.5 py-1 rounded-md whitespace-nowrap pointer-events-none z-10">
        {label}
      </div>
      <div className={dockIconBase}>
        <Icon className="w-[22px] h-[22px] text-sky-100 group-hover:text-white transition-colors" strokeWidth={1.6} />
      </div>
      {minimizedCount > 0 && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onBadgeClick?.();
          }}
          className="absolute -top-1.5 -right-1.5 z-20 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border border-white/60 shadow cursor-pointer hover:bg-rose-600"
          aria-label={`${minimizedCount} minimized ${label} window${minimizedCount > 1 ? "s" : ""}`}
          data-testid={`dock-badge-${testId}`}
        >
          {minimizedCount}
        </span>
      )}
      <div className={`w-1 h-1 rounded-full mt-1 ${isActive ? "bg-cyan-300" : "bg-transparent"}`} />
    </div>
  );

  const renderDockApp = (appId: string, testId: string) => {
    const app = apps[appId];
    if (!app) return null;
    const minCount = minimizedFor(appId).length;
    const hasOpen = windowsFor(appId).length > 0;
    return (
      <button
        key={appId}
        type="button"
        onClick={() => spawnWindow(appId)}
        className="focus:outline-none"
        data-testid={testId}
      >
        {renderDockIcon(app.Icon, app.label, hasOpen, `dock-icon-${slugOf(appId)}`, minCount, () =>
          setPanelApp((cur) => (cur === appId ? null : appId)),
        )}
      </button>
    );
  };

  const panelWindows = panelApp ? minimizedFor(panelApp) : [];
  const tabs = windows.filter((w) => w.mode === "tab");
  const floatingWindows = windows.filter((w) => w.mode === "window");

  const onTabPointerDown = (id: number) => (e: React.PointerEvent) => {
    tabDragRef.current = { id, sx: e.clientX, sy: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onTabPointerMove = (id: number) => (e: React.PointerEvent) => {
    const d = tabDragRef.current;
    if (!d || d.id !== id) return;
    // Dragging the tab out of the banner turns it into a floating window.
    if (e.clientY - d.sy > 44) {
      tabDragRef.current = null;
      detachTab(id, e.clientX, e.clientY);
    }
  };
  const onTabPointerEnd = () => {
    tabDragRef.current = null;
  };

  return (
    <div className="relative h-full w-full overflow-hidden font-sans select-none">
      {/* Wallpaper */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url("/winter-wallpaper.png")' }}
      />

      {/* Falling snow */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
          @keyframes wh-snowfall {
            0% { transform: translateY(-10vh) translateX(0); opacity: 1; }
            100% { transform: translateY(110vh) translateX(20px); opacity: 0.3; }
          }
          .wh-snowflake {
            position: absolute;
            background: white;
            border-radius: 50%;
            filter: blur(1px);
            animation: wh-snowfall linear infinite;
          }
          /* Winter window: blend the embedded page into the glass window.
             The page shell goes transparent so the wallpaper glow shows
             through, while tiles stay more opaque than the page behind them. */
          [data-winter-window] .bg-slate-50\\/40,
          [data-winter-window] .bg-slate-50,
          [data-winter-window] .bg-slate-100 {
            background-color: transparent;
          }
          [data-winter-window] .bg-white {
            background-color: rgba(255, 255, 255, 0.72);
          }
          [data-winter-window] .rounded-3xl { border-radius: 0.625rem; }
          [data-winter-window] .rounded-2xl { border-radius: 0.5rem; }
          [data-winter-window] .rounded-xl { border-radius: 0.375rem; }
          /* Dialogs are portaled INTO the window body, so give them the
             glass treatment there; keep the body-level mirror for any
             stray portals that still land on <body>. */
          [data-winter-window] [role="dialog"],
          body.winter-window-open > [role="dialog"] {
            background-color: rgba(255, 255, 255, 0.86);
            backdrop-filter: blur(24px);
            border-radius: 0.5rem;
          }
          `,
        }}
      />
      {[...Array(40)].map((_, i) => (
        <div
          key={i}
          className="wh-snowflake"
          style={{
            left: `${(i * 61) % 100}vw`,
            animationDuration: `${((i * 7) % 50) / 10 + 5}s`,
            animationDelay: `-${(i * 13) % 10}s`,
            opacity: ((i * 17) % 50) / 100 + 0.3,
            width: `${((i * 11) % 30) / 10 + 2}px`,
            height: `${((i * 11) % 30) / 10 + 2}px`,
          }}
        />
      ))}

      {/* Glass status bar */}
      <div className="absolute top-0 left-0 right-0 z-40 flex h-12 items-center justify-between bg-white/10 px-5 backdrop-blur-xl border-b border-white/20 text-sm font-medium text-slate-700 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="text-[15px] font-bold tracking-tight bg-gradient-to-b from-sky-700 to-blue-900 bg-clip-text text-transparent shrink-0"
            data-testid="text-banner-brand"
          >
            Plexus Clinical
          </span>
          {todaySummary && (
            <>
              <div className="w-px h-4 bg-slate-400/40" />
              <span className="opacity-80 truncate" data-testid="text-today-summary">
                Today: {todaySummary.patientCount} pts · {todaySummary.batchCount} schedules
              </span>
            </>
          )}
        </div>

        {/* Banner tabs — dock apps open here; drag a tab down to float it. */}
        {tabs.length > 0 && (
          <div
            className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto px-3"
            data-testid="banner-tab-strip"
          >
            {tabs.map((t) => {
              const active = t.id === activeTabId;
              return (
                <div
                  key={t.id}
                  className={`group/tab flex items-center gap-1.5 shrink-0 rounded-md pl-3 pr-1.5 py-1 text-[13px] font-medium cursor-grab active:cursor-grabbing touch-none transition-colors select-none ${
                    active
                      ? "bg-white/30 text-slate-800 shadow-sm"
                      : "text-slate-600 hover:bg-white/20 hover:text-slate-800"
                  }`}
                  onPointerDown={onTabPointerDown(t.id)}
                  onPointerMove={onTabPointerMove(t.id)}
                  onPointerUp={onTabPointerEnd}
                  onPointerCancel={onTabPointerEnd}
                  onClick={() => setActiveTabId(t.id)}
                  data-testid={`banner-tab-${t.id}`}
                >
                  <span className="truncate max-w-[160px]">{titleFor(t)}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeWindow(t.id);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-white/40 transition-colors"
                    aria-label={`Close ${titleFor(t)} tab`}
                    data-testid={`banner-tab-close-${t.id}`}
                  >
                    <X className="w-3.5 h-3.5" strokeWidth={2.2} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-4 shrink-0">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 px-2 py-0.5 rounded hover:bg-white/25 transition-colors focus:outline-none"
                data-testid="text-clock"
              >
                <span>{date}</span>
                <span>{time}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              className="w-[380px] p-3 bg-white/90 backdrop-blur-xl border-white/50 shadow-2xl"
              data-testid="popover-banner-calendar"
            >
              <CanonicalMonthCalendar cells={bannerCalendarCells} />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Tab panes — full-screen frosted layers under the floating windows. */}
      {tabs.map((t) => {
        const app = apps[t.appId];
        if (!app) return null;
        return (
          <WinterTabPane
            key={t.id}
            win={t}
            app={app}
            title={titleFor(t)}
            active={t.id === activeTabId}
          />
        );
      })}

      {/* Desktop windows layer — no scrim: the desktop stays interactive. */}
      <div className="absolute inset-0 z-50 pointer-events-none">
        {floatingWindows.map((win) => {
          const app = apps[win.appId];
          if (!app) return null;
          return (
            <WinterWindow
              key={win.id}
              win={win}
              app={app}
              title={titleFor(win)}
              onFocus={() => bringToFront(win.id)}
              onClose={() => closeWindow(win.id)}
              onMinimize={() => patchWindow(win.id, { minimized: true })}
              onToggleMax={() => patchWindow(win.id, { maximized: !win.maximized })}
              onGeometry={(patch) => patchWindow(win.id, patch)}
            />
          );
        })}
      </div>

      {/* Dock */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[60] group/dock" data-testid="dock-container">
        {/* Minimized-windows panel (low-opacity glass box above the dock) */}
        {panelApp && panelWindows.length > 0 && (
          <div
            className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 min-w-[240px] max-w-[340px] rounded-xl bg-white/30 backdrop-blur-xl border border-white/40 shadow-2xl p-2 space-y-1"
            data-testid="dock-minimized-panel"
          >
            <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-700/90">
              {apps[panelApp]?.label} — minimized
            </div>
            {panelWindows.map((win) => (
              <div
                key={win.id}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/40 transition-colors"
                data-testid={`dock-minimized-entry-${win.id}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    patchWindow(win.id, { minimized: false });
                    bringToFront(win.id);
                    setPanelApp(null);
                  }}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left text-[13px] font-medium text-slate-800"
                  data-testid={`dock-minimized-restore-${win.id}`}
                >
                  {(() => {
                    const Icon = apps[win.appId]?.Icon ?? Brain;
                    return <Icon className="w-4 h-4 text-sky-700 shrink-0" />;
                  })()}
                  <span className="truncate">{titleFor(win)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => closeWindow(win.id)}
                  className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:text-rose-600 hover:bg-white/60 transition-colors"
                  aria-label="Close window"
                  data-testid={`dock-minimized-close-${win.id}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          className={`flex items-center gap-1.5 px-3 pb-1.5 pt-3 bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl rounded-2xl origin-bottom transition-all duration-300 ${
            dockPinned
              ? "opacity-100 scale-100"
              : "opacity-20 group-hover/dock:opacity-100"
          }`}
        >
          <div className="flex items-end gap-1.5">
            {primaryItems.map((item) =>
              renderDockApp(item.href, `dock-item-${item.href.replace(/\//g, "")}`),
            )}

            {/* Plexus IQ — opens as a window over the desktop */}
            {renderDockApp("plexus-iq", "dock-item-plexus-iq-window")}
          </div>

          {overflowItems.length > 0 && (
            <>
              <div className="w-px h-10 bg-white/30 mx-0.5" />
              <button
                type="button"
                onClick={() => setDockExpanded((v) => !v)}
                className="focus:outline-none self-center"
                aria-label={dockExpanded ? "Show fewer apps" : "Show more apps"}
                data-testid="button-dock-expand"
              >
                <div
                  className="relative group flex items-center justify-center cursor-pointer"
                  data-testid="dock-expand-icon"
                >
                  <div className="absolute -top-12 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 backdrop-blur text-white text-[11px] px-2.5 py-1 rounded-md whitespace-nowrap pointer-events-none z-10">
                    {dockExpanded ? "Less" : `More apps (${overflowItems.length})`}
                  </div>
                  <div className="w-8 h-10 flex items-center justify-center">
                    {dockExpanded ? (
                      <ChevronLeft
                        className="w-7 h-7 text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)] group-hover:text-sky-300/90 group-hover:drop-shadow-[0_0_8px_rgba(125,211,252,0.85)] transition-all animate-pulse group-hover:animate-none"
                        strokeWidth={2.5}
                      />
                    ) : (
                      <ChevronRight
                        className="w-7 h-7 text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)] group-hover:text-sky-300/90 group-hover:drop-shadow-[0_0_8px_rgba(125,211,252,0.85)] transition-all animate-pulse group-hover:animate-none"
                        strokeWidth={2.5}
                      />
                    )}
                  </div>
                </div>
              </button>
              <div
                className={`flex items-end gap-1.5 overflow-hidden transition-all duration-300 ease-out ${
                  dockExpanded ? "max-w-[900px] opacity-100" : "max-w-0 opacity-0"
                }`}
                data-testid="dock-overflow-section"
              >
                {overflowItems.map((item) =>
                  renderDockApp(item.href, `dock-item-${item.href.replace(/\//g, "")}`),
                )}
              </div>
            </>
          )}

          <div className="w-px h-10 bg-white/30 mx-0.5" />
          <button
            type="button"
            onClick={() => setDockPinned((v) => !v)}
            className="self-center w-7 h-7 rounded-md flex items-center justify-center text-white/70 hover:text-white hover:bg-white/15 transition-colors focus:outline-none"
            aria-label={dockPinned ? "Unpin dock (fade when not in use)" : "Pin dock (always visible)"}
            title={dockPinned ? "Unpin dock" : "Pin dock"}
            data-testid="button-dock-pin"
          >
            {dockPinned ? (
              <Pin className="w-4 h-4 drop-shadow" strokeWidth={2.2} />
            ) : (
              <PinOff className="w-4 h-4 drop-shadow" strokeWidth={2.2} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
