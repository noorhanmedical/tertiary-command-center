// Ultrasound Central — read-only ultrasound overview.
//
// A focused, green-themed cockpit for the ultrasound service line. It
// summarizes ultrasound demand across the schedule the rest of the app
// already loads (/api/schedule/dashboard): today's ultrasound load by
// site, the month's ultrasound volume, and a breakdown by specific
// study type (carotid, echo, renal, etc.).
//
// No new endpoints or schema — every number is derived from existing
// dashboard data, classified with the shared ancillary categorizer so
// it stays in lockstep with the rest of the app.

import { useMemo } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Waves, Activity, MapPin, CalendarDays, ExternalLink, Sparkles } from "lucide-react";
import { useScheduleDashboard } from "@/hooks/api/dashboard";
import { getAncillaryCategory } from "@shared/ancillaryCategory";

export default function UltrasoundCentralPage() {
  const { data: dashboard, isLoading, isError } = useScheduleDashboard({});

  const today = dashboard?.today ?? "";
  const clinicTabs = dashboard?.clinicTabs ?? [];

  // Per-site ultrasound load for today.
  const siteSummaries = useMemo(() => {
    return clinicTabs
      .map((tab) => {
        const cell = tab.monthCells.find((c) => c.isoDate === today) || null;
        const patients = cell?.patients ?? [];
        let ultrasoundCount = 0;
        const patientsWithUltrasound = new Set<number>();
        for (const p of patients) {
          for (const a of p.ancillaries ?? []) {
            if (getAncillaryCategory(a) === "ultrasound") {
              ultrasoundCount += 1;
              patientsWithUltrasound.add(p.id);
            }
          }
        }
        return {
          clinicKey: tab.clinicKey,
          clinicLabel: tab.clinicLabel,
          patientCount: cell?.patientCount ?? 0,
          ultrasoundCount,
          ultrasoundPatients: patientsWithUltrasound.size,
        };
      })
      .sort((a, b) => b.ultrasoundCount - a.ultrasoundCount);
  }, [clinicTabs, today]);

  // Month-wide ultrasound breakdown by specific study type.
  const monthBreakdown = useMemo(() => {
    const byType: Record<string, number> = {};
    let monthTotal = 0;
    const seenCells = new Set<string>();
    for (const tab of clinicTabs) {
      for (const cell of tab.monthCells) {
        // monthCells can repeat isoDate across clinic tabs; we want every
        // tab's cells since each tab is a distinct site.
        const cellKey = `${tab.clinicKey}:${cell.isoDate}`;
        if (seenCells.has(cellKey)) continue;
        seenCells.add(cellKey);
        for (const p of cell.patients ?? []) {
          for (const a of p.ancillaries ?? []) {
            if (getAncillaryCategory(a) === "ultrasound") {
              byType[a] = (byType[a] || 0) + 1;
              monthTotal += 1;
            }
          }
        }
      }
    }
    const types = Object.entries(byType)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    return { types, monthTotal };
  }, [clinicTabs]);

  const todayTotal = siteSummaries.reduce((s, x) => s + x.ultrasoundCount, 0);
  const activeSitesToday = siteSummaries.filter((s) => s.ultrasoundCount > 0).length;

  const metricCards = [
    { label: "Ultrasound Today", value: todayTotal, Icon: Waves },
    { label: "Ultrasound This Month", value: monthBreakdown.monthTotal, Icon: Activity },
    { label: "Sites Active Today", value: activeSitesToday, Icon: MapPin },
  ];

  return (
    <div className="flex flex-col h-full">
      <header className="bg-white border-b border-slate-200/60 sticky top-0 z-30">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/15 to-green-500/15 text-emerald-700">
            <Waves className="w-5 h-5" strokeWidth={1.75} />
          </span>
          <div>
            <div className="text-[10px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
              PLEXUS ANCILLARY · ULTRASOUND CENTRAL
            </div>
            <h1
              className="text-xl font-semibold tracking-tight text-slate-900"
              data-testid="text-ultrasound-central-title"
            >
              Ultrasound Central
            </h1>
            <p className="text-[11px] text-slate-500">
              Read-only overview of ultrasound demand across sites and study types.
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-auto bg-slate-50/40">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 max-w-6xl mx-auto">
          {isLoading && (
            <div className="py-12 text-center text-slate-400 text-sm" data-testid="status-ultrasound-central-loading">
              Loading ultrasound data…
            </div>
          )}

          {!isLoading && isError && (
            <div
              className="py-12 text-center text-red-600 text-sm rounded-lg border border-red-200 bg-red-50"
              data-testid="status-ultrasound-central-error"
            >
              Couldn't load ultrasound data. Please refresh to try again.
            </div>
          )}

          {!isLoading && !isError && (
            <>
              {/* Top-line metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="ultrasound-central-metrics">
                {metricCards.map((m) => (
                  <Card key={m.label} className="p-4 flex items-center gap-3" data-testid={`metric-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700">
                      <m.Icon className="w-5 h-5" />
                    </span>
                    <div>
                      <div className="text-2xl font-bold tabular-nums text-emerald-700">{m.value}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{m.label}</div>
                    </div>
                  </Card>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Today's ultrasound load by site */}
                <Card className="p-4 space-y-3" data-testid="ultrasound-central-by-site">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700">
                        <MapPin className="w-4 h-4" />
                      </span>
                      <span className="font-semibold text-slate-800 text-sm">Today's Ultrasound by Site</span>
                    </div>
                    <Link href="/plexus-iq" className="text-xs text-emerald-700 hover:underline flex items-center gap-1" data-testid="link-plexus-iq">
                      Plexus IQ <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>

                  {siteSummaries.length === 0 || todayTotal === 0 ? (
                    <div className="py-6 text-center text-slate-400 text-sm" data-testid="empty-ultrasound-sites">
                      No ultrasound studies scheduled today.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {siteSummaries
                        .filter((s) => s.ultrasoundCount > 0)
                        .map((s) => (
                          <div key={s.clinicKey} className="flex items-center justify-between py-2.5" data-testid={`site-row-${s.clinicKey}`}>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-800 truncate">{s.clinicLabel}</div>
                              <div className="text-[11px] text-slate-500">{s.ultrasoundPatients} patients · {s.patientCount} on schedule</div>
                            </div>
                            <span className="rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-semibold px-2.5 py-1 tabular-nums shrink-0">
                              {s.ultrasoundCount} studies
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </Card>

                {/* Month breakdown by study type */}
                <Card className="p-4 space-y-3" data-testid="ultrasound-central-by-type">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700">
                      <CalendarDays className="w-4 h-4" />
                    </span>
                    <span className="font-semibold text-slate-800 text-sm">This Month by Study Type</span>
                  </div>

                  {monthBreakdown.types.length === 0 ? (
                    <div className="py-6 text-center text-slate-400 text-sm" data-testid="empty-ultrasound-types">
                      No ultrasound studies on the current schedule.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {monthBreakdown.types.map((t) => {
                        const pct = monthBreakdown.monthTotal > 0 ? Math.round((t.count / monthBreakdown.monthTotal) * 100) : 0;
                        return (
                          <div key={t.name} data-testid={`type-row-${t.name.toLowerCase().replace(/\s+/g, "-")}`}>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-700 truncate pr-2">{t.name}</span>
                              <span className="font-semibold text-slate-900 tabular-nums shrink-0">{t.count}</span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </div>

              {/* Quick links */}
              <Card className="p-4 space-y-3" data-testid="ultrasound-central-quick-links">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Quick Links</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {[
                    { href: "/plexus-iq", label: "Plexus IQ", Icon: Sparkles, color: "text-violet-600" },
                    { href: "/dashboard", label: "Full Dashboard", Icon: CalendarDays, color: "text-indigo-600" },
                    { href: "/mission-control", label: "Mission Control", Icon: Activity, color: "text-emerald-600" },
                  ].map((q) => (
                    <Link
                      key={q.href}
                      href={q.href}
                      className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors text-sm text-slate-700 font-medium"
                      data-testid={`quick-link-${q.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <q.Icon className={`w-4 h-4 shrink-0 ${q.color}`} />
                      <span className="truncate">{q.label}</span>
                    </Link>
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
