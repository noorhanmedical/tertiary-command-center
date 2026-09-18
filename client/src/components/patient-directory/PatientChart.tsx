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
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Phone, CalendarPlus, ChevronLeft, ChevronRight,
  MessageSquare,
} from "lucide-react";
import {
  CHART_SECTIONS, SectionSkeleton, SectionSummaryCard, AccessDeniedSection,
  sectionSummaryLine, EcwSyncContext, EpisodeDocsProvider,
} from "./PatientChartSections";
import { type EmrChart } from "@/types/emr";
import { EHR_HEX } from "./ehrTokens";
import { initials } from "./profileTypes";
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

// Compact patient identity block for the top of the chart-nav column. Portrait
// avatar (neutral initials — no invented gendered art), name, muted DOB/MRN/
// Plexus ID, and outlined circular quick actions (phone green-outline, calendar
// charcoal-outline, message optional). Transparent interiors, icon-only. Wires
// the existing tel:/schedule/mailto affordances only — no new behavior.
function ChartNavPatientHeader({
  chart,
  phoneHref,
  onSchedule,
}: {
  chart: EmrChart;
  phoneHref: string | null;
  onSchedule?: () => void;
}) {
  const d = chart.demographics;
  const [, navigate] = useLocation();
  const meta = [
    d.dob ? `DOB ${d.dob}${d.age != null ? ` (${d.age}y)` : ""}` : null,
    d.mrn ? `MRN ${d.mrn}` : null,
    chart.plexusId ? chart.plexusId : null,
  ].filter(Boolean);

  return (
    <div className="px-1.5 pt-0.5 pb-3 mb-1 border-b" style={{ borderColor: EHR_HEX.controlBorder }} data-testid="chart-nav-patient-header">
      <div className="flex flex-col items-center text-center">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-base font-semibold mb-2 ring-2 ring-white shadow-sm"
          style={{ background: EHR_HEX.selected, color: EHR_HEX.textStrong }}
          data-testid="chart-avatar"
          aria-hidden
        >
          {d.name ? initials(d.name) : "?"}
        </div>
        <div className="text-[15px] font-semibold leading-tight text-slate-900 truncate max-w-full" data-testid="text-chart-name">
          {d.name || "Unknown patient"}
        </div>
        <div className="mt-1 space-y-0.5">
          {meta.map((m, i) => (
            <div key={i} className="text-[11px] leading-tight" style={{ color: "#8592A6" }}>{m}</div>
          ))}
        </div>

        {/* Outlined circular quick actions — transparent interiors, icon-only. */}
        <div className="mt-2.5 flex items-center justify-center gap-2.5">
          <button
            type="button"
            disabled={!phoneHref}
            onClick={() => { if (phoneHref) window.location.href = phoneHref; }}
            title={phoneHref ? "Call patient" : "No phone on file"}
            aria-label="Call patient"
            data-testid="button-call"
            className="w-9 h-9 rounded-full border-2 flex items-center justify-center bg-transparent transition-colors disabled:opacity-40 hover:bg-emerald-50"
            style={{ borderColor: "#1FA870", color: "#1FA870" }}
          >
            <Phone className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => (onSchedule ? onSchedule() : navigate("/appointments"))}
            title="Schedule"
            aria-label="Schedule appointment"
            data-testid="button-schedule"
            className="w-9 h-9 rounded-full border-2 flex items-center justify-center bg-transparent transition-colors hover:bg-slate-100"
            style={{ borderColor: "#334155", color: "#334155" }}
          >
            <CalendarPlus className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={!d.email}
            onClick={() => { if (d.email) window.location.href = `mailto:${d.email}`; }}
            title={d.email ? "Message patient" : "No email on file"}
            aria-label="Message patient"
            data-testid="button-message"
            className="w-9 h-9 rounded-full border-2 flex items-center justify-center bg-transparent transition-colors disabled:opacity-40 hover:bg-slate-100"
            style={{ borderColor: "#334155", color: "#334155" }}
          >
            <MessageSquare className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function PatientChart({
  chart,
  onBack,
  onSchedule,
  loadingSections,
  onVisibleSectionsChange,
  focusSection,
  focusToken,
}: {
  chart: EmrChart;
  onBack?: () => void;
  onSchedule?: () => void;
  loadingSections?: Set<string>;
  onVisibleSectionsChange?: (ids: string[]) => void;
  /** Section id to scroll/highlight when the workspace requests service focus. */
  focusSection?: string | null;
  /** One-shot token; a new value triggers the focus once (not on every render). */
  focusToken?: number;
}) {
  const d = chart.demographics;
  const { getSectionAccess } = usePatientDirectorySectionAccess();
  const [navCollapsed, setNavCollapsed] = useState(false);

  const navSections = CHART_SECTIONS.filter((s) => getSectionAccess(s.id) !== "hidden");
  const [activeSection, setActiveSection] = useState<string>(navSections[0]?.id ?? "overview");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const manualScrollUntil = useRef<number>(0);
  const visibleSig = useRef<string>("");

  // Service-focus: transiently highlight a section when the workspace requests
  // focus (e.g. clicking a service row in the right-rail Ancillary queue).
  const [highlightedSection, setHighlightedSection] = useState<string | null>(null);
  const consumedFocusToken = useRef<number | undefined>(undefined);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // One-shot service focus. Runs only when focusToken changes to a new value,
  // so it does not retrigger on unrelated re-renders. Scrolls to the requested
  // section and applies a transient highlight. Retries briefly because the
  // target section may still be hydrating (per-section skeletons).
  useEffect(() => {
    if (focusToken == null || focusToken === 0) return;
    if (consumedFocusToken.current === focusToken) return;
    if (!focusSection) return;

    let attempts = 0;
    let raf = 0;
    const tryFocus = () => {
      const el = document.getElementById(`section-${focusSection}`);
      if (el) {
        consumedFocusToken.current = focusToken;
        scrollToSection(focusSection);
        setHighlightedSection(focusSection);
        if (highlightTimer.current) clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setHighlightedSection(null), 2200);
        return;
      }
      if (attempts++ < 40) {
        raf = window.setTimeout(tryFocus, 100); // up to ~4s while sections hydrate
      }
    };
    tryFocus();

    return () => {
      if (raf) clearTimeout(raf);
    };
  }, [focusToken, focusSection, scrollToSection]);

  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  const phoneHref = d.phoneNumber ? `tel:${d.phoneNumber.replace(/[^\d+]/g, "")}` : null;

  return (
    <div className="flex flex-col h-full" data-testid="patient-chart" style={{ background: "#F3F6FA" }}>
      {/* Mobile-only back to the roster (the wide desktop header row was removed;
          patient identity + actions now live at the top of the chart nav). */}
      {onBack && (
        <div className="lg:hidden shrink-0 border-b px-3 py-2" style={{ borderColor: "#E2E8F0", background: "#FFFFFF" }}>
          <Button size="sm" variant="ghost" className="h-7 gap-1.5" onClick={onBack} data-testid="button-back-roster">
            <ChevronLeft className="w-4 h-4" /> Patients
          </Button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          MAIN: CHART NAV (owns patient identity) + SCROLLABLE CONTENT
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ─── Chart Navigation (220px, collapsible) ─── */}
        {navCollapsed ? (
          <div
            className="hidden lg:flex flex-col items-center shrink-0 pt-3"
            style={{ width: "40px", background: EHR_HEX.control, borderRight: `1px solid ${EHR_HEX.controlBorder}` }}
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
          style={{ width: "220px", background: EHR_HEX.control, borderRight: `1px solid ${EHR_HEX.controlBorder}`, padding: "14px 10px" }}
          data-testid="chart-section-nav"
        >
          {/* Compact patient identity block — owns the patient portrait, name,
              muted DOB/MRN/Plexus ID, and outlined circular quick actions. This
              replaces the removed wide top header row. */}
          <ChartNavPatientHeader chart={chart} phoneHref={phoneHref} onSchedule={onSchedule} />

          <div className="flex items-center justify-between px-2.5 mb-2 mt-1">
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
                      background: active ? EHR_HEX.selected : "transparent",
                      borderLeft: active ? `2px solid ${EHR_HEX.primaryBlue}` : "2px solid transparent",
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
            <div className="px-4 py-3 max-w-5xl" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
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
                const focused = highlightedSection === s.id;
                return (
                  <div
                    key={s.id}
                    className={focused ? "rounded-2xl ring-2 ring-[#3169E8] ring-offset-2 transition-shadow duration-500" : "transition-shadow duration-500"}
                    data-focused={focused ? "true" : undefined}
                  >
                    <Comp chart={chart} />
                  </div>
                );
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
