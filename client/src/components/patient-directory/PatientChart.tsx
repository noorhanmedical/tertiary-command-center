/**
 * PatientChart — the patient workspace shell.
 *
 * Architecture:
 *   PATIENT HEADER (sticky)
 *   INTELLIGENCE STRIP (sticky below header)
 *   LEFT CHART NAV (grouped, scroll-spy) + CONTINUOUS SCROLLABLE CONTENT
 *
 * All permitted sections render in one continuous scroll.
 * Nav click = smooth scroll to section anchor.
 * Scroll = spy updates active nav item.
 * Data Signals is always LAST.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Phone, CalendarPlus, Building2, ShieldCheck, ChevronLeft, ChevronRight,
  Stethoscope, MessageSquare, User as UserIcon,
} from "lucide-react";
import {
  CHART_SECTIONS, SectionSkeleton, SectionSummaryCard, AccessDeniedSection,
  sectionSummaryLine, EcwSyncContext, EpisodeDocsProvider,
} from "./PatientChartSections";
import { type EmrChart } from "@/types/emr";
import { usePatientDirectorySectionAccess } from "@/hooks/usePatientDirectorySectionAccess";

// ─── Nav group labels ─────────────────────────────────────────────────────
const GROUP_LABELS: Record<string, string> = {
  identity: "PATIENT",
  overview: "PATIENT OVERVIEW",
  intelligence: "PLEXUS INTELLIGENCE",
  clinical: "SOURCE CLINICAL DATA",
  operations: "OPERATIONS & PLEXUS CLINICAL WORKFLOW",
  deep: "PLEXUS DEEP INTELLIGENCE",
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
  onSchedule?: () => void;
  loadingSections?: Set<string>;
  onVisibleSectionsChange?: (ids: string[]) => void;
}) {
  const d = chart.demographics;
  const { getSectionAccess } = usePatientDirectorySectionAccess();
  const [navCollapsed, setNavCollapsed] = useState(false);

  const navSections = CHART_SECTIONS.filter((s) => getSectionAccess(s.id) !== "hidden");
  const [activeSection, setActiveSection] = useState<string>(navSections[0]?.id ?? "overview");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const manualScrollUntil = useRef<number>(0);
  const visibleSig = useRef<string>("");

  // ─── Scroll-spy ─────────────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();

    // Report visible sections for lazy loading
    if (onVisibleSectionsChange) {
      const visible: string[] = [];
      for (const s of CHART_SECTIONS) {
        const el = document.getElementById(`section-${s.id}`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom >= cRect.top - 200 && r.top <= cRect.bottom + 200) visible.push(s.id);
      }
      const sig = visible.join(",");
      if (sig !== visibleSig.current) {
        visibleSig.current = sig;
        onVisibleSectionsChange(visible);
      }
    }

    if (Date.now() < manualScrollUntil.current) return;
    let current = navSections[0]?.id ?? "overview";
    for (const s of CHART_SECTIONS) {
      const el = document.getElementById(`section-${s.id}`);
      if (!el) continue;
      if (el.getBoundingClientRect().top - cRect.top <= 140) current = s.id;
      else break;
    }
    setActiveSection(current);
  }, [onVisibleSectionsChange, navSections]);

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
    const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 16;
    container.scrollTo({ top, behavior: "smooth" });
  }, []);

  const phoneHref = d.phoneNumber ? `tel:${d.phoneNumber.replace(/[^\d+]/g, "")}` : null;

  return (
    <div className="flex flex-col h-full" data-testid="patient-chart" style={{ background: "#F3F6FA" }}>
      {/* ═══════════════════════════════════════════════════════════════════
          PATIENT HEADER — sticky, ~88px, gradient background
          ═══════════════════════════════════════════════════════════════════ */}
      <header
        className="sticky top-0 z-20 shrink-0 border-b"
        style={{ background: "linear-gradient(90deg, #FFFFFF 0%, #F5F8FF 55%, #EEF4FF 100%)", borderColor: "#E2E8F0", padding: "12px 18px" }}
        data-testid="chart-header"
      >
        <div className="flex items-center gap-4">
          {onBack && (
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 lg:hidden" onClick={onBack}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
          )}
          {/* Silhouette avatar */}
          <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ background: "#E8EEF7" }}>
            <UserIcon className="w-6 h-6" style={{ color: "#5D6B82" }} />
          </div>
          {/* Identity */}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold leading-tight" style={{ color: "#0F172A" }} data-testid="text-chart-name">
              {d.name || "Unknown patient"}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 text-xs mt-0.5" style={{ color: "#667085" }}>
              <span>{chart.plexusId || "PLX-—"}</span>
              <span>·</span>
              <span>{d.mrn ? `MRN ${d.mrn}` : "MRN —"}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 text-xs mt-0.5" style={{ color: "#667085" }}>
              <span>{d.dob ? `DOB ${d.dob}` : "DOB —"}{d.age ? ` (${d.age})` : ""}</span>
              <span>{d.gender || "—"}</span>
              <span className="flex items-center gap-0.5"><Building2 className="w-3 h-3" />{d.clinic || "—"}</span>
              <span className="flex items-center gap-0.5"><Stethoscope className="w-3 h-3" />{d.provider || "—"}</span>
              <span className="flex items-center gap-0.5"><ShieldCheck className="w-3 h-3" />{chart.insurance.primary || "—"}</span>
              {d.phoneNumber && <span className="flex items-center gap-0.5"><Phone className="w-3 h-3" />{d.phoneNumber}</span>}
            </div>
          </div>
          {/* Actions */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            {phoneHref ? (
              <a href={phoneHref}><Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs rounded-lg"><Phone className="w-3.5 h-3.5" />Call</Button></a>
            ) : (
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs rounded-lg" disabled><Phone className="w-3.5 h-3.5" />Call</Button>
            )}
            {onSchedule ? (
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs rounded-lg" onClick={onSchedule}><CalendarPlus className="w-3.5 h-3.5" />Schedule</Button>
            ) : (
              <Link href="/appointments"><Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs rounded-lg"><CalendarPlus className="w-3.5 h-3.5" />Schedule</Button></Link>
            )}
            {d.email ? (
              <a href={`mailto:${d.email}`}><Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs rounded-lg" data-testid="button-message"><MessageSquare className="w-3.5 h-3.5" />Message</Button></a>
            ) : (
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs rounded-lg" disabled title="No email on file"><MessageSquare className="w-3.5 h-3.5" />Message</Button>
            )}
          </div>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════════════
          MAIN: CHART NAV + SCROLLABLE CONTENT
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ─── Chart Navigation (220px, collapsible) ─── */}
        {navCollapsed ? (
          <div
            className="hidden lg:flex flex-col items-center shrink-0 pt-3"
            style={{ width: "40px", background: "#F7F9FC", borderRight: "1px solid #E2E8F0" }}
            data-testid="chart-section-nav-collapsed"
          >
            <button
              onClick={() => setNavCollapsed(false)}
              title="Expand navigation"
              className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-slate-200/60"
              data-testid="button-nav-expand"
            >
              <ChevronRight className="w-4 h-4" style={{ color: "#667085" }} />
            </button>
          </div>
        ) : (
        <nav
          className="hidden lg:flex flex-col shrink-0 overflow-y-auto"
          style={{ width: "220px", background: "#F7F9FC", borderRight: "1px solid #E2E8F0", padding: "14px 10px" }}
          data-testid="chart-section-nav"
        >
          <div className="flex items-center justify-between px-2.5 mb-2">
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "#98A2B3" }}>Chart</span>
            <button
              onClick={() => setNavCollapsed(true)}
              title="Collapse navigation"
              className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-slate-200/60"
              data-testid="button-nav-collapse"
            >
              <ChevronLeft className="w-4 h-4" style={{ color: "#667085" }} />
            </button>
          </div>
          {(() => {
            let lastGroup = "";
            return navSections.map((s) => {
              const active = activeSection === s.id;
              const group = (s as any).group ?? "";
              const showHeader = group && group !== lastGroup;
              lastGroup = group;
              return (
                <div key={s.id}>
                  {showHeader && (
                    <div className="mt-3 mb-1 px-2.5" style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "#98A2B3" }}>
                      {GROUP_LABELS[group] ?? group}
                    </div>
                  )}
                  <button
                    onClick={() => scrollToSection(s.id)}
                    className="flex items-center gap-2 w-full text-left transition-colors"
                    style={{
                      height: "34px",
                      padding: "0 10px",
                      borderRadius: "7px",
                      fontSize: "13px",
                      fontWeight: active ? 600 : 500,
                      color: active ? "#263B63" : "#667085",
                      background: active ? "#E8EEF8" : "transparent",
                      borderLeft: active ? "2px solid #3169E8" : "2px solid transparent",
                    }}
                    data-testid={`nav-section-${s.id}`}
                  >
                    <span style={{ color: active ? "#3169E8" : "#98A2B3" }}>{s.icon}</span>
                    <span className="truncate">{s.label}</span>
                  </button>
                </div>
              );
            });
          })()}
        </nav>
        )}

        {/* ─── Scrollable Content ─── */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto" data-testid="chart-scroll">
          {/* Mobile pill nav */}
          <div className="lg:hidden sticky top-0 z-10 border-b px-3 py-2 overflow-x-auto" style={{ background: "#F3F6FA", borderColor: "#E2E8F0" }}>
            <div className="flex items-center gap-1.5 w-max">
              {navSections.slice(0, 10).map((s) => (
                <button
                  key={s.id}
                  onClick={() => scrollToSection(s.id)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap"
                  style={{
                    background: activeSection === s.id ? "#0F172A" : "#E2E8F0",
                    color: activeSection === s.id ? "#FFFFFF" : "#667085",
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Continuous sections */}
          <EcwSyncContext.Provider value={chart.ecwSynced ?? false}>
           <EpisodeDocsProvider
             screeningId={chart.patientScreeningId ?? null}
             enabled={getSectionAccess("documents") === "full"}
           >
            <div className="px-5 py-4 max-w-5xl" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              {CHART_SECTIONS.map((s) => {
                const access = getSectionAccess(s.id);
                if (access === "hidden") return null;
                if (loadingSections?.has(s.id)) {
                  return <SectionSkeleton key={s.id} id={s.id} title={s.label} icon={s.icon} />;
                }
                if (access === "summary") {
                  return (
                    <SectionSummaryCard
                      key={s.id}
                      id={s.id}
                      title={s.label}
                      icon={s.icon}
                      summary={sectionSummaryLine(chart, s.id)}
                    />
                  );
                }
                const Comp = s.Component;
                return <Comp key={s.id} chart={chart} />;
              })}
              <div className="h-32" aria-hidden />
            </div>
           </EpisodeDocsProvider>
          </EcwSyncContext.Provider>
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton (shown while profile loads) ─────────────────────────────────
export function PatientChartSkeleton({ seedName, onBack }: { seedName?: string | null; onBack?: () => void }) {
  return (
    <div className="flex flex-col h-full" style={{ background: "#F3F6FA" }}>
      <header className="border-b px-5 py-3 shrink-0" style={{ background: "#FFFFFF", borderColor: "#E2E8F0" }}>
        <div className="flex items-center gap-4">
          {onBack && (
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 lg:hidden" onClick={onBack}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
          )}
          <div className="w-11 h-11 rounded-full animate-pulse" style={{ background: "#E8EEF7" }} />
          <div className="space-y-2 flex-1">
            <div className="h-5 w-40 rounded animate-pulse" style={{ background: "#E2E8F0" }} />
            <div className="h-3 w-64 rounded animate-pulse" style={{ background: "#EDF1F5" }} />
          </div>
        </div>
      </header>
      <div className="flex-1 flex items-center justify-center text-sm" style={{ color: "#98A2B3" }}>
        {seedName ? `Loading ${seedName}...` : "Loading patient..."}
      </div>
    </div>
  );
}
