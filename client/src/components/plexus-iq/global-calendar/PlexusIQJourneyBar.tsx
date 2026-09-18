// Minimal "Journey" bar for the Plexus IQ page.
//
// Very simplistic: each item is just a title, an icon, and a number, separated
// by thin dividers. No extra chrome.
//
// Metrics:
//   - Overall All Patients   (real)
//   - Qualified by Plexus IQ (real)
//   - Total Called           (NOT connected yet → renders "—" with a subtle
//                             "Not connected" hint; slot kept for later wiring)
//   - Total Scheduled        (real)
//   - Completed Today        (real)

import {
  CheckCircle2,
  CalendarCheck,
  PhoneCall,
  Sparkles,
  Users,
} from "lucide-react";

export type JourneyMetrics = {
  allPatients: number;
  qualified: number;
  // null = feed not connected yet (render "—" + Not connected).
  totalCalled: number | null;
  totalScheduled: number;
  completedToday: number;
};

export function PlexusIQJourneyBar({ metrics }: { metrics: JourneyMetrics }) {
  const items = [
    { title: "Overall All Patients", icon: <Users className="h-4 w-4" />, value: metrics.allPatients },
    { title: "Qualified by Plexus IQ", icon: <Sparkles className="h-4 w-4" />, value: metrics.qualified },
    { title: "Total Called", icon: <PhoneCall className="h-4 w-4" />, value: metrics.totalCalled },
    { title: "Total Scheduled", icon: <CalendarCheck className="h-4 w-4" />, value: metrics.totalScheduled },
    { title: "Completed Today", icon: <CheckCircle2 className="h-4 w-4" />, value: metrics.completedToday },
  ];

  return (
    <div
      className="flex items-stretch rounded-[14px] border border-slate-200 bg-white px-2 py-3 shadow-sm"
      data-testid="plexus-iq-journey-bar"
    >
      {items.map((it, i) => {
        const notConnected = it.value === null;
        return (
          <div key={it.title} className="flex flex-1 items-stretch">
            {i > 0 && <div className="my-1 w-px bg-slate-200" aria-hidden="true" />}
            <div
              className="flex flex-1 flex-col items-center justify-center px-2 text-center"
              data-testid={`journey-metric-${it.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            >
              <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-slate-500">
                {it.title}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="text-slate-400">{it.icon}</span>
                <span className="text-[20px] font-semibold tabular-nums leading-none text-slate-900">
                  {notConnected ? "—" : it.value}
                </span>
              </div>
              {notConnected && (
                <div className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.06em] text-slate-300">
                  Not connected
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
