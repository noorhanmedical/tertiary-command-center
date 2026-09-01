import { useState, createContext, useContext, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/api/auth";
import { usePatientDirectorySectionAccess } from "@/hooks/usePatientDirectorySectionAccess";
import { Link } from "wouter";
import { PlexusEhr } from "./PlexusEhr";
import { openSinglePatientPacket } from "@/components/engagement/engagementShared";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { serviceVisual } from "./serviceVisuals";
import { CanonicalAppointmentSummary } from "@/components/canonical/CanonicalAppointmentSummary";
import { isCanonicalAppointmentUiEnabled } from "@/lib/canonicalAppointmentUiFlag";
import { AncillaryDocumentsCard } from "@/components/ancillary-documents/CanonicalAncillaryDocuments";
import { isUnifiedAncillaryDocumentsEnabled } from "@/lib/unifiedAncillaryDocumentsFlag";
import {
  User, ShieldCheck, Stethoscope, Pill as PillIcon, AlertTriangle, FlaskConical,
  Scan, Activity, FileText, Phone, CalendarClock, Clock, Megaphone,
  Sparkles, ClipboardList, Receipt, History, CheckCircle2, XCircle,
  MinusCircle, ExternalLink, UserCog, Lock, Eye, ChevronRight, ChevronDown,
  FileBarChart,
} from "lucide-react";
import { fmtDate } from "./profileTypes";
import {
  type EmrChart, type EmrQualifyingTest, type AdChannelStatus, COOLDOWN_STATE_TONES,
  JOURNEY_STAGES, type EmrLab, type EmrVital, type EmrEncounter,
} from "@/types/emr";

// ── Shared primitives ────────────────────────────────────────────────────

// When true, chart sections show a "Synced from eCW" indicator to signal the
// data arrived through the eClinicalWorks API integration. Provided by
// PatientChart from chart.ecwSynced.
export const EcwSyncContext = createContext(false);

export function SectionCard({
  id, title, icon, count, action, children,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  count?: number | null;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`section-${id}`}
      data-section={id}
      className="scroll-mt-4"
      data-testid={`chart-section-${id}`}
    >
      <div className="rounded-2xl border border-slate-200/80 dark:border-border/60 bg-white dark:bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100 dark:border-border/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-slate-900/[0.04] dark:bg-white/5 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
              {icon}
            </div>
            <h2 className="text-base font-bold tracking-tight truncate" data-testid={`heading-${id}`}>{title}</h2>
            {count != null && (
              <span className="text-xs font-semibold text-muted-foreground tabular-nums">{count}</span>
            )}
          </div>
          {action}
        </div>
        <div className="p-5">{children}</div>
      </div>
    </section>
  );
}

export function EmptyState({ icon, title, hint, testId }: { icon: React.ReactNode; title: string; hint?: string; testId?: string }) {
  return (
    <div className="py-10 text-center" data-testid={testId}>
      <div className="flex justify-center mb-3 text-slate-300 dark:text-slate-600">{icon}</div>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">{hint}</p>}
    </div>
  );
}

// Placeholder rendered in place of a section whose backing query is still in
// flight, so the chart frame paints instantly and each section hydrates on its
// own without a blocking full-page spinner.
export function SectionSkeleton({
  id, title, icon,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <SectionCard id={id} title={title} icon={icon}>
      <div className="space-y-3 animate-pulse" data-testid={`chart-section-skeleton-${id}`}>
        <div className="h-3.5 w-2/3 rounded bg-slate-200/80 dark:bg-muted" />
        <div className="h-3.5 w-1/2 rounded bg-slate-200/70 dark:bg-muted/80" />
        <div className="h-3.5 w-3/4 rounded bg-slate-200/60 dark:bg-muted/70" />
      </div>
    </SectionCard>
  );
}

// Compact one-line summary of a section, used when a role has "summary" (not
// "full") access. Shows non-sensitive counts/status only — never row detail.
export function sectionSummaryLine(chart: EmrChart, id: string): string {
  const n = (arr: unknown): number => (Array.isArray(arr) ? arr.length : 0);
  switch (id) {
    case "overview": {
      const q = n(chart.plexusIq?.qualifyingTests);
      return q > 0 ? `Qualifies for ${q} ancillary test${q === 1 ? "" : "s"}` : "No qualifying tests yet";
    }
    case "plexus-iq": {
      const q = n(chart.plexusIq?.qualifyingTests);
      return `${q} qualifying test${q === 1 ? "" : "s"}`;
    }
    case "cooldown":
      return chart.cooldown?.stateLabel || "Cooldown status on file";
    case "diagnoses":
      return `${n(chart.diagnoses)} diagnosis record${n(chart.diagnoses) === 1 ? "" : "s"} on file`;
    case "medications":
      return `${n(chart.medications)} medication${n(chart.medications) === 1 ? "" : "s"} on file`;
    case "allergies":
      return `${n(chart.allergies)} allergy record${n(chart.allergies) === 1 ? "" : "s"} on file`;
    case "demographics":
      return chart.demographics?.name || "Patient demographics on file";
    case "insurance":
      return chart.insurance?.primary || "Insurance on file";
    case "providers":
      return `${n(chart.providers)} provider${n(chart.providers) === 1 ? "" : "s"} on care team`;
    case "labs":
      return `${n(chart.labs)} lab result${n(chart.labs) === 1 ? "" : "s"} on file`;
    case "imaging":
      return `${n(chart.imaging)} imaging stud${n(chart.imaging) === 1 ? "y" : "ies"} on file`;
    case "vitals":
      return `${n(chart.vitals)} vital sign record${n(chart.vitals) === 1 ? "" : "s"} on file`;
    case "encounters":
      return `${n(chart.encounters)} encounter/note record${n(chart.encounters) === 1 ? "" : "s"} on file`;
    case "calls": {
      const c = chart.communication?.callAttemptCount ?? n(chart.communication?.calls);
      return `${c} call attempt${c === 1 ? "" : "s"} logged`;
    }
    case "scheduling":
      return `${n(chart.scheduling)} appointment${n(chart.scheduling) === 1 ? "" : "s"} on file`;
    case "documents":
      return `${n(chart.documents)} document${n(chart.documents) === 1 ? "" : "s"} on file`;
    case "billing": {
      const items = chart.billing?.items ?? [];
      const ready = items.filter((i) => i.ready).length;
      return `${ready}/${items.length} billing readiness check${items.length === 1 ? "" : "s"} ready`;
    }
    case "admin-review":
      return chart.plexusIq?.adminApprovalStatus
        ? `Admin review: ${chart.plexusIq.adminApprovalStatus}`
        : "Admin review pending";
    case "ancillary-journey":
      return `${n(chart.plexusIq?.qualifyingTests)} service${n(chart.plexusIq?.qualifyingTests) === 1 ? "" : "s"} in the ancillary journey`;
    case "re-engagement":
      return chart.adAutomation?.reEngagementEligible ? "Re-engagement eligible" : "Re-engagement not eligible";
    case "ancillary-cases":
      return `${n(chart.executionCases)} ancillary case${n(chart.executionCases) === 1 ? "" : "s"} on file`;
    case "plexus-story":
      return "Patient's Plexus Story available";
    case "plexus-data-signals":
      return "Plexus Data Signals available";
    default:
      return "Summary available";
  }
}

// Rendered when a role has "summary" (not "full") access to a section. Shows a
// compact, non-sensitive one-line summary rather than the full section body.
export function SectionSummaryCard({
  id, title, icon, summary,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  summary: string;
}) {
  return (
    <SectionCard
      id={id}
      title={title}
      icon={icon}
      action={
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-muted dark:text-foreground" data-testid={`badge-summary-${id}`}>
          <Eye className="w-3 h-3" />Summary
        </span>
      }
    >
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200" data-testid={`section-summary-${id}`}>
        {summary}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5">Full details are restricted for your role.</p>
    </SectionCard>
  );
}

// Rendered in place of a section's content when a role has "hidden" access and
// the user deep-links directly to the section anchor.
export function AccessDeniedSection({
  id, title, icon,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <SectionCard id={id} title={title} icon={icon}>
      <EmptyState
        icon={<Lock className="w-8 h-8" />}
        title="This section is not available for your role."
        hint="Contact an administrator if you need access to this information."
        testId={`section-denied-${id}`}
      />
    </SectionCard>
  );
}

function KV({ label, value, testId }: { label: string; value: React.ReactNode; testId?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-100 dark:border-border/40 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground pt-0.5">{label}</span>
      <span className="text-sm font-medium text-right max-w-[60%] break-words" data-testid={testId}>{value}</span>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-top text-sm ${className}`}>{children}</td>;
}
function Table({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full border-collapse">
        <thead><tr className="border-b border-slate-200 dark:border-border/60">{head}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const TONE_PILL: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  slate: "bg-slate-100 text-slate-700 dark:bg-muted dark:text-foreground",
};
function Pill({ tone, children, testId }: { tone: keyof typeof TONE_PILL; children: React.ReactNode; testId?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${TONE_PILL[tone]}`} data-testid={testId}>
      {children}
    </span>
  );
}

// Bucket colours are kept as a subtle left-border accent only (no full card
// fill) so the profile reads as the Plexus IQ navy/white palette.
const BUCKET_STYLES: Record<string, string> = {
  brainwave: "border-l-4 border-l-purple-400 dark:border-l-purple-500",
  vitalwave: "border-l-4 border-l-red-400 dark:border-l-red-500",
  ultrasound: "border-l-4 border-l-emerald-400 dark:border-l-emerald-500",
};
const BUCKET_DOT: Record<string, string> = {
  brainwave: "bg-purple-500", vitalwave: "bg-red-500", ultrasound: "bg-emerald-500",
};
const BUCKET_LABEL: Record<string, string> = {
  brainwave: "BrainWave", vitalwave: "VitalWave", ultrasound: "Ultrasound",
};
const BUCKET_ORDER: Array<"brainwave" | "vitalwave" | "ultrasound"> = ["brainwave", "vitalwave", "ultrasound"];

function firstLine(text?: string | null): string | null {
  if (!text) return null;
  const line = text.split(/\n+/).map((s) => s.trim()).find(Boolean);
  return line ?? null;
}

type SectionProps = { chart: EmrChart };

// ── 1a. Ancillary Journey — ONE unified tile (rows per service) ──
function AncillaryJourneyPlaceholder({ chart }: SectionProps) {
  return (
    <SectionCard id="ancillary-journey" title="Ancillary Journey" icon={<Sparkles className="w-4 h-4" />}>
      <PlexusEhr chart={chart} />
    </SectionCard>
  );
}
// ── 1b. Plexus Data Signals (placeholder — shows AI-found clinical items) ──
// Canonical Plexus Data Signals (plexus_clinical_findings). Reads the real
// endpoint by screening id; when none exist (e.g. demo not seeded) it derives
// a display list from the qualification reasoning so the section is populated.
type FindingRow = {
  id: number; findingType: string; displayName: string; suggestedIcd10: string | null;
  confidence: string | null; sourceType: string | null; sourceDate: string | null;
  sourceExcerpt: string | null; reviewStatus: string | null;
};
type DataSignal = {
  key: string; name: string; type: string; confidence?: string | null;
  usedFor: string[]; icd?: string | null; source?: string | null; excerpt?: string | null; status?: string | null;
};
function deriveSignalsFromReasoning(chart: EmrChart): DataSignal[] {
  const map = new Map<string, DataSignal>();
  for (const t of chart.plexusIq.qualifyingTests ?? []) {
    const icd = (t.icd10Codes ?? [])[0] ?? null;
    for (const f of t.qualifyingFactors ?? []) {
      const key = f.toLowerCase();
      const cur = map.get(key);
      if (cur) { if (!cur.usedFor.includes(t.testName)) cur.usedFor.push(t.testName); }
      // Derived from canonical qualification factors. status=null: do NOT
      // fabricate a "Confirmed" review status the client never performed —
      // only real /api/plexus-findings rows carry an authoritative reviewStatus.
      else map.set(key, { key, name: f, type: "Clinical signal", confidence: t.confidence ?? null, usedFor: [t.testName], icd, source: "Plexus IQ", status: null });
    }
  }
  return Array.from(map.values());
}
function PlexusFindingsPlaceholder({ chart }: SectionProps) {
  const psid = chart.patientScreeningId ?? null;
  const { data: findings = [] } = useQuery<FindingRow[]>({
    queryKey: ["/api/plexus-findings/screening", psid],
    queryFn: async () => {
      const res = await fetch(`/api/plexus-findings/screening/${psid}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as FindingRow[];
      return Array.isArray(rows) ? rows : [];
    },
    enabled: psid != null,
    staleTime: 60_000,
  });
  const canonical: DataSignal[] = findings.map((f) => ({
    key: String(f.id),
    name: f.displayName,
    type: (f.findingType ?? "signal").replace(/_/g, " "),
    confidence: f.confidence,
    usedFor: [],
    icd: f.suggestedIcd10,
    source: f.sourceType ? `${f.sourceType}${f.sourceDate ? ` · ${fmtDate(f.sourceDate)}` : ""}` : null,
    excerpt: f.sourceExcerpt,
    status: f.reviewStatus,
  }));
  const signals = canonical.length > 0 ? canonical : deriveSignalsFromReasoning(chart);
  return (
    <SectionCard id="plexus-data-signals" title="Plexus Data Signals" icon={<Sparkles className="w-4 h-4" />} count={signals.length || null}>
      {signals.length === 0 ? (
        <EmptyState icon={<Sparkles className="w-8 h-8" />} title="No Data Signals" hint="Plexus IQ clinical signals appear here after analysis." testId="empty-data-signals" />
      ) : (
        <div className="space-y-2">
          {signals.map((s) => (
            <div key={s.key} className="rounded-xl border border-slate-200/70 dark:border-border/50 px-3.5 py-2.5" data-testid={`data-signal-${s.key}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{s.name}</span>
                <span className="flex items-center gap-2 shrink-0">
                  {s.confidence && <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{s.confidence}</span>}
                  {s.status && <Pill tone={/confirm/i.test(s.status) ? "green" : "amber"}>{s.status}</Pill>}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-[11px] text-slate-500">
                <span className="capitalize">{s.type}</span>
                {s.icd && <span className="font-mono">{s.icd}</span>}
                {s.source && <span>Source: {s.source}</span>}
                {s.usedFor.length > 0 && <span>Used for: {s.usedFor.join(", ")}</span>}
              </div>
              {s.excerpt && <p className="text-[11px] text-slate-500 mt-1 italic">“{s.excerpt}”</p>}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ── 1. Overview ───────────────────────────────────────────────────────────
// ONE compact dashboard, six panels across two rows. No qualifying-services
// tile grid, no demographic duplication, no raw AI reasoning.
//   ROW 1: Next Action · Recent Calls · Current Tests (operational state)
//   ROW 2: Upcoming Scheduling · Recent Reports · Important Alerts
// Flat labeled block — NO card chrome (no border/background), so the Overview
// tile does not contain nested cards.
function OverviewPanel({ title, children, action, className = "" }: { title: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-muted-foreground">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

const LAST_JOURNEY_STAGE = JOURNEY_STAGES.length - 1;
function episodeStageLabel(stageIndex: number, stage: string): string {
  return stageIndex >= LAST_JOURNEY_STAGE ? "Complete" : stage;
}

function OverviewSection({ chart }: SectionProps) {
  const d = chart.demographics;
  const tests = chart.plexusIq.qualifyingTests ?? [];
  const episodes = chart.serviceEpisodes ?? [];
  const calls = chart.communication?.calls ?? [];
  const appts = chart.scheduling ?? [];
  const phoneHref = d.phoneNumber ? `tel:${d.phoneNumber.replace(/[^\d+]/g, "")}` : null;
  const reports = chart.reports;
  const contact = chart.overview?.contactability;
  const alerts: string[] = [];
  if (contact && !contact.canContact) alerts.push(contact.label);
  if (chart.adAutomation?.suppressionReason) alerts.push(chart.adAutomation.suppressionReason);

  // Only true upcoming appointments: future-dated AND not completed/cancelled.
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = appts
    .filter((a) => {
      const st = (a.status ?? "").toLowerCase();
      if (["completed", "cancelled", "canceled", "no_show", "no-show"].includes(st)) return false;
      const dt = (a.scheduledDate ?? "").slice(0, 10);
      return dt >= today;
    })
    .sort((a, b) => (a.scheduledDate ?? "").localeCompare(b.scheduledDate ?? ""));

  return (
    <SectionCard id="overview" title="Overview" icon={<User className="w-4 h-4" />}>
      {/* ROW 1 — clean 3-column dashboard with vertical dividers, no cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-100 dark:divide-border/50">
        <OverviewPanel title="Next Action" className="md:pr-7 pb-6 md:pb-1 min-h-[104px]">
          <p className="text-sm text-slate-700 dark:text-slate-200 mb-3 leading-snug" data-testid="overview-next-action">
            {chart.overview?.nextAction
              || (tests.length > 0
                ? `Call ${d.name?.split(" ")[0] || "patient"} regarding ${tests.length} test${tests.length !== 1 ? "s" : ""}.`
                : "No pending actions — run Plexus IQ to qualify services.")}
          </p>
          <div className="flex gap-2">
            {phoneHref ? (
              <a href={phoneHref} className="flex-1">
                <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-8"><Phone className="w-3.5 h-3.5" />Call</Button>
              </a>
            ) : (
              <Button size="sm" className="flex-1 h-8" disabled>No phone</Button>
            )}
            <Link href="/appointments" className="flex-1"><Button size="sm" variant="outline" className="w-full h-8 gap-1 text-[11px]" data-testid="overview-schedule"><CalendarClock className="w-3 h-3" />Schedule</Button></Link>
          </div>
        </OverviewPanel>

        <OverviewPanel title="Recent Calls" className="md:px-7 py-6 md:py-1 min-h-[104px]">
          {calls.length === 0 ? (
            <p className="text-xs text-slate-500" data-testid="overview-calls-empty">No outreach attempts yet.</p>
          ) : (
            <div className="space-y-2.5">
              {calls.slice(0, 3).map((c, i) => (
                <div key={c.id ?? i} className="text-xs" data-testid={`overview-call-${i}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-700 dark:text-slate-200 font-medium">{fmtDate((c.occurredAt || "").slice(0, 10) || null)}</span>
                    <Badge variant="outline" className="text-[10px]">{c.outcome || "logged"}</Badge>
                  </div>
                  {c.teamMember && <div className="text-[11px] text-slate-500 mt-0.5">{c.teamMember}</div>}
                </div>
              ))}
            </div>
          )}
        </OverviewPanel>

        <OverviewPanel title={`Current Tests (${episodes.length})`} className="md:pl-7 pt-6 md:pt-1 min-h-[104px]">
          {episodes.length === 0 ? (
            <p className="text-xs text-slate-500" data-testid="overview-tests-empty">No active services.</p>
          ) : (
            <div className="space-y-2">
              {episodes.slice(0, 4).map((ep) => (
                <div key={ep.serviceKey} className="flex items-center justify-between gap-2 text-xs" data-testid={`overview-test-${ep.serviceKey}`}>
                  <span className="text-slate-700 dark:text-slate-200 font-medium truncate">{ep.serviceName}</span>
                  <span className="text-[10px] font-semibold shrink-0" style={{ color: "#3169E8" }}>{episodeStageLabel(ep.stageIndex, ep.stage)}</span>
                </div>
              ))}
              {episodes.length > 4 && (
                <div className="text-[10px] text-slate-500 pt-0.5">+{episodes.length - 4} more · <span className="text-blue-600">View Journey</span></div>
              )}
            </div>
          )}
        </OverviewPanel>
      </div>

      {/* Divider between the two rows */}
      <div className="border-t border-slate-100 dark:border-border/50 my-6" />

      {/* ROW 2 */}
      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-100 dark:divide-border/50">
        <OverviewPanel title="Upcoming Scheduling" className="md:pr-7 pb-6 md:pb-1 min-h-[92px]">
          {upcoming.length === 0 ? (
            <p className="text-xs text-slate-500" data-testid="overview-scheduling-empty">No upcoming appointments.</p>
          ) : (
            <div className="space-y-2">
              {upcoming.slice(0, 4).map((a, i) => (
                <div key={a.id ?? i} className="flex items-center justify-between gap-2 text-xs" data-testid={`overview-appt-${i}`}>
                  <span className="text-slate-700 dark:text-slate-200 truncate">{a.testType || "Ancillary"}</span>
                  <span className="text-[10px] text-slate-500 shrink-0">{a.scheduledDate ? fmtDate(a.scheduledDate) : "—"}{a.scheduledTime ? ` · ${a.scheduledTime}` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </OverviewPanel>

        <OverviewPanel title="Recent Reports" className="md:px-7 py-6 md:py-1 min-h-[92px]">
          {(reports?.plexusPdf?.available || reports?.clinicianPdf?.available) ? (
            <AtlasActions chart={chart} layout="row" />
          ) : (
            <p className="text-xs text-slate-500" data-testid="overview-reports-empty">No reports generated yet.</p>
          )}
        </OverviewPanel>

        <OverviewPanel title="Important Alerts" className="md:pl-7 pt-6 md:pt-1 min-h-[92px]">
          {alerts.length === 0 ? (
            <p className="text-xs text-slate-500" data-testid="overview-alerts-empty">No actionable alerts.</p>
          ) : (
            <div className="space-y-2">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300" data-testid={`overview-alert-${i}`}>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{a}</span>
                </div>
              ))}
            </div>
          )}
        </OverviewPanel>
      </div>
    </SectionCard>
  );
}

// ── 2. Cooldown Eligibility ────────────────────────────────────────────────
// One row per SERVICE (latest test + current eligibility), with expandable
// full test history — not one row per historical date.
type CooldownEntry = NonNullable<EmrChart["cooldown"]["testCooldowns"]>[number];

function CooldownServiceRow({ service, entries }: { service: string; entries: CooldownEntry[] }) {
  const [open, setOpen] = useState(false);
  const sorted = [...entries].sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""));
  const latest = sorted[0];
  const cleared = !!latest?.cleared;
  const days = latest?.daysUntilClear ?? 0;
  return (
    <div className="border-t border-slate-100 dark:border-border/40 first:border-t-0" data-testid={`cooldown-service-${service}`}>
      <div className="grid grid-cols-2 md:grid-cols-[minmax(0,1.6fr)_1fr_0.7fr_0.8fr_1fr_auto] items-center gap-x-3 gap-y-1 py-2.5 text-xs">
        <span className="font-medium text-slate-800 dark:text-slate-100 col-span-2 md:col-span-1 truncate">{service}</span>
        <span className="text-slate-600 dark:text-slate-300"><span className="md:hidden text-slate-400">Last: </span>{latest?.lastDate ? fmtDate(latest.lastDate) : "—"}</span>
        <span className="text-slate-500">{(latest?.insuranceType ?? "").toUpperCase() || "—"}</span>
        <span className="text-slate-500">{latest?.cooldownMonths ? `${latest.cooldownMonths} mo` : "—"}</span>
        <span className="text-slate-600 dark:text-slate-300">{cleared ? <span className="text-emerald-700 dark:text-emerald-400 font-medium">Now</span> : (latest?.clearsAt ? fmtDate(latest.clearsAt) : "—")}</span>
        <span className="flex items-center gap-2 justify-end">
          {cleared
            ? <Pill tone="green"><CheckCircle2 className="w-3 h-3" />Eligible</Pill>
            : <Pill tone={days <= 7 ? "red" : "amber"}><Clock className="w-3 h-3" />Cooldown</Pill>}
          {entries.length > 1 && (
            <button onClick={() => setOpen(!open)} className="text-[11px] text-blue-600 hover:underline shrink-0" data-testid={`cooldown-history-toggle-${service}`}>History ({entries.length})</button>
          )}
        </span>
      </div>
      {open && entries.length > 1 && (
        <div className="pl-1 pb-2.5 space-y-1">
          {sorted.map((e, i) => (
            <div key={i} className="flex items-center gap-4 text-[11px] text-slate-500" data-testid={`cooldown-history-${service}-${i}`}>
              <span className="w-28 text-slate-600 dark:text-slate-300">{e.lastDate ? fmtDate(e.lastDate) : "—"}</span>
              <span className="w-16">{(e.insuranceType ?? "").toUpperCase()}</span>
              <span>{e.cleared ? "Re-eligible" : `Clears ${e.clearsAt ? fmtDate(e.clearsAt) : "—"}`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CooldownSection({ chart }: SectionProps) {
  const tests = chart.cooldown.testCooldowns ?? [];
  const groups = new Map<string, CooldownEntry[]>();
  for (const c of tests) {
    const k = c.testName ?? "—";
    const arr = groups.get(k);
    if (arr) arr.push(c); else groups.set(k, [c]);
  }
  const services = Array.from(groups.entries());
  const inCooldownCount = services.filter(([, es]) => {
    const latest = [...es].sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""))[0];
    return latest && !latest.cleared;
  }).length;
  return (
    <SectionCard
      id="cooldown"
      title="Cooldown Eligibility"
      icon={<Clock className="w-4 h-4" />}
      count={services.length || null}
      action={services.length > 0
        ? <Pill tone={inCooldownCount > 0 ? "amber" : "green"} testId="badge-cooldown-state">{inCooldownCount > 0 ? `${inCooldownCount} in cooldown` : "All re-eligible"}</Pill>
        : undefined}
    >
      {services.length === 0 ? (
        <EmptyState icon={<Clock className="w-8 h-8" />} title="No prior tests on file" hint="Cooldown windows appear here once test history is imported." testId="empty-cooldown" />
      ) : (
        <div>
          <div className="hidden md:grid grid-cols-[minmax(0,1.6fr)_1fr_0.7fr_0.8fr_1fr_auto] gap-x-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            <span>Service</span><span>Last Test</span><span>Payer</span><span>Rule</span><span>Next Eligible</span><span className="text-right">Status</span>
          </div>
          {services.map(([service, entries]) => <CooldownServiceRow key={service} service={service} entries={entries} />)}
        </div>
      )}
    </SectionCard>
  );
}

// ── 3. Re-engagement ────────────────────────────────────────────────────────
// Answers, per service: when can we approach again, and through which channels.
// Clean rows (no channel bubbles) driven by cooldown + channel eligibility.
const AD_CH_LABEL: Record<string, string> = { phone: "Phone", sms: "SMS", email: "Email", passive_ads: "Passive ads" };
function subtractDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function AdAutomationSection({ chart }: SectionProps) {
  const ad = chart.adAutomation;
  const today = new Date().toISOString().slice(0, 10);
  const channels = (ad.channels ?? []).filter((c) => c.status !== "suppressed").map((c) => AD_CH_LABEL[c.channel]).filter(Boolean);
  const channelLabel = channels.length > 0 ? channels.join(" · ") : "Paused";

  // Latest cooldown entry per service → next-eligible date.
  const cooldownByService = new Map<string, { clearsAt?: string | null; cleared?: boolean | null }>();
  for (const c of chart.cooldown.testCooldowns ?? []) {
    const k = c.testName ?? "";
    const cur = cooldownByService.get(k);
    if (!cur || (c.lastDate ?? "") > "") cooldownByService.set(k, { clearsAt: c.clearsAt, cleared: c.cleared });
  }
  const episodes = chart.serviceEpisodes ?? [];
  const rows = episodes.map((ep) => {
    const cd = cooldownByService.get(ep.serviceName);
    const scheduled = (ep.appointment?.status ?? "").toLowerCase() === "scheduled";
    const eligibleNow = !cd || cd.cleared || !cd.clearsAt || cd.clearsAt <= today;
    const eligibleAgain = eligibleNow ? "Now" : fmtDate(cd!.clearsAt!);
    const recommended = eligibleNow ? "Now" : fmtDate(subtractDays(cd!.clearsAt!, 7));
    const status = scheduled ? "Scheduled" : eligibleNow ? "Eligible" : "Cooldown";
    return { service: ep.serviceName, eligibleAgain, recommended, status };
  });

  return (
    <SectionCard
      id="re-engagement"
      title="Re-engagement"
      icon={<Megaphone className="w-4 h-4" />}
      action={ad.reEngagementEligible ? <Pill tone="green">Eligible</Pill> : <Pill tone="amber">Paused</Pill>}
    >
      {ad.suppressionReason && (
        <div className="mb-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300" data-testid="text-ad-suppression-reason">
          {ad.suppressionReason}
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={<Megaphone className="w-8 h-8" />} title="No services to re-engage" hint="Re-engagement windows appear per qualifying service." testId="empty-re-engagement" />
      ) : (
        <div>
          <div className="hidden md:grid grid-cols-[minmax(0,1.6fr)_1fr_1fr_1.2fr_auto] gap-x-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            <span>Service</span><span>Eligible Again</span><span>Recommended</span><span>Channels</span><span className="text-right">Status</span>
          </div>
          {rows.map((r) => (
            <div key={r.service} className="grid grid-cols-2 md:grid-cols-[minmax(0,1.6fr)_1fr_1fr_1.2fr_auto] items-center gap-x-3 gap-y-1 py-2.5 border-t border-slate-100 dark:border-border/40 first:border-t-0 text-xs" data-testid={`reengagement-${r.service}`}>
              <span className="font-medium text-slate-800 dark:text-slate-100 col-span-2 md:col-span-1 truncate">{r.service}</span>
              <span className="text-slate-600 dark:text-slate-300"><span className="md:hidden text-slate-400">Eligible: </span>{r.eligibleAgain}</span>
              <span className="text-slate-600 dark:text-slate-300"><span className="md:hidden text-slate-400">Outreach: </span>{r.recommended}</span>
              <span className="text-slate-500">{channelLabel}</span>
              <span className="flex justify-end">
                <Pill tone={r.status === "Scheduled" ? "blue" : r.status === "Eligible" ? "green" : "amber"}>{r.status}</Pill>
              </span>
            </div>
          ))}
          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-border/40 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">Automation Rules</span>
            <span className="text-[11px] text-slate-400">{ad.reEngagementEligible ? "Re-engagement automation active" : "Direct outreach paused"}</span>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ── 4. Plexus IQ ───────────────────────────────────────────────────────────
// Split AI prose into short bullets so nothing renders as a wall of text.
function toBullets(text?: string | null, max = 5): string[] {
  if (!text) return [];
  let parts = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1) parts = parts[0].split(/(?<=[.;])\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.map((p) => p.replace(/^[-•*]\s*/, "")).slice(0, max);
}

function EvidenceBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-1">{label}</div>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc list-inside space-y-0.5 text-xs text-slate-600 dark:text-slate-300 leading-snug">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}

function ChipRow({ items, mono }: { items: string[]; mono?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it, i) => (
        <span key={i} className={`px-1.5 py-0.5 rounded text-[10px] ${mono ? "font-mono" : ""}`} style={{ background: "#F1F5F9", color: "#475569" }}>{it}</span>
      ))}
    </div>
  );
}

// Structured qualification evidence for one test — shared by the Current
// Qualifying Tests popup and (conceptually) the Journey's Why Qualifies.
export function QualifyingEvidence({ test, diagnoses, medications }: {
  test: EmrQualifyingTest;
  diagnoses: string[];
  medications: string[];
}) {
  const justification = toBullets(test.clinicianUnderstanding);
  const talking = toBullets(test.patientTalkingPoints);
  const factors = test.qualifyingFactors ?? [];
  const pearls = test.pearls ?? [];
  const icd = test.icd10Codes ?? [];
  return (
    <div className="space-y-3">
      {diagnoses.length > 0 && <EvidenceBlock label="Supporting Diagnoses"><ChipRow items={diagnoses.slice(0, 12)} /></EvidenceBlock>}
      {medications.length > 0 && <EvidenceBlock label="Supporting Medications"><ChipRow items={medications.slice(0, 12)} /></EvidenceBlock>}
      {factors.length > 0 && <EvidenceBlock label="Clinical Justification"><BulletList items={factors.slice(0, 8)} /></EvidenceBlock>}
      {justification.length > 0 && factors.length === 0 && <EvidenceBlock label="Clinical Justification"><BulletList items={justification} /></EvidenceBlock>}
      {icd.length > 0 && <EvidenceBlock label="ICD-10"><ChipRow items={icd} mono /></EvidenceBlock>}
      {test.confidence && <EvidenceBlock label="Confidence"><span className="text-xs font-medium capitalize text-slate-600 dark:text-slate-300">{test.confidence}</span></EvidenceBlock>}
      {talking.length > 0 && <EvidenceBlock label="Patient Talking Points"><BulletList items={talking} /></EvidenceBlock>}
      {pearls.length > 0 && <EvidenceBlock label="Pearls"><BulletList items={pearls.slice(0, 6)} /></EvidenceBlock>}
      <div className="flex items-center gap-3 pt-0.5">
        <Link href="/plexus-iq">
          <button className="text-[11px] font-medium hover:underline flex items-center gap-1" style={{ color: "#2459E0" }} data-testid={`link-reasoning-${test.testName}`}>
            View Full Reasoning <ExternalLink className="w-3 h-3" />
          </button>
        </Link>
      </div>
    </div>
  );
}

// Current Qualifying Tests — circular service icons (3 per row); clicking one
// opens a popup with the structured qualification evidence.
function PlexusIqSection({ chart }: SectionProps) {
  const iq = chart.plexusIq;
  const tests = iq.qualifyingTests ?? [];
  const diagnoses = (chart.diagnoses ?? []).map((d) => (d.icd10 ? `${d.icd10} · ${d.description}` : d.description ?? "")).filter(Boolean);
  const medications = (chart.medications ?? []).map((m) => m.name ?? "").filter(Boolean);
  const [selected, setSelected] = useState<EmrQualifyingTest | null>(null);
  return (
    <SectionCard
      id="plexus-iq"
      title="Current Qualifying Tests"
      icon={<Sparkles className="w-4 h-4" />}
      count={tests.length || null}
      action={iq.adminApprovalStatus
        ? <Pill tone={iq.adminApprovalStatus === "approved" ? "green" : iq.adminApprovalStatus === "rejected" ? "red" : "amber"} testId="badge-admin-approval">{iq.adminApprovalStatus}</Pill>
        : undefined}
    >
      {tests.length === 0 ? (
        <EmptyState icon={<Sparkles className="w-8 h-8" />} title="No qualifying tests on record yet" hint="Run this patient through Plexus IQ to surface qualifying ancillary opportunities." testId="empty-plexus" />
      ) : (
        <div className="grid grid-cols-3 gap-x-4 gap-y-5" data-testid="qualifying-tests-grid">
          {tests.map((t) => {
            const vis = serviceVisual(t.testName);
            const Icon = vis.Icon;
            return (
              <button
                key={t.testName}
                onClick={() => setSelected(t)}
                className="flex flex-col items-center gap-2 group"
                data-testid={`qualifying-icon-${t.testName}`}
              >
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center transition-transform group-hover:scale-105"
                  style={{ background: vis.bg }}
                >
                  <Icon className="w-8 h-8" style={{ color: vis.color }} />
                </div>
                <span className="text-[11px] font-medium text-center text-slate-700 dark:text-slate-200 leading-tight">{t.testName}</span>
                {t.confidence && <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{t.confidence}</span>}
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {selected && (() => { const V = serviceVisual(selected.testName).Icon; return <V className="w-5 h-5" style={{ color: serviceVisual(selected.testName).color }} />; })()}
              {selected?.testName}
            </DialogTitle>
          </DialogHeader>
          {selected && <QualifyingEvidence test={selected} diagnoses={diagnoses} medications={medications} />}
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

// ── Ancillary Cases — one dense row per service (operational ownership) ──────
// Permission-gated via the section-access matrix (hidden by default for
// non-admin roles). One case per ancillary service; NOT a Journey duplicate.
function ExecutionCasesSection({ chart }: SectionProps) {
  const ec = (chart.executionCases ?? [])[0] ?? null;
  const episodes = chart.serviceEpisodes ?? [];
  const rows = episodes.map((ep) => ({
    service: ep.serviceName,
    caseId: ep.caseId != null ? `AC-${String(ep.caseId).padStart(6, "0")}` : "—",
    owner: ep.owner ?? ec?.assignedRole ?? "—",
    stage: ep.stageIndex >= JOURNEY_STAGES.length - 1 ? "Complete" : ep.stage,
    priority: ec?.priorityScore != null ? String(ec.priorityScore) : "Normal",
    attempts: ec?.callAttemptCount ?? 0,
    lastOutcome: ec?.lastCallOutcome ?? "—",
    nextAction: ep.nextAction ?? (ec?.nextActionAt ? fmtDate(ec.nextActionAt.slice(0, 10)) : "—"),
    appt: ep.appointment?.date ? fmtDate((ep.appointment.date || "").slice(0, 10)) : "None",
  }));
  return (
    <SectionCard id="ancillary-cases" title="Ancillary Cases" icon={<ClipboardList className="w-4 h-4" />} count={rows.length || null}>
      {rows.length === 0 ? (
        <EmptyState icon={<ClipboardList className="w-8 h-8" />} title="No active ancillary case" hint="Ancillary cases are created when this patient enters the outreach engagement engine. Each qualifying service gets its own case." testId="empty-execution-cases" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-border/60">
                <Th>Service</Th><Th>Case ID</Th><Th>Owner</Th><Th>Stage</Th><Th>Priority</Th><Th>Attempts</Th><Th>Last Outcome</Th><Th>Next Action</Th><Th>Appointment</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.caseId} className="border-b border-slate-100 dark:border-border/40 last:border-0" data-testid={`ancillary-case-${r.service}`}>
                  <Td className="font-medium whitespace-nowrap">{r.service}</Td>
                  <Td className="text-slate-500 whitespace-nowrap font-mono">{r.caseId}</Td>
                  <Td className="whitespace-nowrap">{r.owner}</Td>
                  <Td><Badge variant="outline" className="text-[10px]">{r.stage}</Badge></Td>
                  <Td>{r.priority}</Td>
                  <Td>{r.attempts}</Td>
                  <Td className="text-slate-500 whitespace-nowrap">{r.lastOutcome}</Td>
                  <Td className="text-slate-500 whitespace-nowrap">{r.nextAction}</Td>
                  <Td className="whitespace-nowrap">{r.appt}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ── 6. Calls & Communications ──────────────────────────────────────────────
// Canonical communication workspace. Reads from the real /api/patients/:id/
// communications endpoint (outreach_calls table extended by migration 0063).
// Supports multi-channel filtering, paginated Load More, and a detail dialog.
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = fmtDate((iso || "").slice(0, 10));
  const t = fmtTime(iso);
  return t ? `${d} · ${t}` : d;
}
const COMM_CHANNEL_FILTERS: Array<[string, string]> = [
  ["all", "All"], ["phone", "Calls"], ["sms", "SMS"], ["email", "Email"], ["portal", "Portal"],
];
const CALLS_PAGE_SIZE = 20;

type CanonicalCommRow = {
  id: number;
  patientScreeningId: number;
  startedAt: string | null;
  endedAt: string | null;
  outcome: string;
  notes: string | null;
  callbackAt: string | null;
  attemptNumber: number;
  durationSeconds: number | null;
  channel: string;
  direction: string;
  destination: string | null;
  staffName: string | null;
  staffRole: string | null;
  serviceType: string | null;
  ancillaryCaseId: number | null;
  nextAction: string | null;
  disposition: string | null;
  sourceSystem: string | null;
  externalCallId: string | null;
  recordingRef: string | null;
  transcriptRef: string | null;
};

function CommDetailDialog({ row, onClose }: { row: CanonicalCommRow | null; onClose: () => void }) {
  return (
    <Dialog open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" data-testid="comm-detail-dialog">
        {row && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base flex items-center gap-2">
                <Phone className="w-4 h-4 text-slate-500" />
                Communication Detail
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2.5 text-sm mt-2">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div><span className="text-slate-400 text-[10px] uppercase block">Date / Time</span>{fmtDateTime(row.startedAt)}</div>
                <div><span className="text-slate-400 text-[10px] uppercase block">Duration</span>{row.durationSeconds ? `${Math.floor(row.durationSeconds / 60)}m ${row.durationSeconds % 60}s` : "—"}</div>
                <div><span className="text-slate-400 text-[10px] uppercase block">Staff</span>{row.staffName || "—"}{row.staffRole ? `, ${row.staffRole}` : ""}</div>
                <div><span className="text-slate-400 text-[10px] uppercase block">Channel</span><span className="capitalize">{row.channel || "phone"}</span></div>
                <div><span className="text-slate-400 text-[10px] uppercase block">Direction</span><span className="capitalize">{row.direction || "outbound"}</span></div>
                <div><span className="text-slate-400 text-[10px] uppercase block">Outcome</span><span className="capitalize">{(row.outcome || "").replace(/_/g, " ")}</span></div>
                <div><span className="text-slate-400 text-[10px] uppercase block">Service</span>{row.serviceType || "Patient-level"}</div>
                <div><span className="text-slate-400 text-[10px] uppercase block">Destination</span>{row.destination || "—"}</div>
                {row.callbackAt && <div><span className="text-slate-400 text-[10px] uppercase block">Callback</span>{fmtDateTime(row.callbackAt)}</div>}
                {row.nextAction && <div><span className="text-slate-400 text-[10px] uppercase block">Next Action</span>{row.nextAction}</div>}
                {row.disposition && <div><span className="text-slate-400 text-[10px] uppercase block">Disposition</span>{row.disposition}</div>}
                {row.sourceSystem && row.sourceSystem !== "plexus" && <div><span className="text-slate-400 text-[10px] uppercase block">Source</span>{row.sourceSystem}</div>}
                {row.externalCallId && <div><span className="text-slate-400 text-[10px] uppercase block">External ID</span><span className="font-mono text-[11px]">{row.externalCallId}</span></div>}
              </div>
              {row.notes && (
                <div className="pt-2 border-t border-slate-100 dark:border-border/40">
                  <span className="text-slate-400 text-[10px] uppercase block mb-1">Notes</span>
                  <p className="text-[13px] text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">{row.notes}</p>
                </div>
              )}
              {(row.recordingRef || row.transcriptRef) && (
                <div className="pt-2 border-t border-slate-100 dark:border-border/40 flex gap-3">
                  {row.recordingRef && <span className="text-[11px] text-blue-600">Recording on file</span>}
                  {row.transcriptRef && <span className="text-[11px] text-blue-600">Transcript on file</span>}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CallsSection({ chart }: SectionProps) {
  const screeningId = chart.patientScreeningId ?? null;
  const ec = (chart.executionCases ?? [])[0] ?? null;
  const [filter, setFilter] = useState("all");
  const [visibleCount, setVisibleCount] = useState(CALLS_PAGE_SIZE);
  const [detailRow, setDetailRow] = useState<CanonicalCommRow | null>(null);

  // Fetch canonical communications from the real API endpoint.
  const { data: allComms = [] } = useQuery<CanonicalCommRow[]>({
    queryKey: ["/api/patients", screeningId, "communications"],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${screeningId}/communications`, { credentials: "include" });
      if (!res.ok) return [];
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    },
    enabled: screeningId != null,
  });

  // Derive operational summary from canonical data.
  const totalComms = allComms.length;
  const lastComm = allComms[0] ?? null; // already ordered by startedAt DESC
  const assignedPcs = allComms.find((c) => c.staffName)?.staffName ?? null;
  const assignedRole = allComms.find((c) => c.staffRole)?.staffRole ?? ec?.assignedRole ?? null;
  const nextCallback = allComms.map((c) => c.callbackAt).filter(Boolean).sort().reverse()[0] ?? ec?.nextActionAt ?? null;
  const lastContact = lastComm ? `${fmtDate((lastComm.startedAt || "").slice(0, 10))} · ${(lastComm.outcome || "").replace(/_/g, " ")}` : "—";

  // Filter + paginate.
  const filtered = filter === "all" ? allComms : allComms.filter((c) => (c.channel || "phone") === filter);
  const shown = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  return (
    <SectionCard id="calls" title="Calls & Communications" icon={<Phone className="w-4 h-4" />} count={totalComms || null}>
      {/* Operational summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-1 mb-4 text-xs">
        <div><span className="text-[10px] text-slate-400 uppercase block">Assigned PCS</span><span className="font-medium text-slate-700 dark:text-slate-200">{assignedPcs ? `${assignedPcs}${assignedRole ? `, ${assignedRole}` : ""}` : (assignedRole || "—")}</span></div>
        <div><span className="text-[10px] text-slate-400 uppercase block">Total</span><span className="font-medium text-slate-700 dark:text-slate-200">{totalComms}</span></div>
        <div><span className="text-[10px] text-slate-400 uppercase block">Last Contact</span><span className="font-medium text-slate-700 dark:text-slate-200 capitalize">{lastContact}</span></div>
        <div><span className="text-[10px] text-slate-400 uppercase block">Next Callback</span><span className="font-medium text-slate-700 dark:text-slate-200">{nextCallback ? fmtDateTime(String(nextCallback)) : "—"}</span></div>
        <div><span className="text-[10px] text-slate-400 uppercase block">Next Action</span><span className="font-medium text-slate-700 dark:text-slate-200">{ec?.lastCallOutcome ? (allComms.find((c) => c.nextAction)?.nextAction ?? "—") : "—"}</span></div>
      </div>

      {totalComms === 0 ? (
        <EmptyState icon={<Phone className="w-8 h-8" />} title="No communications on file yet" hint="Calls, SMS, email and portal messages appear here as outreach happens." testId="empty-calls" />
      ) : (
        <>
          {/* Channel filter chips */}
          <div className="flex flex-wrap gap-1 mb-3">
            {COMM_CHANNEL_FILTERS.map(([k, label]) => (
              <button key={k} onClick={() => { setFilter(k); setVisibleCount(CALLS_PAGE_SIZE); }} className={`text-[11px] px-2 py-1 rounded-md transition-colors ${filter === k ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-muted"}`} data-testid={`calls-filter-${k}`}>{label}</button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="text-xs text-slate-500">No {filter} communications.</p>
          ) : (
            <div className="space-y-0 divide-y divide-slate-100 dark:divide-border/40">
              {shown.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setDetailRow(c)}
                  className="w-full text-left px-2 py-2.5 hover:bg-slate-50 dark:hover:bg-muted/30 transition-colors rounded-md flex items-start gap-3"
                  data-testid={`comm-row-${c.id}`}
                >
                  {/* Date/time column */}
                  <div className="shrink-0 w-28 text-xs">
                    <div className="font-medium text-slate-700 dark:text-slate-200">{fmtDate((c.startedAt || "").slice(0, 10))}</div>
                    <div className="text-[10px] text-slate-400">{fmtTime(c.startedAt)}</div>
                  </div>
                  {/* Main content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-slate-800 dark:text-slate-100">{c.staffName || "Staff"}{c.staffRole ? `, ${c.staffRole}` : ""}</span>
                      <span className="text-[10px] text-slate-400">·</span>
                      <span className="text-[10px] text-slate-500 capitalize">{c.direction || "outbound"} {c.channel || "phone"}</span>
                      <Badge variant="outline" className="text-[10px] capitalize">{(c.outcome || "logged").replace(/_/g, " ")}</Badge>
                    </div>
                    {c.serviceType && (
                      <div className="text-[11px] text-blue-600 mt-0.5">{c.serviceType}</div>
                    )}
                    {c.notes && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{c.notes}</p>
                    )}
                    {c.nextAction && (
                      <div className="text-[11px] text-slate-500 mt-0.5">Next: <span className="font-medium text-slate-700 dark:text-slate-200">{c.nextAction}</span></div>
                    )}
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-1" />
                </button>
              ))}
            </div>
          )}

          {/* Pagination */}
          {hasMore && (
            <div className="mt-3 text-center">
              <button
                onClick={() => setVisibleCount((v) => v + CALLS_PAGE_SIZE)}
                className="text-xs font-medium text-blue-600 hover:underline"
                data-testid="calls-load-more"
              >
                Load {Math.min(CALLS_PAGE_SIZE, filtered.length - visibleCount)} More · Showing {shown.length} of {filtered.length}
              </button>
            </div>
          )}
        </>
      )}

      <CommDetailDialog row={detailRow} onClose={() => setDetailRow(null)} />
    </SectionCard>
  );
}

// ── 7. Scheduling ──────────────────────────────────────────────────────────
function SchedulingSection({ chart }: SectionProps) {
  const appts = chart.scheduling ?? [];
  const today = new Date().toISOString().slice(0, 10);

  // Phase 2D — when the client flag is ON and the chart carries the
  // canonical projection, render per-ancillary-case canonical
  // appointments (active + history within the correct case; doctor_visit
  // excluded server-side) instead of the legacy ancillary_appointments
  // table. Flag OFF preserves the legacy scheduling table exactly.
  const canonicalByService = chart.canonicalAppointmentByService ?? null;
  if (isCanonicalAppointmentUiEnabled() && canonicalByService) {
    const entries = Object.entries(canonicalByService);
    return (
      <SectionCard id="scheduling" title="Scheduling" icon={<CalendarClock className="w-4 h-4" />} count={entries.length}
        action={<Link href="/appointments"><Button size="sm" variant="ghost" className="h-7 px-2 gap-1 text-xs" data-testid="button-open-appointments"><ExternalLink className="w-3 h-3" />Calendar</Button></Link>}>
        {entries.length === 0 ? (
          <EmptyState icon={<CalendarClock className="w-8 h-8" />} title="No appointments scheduled" hint="Booked ancillary appointments for this patient appear here." testId="empty-scheduling" />
        ) : (
          <div className="space-y-2">
            {entries.map(([serviceType, projection]) => (
              <CanonicalAppointmentSummary
                key={`${serviceType}-${projection.activeAppointment?.globalScheduleEventId ?? "none"}`}
                projection={projection}
                serviceType={serviceType}
                showHistory
                showReadiness
                data-testid={`ehr-appointment-${serviceType}`}
              />
            ))}
          </div>
        )}
      </SectionCard>
    );
  }

  const DONE_STATUSES = ["completed", "cancelled", "canceled", "no_show", "no-show"];
  const upcoming = appts
    .filter((a) => !DONE_STATUSES.includes((a.status ?? "").toLowerCase()) && (a.scheduledDate ?? "").slice(0, 10) >= today)
    .sort((a, b) => (a.scheduledDate ?? "").localeCompare(b.scheduledDate ?? ""));
  const history = appts
    .filter((a) => DONE_STATUSES.includes((a.status ?? "").toLowerCase()) || (a.scheduledDate ?? "").slice(0, 10) < today)
    .sort((a, b) => (b.scheduledDate ?? "").localeCompare(a.scheduledDate ?? ""));
  const unscheduled = (chart.serviceEpisodes ?? []).filter((ep) => {
    const st = (ep.appointment?.status ?? "").toLowerCase();
    return st !== "scheduled" && st !== "completed";
  });
  const total = appts.length + unscheduled.length;

  const apptRow = (a: typeof appts[number], i: number) => (
    <div key={a.id ?? i} className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 dark:border-border/40 last:border-0 text-xs" data-testid={`appt-${a.id ?? i}`}>
      <div className="min-w-0">
        <div className="font-medium text-slate-800 dark:text-slate-100 truncate">{a.testType || "Ancillary"}</div>
        <div className="text-[11px] text-slate-500">{a.facility || "—"}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-slate-700 dark:text-slate-200">{a.scheduledDate ? fmtDate(a.scheduledDate) : "—"}{a.scheduledTime ? ` · ${a.scheduledTime}` : ""}</div>
        <Badge variant="outline" className="text-[10px] mt-0.5">{a.status || "—"}</Badge>
      </div>
    </div>
  );
  const groupLabel = (t: string) => <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1 mt-3 first:mt-0">{t}</div>;

  return (
    <SectionCard id="scheduling" title="Scheduling" icon={<CalendarClock className="w-4 h-4" />} count={total || null}
      action={<Link href="/appointments"><Button size="sm" variant="ghost" className="h-7 px-2 gap-1 text-xs" data-testid="button-open-appointments"><ExternalLink className="w-3 h-3" />Calendar</Button></Link>}>
      {total === 0 ? (
        <EmptyState icon={<CalendarClock className="w-8 h-8" />} title="No appointments scheduled" hint="Booked ancillary appointments for this patient appear here." testId="empty-scheduling" />
      ) : (
        <div>
          {groupLabel("Upcoming")}
          {upcoming.length === 0 ? <p className="text-xs text-slate-500">No upcoming appointments.</p> : upcoming.map(apptRow)}

          {unscheduled.length > 0 && (
            <>
              {groupLabel("Unscheduled Approved Services")}
              {unscheduled.map((ep) => (
                <div key={ep.serviceKey} className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 dark:border-border/40 last:border-0 text-xs" data-testid={`unscheduled-${ep.serviceKey}`}>
                  <span className="font-medium text-slate-800 dark:text-slate-100 truncate">{ep.serviceName}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-slate-400">{ep.stage}</span>
                    <Link href="/appointments"><button className="text-[11px] text-blue-600 hover:underline" data-testid={`schedule-${ep.serviceKey}`}>Schedule</button></Link>
                  </span>
                </div>
              ))}
            </>
          )}

          {history.length > 0 && (
            <>
              {groupLabel("History")}
              {history.map(apptRow)}
            </>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ── 8. Plexus Notes & Documents ─────────────────────────────────────────────
// Shared clickable Atlas launcher. Generates + opens the per-patient atlas on
// demand from the canonical Plexus IQ output (patient_screenings.reasoning),
// keyed by patientScreeningId. Used in Overview → Recent Reports, the Documents
// → Atlases section, and the header intelligence strip.
const ATLAS_META = {
  plexus: { label: "Plexus Atlas", Icon: FileBarChart },
  clinician: { label: "Clinician Atlas", Icon: FileText },
} as const;

export function AtlasActions({ chart, layout }: { chart: EmrChart; layout: "row" | "card" }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<null | "plexus" | "clinician">(null);
  const psid = chart.patientScreeningId ?? null;
  const name = chart.demographics.name ?? "Patient";

  const availability = {
    plexus: chart.reports?.plexusPdf?.available ?? false,
    clinician: chart.reports?.clinicianPdf?.available ?? false,
  };
  const detail = {
    plexus: chart.reports?.plexusPdf?.detail ?? null,
    clinician: chart.reports?.clinicianPdf?.detail ?? null,
  };

  const open = async (mode: "plexus" | "clinician") => {
    if (psid == null) {
      toast({ title: "Atlas unavailable", description: "No screening is linked to this patient yet.", variant: "destructive" });
      return;
    }
    setBusy(mode);
    try {
      const res = await openSinglePatientPacket(psid, name, null, mode);
      if (!res.ok) toast({ title: `Could not open ${ATLAS_META[mode].label}`, description: res.error, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const modes: Array<"plexus" | "clinician"> = ["plexus", "clinician"];

  if (layout === "row") {
    return (
      <div className="space-y-1.5">
        {modes.map((mode) => {
          const { label, Icon } = ATLAS_META[mode];
          const ok = availability[mode];
          return (
            <button
              key={mode}
              onClick={() => ok && open(mode)}
              disabled={!ok || busy === mode}
              className={`w-full flex items-center justify-between gap-2 text-xs ${ok ? "hover:underline" : "opacity-60 cursor-not-allowed"}`}
              data-testid={`overview-atlas-${mode}`}
            >
              <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                <Icon className="w-3.5 h-3.5" style={{ color: mode === "plexus" ? "#2459E0" : "#6B5ED6" }} />
                {label}
              </span>
              <span className={`text-[10px] font-medium ${ok ? "text-blue-600" : "text-slate-400"}`}>{ok ? (busy === mode ? "Opening…" : "Open") : "—"}</span>
            </button>
          );
        })}
      </div>
    );
  }

  // layout === "card"
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {modes.map((mode) => {
        const { label, Icon } = ATLAS_META[mode];
        const ok = availability[mode];
        return (
          <div key={mode} className="rounded-xl border border-slate-200/70 dark:border-border/50 px-4 py-3 flex items-center justify-between gap-3" data-testid={`atlas-card-${mode}`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 shrink-0" style={{ color: mode === "plexus" ? "#2459E0" : "#6B5ED6" }} />
                <span className="text-sm font-semibold truncate">{label}</span>
                {ok
                  ? <Pill tone="green"><CheckCircle2 className="w-3 h-3" />Current</Pill>
                  : <Pill tone="slate"><MinusCircle className="w-3 h-3" />Not generated</Pill>}
              </div>
              {detail[mode] && <div className="text-[11px] text-muted-foreground mt-1 ml-6">{detail[mode]}</div>}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 shrink-0 text-xs"
              disabled={!ok || busy === mode}
              onClick={() => open(mode)}
              data-testid={`atlas-card-${mode}-open`}
            >
              <ExternalLink className="w-3.5 h-3.5" />{busy === mode ? "Opening…" : "Open Atlas"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

// ── Plexus Notes & Documents — canonical, organized PATIENT → SERVICE →
//    CURRENT EPISODE → PREVIOUS EPISODES. Real order/procedure notes come from
//    procedure_notes; previous episodes from patient_test_history. Every "Open"
//    renders the real object (no dead buttons, no fabricated statuses).

// Canonical per-episode document + version-lineage shapes (from
// /api/patients/:id/episode-documents). Episode-keyed => no cross-episode leak.
type EpisodeDoc = {
  id: number; serviceType: string; episodeKey: string; episodeLabel: string | null;
  episodeDate: string | null; isCurrent: boolean; documentType: string; title: string;
  status: string | null; bodyText: string | null; structuredData: any;
  createdDate: string | null; sentDate: string | null; completedDate: string | null;
  signedDate: string | null; finalizedDate: string | null;
  authorName: string | null; completedByName: string | null; signerName: string | null; version: number;
};
type DocVersion = {
  id: number; episodeDocumentId: number; version: number; authorRole: string | null;
  authorName: string | null; label: string; bodyText: string | null;
  changes: Array<{ field: string; action: string; before?: string | null; after?: string | null }> | null;
  isSigned: boolean; createdDate: string | null;
};

// A single document the user can open (note body or report summary).
type OpenDoc = { title: string; meta: string; body: string; kind: "note" | "report" };

function DocViewerDialog({ doc, onClose }: { doc: OpenDoc | null; onClose: () => void }) {
  return (
    <Dialog open={!!doc} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="doc-viewer-dialog">
        {doc && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base flex items-center gap-2">
                {doc.kind === "note" ? <FileText className="w-4 h-4 text-slate-500" /> : <FileBarChart className="w-4 h-4 text-slate-500" />}
                {doc.title}
              </DialogTitle>
            </DialogHeader>
            {doc.meta && <div className="text-[11px] text-muted-foreground border-b border-slate-100 dark:border-border/40 pb-2">{doc.meta}</div>}
            <p className="text-[13px] text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap mt-1" data-testid="doc-viewer-body">{doc.body}</p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const DOC_TYPE_LABEL: Record<string, string> = {
  order_note: "Order Note", screening_addendum: "Order Screening Addendum",
  procedure_note: "Procedure Note", consent: "Consent", screening_form: "Screening Form",
  test_report: "Test Report", billing_document: "Billing Document",
};
// Canonical render order of documents within an episode.
const DOC_TYPE_ORDER = ["order_note", "screening_addendum", "procedure_note", "consent", "screening_form", "test_report", "billing_document"];
const NOTE_DOC_TYPES = new Set(["order_note", "procedure_note", "screening_addendum"]);
function docStatusTone(status: string | null): string {
  const s = (status ?? "").toLowerCase();
  if (["signed", "complete", "final", "generated", "uploaded"].includes(s)) return "text-emerald-600";
  if (["ready to sign", "sent", "in progress"].includes(s)) return "text-blue-600";
  if (["pending", "needs signature", "draft"].includes(s)) return "text-amber-600";
  if (["not started"].includes(s)) return "text-slate-400";
  return "text-slate-500";
}
function docIsOpenable(d: EpisodeDoc): boolean {
  return !!d.bodyText || (d.structuredData != null && typeof d.structuredData === "object");
}

// Version-derived audit summary for a clinician-editable note.
function noteAuditFromVersions(versions: DocVersion[], d: EpisodeDoc): {
  generatedBy: string; adminEdited: boolean; clinicianEdited: boolean; changes: number; signedBy: string | null; signedDate: string | null;
} {
  const adminEdited = versions.some((v) => v.authorRole === "admin");
  const clinicianEdited = versions.some((v) => v.authorRole === "clinician" && !v.isSigned);
  const changes = versions.reduce((sum, v) => sum + (v.changes?.length ?? 0), 0);
  const signedV = versions.find((v) => v.isSigned);
  return {
    generatedBy: versions.find((v) => v.authorRole === "plexus_iq")?.authorName ?? d.authorName ?? "Plexus IQ",
    adminEdited, clinicianEdited, changes,
    signedBy: signedV?.authorName ?? d.signerName ?? null,
    signedDate: signedV?.createdDate ?? d.signedDate ?? null,
  };
}

// One document row: Open + (notes) audit line + View Changes + History.
function EpisodeDocRow({ d, versions, onOpen, onChanges, onHistory }: {
  d: EpisodeDoc; versions: DocVersion[];
  onOpen: (d: EpisodeDoc) => void; onChanges: (d: EpisodeDoc, v: DocVersion[]) => void; onHistory: (d: EpisodeDoc, v: DocVersion[]) => void;
}) {
  const openable = docIsOpenable(d);
  const isNote = NOTE_DOC_TYPES.has(d.documentType);
  const audit = isNote ? noteAuditFromVersions(versions, d) : null;
  const hasVersions = versions.length > 0;
  const changeCount = audit?.changes ?? 0;
  return (
    <div data-testid={`doc-${d.serviceType}-${d.episodeKey}-${d.documentType}`}>
      <div className="flex items-center justify-between gap-2 px-3.5 py-1.5">
        <span className="text-xs text-slate-700 dark:text-slate-200 truncate">{DOC_TYPE_LABEL[d.documentType] ?? d.title}</span>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-medium ${docStatusTone(d.status)}`}>{d.status ?? "—"}</span>
          <button
            onClick={() => openable && onOpen(d)}
            disabled={!openable}
            className={`text-[10px] font-medium inline-flex items-center gap-0.5 ${openable ? "text-blue-600 hover:underline" : "text-slate-300 cursor-not-allowed"}`}
            data-testid={`open-${d.serviceType}-${d.episodeKey}-${d.documentType}`}
          >
            <ExternalLink className="w-3 h-3" />Open
          </button>
          {isNote && changeCount > 0 && (
            <button onClick={() => onChanges(d, versions)} className="text-[10px] font-medium text-blue-600 hover:underline" data-testid={`changes-${d.serviceType}-${d.episodeKey}-${d.documentType}`}>View Changes</button>
          )}
          {isNote && hasVersions && (
            <button onClick={() => onHistory(d, versions)} className="text-[10px] font-medium text-blue-600 hover:underline" data-testid={`history-${d.serviceType}-${d.episodeKey}-${d.documentType}`}>History</button>
          )}
        </div>
      </div>
      {isNote && audit && (
        <div className="px-3.5 pb-1.5 -mt-0.5 text-[10px] text-slate-400 leading-snug">
          Generated by {audit.generatedBy}
          {audit.adminEdited ? " · Admin edited" : ""}
          {audit.clinicianEdited ? " · Clinician edited" : ""}
          {audit.changes > 0 ? ` · ${audit.changes} change${audit.changes === 1 ? "" : "s"}` : ""}
          {audit.signedBy ? ` · Signed by ${audit.signedBy}${audit.signedDate ? ` ${fmtDate(audit.signedDate.slice(0, 10))}` : ""}` : ""}
        </div>
      )}
    </div>
  );
}

// Renders a document's real content (narrative body or structured data).
function EpisodeDocContent({ d }: { d: EpisodeDoc }) {
  const sd = d.structuredData;
  if (d.documentType === "screening_form" && sd && typeof sd === "object") {
    const questions: Array<{ question: string; answer: string }> = Array.isArray(sd.questions) ? sd.questions : [];
    return (
      <div className="space-y-2 text-[13px]">
        <div className="text-[11px] text-muted-foreground">{[sd.template, sd.templateVersion, sd.completed ? `Completed ${sd.completedDate ?? ""}${sd.completedBy ? ` · ${sd.completedBy}` : ""}` : "Not completed"].filter(Boolean).join(" · ")}</div>
        {questions.length === 0 ? <p className="text-xs text-slate-400">No answers recorded yet.</p> : (
          <div className="space-y-1.5">
            {questions.map((q, i) => (
              <div key={i} className="border-b border-slate-100 dark:border-border/40 pb-1">
                <div className="text-slate-500 text-[11px]">{q.question}</div>
                <div className="text-slate-800 dark:text-slate-100">{q.answer}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  if ((d.documentType === "test_report" || d.documentType === "billing_document") && sd && typeof sd === "object") {
    return (
      <div className="space-y-1.5 text-[13px]">
        {Object.entries(sd).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="text-slate-500 text-[11px] w-40 shrink-0 capitalize">{k.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}</span>
            <span className="text-slate-800 dark:text-slate-100">{Array.isArray(v) ? v.join(", ") : String(v ?? "—")}</span>
          </div>
        ))}
      </div>
    );
  }
  if (d.bodyText) return <p className="text-[13px] text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">{d.bodyText}</p>;
  return <p className="text-xs text-slate-400">No content on file.</p>;
}

// One service group: current episode docs + previous episodes (collapsed).
function ServiceEpisodesGroup({ serviceName, stageLabel, episodes, versionsByDoc, onOpen, onChanges, onHistory }: {
  serviceName: string;
  stageLabel: string | null;
  episodes: Array<{ key: string; label: string; date: string | null; isCurrent: boolean; docs: EpisodeDoc[] }>;
  versionsByDoc: Map<number, DocVersion[]>;
  onOpen: (d: EpisodeDoc) => void; onChanges: (d: EpisodeDoc, v: DocVersion[]) => void; onHistory: (d: EpisodeDoc, v: DocVersion[]) => void;
}) {
  const [showPrev, setShowPrev] = useState(false);
  const current = episodes.find((e) => e.isCurrent) ?? episodes[0] ?? null;
  const previous = episodes.filter((e) => e !== current);
  const sortDocs = (docs: EpisodeDoc[]) => [...docs].sort((a, b) => DOC_TYPE_ORDER.indexOf(a.documentType) - DOC_TYPE_ORDER.indexOf(b.documentType));
  return (
    <div className="rounded-xl border border-slate-200/80 dark:border-border/60 overflow-hidden" data-testid={`doc-service-${serviceName}`}>
      <div className="px-3.5 py-2 bg-slate-50 dark:bg-muted/40 border-b border-slate-100 dark:border-border/40 flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">{serviceName}</span>
        {stageLabel && <Badge variant="outline" className="text-[9px]">{stageLabel}</Badge>}
      </div>

      {/* CURRENT EPISODE */}
      <div className="py-1.5">
        <div className="px-3.5 pt-1 pb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">{current?.label ?? "Current Episode"}</div>
        {!current || current.docs.length === 0 ? (
          <p className="px-3.5 pb-1.5 text-[11px] text-slate-400">No documents generated yet for the current episode.</p>
        ) : sortDocs(current.docs).map((d) => (
          <EpisodeDocRow key={d.id} d={d} versions={versionsByDoc.get(d.id) ?? []} onOpen={onOpen} onChanges={onChanges} onHistory={onHistory} />
        ))}
      </div>

      {/* PREVIOUS EPISODES (collapsed by default) */}
      {previous.length > 0 && (
        <div className="border-t border-slate-100 dark:border-border/40">
          <button
            onClick={() => setShowPrev((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-3.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-muted/30"
            data-testid={`prev-episodes-toggle-${serviceName}`}
          >
            <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Previous Episodes ({previous.length})</span>
            {showPrev ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
          </button>
          {showPrev && (
            <div className="pb-1.5">
              {previous.map((ep) => (
                <div key={ep.key} className="mb-1.5 last:mb-0" data-testid={`prev-episode-${serviceName}-${ep.key}`}>
                  <div className="px-3.5 pt-1 text-[10px] font-semibold text-slate-500">{ep.label}{ep.date ? ` · ${fmtDate(ep.date.slice(0, 10))}` : ""}</div>
                  {sortDocs(ep.docs).map((d) => (
                    <EpisodeDocRow key={d.id} d={d} versions={versionsByDoc.get(d.id) ?? []} onOpen={onOpen} onChanges={onChanges} onHistory={onHistory} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Unified viewer: document content, version changes (diff), or version history.
type DocViewerState = { mode: "open" | "changes" | "history"; doc: EpisodeDoc; versions: DocVersion[] } | null;
function EpisodeDocViewer({ state, onClose }: { state: DocViewerState; onClose: () => void }) {
  return (
    <Dialog open={!!state} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="episode-doc-dialog">
        {state && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-500" />
                {DOC_TYPE_LABEL[state.doc.documentType] ?? state.doc.title} — {state.doc.serviceType}
                {state.mode === "changes" ? " · Changes" : state.mode === "history" ? " · Version History" : ""}
              </DialogTitle>
            </DialogHeader>
            <div className="text-[11px] text-muted-foreground border-b border-slate-100 dark:border-border/40 pb-2">
              {[state.doc.episodeLabel, state.doc.status].filter(Boolean).join(" · ")}
            </div>
            {state.mode === "open" && <div className="mt-1"><EpisodeDocContent d={state.doc} /></div>}
            {state.mode === "history" && (
              <div className="mt-1 space-y-2" data-testid="doc-history">
                {state.versions.length === 0 ? <p className="text-xs text-slate-400">No version history.</p> : state.versions.map((v) => (
                  <div key={v.id} className="flex items-start gap-2 border-b border-slate-100 dark:border-border/40 pb-1.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${v.isSigned ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{v.isSigned ? "SIGNED" : `V${v.version}`}</span>
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium text-slate-800 dark:text-slate-100">{v.label}</div>
                      <div className="text-[11px] text-slate-500">{[v.authorName, v.createdDate ? fmtDate(v.createdDate.slice(0, 10)) : null].filter(Boolean).join(" · ")}{v.changes && v.changes.length > 0 ? ` · ${v.changes.length} change${v.changes.length === 1 ? "" : "s"}` : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {state.mode === "changes" && (
              <div className="mt-1 space-y-3" data-testid="doc-changes">
                {state.versions.filter((v) => v.changes && v.changes.length > 0).length === 0 ? (
                  <p className="text-xs text-slate-400">No recorded changes.</p>
                ) : state.versions.filter((v) => v.changes && v.changes.length > 0).map((v) => (
                  <div key={v.id}>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{v.label} · {v.authorName}{v.createdDate ? ` · ${fmtDate(v.createdDate.slice(0, 10))}` : ""}</div>
                    <div className="mt-1 space-y-1.5">
                      {(v.changes ?? []).map((c, i) => (
                        <div key={i} className="text-[12px]">
                          <span className={`text-[9px] font-bold px-1 py-0.5 rounded mr-1.5 ${c.action === "added" ? "bg-emerald-50 text-emerald-700" : c.action === "removed" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>{c.action.toUpperCase()}</span>
                          <span className="font-medium text-slate-700 dark:text-slate-200">{c.field}</span>
                          {c.before != null && <div className="pl-2 text-slate-500">Before: <span className="line-through">{c.before}</span></div>}
                          {c.after != null && <div className="pl-2 text-slate-800 dark:text-slate-100">After: {c.after}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Shared episode-document store + viewer opener ──────────────────────────
// The Plexus Notes & Documents section AND the Plexus Story open the SAME
// EpisodeDocViewer (open / view changes / history). This provider owns the
// single /episode-documents fetch, the version-by-doc index, and the viewer
// dialog so a Story event can deep-link to the exact same canonical document
// + diff a note row opens — no duplicate document/diff model. Mounted once in
// PatientChart, wrapping every section. Gated to roles with FULL documents
// access (a Story deep-link can open a doc iff the Documents section can).
type EpisodeDocsOpener = {
  documents: EpisodeDoc[];
  versionsByDoc: Map<number, DocVersion[]>;
  hasDoc: (episodeDocumentId: number) => boolean;
  open: (doc: EpisodeDoc, mode: "open" | "changes" | "history") => void;
  openById: (episodeDocumentId: number, mode: "open" | "changes" | "history") => void;
};
const EpisodeDocsContext = createContext<EpisodeDocsOpener | null>(null);
function useEpisodeDocs(): EpisodeDocsOpener | null {
  return useContext(EpisodeDocsContext);
}

export function EpisodeDocsProvider({ screeningId, enabled = true, children }: {
  screeningId: number | null;
  enabled?: boolean;
  children: React.ReactNode;
}) {
  const [viewer, setViewer] = useState<DocViewerState>(null);
  const { data: ed } = useQuery<{ documents: EpisodeDoc[]; versions: DocVersion[] }>({
    queryKey: ["/api/patients", screeningId, "episode-documents"],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${screeningId}/episode-documents`, { credentials: "include" });
      if (!res.ok) return { documents: [], versions: [] };
      const j = await res.json();
      return { documents: Array.isArray(j.documents) ? j.documents : [], versions: Array.isArray(j.versions) ? j.versions : [] };
    },
    enabled: enabled && screeningId != null,
  });
  const documents = ed?.documents ?? [];
  const versions = ed?.versions ?? [];
  const versionsByDoc = useMemo(() => {
    const m = new Map<number, DocVersion[]>();
    for (const v of versions) { const a = m.get(v.episodeDocumentId); if (a) a.push(v); else m.set(v.episodeDocumentId, [v]); }
    return m;
  }, [versions]);
  const docById = useMemo(() => new Map(documents.map((d) => [d.id, d])), [documents]);

  const open = useCallback((doc: EpisodeDoc, mode: "open" | "changes" | "history") => {
    setViewer({ mode, doc, versions: versionsByDoc.get(doc.id) ?? [] });
  }, [versionsByDoc]);
  const openById = useCallback((id: number, mode: "open" | "changes" | "history") => {
    const doc = docById.get(id);
    if (doc) setViewer({ mode, doc, versions: versionsByDoc.get(id) ?? [] });
  }, [docById, versionsByDoc]);

  const value = useMemo<EpisodeDocsOpener>(() => ({
    documents, versionsByDoc,
    hasDoc: (id: number) => docById.has(id),
    open, openById,
  }), [documents, versionsByDoc, docById, open, openById]);

  return (
    <EpisodeDocsContext.Provider value={value}>
      {children}
      <EpisodeDocViewer state={viewer} onClose={() => setViewer(null)} />
    </EpisodeDocsContext.Provider>
  );
}

function DocumentsSection({ chart }: SectionProps) {
  const docs = chart.documents ?? [];
  const canonical = isUnifiedAncillaryDocumentsEnabled();
  const screeningId = chart.patientScreeningId ?? null;
  const showCanonical = canonical && screeningId != null;

  // Canonical per-episode documents + version lineage come from the shared
  // EpisodeDocsProvider (single fetch + single viewer, shared with the Story).
  const docsCtx = useEpisodeDocs();
  const documents = docsCtx?.documents ?? [];
  const versionsByDoc = docsCtx?.versionsByDoc ?? new Map<number, DocVersion[]>();

  // Service list + stage badge from the single canonical serviceEpisodes
  // projection so Notes agree with Journey/Overview/Admin Review.
  const episodeByService = new Map((chart.serviceEpisodes ?? []).map((e) => [e.serviceName, e]));
  const serviceOrder = (chart.serviceEpisodes ?? []).map((e) => e.serviceName);
  const docServices = Array.from(new Set(documents.map((d) => d.serviceType)));
  const services = serviceOrder.length > 0
    ? [...serviceOrder, ...docServices.filter((s) => !serviceOrder.includes(s))]
    : docServices;

  // Group documents → service → episodeKey (episode-keyed = no leakage).
  const byServiceEpisode = new Map<string, Map<string, EpisodeDoc[]>>();
  for (const d of documents) {
    let m = byServiceEpisode.get(d.serviceType); if (!m) { m = new Map(); byServiceEpisode.set(d.serviceType, m); }
    const arr = m.get(d.episodeKey); if (arr) arr.push(d); else m.set(d.episodeKey, [d]);
  }
  const buildEpisodes = (svc: string) => {
    const m = byServiceEpisode.get(svc) ?? new Map<string, EpisodeDoc[]>();
    return Array.from(m.entries())
      .map(([key, ds]) => ({ key, label: ds[0]?.episodeLabel ?? key, date: ds[0]?.episodeDate ?? null, isCurrent: ds.some((d) => d.isCurrent), docs: ds }))
      .sort((a, b) => (b.isCurrent ? 1 : 0) - (a.isCurrent ? 1 : 0) || (b.date ?? "").localeCompare(a.date ?? ""));
  };

  const onOpen = (d: EpisodeDoc) => docsCtx?.open(d, "open");
  const onChanges = (d: EpisodeDoc) => docsCtx?.open(d, "changes");
  const onHistory = (d: EpisodeDoc) => docsCtx?.open(d, "history");

  return (
    <SectionCard id="documents" title="Plexus Notes & Documents" icon={<FileText className="w-4 h-4" />} count={services.length || null}>
      {services.length === 0 ? (
        <EmptyState icon={<FileText className="w-8 h-8" />} title="No ancillary service episodes yet" hint="Order notes, screening, procedure notes, consent, reports and billing are grouped per service episode." testId="empty-documents" />
      ) : (
        <div className="space-y-3 mb-4" data-testid="doc-service-groups">
          {services.map((s) => {
            const ep = episodeByService.get(s);
            const stageLabel = ep ? (ep.stageIndex >= JOURNEY_STAGES.length - 1 ? "Complete" : ep.stage) : null;
            return (
              <ServiceEpisodesGroup
                key={s}
                serviceName={s}
                stageLabel={stageLabel}
                episodes={buildEpisodes(s)}
                versionsByDoc={versionsByDoc}
                onOpen={onOpen}
                onChanges={onChanges}
                onHistory={onHistory}
              />
            );
          })}
        </div>
      )}

      {/* Atlases — generated from Plexus IQ, click to view */}
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Atlases</div>
      <div className="mb-4">
        <AtlasActions chart={chart} layout="card" />
      </div>

      {/* General attachments (canonical when enabled, else legacy list) */}
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">General Attachments</div>
      {showCanonical ? (
        <AncillaryDocumentsCard
          params={{ patientScreeningId: screeningId as number }}
          enabled
          title="Ancillary Documents"
        />
      ) : docs.length === 0 ? (
        <p className="text-xs text-slate-500" data-testid="empty-general-attachments">No general attachments on file.</p>
      ) : (
        <div className="space-y-1.5">
          {docs.map((d, i) => (
            <div key={d.id ?? i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-muted/40" data-testid={`row-document-${d.id ?? i}`}>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{d.title}</div>
                <div className="text-[11px] text-muted-foreground">{[d.kind, d.version ? `v${d.version}` : null, d.createdAt ? fmtDate(d.createdAt.slice(0, 10)) : null].filter(Boolean).join(" · ") || "—"}</div>
              </div>
              {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-emerald-600 hover:underline inline-flex items-center gap-0.5 shrink-0"><ExternalLink className="w-3 h-3" />Open</a>}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ── 9. Demographics ────────────────────────────────────────────────────────
function DemographicsSection({ chart }: SectionProps) {
  const d = chart.demographics;
  return (
    <SectionCard id="demographics" title="Demographics" icon={<User className="w-4 h-4" />}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
        <div>
          <KV label="Name" value={d.name || "—"} testId="text-demo-name" />
          <KV label="MRN" value={d.mrn || "—"} />
          <KV label="DOB" value={d.dob || "—"} />
          <KV label="Age" value={d.age != null ? `${d.age}` : "—"} />
          <KV label="Gender" value={d.gender || "—"} />
        </div>
        <div>
          <KV label="Phone" value={d.phoneNumber || "—"} />
          <KV label="Email" value={d.email || "—"} />
          <KV label="Address" value={d.address || "—"} />
          <KV label="Clinic" value={d.clinic || "—"} />
          <KV label="Language" value={d.language || "—"} />
        </div>
      </div>
    </SectionCard>
  );
}

// ── 10. Insurance & Eligibility ────────────────────────────────────────────
const ELIG_TONE: Record<string, keyof typeof TONE_PILL> = {
  preferred: "green", allowed: "green", requires_admin_approval: "amber", blocked: "red", unknown: "slate",
};
function InsuranceSection({ chart }: SectionProps) {
  const plans = chart.insurance.plans ?? [];
  return (
    <SectionCard id="insurance" title="Insurance & Eligibility" icon={<ShieldCheck className="w-4 h-4" />}>
      <KV label="Primary insurance" value={chart.insurance.primary || "—"} testId="text-insurance-primary" />
      <div className="mt-3">
        {plans.length === 0 ? (
          <EmptyState icon={<ShieldCheck className="w-8 h-8" />} title="No eligibility reviews on file" hint="Eligibility determinations and prior-auth status appear here once reviewed." testId="empty-insurance" />
        ) : (
          <Table head={<><Th>Plan</Th><Th>Priority</Th><Th>Eligibility</Th><Th>Approval</Th><Th>Reviewed</Th></>}>
            {plans.map((p, i) => (
              <tr key={i} className="border-b border-slate-100 dark:border-border/40 last:border-0" data-testid={`row-eligibility-${i}`}>
                <Td className="font-medium">{p.insuranceName || p.insuranceType || "—"}</Td>
                <Td>{p.priorityClass ? p.priorityClass.replace(/_/g, " ") : "—"}</Td>
                <Td><Pill tone={ELIG_TONE[(p.eligibilityStatus || "unknown").toLowerCase()] ?? "slate"}>{(p.eligibilityStatus || "unknown").replace(/_/g, " ")}</Pill></Td>
                <Td>{(p.approvalStatus || "—").replace(/_/g, " ")}</Td>
                <Td>{p.reviewedAt ? fmtDate(p.reviewedAt.slice(0, 10)) : "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </SectionCard>
  );
}

// ── 11. Providers ──────────────────────────────────────────────────────────
function ProvidersSection({ chart }: SectionProps) {
  const providers = chart.providers ?? [];
  return (
    <SectionCard id="providers" title="Providers" icon={<UserCog className="w-4 h-4" />} count={providers.length || null}>
      {providers.length === 0 ? (
        <EmptyState icon={<UserCog className="w-8 h-8" />} title="No care team on file" hint="Referring and ordering providers appear here once linked." testId="empty-providers" />
      ) : (
        <div className="space-y-1.5">
          {providers.map((p, i) => (
            <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-muted/40 text-sm" data-testid={`row-provider-${i}`}>
              <span className="font-medium">{p.name || "—"}</span>
              <span className="text-[11px] text-muted-foreground">{[p.role, p.facility].filter(Boolean).join(" · ") || "—"}</span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ── 12. Diagnoses / Problem List ───────────────────────────────────────────
function DiagnosesSection({ chart }: SectionProps) {
  const dx = chart.diagnoses ?? [];
  return (
    <SectionCard id="diagnoses" title="Diagnoses / Problem List" icon={<Stethoscope className="w-4 h-4" />} count={dx.length || null}>
      {dx.length === 0 ? (
        <EmptyState icon={<Stethoscope className="w-8 h-8" />} title="No diagnoses recorded" hint="Problem list entries are pulled from this patient's clinical data." testId="empty-diagnoses" />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {dx.map((d, i) => (
            <Badge key={i} variant="secondary" className="text-[11px]" data-testid={`chip-diagnosis-${i}`}>
              {d.icd10 ? `${d.icd10} · ` : ""}{d.description}
            </Badge>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ── 13. Medications ────────────────────────────────────────────────────────
function MedicationsSection({ chart }: SectionProps) {
  const meds = chart.medications ?? [];
  return (
    <SectionCard id="medications" title="Medications" icon={<PillIcon className="w-4 h-4" />} count={meds.length || null}>
      {meds.length === 0 ? (
        <EmptyState icon={<PillIcon className="w-8 h-8" />} title="No medications recorded" hint="Active medications are pulled from this patient's clinical data." testId="empty-medications" />
      ) : (
        <Table head={<><Th>Medication</Th><Th>Dose</Th><Th>Frequency</Th></>}>
          {meds.map((m, i) => (
            <tr key={i} className="border-b border-slate-100 dark:border-border/40 last:border-0" data-testid={`row-medication-${i}`}>
              <Td className="font-medium">{m.name}</Td>
              <Td>{m.dose || "—"}</Td>
              <Td>{m.frequency || "—"}</Td>
            </tr>
          ))}
        </Table>
      )}
    </SectionCard>
  );
}

// ── 14. Allergies ──────────────────────────────────────────────────────────
function AllergiesSection({ chart }: SectionProps) {
  const allergies = chart.allergies ?? [];
  return (
    <SectionCard id="allergies" title="Allergies" icon={<AlertTriangle className="w-4 h-4" />} count={allergies.length || null}>
      {allergies.length === 0 ? (
        <EmptyState icon={<AlertTriangle className="w-8 h-8" />} title="No known allergies on file" hint="Allergy and intolerance records appear here once captured." testId="empty-allergies" />
      ) : (
        <Table head={<><Th>Substance</Th><Th>Reaction</Th><Th>Severity</Th></>}>
          {allergies.map((a, i) => (
            <tr key={i} className="border-b border-slate-100 dark:border-border/40 last:border-0" data-testid={`row-allergy-${i}`}>
              <Td className="font-medium">{a.substance}</Td>
              <Td>{a.reaction || "—"}</Td>
              <Td>{a.severity || "—"}</Td>
            </tr>
          ))}
        </Table>
      )}
    </SectionCard>
  );
}

// ── 15. Labs ───────────────────────────────────────────────────────────────
const LAB_FLAG_TONE: Record<string, string> = {
  high: "text-red-600", critical: "text-red-700 font-semibold", low: "text-amber-600", normal: "text-slate-400",
};
function LabPanel({ panel, rows }: { panel: string; rows: EmrLab[] }) {
  const [open, setOpen] = useState(false);
  const draws = new Set(rows.map((r) => r.collectedAt)).size;
  const sorted = [...rows].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "") || (b.collectedAt ?? "").localeCompare(a.collectedAt ?? ""));
  return (
    <div className="rounded-xl border border-slate-200/80 dark:border-border/60 overflow-hidden" data-testid={`lab-panel-${panel}`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-slate-50 dark:hover:bg-muted/40">
        <span className="text-sm font-semibold">{panel}</span>
        <span className="flex items-center gap-2 text-xs text-slate-500">{draws} draw{draws !== 1 ? "s" : ""} {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-slate-100 dark:border-border/40">
          <table className="w-full border-collapse text-xs">
            <thead><tr className="border-b border-slate-200 dark:border-border/60"><Th>Analyte</Th><Th>Value</Th><Th>Units</Th><Th>Reference</Th><Th>Flag</Th><Th>Date</Th></tr></thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-border/40 last:border-0">
                  <Td className="font-medium">{r.name}</Td>
                  <Td className="tabular-nums">{r.value}</Td>
                  <Td className="text-slate-500">{r.unit}</Td>
                  <Td className="text-slate-500">{r.referenceRange || "—"}</Td>
                  <Td><span className={LAB_FLAG_TONE[r.flag ?? "normal"]}>{r.flag && r.flag !== "normal" ? r.flag : "—"}</span></Td>
                  <Td className="text-slate-500">{r.collectedAt ? fmtDate(r.collectedAt) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function LabsSection({ chart }: SectionProps) {
  const labs = chart.labs ?? [];
  const groups = new Map<string, EmrLab[]>();
  for (const l of labs) {
    const k = l.panel ?? l.name ?? "Other";
    const arr = groups.get(k); if (arr) arr.push(l); else groups.set(k, [l]);
  }
  const panels = Array.from(groups.entries());
  return (
    <SectionCard id="labs" title="Labs" icon={<FlaskConical className="w-4 h-4" />} count={panels.length || null}>
      {labs.length === 0 ? (
        <EmptyState icon={<FlaskConical className="w-8 h-8" />} title="No lab results available" hint="Current source: manual entry. Lab results populate here once a lab source is connected." testId="empty-labs" />
      ) : (
        <div className="space-y-2" data-testid="lab-panels">
          {panels.map(([panel, rows]) => <LabPanel key={panel} panel={panel} rows={rows} />)}
        </div>
      )}
    </SectionCard>
  );
}

// ── 16. Imaging ────────────────────────────────────────────────────────────
function ImagingSection({ chart }: SectionProps) {
  const imaging = chart.imaging ?? [];
  const [openDoc, setOpenDoc] = useState<OpenDoc | null>(null);
  return (
    <SectionCard id="imaging" title="Imaging" icon={<Scan className="w-4 h-4" />} count={imaging.length || null}>
      {imaging.length === 0 ? (
        <EmptyState icon={<Scan className="w-8 h-8" />} title="No imaging available" hint="Imaging studies and impressions populate here once a PACS/imaging source is connected." testId="empty-imaging" />
      ) : (
        <div className="space-y-2.5">
          {imaging.map((m, i) => {
            const openable = !!m.reportAvailable && !!m.impression;
            return (
              <div key={i} className="rounded-xl border border-slate-200/70 dark:border-border/50 px-4 py-3" data-testid={`row-imaging-${i}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{m.study}</span>
                  <span className="text-[11px] text-slate-500 shrink-0">{[m.modality, m.performedAt ? fmtDate(m.performedAt) : null].filter(Boolean).join(" · ")}</span>
                </div>
                {m.impression && <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-snug">{m.impression}</p>}
                <div className="flex items-center justify-between gap-2 mt-2">
                  <span className="text-[10px] text-slate-400">{[m.status, m.source ? `Source: ${m.source}` : null].filter(Boolean).join(" · ")}</span>
                  <button
                    disabled={!openable}
                    onClick={() => openable && setOpenDoc({
                      kind: "report",
                      title: `${m.study} — Report`,
                      meta: [m.modality, m.performedAt ? fmtDate(m.performedAt) : null, m.status, m.source ? `Source: ${m.source}` : null].filter(Boolean).join(" · "),
                      body: `IMPRESSION\n\n${m.impression ?? ""}`,
                    })}
                    className={`text-[11px] font-medium inline-flex items-center gap-1 ${openable ? "text-blue-600 hover:underline" : "text-slate-300 cursor-not-allowed"}`}
                    data-testid={`imaging-report-${i}`}
                  >
                    <FileText className="w-3 h-3" />Open Report
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <DocViewerDialog doc={openDoc} onClose={() => setOpenDoc(null)} />
    </SectionCard>
  );
}

// ── 17. Vitals ─────────────────────────────────────────────────────────────
const VITAL_METRICS = ["Blood Pressure", "Heart Rate", "Resp Rate", "SpO₂", "Temp", "Weight", "BMI"];
function VitalsSection({ chart }: SectionProps) {
  const vitals = chart.vitals ?? [];
  const byDate = new Map<string, Map<string, EmrVital>>();
  for (const v of vitals) {
    const d = (v.measuredAt ?? "").slice(0, 10);
    if (!d) continue;
    let m = byDate.get(d); if (!m) { m = new Map(); byDate.set(d, m); }
    if (v.label) m.set(v.label, v);
  }
  const dates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));
  const latest = dates[0];
  const latestMap = latest ? byDate.get(latest)! : new Map<string, EmrVital>();
  return (
    <SectionCard id="vitals" title="Vitals" icon={<Activity className="w-4 h-4" />} count={dates.length || null}>
      {vitals.length === 0 ? (
        <EmptyState icon={<Activity className="w-8 h-8" />} title="No vitals available" hint="Vital signs populate here once a device or EHR source is connected." testId="empty-vitals" />
      ) : (
        <>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Most recent · {latest ? fmtDate(latest) : "—"}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-5">
            {VITAL_METRICS.map((m) => {
              const v = latestMap.get(m);
              return (
                <div key={m} data-testid={`vital-latest-${m}`}>
                  <div className="text-base font-bold tabular-nums leading-none text-slate-800 dark:text-slate-100">{v ? `${v.value ?? ""}${v.unit ? ` ${v.unit}` : ""}` : "—"}</div>
                  <div className="text-[10px] text-slate-500 mt-1">{m}</div>
                </div>
              );
            })}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">History</div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead><tr className="border-b border-slate-200 dark:border-border/60"><Th>Date</Th>{VITAL_METRICS.map((m) => <Th key={m}>{m}</Th>)}</tr></thead>
              <tbody>
                {dates.map((d) => (
                  <tr key={d} className="border-b border-slate-100 dark:border-border/40 last:border-0" data-testid={`vital-row-${d}`}>
                    <Td className="font-medium whitespace-nowrap">{fmtDate(d)}</Td>
                    {VITAL_METRICS.map((m) => <Td key={m} className="tabular-nums whitespace-nowrap">{byDate.get(d)?.get(m)?.value ?? "—"}</Td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ── 18. Encounters / Notes ─────────────────────────────────────────────────
const ENCOUNTER_FILTERS: Array<[string, string]> = [
  ["all", "All"], ["primary_care", "Primary Care"], ["specialist", "Specialist"],
  ["hospital", "Hospital"], ["telephone", "Telephone"], ["other", "Other"],
];
function EncounterRow({ e, onOpen, relevant }: { e: EmrEncounter; onOpen: (e: EmrEncounter) => void; relevant?: boolean }) {
  return (
    <div className="border-b border-slate-100 dark:border-border/40 last:border-0">
      <button onClick={() => onOpen(e)} className="w-full flex items-center gap-3 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-muted/30" data-testid={`encounter-row-${e.occurredAt}`}>
        <span className="w-16 text-slate-500 shrink-0">{e.occurredAt ? fmtDate(e.occurredAt.slice(0, 10)) : "—"}</span>
        <span className="w-28 text-slate-500 shrink-0 truncate hidden sm:block">{e.kind}</span>
        <span className="flex-1 min-w-0 truncate"><span className="font-medium text-slate-800 dark:text-slate-100">{e.title}</span>{e.provider ? <span className="text-slate-500"> · {e.provider}</span> : ""}</span>
        {!relevant && (e.tags ?? []).map((t) => (
          <span key={t} className="hidden lg:inline text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: "#EDF3FF", color: "#3169E8" }}>{t}</span>
        ))}
        <span className="text-[10px] text-slate-400 shrink-0 inline-flex items-center gap-0.5"><Eye className="w-3 h-3" />Note</span>
      </button>
    </div>
  );
}

function EncounterNoteDialog({ encounter, onClose }: { encounter: EmrEncounter | null; onClose: () => void }) {
  const e = encounter;
  return (
    <Dialog open={!!e} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="encounter-note-dialog">
        {e && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">{e.title}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground border-b border-slate-100 dark:border-border/40 pb-2.5">
              {e.occurredAt && <span>{fmtDate(e.occurredAt.slice(0, 10))}</span>}
              {e.kind && <span>· {e.kind}</span>}
              {e.provider && <span>· {e.provider}</span>}
              {e.category && <span>· {e.category.replace(/_/g, " ")}</span>}
              {(e.tags ?? []).map((t) => (
                <span key={t} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "#EDF3FF", color: "#3169E8" }}>{t}</span>
              ))}
            </div>
            {e.noteBody ? (
              <p className="text-[13px] text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap mt-1" data-testid="encounter-note-body">{e.noteBody}</p>
            ) : e.summary ? (
              <p className="text-[13px] text-slate-700 dark:text-slate-200 leading-relaxed mt-1">{e.summary}</p>
            ) : (
              <p className="text-xs text-slate-400 mt-1">No note text on file for this encounter.</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const RELEVANT_LIMIT = 5;
const ENCOUNTER_PAGE = 20;
// Server-paginated encounters: page 1 fetched on mount; Load More raises the
// server limit (never preloads the full history). Search + type filter apply
// over the loaded pages; Load More pulls older encounters into scope.
function EncountersSection({ chart }: SectionProps) {
  const psid = chart.patientScreeningId ?? null;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(ENCOUNTER_PAGE);
  const [openEnc, setOpenEnc] = useState<EmrEncounter | null>(null);

  const { data } = useQuery<{ rows: EmrEncounter[]; total: number }>({
    queryKey: ["/api/patients", psid, "encounters", limit],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${psid}/encounters?limit=${limit}&offset=0`, { credentials: "include" });
      if (!res.ok) return { rows: [], total: 0 };
      const j = await res.json();
      return { rows: Array.isArray(j.rows) ? j.rows : [], total: j.total ?? 0 };
    },
    enabled: psid != null,
    placeholderData: (prev) => prev,
  });
  const loaded = data?.rows ?? [];
  const total = data?.total ?? 0;
  const remaining = Math.max(total - loaded.length, 0);
  const searching = query.trim().length > 0 || filter !== "all";

  const relevant = loaded
    .filter((e) => (e.tags ?? []).length > 0)
    .sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""))
    .slice(0, RELEVANT_LIMIT);

  const filtered = loaded.filter((e) => {
    if (filter !== "all" && (e.category ?? "other") !== filter) return false;
    if (query) {
      const hay = `${e.title ?? ""} ${e.provider ?? ""} ${e.summary ?? ""} ${e.kind ?? ""}`.toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""));

  const byYear = new Map<string, EmrEncounter[]>();
  for (const e of filtered) {
    const y = (e.occurredAt ?? "").slice(0, 4) || "—";
    const arr = byYear.get(y); if (arr) arr.push(e); else byYear.set(y, [e]);
  }
  const years = Array.from(byYear.keys()).sort((a, b) => b.localeCompare(a));

  return (
    <SectionCard id="encounters" title="Encounters / Notes" icon={<FileText className="w-4 h-4" />} count={total || null}>
      {total === 0 && loaded.length === 0 ? (
        <EmptyState icon={<FileText className="w-8 h-8" />} title="No encounters or notes on file" hint="Visit notes and encounter summaries appear here once recorded." testId="empty-encounters" />
      ) : (
        <>
          {!searching && relevant.length > 0 && (
            <div className="mb-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Relevant to active services</div>
              <div className="rounded-xl border border-slate-200/80 dark:border-border/60 px-3">
                {relevant.map((e, i) => <EncounterRow key={`rel-${e.occurredAt}-${i}`} e={e} onOpen={setOpenEnc} relevant />)}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mb-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search encounters…"
              className="h-8 px-2.5 rounded-md border border-slate-200 dark:border-border/60 bg-white dark:bg-card text-xs w-44 focus:outline-none focus:ring-1 focus:ring-blue-300"
              data-testid="encounters-search"
            />
            <div className="flex flex-wrap gap-1">
              {ENCOUNTER_FILTERS.map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`text-[11px] px-2 py-1 rounded-md ${filter === k ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-muted"}`}
                  data-testid={`encounters-filter-${k}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="text-[10px] text-slate-400 mb-3">Showing {loaded.length} of {total}{searching ? ` · ${filtered.length} match${filtered.length === 1 ? "" : "es"} in loaded` : ""}</div>

          {filtered.length === 0 ? (
            <p className="text-xs text-slate-500">No encounters match in the loaded set{remaining > 0 ? " — load more to search older encounters." : "."}</p>
          ) : (
            years.map((y) => (
              <div key={y} className="mb-3 last:mb-0">
                <div className="text-[11px] font-bold text-slate-400 border-b border-slate-100 dark:border-border/40 pb-1 mb-1">{y}</div>
                <div>{byYear.get(y)!.map((e, i) => <EncounterRow key={`${e.occurredAt}-${i}`} e={e} onOpen={setOpenEnc} />)}</div>
              </div>
            ))
          )}
          {remaining > 0 && (
            <button
              onClick={() => setLimit((l) => l + ENCOUNTER_PAGE)}
              className="mt-1 text-xs font-medium text-blue-600 hover:underline"
              data-testid="encounters-load-more"
            >
              Load {Math.min(remaining, ENCOUNTER_PAGE)} more ({remaining} remaining)
            </button>
          )}
        </>
      )}
      <EncounterNoteDialog encounter={openEnc} onClose={() => setOpenEnc(null)} />
    </SectionCard>
  );
}

// ── 19. Billing / Readiness ────────────────────────────────────────────────
function BillingCheck({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs" data-testid={`billing-check-${label}`}>
      {ready ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
      <span className={ready ? "text-slate-700 dark:text-slate-200" : "text-slate-400"}>{label}</span>
    </div>
  );
}

type ServiceBilling = { checks: Array<{ label: string; ready: boolean }>; allReady: boolean; blockers: string[] };
function computeServiceBilling(serviceName: string, chart: EmrChart): ServiceBilling {
  const hasDemographics = !!chart.demographics.dob;
  const hasInsurance = !!chart.insurance.primary;
  const eligibility = (chart.insurance.plans ?? []).some(
    (p) => (p.approvalStatus ?? "").toLowerCase() === "approved"
      || ["preferred", "allowed"].includes((p.eligibilityStatus ?? "").toLowerCase()),
  );
  const hasDiagnosis = (chart.diagnoses ?? []).length > 0;
  const n = serviceName.toLowerCase();
  const scheduled = (chart.scheduling ?? []).some(
    (a) => ["scheduled", "completed"].includes((a.status ?? "").toLowerCase())
      && (a.testType ?? "").toLowerCase().includes(n.split(" ")[0]),
  );
  // Per-service clinical-workflow state from the SINGLE canonical serviceEpisodes
  // projection (order/report/procedure-note statuses derive server-side from
  // procedure_notes.signatureStatus + appointment + report). Never a global
  // eCW-sync flag — billing readiness must reflect THIS service's real state.
  const ep = (chart.serviceEpisodes ?? []).find((e) => e.serviceName === serviceName) ?? null;
  const orderSigned = (ep?.orderStatus ?? "").toLowerCase() === "signed";
  const reportUploaded = ["final", "uploaded"].includes((ep?.reportStatus ?? "").toLowerCase());
  const procedureNoteSigned = (ep?.procedureNoteStatus ?? "").toLowerCase() === "signed";
  // Screening precedes the test: a finalized report or signed procedure note
  // implies screening was completed; otherwise reflect the episode's status.
  const screeningComplete = reportUploaded || procedureNoteSigned
    || ["complete", "completed"].includes((ep?.screeningStatus ?? "").toLowerCase());
  const checks = [
    { label: "Demographics", ready: hasDemographics },
    { label: "Insurance", ready: hasInsurance },
    { label: "Eligibility", ready: eligibility },
    { label: "Diagnosis / ICD", ready: hasDiagnosis },
    { label: "Order Signed", ready: orderSigned },
    { label: "Screening Complete", ready: screeningComplete },
    { label: "Report Uploaded", ready: reportUploaded },
    { label: "Procedure Note Signed", ready: procedureNoteSigned },
  ];
  const allReady = checks.every((c) => c.ready) && scheduled;
  const blockers: string[] = [];
  if (!scheduled) blockers.push("Not scheduled");
  if (!orderSigned) blockers.push("Order not signed");
  if (!reportUploaded) blockers.push("Report missing");
  if (!procedureNoteSigned) blockers.push("Procedure Note missing");
  return { checks, allReady, blockers };
}

// Collapsed accordion — one row per service; expand for checklist + blockers.
function ServiceBillingCard({ serviceName, chart }: { serviceName: string; chart: EmrChart }) {
  const [open, setOpen] = useState(false);
  const { checks, allReady, blockers } = computeServiceBilling(serviceName, chart);
  return (
    <div className="rounded-xl border border-slate-200/80 dark:border-border/60 overflow-hidden" data-testid={`billing-service-${serviceName}`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 hover:bg-slate-50 dark:hover:bg-muted/40" data-testid={`billing-toggle-${serviceName}`}>
        <span className="text-sm font-semibold truncate">{serviceName}</span>
        <span className="flex items-center gap-2 shrink-0">
          {allReady ? <Pill tone="green"><CheckCircle2 className="w-3 h-3" />Ready</Pill> : <Pill tone="red">{blockers.length} blocker{blockers.length !== 1 ? "s" : ""}</Pill>}
          {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        </span>
      </button>
      {open && (
        <div className="p-3.5 border-t border-slate-100 dark:border-border/40">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {checks.map((c) => <BillingCheck key={c.label} label={c.label} ready={c.ready} />)}
          </div>
          {blockers.length > 0 && (
            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-border/40">
              <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-1">Blockers</div>
              <ul className="list-disc list-inside space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
                {blockers.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BillingSection({ chart }: SectionProps) {
  const services = (chart.serviceEpisodes ?? []).map((ep) => ep.serviceName);
  const list = services.length > 0 ? services : (chart.plexusIq.qualifyingTests ?? []).map((t) => t.testName);
  const readyCount = list.filter((s) => computeServiceBilling(s, chart).allReady).length;
  const blockedCount = list.length - readyCount;
  return (
    <SectionCard id="billing" title="Billing / Readiness" icon={<Receipt className="w-4 h-4" />} count={list.length || null}
      action={list.length > 0 ? <Pill tone={readyCount === list.length ? "green" : readyCount === 0 ? "red" : "amber"}>{readyCount}/{list.length} ready</Pill> : undefined}>
      {list.length === 0 ? (
        <EmptyState icon={<Receipt className="w-8 h-8" />} title="No ancillary service episodes to bill yet" hint="Billing readiness is tracked per ancillary service episode once services qualify." testId="empty-billing" />
      ) : (
        <>
          <div className="text-xs text-slate-500 mb-3" data-testid="billing-summary">{readyCount} of {list.length} services ready · {blockedCount} blocked</div>
          <div className="space-y-2" data-testid="billing-service-cards">
            {list.map((s) => <ServiceBillingCard key={s} serviceName={s} chart={chart} />)}
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ── 20. Patient's Plexus Story ─────────────────────────────────────────────
// Renders the canonical patient_journey_events (via /api/patient-journey-events
// keyed by patientScreeningId) as a human-readable vertical story. Falls back
// to (and supplements with) events synthesized from chart data so the story is
// never empty when activity exists.
type JourneyEventRow = {
  id: number;
  eventType: string;
  eventSource: string;
  summary: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

const JOURNEY_TONE: Array<{ match: RegExp; tone: string }> = [
  { match: /call|contact|outreach/i, tone: "bg-amber-500" },
  { match: /appointment|schedule|booked/i, tone: "bg-blue-500" },
  { match: /admin|review|approv/i, tone: "bg-purple-500" },
  { match: /document|note|report|consent|order|procedure/i, tone: "bg-indigo-500" },
  { match: /screening|committed|qualif|case/i, tone: "bg-emerald-500" },
];
function journeyTone(eventType: string, summary: string): string {
  const hay = `${eventType} ${summary}`;
  return JOURNEY_TONE.find((t) => t.match.test(hay))?.tone ?? "bg-slate-400";
}
function humanizeEventType(t: string): string {
  return t.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const STORY_FILTERS = ["All", "Plexus IQ", "Clinical", "Calls", "Scheduling", "Documents", "Billing"] as const;
function storyCategory(hay: string): string {
  if (/call|contact|outreach|sms|email|voicemail/i.test(hay)) return "Calls";
  if (/appointment|schedule|booked|no.?show/i.test(hay)) return "Scheduling";
  if (/billing|claim|invoice|payment|paid/i.test(hay)) return "Billing";
  if (/document|note|report|consent|order|procedure|atlas|addendum/i.test(hay)) return "Documents";
  if (/\biq\b|qualif|data signal|admin|review|screening_committed|reasoning/i.test(hay)) return "Plexus IQ";
  if (/test on file|lab|imaging|vital|encounter|diagnos/i.test(hay)) return "Clinical";
  return "Plexus IQ";
}
function TimelineSection({ chart }: SectionProps) {
  type Ev = { when: string; label: string; sub: string; tone: string; cat: string; docId?: number | null; docAction?: "open" | "changes" };
  const psid = chart.patientScreeningId ?? null;
  const [filter, setFilter] = useState<string>("All");
  // Deep-link into the SAME episode-document viewer the Notes section uses.
  // Gated to FULL documents access (a Story link opens a doc iff Notes can).
  const docsCtx = useEpisodeDocs();
  const { getSectionAccess } = usePatientDirectorySectionAccess();
  const canOpenDocs = getSectionAccess("documents") === "full";

  const { data: journeyRows = [], isLoading } = useQuery<JourneyEventRow[]>({
    queryKey: ["/api/patient-journey-events", { patientScreeningId: psid }],
    queryFn: async () => {
      const res = await fetch(`/api/patient-journey-events?patientScreeningId=${psid}&limit=200`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as JourneyEventRow[];
      return Array.isArray(rows) ? rows : [];
    },
    enabled: psid != null,
    staleTime: 60_000,
  });

  const canonical: Ev[] = journeyRows.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const rawId = meta.episodeDocumentId;
    const docId = typeof rawId === "number" ? rawId
      : (typeof rawId === "string" && /^\d+$/.test(rawId) ? Number(rawId) : null);
    const docAction: "open" | "changes" = meta.documentAction === "changes" ? "changes" : "open";
    return {
      when: (r.createdAt || "").slice(0, 10),
      label: r.summary || humanizeEventType(r.eventType),
      sub: humanizeEventType(r.eventType),
      tone: journeyTone(r.eventType, r.summary || ""),
      cat: storyCategory(`${r.eventType} ${r.summary ?? ""}`),
      docId,
      docAction,
    };
  });

  const synth: Ev[] = [];
  for (const a of chart.scheduling ?? []) {
    if (a.scheduledDate) synth.push({ when: a.scheduledDate, label: `Appointment · ${a.testType || "Ancillary"}`, sub: `${a.facility || "—"} · ${a.status || ""}`, tone: "bg-blue-500", cat: "Scheduling" });
  }
  for (const c of chart.communication.calls ?? []) {
    const when = (c.occurredAt || "").slice(0, 10);
    if (when) synth.push({ when, label: `Call · ${c.outcome || "logged"}`, sub: [c.teamMember, c.notes].filter(Boolean).join(" · "), tone: "bg-amber-500", cat: "Calls" });
  }
  for (const t of chart.cooldown.testCooldowns ?? []) {
    if (t.lastDate) synth.push({ when: t.lastDate, label: `Test on file · ${t.testName}`, sub: (t.insuranceType || "").toUpperCase(), tone: "bg-emerald-500", cat: "Clinical" });
  }

  const combined = canonical.length > 0 ? canonical : synth;
  const all = combined.filter((e) => e.when).sort((a, b) => b.when.localeCompare(a.when));
  const timeline = filter === "All" ? all : all.filter((e) => e.cat === filter);

  return (
    <SectionCard id="plexus-story" title="Patient's Plexus Story" icon={<History className="w-4 h-4" />} count={all.length || null}>
      {isLoading && psid != null ? (
        <div className="space-y-3 animate-pulse" data-testid="plexus-story-loading">
          <div className="h-3.5 w-2/3 rounded bg-slate-200/80 dark:bg-muted" />
          <div className="h-3.5 w-1/2 rounded bg-slate-200/70 dark:bg-muted/80" />
        </div>
      ) : all.length === 0 ? (
        <EmptyState icon={<History className="w-8 h-8" />} title="No activity recorded yet" hint="The patient's story builds as Plexus IQ runs, services qualify, outreach happens and documents are generated." testId="empty-timeline" />
      ) : (
        <>
          <div className="flex flex-wrap gap-1 mb-3">
            {STORY_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[11px] px-2 py-1 rounded-md ${filter === f ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-muted"}`}
                data-testid={`story-filter-${f}`}
              >
                {f}
              </button>
            ))}
          </div>
          {timeline.length === 0 ? (
            <p className="text-xs text-slate-500">No {filter} events.</p>
          ) : (
            <div className="space-y-0">
              {timeline.map((e, i) => (
                <div key={i} className="flex gap-3 pb-4 last:pb-0" data-testid={`row-timeline-${i}`}>
                  <div className="flex flex-col items-center">
                    <span className={`w-2.5 h-2.5 rounded-full ${e.tone} mt-1`} />
                    {i < timeline.length - 1 && <span className="w-px flex-1 bg-slate-200 dark:bg-border mt-1" />}
                  </div>
                  <div className="min-w-0 flex-1 -mt-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{e.label}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0">{fmtDate(e.when)}</span>
                    </div>
                    {e.sub && <p className="text-[11px] text-muted-foreground truncate">{e.sub}</p>}
                    {e.docId != null && canOpenDocs && docsCtx?.hasDoc(e.docId) && (
                      <button
                        onClick={() => docsCtx?.openById(e.docId!, e.docAction ?? "open")}
                        className="mt-0.5 text-[11px] font-medium text-blue-600 hover:underline inline-flex items-center gap-0.5"
                        data-testid={`story-doc-link-${i}`}
                      >
                        <ExternalLink className="w-3 h-3" />{e.docAction === "changes" ? "View Changes" : "Open Document"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

// ── Admin Review ───────────────────────────────────────────────────────────
// Canonical per-service admin review. Reads the SAME source the Plexus IQ
// workspace writes (patient_ancillary_cases.admin_review_status via
// /api/patients/:id/admin-review) — no duplicate mock state. Permission
// controlled via the section-access matrix (see shared/patientDirectorySections).
type AdminReviewServiceRow = {
  ancillaryCaseId: number; serviceType: string; adminReviewStatus: string;
  qualificationStatus: string; lifecycleStatus: string;
};
type AdminReviewEventRow = {
  id: number; serviceType: string; previousStatus: string | null; newStatus: string;
  reviewerRole: string | null; actualReviewedAt: string | null; rationale: string | null;
};
type AdminReviewView = { services: AdminReviewServiceRow[]; events: AdminReviewEventRow[] };

const ADMIN_REVIEW_TONE: Record<string, keyof typeof TONE_PILL> = {
  approved: "green", rejected: "red", needs_info: "amber", pending: "amber",
};
function adminReviewTone(s: string): keyof typeof TONE_PILL {
  return ADMIN_REVIEW_TONE[(s || "pending").toLowerCase()] ?? "slate";
}

function AdminReviewSection({ chart }: SectionProps) {
  const iq = chart.plexusIq;
  const psid = chart.patientScreeningId ?? null;
  const [showEvents, setShowEvents] = useState(false);

  const { data: view } = useQuery<AdminReviewView>({
    queryKey: ["/api/patients", psid, "admin-review"],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${psid}/admin-review`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: psid != null,
  });

  // Write actions are permitted ONLY for the canonical Plexus-internal clinical
  // reviewer role (server-enforced in adminReview/authorization.ts). We mirror
  // that here so non-reviewers see read-only (no misleading buttons).
  const { data: me } = useCurrentUser();
  const canReview = ((me as { role?: string } | undefined)?.role ?? "") === "plexus_internal_clinical_reviewer";
  const qc = useQueryClient();
  const { toast } = useToast();
  const reviewMut = useMutation({
    mutationFn: async ({ caseId, newStatus }: { caseId: number; newStatus: string; label: string }) => {
      const rationale = window.prompt(`Rationale (optional) for this review decision:`) ?? undefined;
      const res = await fetch(`/api/ancillary-cases/${caseId}/admin-review`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newStatus, rationale }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      return res.json();
    },
    onSuccess: (_d, v) => {
      toast({ title: "Admin Review updated", description: `Service marked ${v.label}. Qualification, Journey and Story updated.` });
      // Prefix-invalidate every patient sub-query (admin-review view + cases +
      // clinical-data + prior-tests) so the canonical serviceEpisodes projection
      // re-derives and all sections reflect the decision. Plus notes + story.
      qc.invalidateQueries({ queryKey: ["/api/patients", psid] });
      qc.invalidateQueries({ queryKey: ["/api/procedure-notes"] });
      qc.invalidateQueries({ queryKey: ["/api/plexus-story", psid] });
    },
    onError: (e: any) => toast({ title: "Review failed", description: String(e?.message ?? e), variant: "destructive" }),
  });
  const doReview = (caseId: number, newStatus: string, label: string) => reviewMut.mutate({ caseId, newStatus, label });

  // Canonical per-service rows. Fall back to the qualifying-tests list only
  // when no canonical ancillary cases exist (unqualified/legacy patients).
  const services = view?.services ?? [];
  const events = view?.events ?? [];
  const tests = iq.qualifyingTests ?? [];
  const counts = services.reduce<Record<string, number>>((acc, s) => {
    const k = (s.adminReviewStatus || "pending").toLowerCase();
    acc[k] = (acc[k] ?? 0) + 1; return acc;
  }, {});
  const summary = Object.entries(counts).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(" · ");

  return (
    <SectionCard
      id="admin-review"
      title="Admin Review"
      icon={<ShieldCheck className="w-4 h-4" />}
      action={
        <div className="flex items-center gap-2">
          {services.length > 0 && <span className="text-[11px] text-muted-foreground">{summary}</span>}
          <Link href="/plexus-iq"><button className="text-[11px] font-medium text-blue-600 hover:underline inline-flex items-center gap-0.5" data-testid="open-full-admin-review"><ExternalLink className="w-3 h-3" />Open Full Admin Review</button></Link>
        </div>
      }
    >
      {services.length === 0 && tests.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="w-8 h-8" />} title="Nothing awaiting review" hint="Admin review appears once Plexus IQ qualifies ancillary services." testId="empty-admin-review" />
      ) : services.length > 0 ? (
        <div className="space-y-1.5" data-testid="admin-review-canonical">
          {services.map((s) => (
            <div key={s.ancillaryCaseId} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-muted/40" data-testid={`admin-review-${s.serviceType}`}>
              <span className="text-sm font-medium truncate">{s.serviceType}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-slate-400">{s.qualificationStatus.replace(/_/g, " ")}</span>
                <Pill tone={adminReviewTone(s.adminReviewStatus)}>{s.adminReviewStatus.replace(/_/g, " ")}</Pill>
                {canReview && (
                  <span className="flex items-center gap-1" data-testid={`admin-review-actions-${s.serviceType}`}>
                    {s.adminReviewStatus !== "approved" && <button onClick={() => doReview(s.ancillaryCaseId, "approved", "approved")} disabled={reviewMut.isPending} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50" data-testid={`approve-${s.serviceType}`}>Approve</button>}
                    {s.adminReviewStatus !== "needs_info" && <button onClick={() => doReview(s.ancillaryCaseId, "needs_info", "needs info")} disabled={reviewMut.isPending} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50" data-testid={`needsinfo-${s.serviceType}`}>Needs Info</button>}
                    {s.adminReviewStatus !== "rejected" && <button onClick={() => doReview(s.ancillaryCaseId, "rejected", "rejected")} disabled={reviewMut.isPending} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50" data-testid={`reject-${s.serviceType}`}>Reject</button>}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Legacy fallback (no canonical ancillary cases): show qualifying tests
        // with the legacy screening-level status.
        <div className="space-y-1.5">
          {tests.map((t) => (
            <div key={t.testName} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-muted/40" data-testid={`admin-review-${t.testName}`}>
              <span className="text-sm font-medium truncate">{t.testName}</span>
              <Pill tone={adminReviewTone(iq.adminApprovalStatus ?? "pending")}>{iq.adminApprovalStatus || "Pending"}</Pill>
            </div>
          ))}
        </div>
      )}

      {events.length > 0 && (
        <div className="mt-3 border-t border-slate-100 dark:border-border/40 pt-2">
          <button onClick={() => setShowEvents((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left" data-testid="admin-review-events-toggle">
            <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Review History ({events.length})</span>
            {showEvents ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
          </button>
          {showEvents && (
            <div className="mt-1.5 space-y-1">
              {events.map((e) => (
                <div key={e.id} className="text-[11px] text-slate-600 dark:text-slate-300" data-testid={`admin-review-event-${e.id}`}>
                  <span className="font-medium">{e.serviceType}</span>: {e.previousStatus ? `${e.previousStatus.replace(/_/g, " ")} → ` : ""}{e.newStatus.replace(/_/g, " ")}
                  {e.actualReviewedAt ? ` · ${fmtDate(e.actualReviewedAt.slice(0, 10))}` : ""}{e.reviewerRole ? ` · ${e.reviewerRole}` : ""}
                  {e.rationale ? <span className="text-slate-400"> — {e.rationale}</span> : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ── Section registry (order = render + nav order) ──────────────────────────
export type ChartSectionDef = {
  id: string;
  label: string;
  icon: React.ReactNode;
  Component: (props: SectionProps) => JSX.Element;
  group?: "identity" | "overview" | "intelligence" | "clinical" | "operations" | "deep";
};

// Section order reflects an ancillary care-specialist workflow:
// Overview → Qualifying Tests → Cooldown Eligibility → Clinical →
// Calls → Scheduling → Documents → Billing Readiness, with the
// outreach-automation surfaces kept at the end.
export const CHART_SECTIONS: ChartSectionDef[] = [
  // ── PATIENT (identity first) ──
  { id: "demographics", label: "Demographics", icon: <User className="w-4 h-4" />, Component: DemographicsSection, group: "identity" },
  { id: "insurance", label: "Insurance & Eligibility", icon: <ShieldCheck className="w-4 h-4" />, Component: InsuranceSection, group: "identity" },
  // ── PATIENT OVERVIEW ──
  { id: "overview", label: "Overview", icon: <User className="w-4 h-4" />, Component: OverviewSection, group: "overview" },
  { id: "plexus-iq", label: "Current Qualifying Tests", icon: <Sparkles className="w-4 h-4" />, Component: PlexusIqSection, group: "overview" },
  { id: "ancillary-journey", label: "Ancillary Journey", icon: <Sparkles className="w-4 h-4" />, Component: AncillaryJourneyPlaceholder, group: "overview" },
  // ── PLEXUS INTELLIGENCE ──
  { id: "cooldown", label: "Cooldown Eligibility", icon: <Clock className="w-4 h-4" />, Component: CooldownSection, group: "intelligence" },
  { id: "admin-review", label: "Admin Review", icon: <ShieldCheck className="w-4 h-4" />, Component: AdminReviewSection, group: "intelligence" },
  // ── SOURCE CLINICAL DATA ──
  { id: "providers", label: "Providers", icon: <UserCog className="w-4 h-4" />, Component: ProvidersSection, group: "clinical" },
  { id: "diagnoses", label: "Diagnoses / Problem List", icon: <Stethoscope className="w-4 h-4" />, Component: DiagnosesSection, group: "clinical" },
  { id: "medications", label: "Medications", icon: <PillIcon className="w-4 h-4" />, Component: MedicationsSection, group: "clinical" },
  { id: "allergies", label: "Allergies", icon: <AlertTriangle className="w-4 h-4" />, Component: AllergiesSection, group: "clinical" },
  { id: "labs", label: "Labs", icon: <FlaskConical className="w-4 h-4" />, Component: LabsSection, group: "clinical" },
  { id: "imaging", label: "Imaging", icon: <Scan className="w-4 h-4" />, Component: ImagingSection, group: "clinical" },
  { id: "vitals", label: "Vitals", icon: <Activity className="w-4 h-4" />, Component: VitalsSection, group: "clinical" },
  { id: "encounters", label: "Encounters / Notes", icon: <FileText className="w-4 h-4" />, Component: EncountersSection, group: "clinical" },
  // ── OPERATIONS & PLEXUS CLINICAL WORKFLOW ──
  { id: "calls", label: "Calls & Comms", icon: <Phone className="w-4 h-4" />, Component: CallsSection, group: "operations" },
  { id: "scheduling", label: "Scheduling", icon: <CalendarClock className="w-4 h-4" />, Component: SchedulingSection, group: "operations" },
  { id: "documents", label: "Plexus Notes & Documents", icon: <FileText className="w-4 h-4" />, Component: DocumentsSection, group: "operations" },
  { id: "billing", label: "Billing / Readiness", icon: <Receipt className="w-4 h-4" />, Component: BillingSection, group: "operations" },
  { id: "re-engagement", label: "Re-engagement", icon: <Megaphone className="w-4 h-4" />, Component: AdAutomationSection, group: "operations" },
  { id: "ancillary-cases", label: "Ancillary Cases", icon: <ClipboardList className="w-4 h-4" />, Component: ExecutionCasesSection, group: "operations" },
  { id: "plexus-story", label: "Patient's Plexus Story", icon: <History className="w-4 h-4" />, Component: TimelineSection, group: "operations" },
  // ── PLEXUS DEEP INTELLIGENCE (LAST) ──
  { id: "plexus-data-signals", label: "Plexus Data Signals", icon: <Sparkles className="w-4 h-4" />, Component: PlexusFindingsPlaceholder, group: "deep" },
];
