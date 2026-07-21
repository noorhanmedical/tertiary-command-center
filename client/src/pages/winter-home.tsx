import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Phone,
  DollarSign,
  Brain,
  X,
  Minus,
  Maximize2,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { NAV_ITEMS } from "@/components/GlobalNav";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CanonicalMonthCalendar } from "@/calendar";
import { buildCommandCalendarCells } from "@/lib/calendar/commandCalendarViewModel";
import type { CalendarSummaryRow } from "@/components/plexus-iq/PlexusIQCalendar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useHomeStats } from "@/hooks/api/home-stats";
import { SIDEBAR_STYLE, type AuthUser } from "@/App";

const PlexusIQPage = lazy(() => import("@/pages/plexus-iq"));

// Floating-window side cushion presets, smallest window (most cushion)
// first. Index = windowSizeLevel; +/- buttons in the title bar step it.
const WINDOW_SIZE_PADDING = [
  "px-44 pt-24 pb-32",
  "px-24 pt-16 pb-28",
  "px-12 pt-16 pb-24",
  "px-4 pt-14 pb-20",
];

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

function formatDollarsShort(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(value)}`;
}

function PulseChip({
  icon,
  value,
  upcoming,
  title,
  testId,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  upcoming?: React.ReactNode;
  title: string;
  testId: string;
}) {
  return (
    <div
      className="flex items-center gap-1 cursor-default rounded px-1.5 py-0.5 hover:bg-white/20 transition-colors"
      title={title}
      data-testid={testId}
    >
      {icon}
      <span className="font-semibold tabular-nums">{value}</span>
      {upcoming !== undefined && (
        <span className="text-emerald-600 font-semibold tabular-nums">{upcoming}</span>
      )}
    </div>
  );
}

function PracticePulseCompact() {
  const { data } = useHomeStats();
  if (!data) return null;
  const last7 = data.windows?.last7;
  const upcoming = data.upcoming;
  const finance = data.finance;
  return (
    <div className="flex items-center gap-2" data-testid="pulse-compact">
      <div className="flex items-center gap-1.5 pr-1">
        <Activity className="w-4 h-4 text-indigo-500" strokeWidth={2.25} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          Pulse
        </span>
      </div>
      <PulseChip
        icon={<Activity className="w-3.5 h-3.5 opacity-70" />}
        value={last7?.ancillaries ?? 0}
        upcoming={upcoming?.ancillaryPatients ?? 0}
        title={`Ancillaries: ${last7?.ancillaries ?? 0} last 7 days · ${upcoming?.ancillaryPatients ?? 0} scheduled next 7 days`}
        testId="pulse-ancillaries"
      />
      <PulseChip
        icon={<Phone className="w-3.5 h-3.5 opacity-70" />}
        value={last7?.callsPlanned ?? 0}
        upcoming={upcoming?.callsDistributed ?? 0}
        title={`Calls: ${last7?.callsPlanned ?? 0} last 7 days · ${upcoming?.callsDistributed ?? 0} anticipated next 7 days`}
        testId="pulse-calls"
      />
      <PulseChip
        icon={<DollarSign className="w-3.5 h-3.5 opacity-70" />}
        value={formatDollarsShort(finance?.last7 ?? 0)}
        upcoming={formatDollarsShort(finance?.upcoming ?? 0)}
        title={`Collected last 7 days: $${finance?.last7 ?? 0} · anticipated next 7 days: $${finance?.upcoming ?? 0}`}
        testId="pulse-finance"
      />
    </div>
  );
}

export default function WinterHomePage({ user }: { user?: AuthUser }) {
  const [location] = useLocation();
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");
  const [dockExpanded, setDockExpanded] = useState(false);
  const [openWindow, setOpenWindow] = useState<"plexus-iq" | null>(null);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [windowMinimized, setWindowMinimized] = useState(false);
  const [windowSizeLevel, setWindowSizeLevel] = useState(1);

  useEffect(() => {
    if (openWindow && !windowMinimized) {
      document.body.classList.add("winter-window-open");
    } else {
      document.body.classList.remove("winter-window-open");
    }
    return () => document.body.classList.remove("winter-window-open");
  }, [openWindow, windowMinimized]);
  const userRole = user?.role ?? "clinician";

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

  useEffect(() => {
    if (openWindow === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenWindow(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openWindow]);

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

  const dockIconBase =
    "w-10 h-10 rounded-[10px] flex items-center justify-center shadow-lg transform transition-all duration-200 origin-bottom group-hover:scale-[1.35] group-hover:-translate-y-2 border border-white/20 bg-gradient-to-b from-sky-700/90 to-blue-900/90 group-hover:from-cyan-400 group-hover:to-teal-500 group-hover:shadow-[0_0_18px_rgba(45,212,191,0.8)] group-hover:border-cyan-200/60";

  const renderDockIcon = (
    Icon: (typeof NAV_ITEMS)[number]["Icon"],
    label: string,
    isActive: boolean,
    testId: string,
  ) => (
    <div className="relative group flex flex-col items-center cursor-pointer" data-testid={testId}>
      <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 backdrop-blur text-white text-[11px] px-2.5 py-1 rounded-md whitespace-nowrap pointer-events-none z-10">
        {label}
      </div>
      <div className={dockIconBase}>
        <Icon className="w-[22px] h-[22px] text-sky-100 group-hover:text-white transition-colors" strokeWidth={1.6} />
      </div>
      <div className={`w-1 h-1 rounded-full mt-1 ${isActive ? "bg-cyan-300" : "bg-transparent"}`} />
    </div>
  );

  const renderDockItem = (item: (typeof NAV_ITEMS)[number]) => {
    const isActive = location === item.href || location.startsWith(item.href + "/");
    return (
      <Link key={item.href} href={item.href}>
        {renderDockIcon(item.Icon, item.label, isActive, `dock-item-${item.href.replace(/\//g, "")}`)}
      </Link>
    );
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
          /* Portaled dialogs (Admin Review etc.) render outside the window
             DOM, so mirror the same glass treatment on them while a winter
             window is open. */
          body.winter-window-open [role="dialog"] {
            background-color: rgba(255, 255, 255, 0.86);
            backdrop-filter: blur(24px);
            border-radius: 0.5rem;
          }
          body.winter-window-open [role="dialog"] .bg-slate-50\\/40,
          body.winter-window-open [role="dialog"] .bg-slate-50,
          body.winter-window-open [role="dialog"] .bg-slate-100 {
            background-color: transparent;
          }
          body.winter-window-open [role="dialog"] .bg-white {
            background-color: rgba(255, 255, 255, 0.72);
          }
          body.winter-window-open [role="dialog"] .rounded-3xl { border-radius: 0.625rem; }
          body.winter-window-open [role="dialog"] .rounded-2xl { border-radius: 0.5rem; }
          body.winter-window-open [role="dialog"] .rounded-xl { border-radius: 0.375rem; }
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
          <div className="w-px h-4 bg-slate-400/40" />
          <PracticePulseCompact />
          {todaySummary && (
            <>
              <div className="w-px h-4 bg-slate-400/40" />
              <span className="opacity-80 truncate" data-testid="text-today-summary">
                Today: {todaySummary.patientCount} pts · {todaySummary.batchCount} schedules
              </span>
            </>
          )}
        </div>
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

      {/* App window overlay */}
      {openWindow === "plexus-iq" && (
        <div
          className={`absolute inset-0 z-50 flex items-center justify-center transition-all duration-200 ${
            windowMaximized ? "p-0" : WINDOW_SIZE_PADDING[windowSizeLevel]
          } ${windowMinimized ? "hidden" : ""}`}
        >
          <div
            className="absolute inset-0 bg-slate-900/25 backdrop-blur-[2px]"
            onClick={() => setOpenWindow(null)}
            data-testid="window-scrim"
          />
          <div
            className={`relative flex flex-col w-full h-full border border-white/40 bg-white/35 backdrop-blur-2xl shadow-[0_40px_120px_rgba(15,23,42,0.45)] overflow-hidden ${
              windowMaximized ? "max-w-none rounded-none" : "max-w-[1500px] rounded-lg"
            }`}
            data-testid="window-plexus-iq"
          >
            <div className="flex items-center gap-2 h-10 px-4 bg-gradient-to-b from-sky-700/50 to-blue-900/50 backdrop-blur-xl border-b border-white/20 shrink-0">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-white/95">
                <Brain className="w-4 h-4 text-sky-200" />
                Plexus IQ
              </div>
              <div className="ml-auto flex items-center gap-2">
                <div className="flex items-center gap-1 mr-2">
                  <button
                    type="button"
                    onClick={() => setWindowSizeLevel((v) => Math.max(0, v - 1))}
                    disabled={windowMaximized || windowSizeLevel === 0}
                    className="w-5 h-5 rounded-[4px] flex items-center justify-center text-white/80 hover:text-white hover:bg-white/15 disabled:opacity-30 transition-colors text-[13px] font-bold leading-none"
                    aria-label="Make window smaller"
                    data-testid="button-window-smaller"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => setWindowSizeLevel((v) => Math.min(WINDOW_SIZE_PADDING.length - 1, v + 1))}
                    disabled={windowMaximized || windowSizeLevel === WINDOW_SIZE_PADDING.length - 1}
                    className="w-5 h-5 rounded-[4px] flex items-center justify-center text-white/80 hover:text-white hover:bg-white/15 disabled:opacity-30 transition-colors text-[13px] font-bold leading-none"
                    aria-label="Make window bigger"
                    data-testid="button-window-bigger"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setWindowMinimized(true)}
                  className="w-3.5 h-3.5 rounded-[4px] bg-yellow-400 hover:bg-yellow-500 flex items-center justify-center group transition-colors"
                  aria-label="Minimize to dock"
                  data-testid="button-restore-window"
                >
                  <Minus className="w-2.5 h-2.5 text-yellow-900 opacity-0 group-hover:opacity-100" strokeWidth={3} />
                </button>
                <button
                  type="button"
                  onClick={() => setWindowMaximized((v) => !v)}
                  className="w-3.5 h-3.5 rounded-[4px] bg-green-400 hover:bg-green-500 flex items-center justify-center group transition-colors"
                  aria-label={windowMaximized ? "Restore window size" : "Expand window"}
                  data-testid="button-maximize-window"
                >
                  <Maximize2 className="w-2 h-2 text-green-900 opacity-0 group-hover:opacity-100" strokeWidth={3} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpenWindow(null)}
                  className="w-3.5 h-3.5 rounded-[4px] bg-red-400 hover:bg-red-500 flex items-center justify-center group transition-colors"
                  aria-label="Close window"
                  data-testid="button-close-window"
                >
                  <X className="w-2.5 h-2.5 text-red-900 opacity-0 group-hover:opacity-100" strokeWidth={3} />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto" data-winter-window>
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
            </div>
          </div>
        </div>
      )}

      {/* Dock */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[60] group/dock" data-testid="dock-container">
        <div className="flex items-end gap-1.5 px-3 pb-1.5 pt-3 bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl rounded-2xl opacity-[0.12] scale-[0.88] origin-bottom group-hover/dock:opacity-100 group-hover/dock:scale-100 transition-all duration-300">
          {primaryItems.map(renderDockItem)}

          {/* Plexus IQ — opens as a window over the desktop */}
          <button
            type="button"
            onClick={() => {
              if (openWindow === "plexus-iq" && windowMinimized) {
                setWindowMinimized(false);
              } else {
                setWindowMaximized(false);
                setWindowMinimized(false);
                setOpenWindow("plexus-iq");
              }
            }}
            className="focus:outline-none"
            data-testid="dock-item-plexus-iq-window"
          >
            {renderDockIcon(Brain, "Plexus IQ", openWindow === "plexus-iq", "dock-icon-plexus-iq")}
          </button>

          {overflowItems.length > 0 && (
            <>
              <div className="w-px h-10 bg-white/30 mx-0.5 self-start mt-2" />
              <button
                type="button"
                onClick={() => setDockExpanded((v) => !v)}
                className="focus:outline-none"
                aria-label={dockExpanded ? "Show fewer apps" : "Show more apps"}
                data-testid="button-dock-expand"
              >
                <div
                  className="relative group flex flex-col items-center cursor-pointer"
                  data-testid="dock-expand-icon"
                >
                  <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 backdrop-blur text-white text-[11px] px-2.5 py-1 rounded-md whitespace-nowrap pointer-events-none z-10">
                    {dockExpanded ? "Less" : `More (${overflowItems.length})`}
                  </div>
                  <div className="w-7 h-10 flex items-center justify-center transform transition-all duration-200 origin-bottom group-hover:scale-[1.35] group-hover:-translate-y-2">
                    {dockExpanded ? (
                      <ChevronLeft
                        className="w-6 h-6 text-white/50 group-hover:text-white drop-shadow transition-colors"
                        strokeWidth={2}
                      />
                    ) : (
                      <ChevronRight
                        className="w-6 h-6 text-white/50 group-hover:text-white drop-shadow transition-colors"
                        strokeWidth={2}
                      />
                    )}
                  </div>
                  <div className="w-1 h-1 mt-1" />
                </div>
              </button>
              <div
                className={`flex items-end gap-1.5 overflow-hidden transition-all duration-300 ease-out ${
                  dockExpanded ? "max-w-[900px] opacity-100" : "max-w-0 opacity-0"
                }`}
                data-testid="dock-overflow-section"
              >
                {overflowItems.map(renderDockItem)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
