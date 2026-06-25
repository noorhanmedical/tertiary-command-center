import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Phone, CalendarPlus, Sparkles, Building2, ShieldCheck, ChevronLeft, Clock, Stethoscope,
} from "lucide-react";
import { initials } from "./profileTypes";
import { CHART_SECTIONS, SectionSkeleton } from "./PatientChartSections";
import { type EmrChart, COOLDOWN_STATE_TONES } from "@/types/emr";

const TONE_PILL: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  slate: "bg-slate-100 text-slate-700 dark:bg-muted dark:text-foreground",
};

export function PatientChart({
  chart,
  onBack,
  onSchedule,
  loadingSections,
  onVisibleSectionsChange,
}: {
  chart: EmrChart;
  onBack?: () => void;
  /** When provided, the Schedule button opens this in-portal calendar popup
   *  instead of navigating to /appointments. */
  onSchedule?: () => void;
  /** Section ids whose backing query is still loading → render a skeleton. */
  loadingSections?: Set<string>;
  /** Reports the section ids currently intersecting the scroll viewport so the
   *  parent can lazily enable heavy per-section queries (no upfront waterfall). */
  onVisibleSectionsChange?: (ids: string[]) => void;
}) {
  const d = chart.demographics;
  const [activeSection, setActiveSection] = useState<string>(CHART_SECTIONS[0].id);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const manualScrollUntil = useRef<number>(0);
  const visibleSignature = useRef<string>("");

  // Active-section tracking + visible-section reporting via scroll position.
  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const top = cRect.top;

    // Report which sections currently intersect the viewport (for lazy loads).
    if (onVisibleSectionsChange) {
      const visible: string[] = [];
      for (const s of CHART_SECTIONS) {
        const el = document.getElementById(`section-${s.id}`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        // Intersects the container viewport (with a small prefetch margin).
        if (r.bottom >= cRect.top - 200 && r.top <= cRect.bottom + 200) visible.push(s.id);
      }
      const sig = visible.join(",");
      if (sig !== visibleSignature.current) {
        visibleSignature.current = sig;
        onVisibleSectionsChange(visible);
      }
    }

    if (Date.now() < manualScrollUntil.current) return;
    let current = CHART_SECTIONS[0].id;
    for (const s of CHART_SECTIONS) {
      const el = document.getElementById(`section-${s.id}`);
      if (!el) continue;
      // The first section whose top is at/above the 120px marker wins.
      if (el.getBoundingClientRect().top - top <= 120) current = s.id;
      else break;
    }
    setActiveSection(current);
  }, [onVisibleSectionsChange]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(`section-${id}`);
    const container = scrollRef.current;
    if (!el || !container) return;
    manualScrollUntil.current = Date.now() + 700;
    setActiveSection(id);
    const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 12;
    container.scrollTo({ top, behavior: "smooth" });
  }, []);

  const phoneHref = d.phoneNumber ? `tel:${d.phoneNumber.replace(/[^\d+]/g, "")}` : null;
  const csTone = chart.caseStatus.tone ?? "slate";
  const cdTone = COOLDOWN_STATE_TONES[chart.cooldown.state ?? "clear"];

  return (
    <div className="flex flex-col h-full" data-testid="patient-chart">
      {/* ── Sticky patient header ── */}
      <header className="border-b border-slate-200/80 dark:border-border/60 bg-white/85 dark:bg-card/80 backdrop-blur px-4 py-2.5 shrink-0" data-testid="chart-header">
        <div className="flex items-center gap-2.5">
          {onBack && (
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 lg:hidden" onClick={onBack} data-testid="button-chart-back">
              <ChevronLeft className="w-4 h-4" />
            </Button>
          )}
          <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-semibold shrink-0">
            {initials(d.name || "?")}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h1 className="text-base font-bold leading-tight truncate" data-testid="text-chart-name">{d.name || "Unknown patient"}</h1>
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${TONE_PILL[csTone]}`} data-testid="badge-case-status">
                {chart.caseStatus.label}
              </span>
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${TONE_PILL[cdTone]}`} data-testid="badge-header-cooldown">
                <Clock className="w-3 h-3" />{chart.cooldown.stateLabel}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-2.5 gap-y-0" data-testid="text-chart-demographics">
              <span>{d.mrn ? `MRN ${d.mrn}` : "MRN —"}</span>
              <span>{d.dob ? `DOB ${d.dob}` : "DOB —"}</span>
              <span>{[d.age ? `${d.age}yo` : null, d.gender].filter(Boolean).join(" · ") || "Age/Gender —"}</span>
              <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{d.clinic || "—"}</span>
              <span className="flex items-center gap-1" data-testid="text-chart-provider"><Stethoscope className="w-3 h-3" />{d.provider || "Provider —"}</span>
              <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3" />{chart.insurance.primary || "Insurance —"}</span>
              {d.phoneNumber && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{d.phoneNumber}</span>}
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            {phoneHref ? (
              <a href={phoneHref} data-testid="button-chart-call"><Button size="sm" variant="outline" className="h-7 gap-1.5"><Phone className="w-3.5 h-3.5" />Call</Button></a>
            ) : (
              <Button size="sm" variant="outline" className="h-7 gap-1.5" disabled data-testid="button-chart-call"><Phone className="w-3.5 h-3.5" />Call</Button>
            )}
            {onSchedule ? (
              <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={onSchedule} data-testid="button-chart-schedule"><CalendarPlus className="w-3.5 h-3.5" />Schedule</Button>
            ) : (
              <Link href="/appointments" data-testid="button-chart-schedule"><Button size="sm" variant="outline" className="h-7 gap-1.5"><CalendarPlus className="w-3.5 h-3.5" />Schedule</Button></Link>
            )}
            <Link href="/plexus-iq" data-testid="button-chart-plexus"><Button size="sm" className="h-7 gap-1.5"><Sparkles className="w-3.5 h-3.5" />Plexus IQ</Button></Link>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* ── Left-rail section nav ── */}
        <nav className="hidden xl:flex flex-col w-56 shrink-0 border-r border-slate-200/70 dark:border-border/50 overflow-y-auto py-3 px-2 bg-white/40 dark:bg-card/30" data-testid="chart-section-nav">
          {CHART_SECTIONS.map((s) => {
            const active = activeSection === s.id;
            return (
              <button
                key={s.id}
                onClick={() => scrollToSection(s.id)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-[13px] transition-colors ${active ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-200 font-semibold" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-muted/50"}`}
                data-testid={`nav-section-${s.id}`}
              >
                <span className={active ? "text-indigo-600 dark:text-indigo-300" : "text-slate-400"}>{s.icon}</span>
                <span className="truncate">{s.label}</span>
              </button>
            );
          })}
        </nav>

        {/* ── Scrollable section content ── */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto" data-testid="chart-scroll">
          {/* Mobile/tablet horizontal section nav */}
          <div className="xl:hidden sticky top-0 z-10 bg-finance-bg/95 backdrop-blur border-b border-slate-200/70 dark:border-border/50 px-3 py-2 overflow-x-auto">
            <div className="flex items-center gap-1.5 w-max">
              {CHART_SECTIONS.map((s) => {
                const active = activeSection === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => scrollToSection(s.id)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${active ? "bg-slate-900 text-white" : "bg-slate-100 dark:bg-muted text-slate-600 dark:text-slate-300"}`}
                    data-testid={`nav-pill-${s.id}`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 space-y-5">
            {CHART_SECTIONS.map((s) => {
              if (loadingSections?.has(s.id)) {
                return <SectionSkeleton key={s.id} id={s.id} title={s.label} icon={s.icon} />;
              }
              const Comp = s.Component;
              return <Comp key={s.id} chart={chart} />;
            })}
            <div className="h-32" aria-hidden />
          </div>
        </div>
      </div>
    </div>
  );
}

// Instant chart frame painted while the patient's summary (profile) query is
// still in flight. Shows the seeded name from the call-list/roster context so
// the chart never blanks to a full-page spinner.
export function PatientChartSkeleton({ seedName, onBack }: { seedName?: string | null; onBack?: () => void }) {
  return (
    <div className="flex flex-col h-full" data-testid="patient-chart-skeleton">
      <header className="border-b border-slate-200/80 dark:border-border/60 bg-white/85 dark:bg-card/80 backdrop-blur px-5 py-4 shrink-0" data-testid="chart-header-skeleton">
        <div className="flex items-start gap-3">
          {onBack && (
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 lg:hidden" onClick={onBack} data-testid="button-chart-back">
              <ChevronLeft className="w-4 h-4" />
            </Button>
          )}
          <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-sm font-semibold shrink-0">
            {initials(seedName || "?")}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold leading-tight truncate" data-testid="text-chart-name">
              {seedName || "Loading patient…"}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 animate-pulse">
              <div className="h-3 w-24 rounded bg-slate-200/80 dark:bg-muted" />
              <div className="h-3 w-20 rounded bg-slate-200/70 dark:bg-muted/80" />
              <div className="h-3 w-28 rounded bg-slate-200/60 dark:bg-muted/70" />
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <nav className="hidden xl:flex flex-col w-56 shrink-0 border-r border-slate-200/70 dark:border-border/50 overflow-y-auto py-3 px-2 bg-white/40 dark:bg-card/30">
          {CHART_SECTIONS.map((s) => (
            <div key={s.id} className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-500 dark:text-slate-400">
              <span className="text-slate-400">{s.icon}</span>
              <span className="truncate">{s.label}</span>
            </div>
          ))}
        </nav>
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 space-y-5">
            {CHART_SECTIONS.slice(0, 6).map((s) => (
              <SectionSkeleton key={s.id} id={s.id} title={s.label} icon={s.icon} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
