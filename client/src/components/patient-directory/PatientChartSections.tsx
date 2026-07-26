import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CanonicalAppointmentSummary } from "@/components/canonical/CanonicalAppointmentSummary";
import { isCanonicalAppointmentUiEnabled } from "@/lib/canonicalAppointmentUiFlag";
import { AncillaryDocumentsCard } from "@/components/ancillary-documents/CanonicalAncillaryDocuments";
import { isUnifiedAncillaryDocumentsEnabled } from "@/lib/unifiedAncillaryDocumentsFlag";
import {
  User, ShieldCheck, Stethoscope, Pill as PillIcon, AlertTriangle, FlaskConical,
  Scan, Activity, FileText, Phone, CalendarClock, Clock, Megaphone,
  Sparkles, ClipboardList, Receipt, History, CheckCircle2, XCircle,
  MinusCircle, ExternalLink, UserCog, Lock, Eye,
} from "lucide-react";
import { fmtDate } from "./profileTypes";
import {
  type EmrChart, type AdChannelStatus, COOLDOWN_STATE_TONES,
} from "@/types/emr";

// ── Shared primitives ────────────────────────────────────────────────────
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
    case "ad-automation":
      return chart.adAutomation?.reEngagementEligible ? "Re-engagement eligible" : "Re-engagement not eligible";
    case "execution-cases":
      return `${n(chart.executionCases)} execution case${n(chart.executionCases) === 1 ? "" : "s"} on file`;
    case "timeline":
      return "Activity timeline available";
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

// ── 1. Overview ───────────────────────────────────────────────────────────
// Care-specialist summary: how many ancillary tests the patient qualifies for,
// each test grouped under its bucket with a one-line reason, plus the clinical
// context (identity + active diagnoses). No outreach workflow status chips.
function OverviewSection({ chart }: SectionProps) {
  const d = chart.demographics;
  const tests = chart.plexusIq.qualifyingTests ?? [];
  const total = tests.length;
  const grouped = BUCKET_ORDER
    .map((bucket) => ({ bucket, items: tests.filter((t) => t.bucket === bucket) }))
    .filter((g) => g.items.length > 0);
  const dx = chart.diagnoses ?? [];
  return (
    <SectionCard
      id="overview"
      title="Overview"
      icon={<User className="w-4 h-4" />}
    >
      {/* Qualifying-test headline + grouped list */}
      <div className="rounded-xl border border-slate-200/80 dark:border-border/60 bg-plexus-navy-950/[0.02] dark:bg-plexus-navy-950/30 px-4 py-4 mb-4" data-testid="panel-qualifying-summary">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-plexus-blue-600 dark:text-plexus-blue-300 shrink-0" />
          <h3 className="text-lg font-bold tracking-tight" data-testid="text-qualifying-headline">
            {total > 0
              ? `Qualifies for ${total} ancillary test${total === 1 ? "" : "s"}`
              : "No qualifying ancillary tests yet"}
          </h3>
        </div>
        {total === 0 ? (
          <p className="text-xs text-muted-foreground mt-2">
            Run this patient through Plexus IQ to surface qualifying ancillary opportunities.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {grouped.map((g) => (
              <div key={g.bucket} data-testid={`overview-bucket-${g.bucket}`}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={`w-2 h-2 rounded-full ${BUCKET_DOT[g.bucket]}`} />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {BUCKET_LABEL[g.bucket]}
                  </span>
                  <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">{g.items.length}</span>
                </div>
                <div className="space-y-1.5">
                  {g.items.map((t) => {
                    const reason = firstLine(t.clinicianUnderstanding) ?? firstLine(t.patientTalkingPoints);
                    return (
                      <div
                        key={t.testName}
                        className={`rounded-lg bg-white dark:bg-card border border-slate-200/70 dark:border-border/50 px-3 py-2 ${BUCKET_STYLES[t.bucket]}`}
                        data-testid={`overview-qualifying-${t.testName}`}
                      >
                        <div className="text-sm font-semibold">{t.testName}</div>
                        {reason && <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{reason}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Clinical context: identity + active problems */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
        <div>
          <KV label="Name" value={d.name || "—"} />
          <KV label="MRN" value={d.mrn || "—"} />
          <KV label="DOB" value={d.dob || "—"} />
          <KV label="Age / Gender" value={[d.age ? `${d.age}yo` : null, d.gender].filter(Boolean).join(" · ") || "—"} />
        </div>
        <div>
          <KV label="Clinic" value={d.clinic || "—"} />
          <KV label="Provider" value={d.provider || "—"} testId="text-overview-provider" />
          <KV label="Insurance" value={chart.insurance.primary || "—"} />
          <KV label="Phone" value={d.phoneNumber || "—"} />
        </div>
      </div>

      {dx.length > 0 && (
        <div className="mt-4" data-testid="panel-overview-diagnoses">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Active diagnoses</div>
          <div className="flex flex-wrap gap-1.5">
            {dx.slice(0, 12).map((x, i) => (
              <Badge key={i} variant="secondary" className="text-[11px]">{x.icd10 ? `${x.icd10} · ` : ""}{x.description}</Badge>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ── 2. Cooldown Eligibility ────────────────────────────────────────────────
// Clean per-test eligibility table: which test was performed, when, and the
// date the patient becomes re-eligible. Rows still in cooldown are highlighted.
function CooldownSection({ chart }: SectionProps) {
  const cd = chart.cooldown;
  const tests = cd.testCooldowns ?? [];
  const inCooldownCount = tests.filter((c) => !c.cleared).length;
  return (
    <SectionCard
      id="cooldown"
      title="Cooldown Eligibility"
      icon={<Clock className="w-4 h-4" />}
      action={
        tests.length > 0
          ? <Pill tone={inCooldownCount > 0 ? "amber" : "green"} testId="badge-cooldown-state">
              {inCooldownCount > 0 ? `${inCooldownCount} in cooldown` : "All re-eligible"}
            </Pill>
          : undefined
      }
    >
      {tests.length === 0 ? (
        <EmptyState icon={<Clock className="w-8 h-8" />} title="No prior tests on file" hint="Cooldown windows appear here once test history is imported." testId="empty-cooldown" />
      ) : (
        <Table head={<><Th>Test</Th><Th>Last performed</Th><Th>Re-eligible</Th><Th>Status</Th></>}>
          {tests.map((c, i) => {
            const inCooldown = !c.cleared;
            return (
              <tr
                key={`${c.testName}-${i}`}
                className={`border-b last:border-0 ${inCooldown ? "bg-amber-50/70 dark:bg-amber-900/15 border-amber-100 dark:border-amber-900/30" : "border-slate-100 dark:border-border/40"}`}
                data-testid={`row-cooldown-test-${i}`}
              >
                <Td className="font-medium">{c.testName}</Td>
                <Td>{c.lastDate ? fmtDate(c.lastDate) : "—"}</Td>
                <Td>{inCooldown ? fmtDate(c.clearsAt) : <span className="text-emerald-700 dark:text-emerald-400">Now</span>}</Td>
                <Td>
                  {c.cleared ? (
                    <Pill tone="green"><CheckCircle2 className="w-3 h-3" />Eligible</Pill>
                  ) : (
                    <Pill tone={(c.daysUntilClear ?? 0) <= 7 ? "red" : "amber"}>
                      <Clock className="w-3 h-3" />In cooldown
                    </Pill>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </SectionCard>
  );
}

// ── 3. Ad Automation ───────────────────────────────────────────────────────
const AD_CH_LABEL: Record<string, string> = { phone: "Phone", sms: "SMS", email: "Email", passive_ads: "Passive ads" };
const AD_STATUS_PILL: Record<AdChannelStatus, keyof typeof TONE_PILL> = { eligible: "green", caution: "amber", suppressed: "red" };
const AD_STATUS_ICON: Record<AdChannelStatus, React.ReactNode> = {
  eligible: <CheckCircle2 className="w-3 h-3" />, caution: <MinusCircle className="w-3 h-3" />, suppressed: <XCircle className="w-3 h-3" />,
};
function AdAutomationSection({ chart }: SectionProps) {
  const ad = chart.adAutomation;
  return (
    <SectionCard
      id="ad-automation"
      title="Ad Automation"
      icon={<Megaphone className="w-4 h-4" />}
      action={ad.reEngagementEligible
        ? <Pill tone="green">Re-engagement eligible</Pill>
        : <Pill tone="amber">Re-engagement paused</Pill>}
    >
      {ad.suppressionReason && (
        <div className="mb-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300" data-testid="text-ad-suppression-reason">
          {ad.suppressionReason}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {(ad.channels ?? []).map((ch) => (
          <div key={ch.channel} className="rounded-xl border border-slate-200/70 dark:border-border/50 px-3 py-2.5" data-testid={`ad-channel-${ch.channel}`}>
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-semibold">{AD_CH_LABEL[ch.channel]}</span>
              <Pill tone={AD_STATUS_PILL[ch.status]}>{AD_STATUS_ICON[ch.status]}{ch.status}</Pill>
            </div>
            {ch.reason && <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">{ch.reason}</p>}
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-dashed border-slate-200 dark:border-border/60 px-4 py-6 text-center" data-testid="empty-ad-campaign">
        <Megaphone className="w-7 h-7 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No active automation campaign connected yet.</p>
        <p className="text-xs text-muted-foreground mt-1">Channel eligibility above is derived live from this patient's cooldown state.</p>
      </div>
    </SectionCard>
  );
}

// ── 4. Plexus IQ ───────────────────────────────────────────────────────────
function PlexusIqSection({ chart }: SectionProps) {
  const iq = chart.plexusIq;
  const tests = iq.qualifyingTests ?? [];
  return (
    <SectionCard
      id="plexus-iq"
      title="Qualifying Tests"
      icon={<Sparkles className="w-4 h-4" />}
      count={tests.length || null}
      action={
        <div className="flex items-center gap-2">
          {iq.adminApprovalStatus && <Pill tone={iq.adminApprovalStatus === "approved" ? "green" : iq.adminApprovalStatus === "rejected" ? "red" : "amber"} testId="badge-admin-approval">{iq.adminApprovalStatus}</Pill>}
          <Link href="/plexus-iq"><Button size="sm" variant="ghost" className="h-7 px-2 gap-1 text-xs" data-testid="button-open-plexus-iq"><Sparkles className="w-3 h-3" />Plexus IQ</Button></Link>
        </div>
      }
    >
      {tests.length === 0 ? (
        <EmptyState icon={<Sparkles className="w-8 h-8" />} title="No qualifying tests on record yet" hint="Run this patient through Plexus IQ to surface qualifying ancillary opportunities." testId="empty-plexus" />
      ) : (
        <div className="space-y-3">
          {tests.map((t) => (
            <div key={t.testName} className={`rounded-xl border border-slate-200/80 dark:border-border/60 bg-white dark:bg-card px-4 py-3 ${BUCKET_STYLES[t.bucket]}`} data-testid={`row-qualifying-${t.testName}`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${BUCKET_DOT[t.bucket]}`} />
                <span className="text-sm font-semibold">{t.testName}</span>
                {t.confidence && <Badge variant="outline" className="text-[10px] ml-auto">{t.confidence} confidence</Badge>}
              </div>
              {(t.clinicianUnderstanding || t.patientTalkingPoints) && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {t.clinicianUnderstanding && (
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">Clinician Understanding</div>
                      <p className="text-xs leading-snug whitespace-pre-wrap">{t.clinicianUnderstanding}</p>
                    </div>
                  )}
                  {t.patientTalkingPoints && (
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">Patient Talking Points</div>
                      <p className="text-xs leading-snug whitespace-pre-wrap">{t.patientTalkingPoints}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {(iq.supportingDiagnoses ?? []).length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Supporting diagnoses</div>
          <div className="flex flex-wrap gap-1.5">
            {iq.supportingDiagnoses!.map((d, i) => <Badge key={i} variant="secondary" className="text-[11px]">{d}</Badge>)}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ── 5. Active Execution Cases ──────────────────────────────────────────────
function ExecutionCasesSection({ chart }: SectionProps) {
  const cases = chart.executionCases ?? [];
  return (
    <SectionCard id="execution-cases" title="Active Execution Cases" icon={<ClipboardList className="w-4 h-4" />} count={cases.length}>
      {cases.length === 0 ? (
        <EmptyState icon={<ClipboardList className="w-8 h-8" />} title="No active execution case" hint="Execution cases are created when this patient enters the outreach engagement engine." testId="empty-execution-cases" />
      ) : (
        <div className="space-y-2">
          {cases.map((c, i) => (
            <div key={c.id ?? i} className="rounded-xl border border-slate-200/70 dark:border-border/50 px-4 py-3" data-testid={`row-execution-case-${c.id ?? i}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  {c.lifecycleStatus && <Pill tone="blue">{c.lifecycleStatus}</Pill>}
                  {c.engagementStatus && <Pill tone="amber">{c.engagementStatus}</Pill>}
                  {c.qualificationStatus && <Badge variant="outline" className="text-[10px]">{c.qualificationStatus}</Badge>}
                </div>
                {c.priorityScore != null && <span className="text-[11px] text-muted-foreground">Priority {c.priorityScore}</span>}
              </div>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                <div><span className="text-muted-foreground">Assigned: </span>{c.assignedRole || "—"}</div>
                <div><span className="text-muted-foreground">Attempts: </span>{c.callAttemptCount ?? 0}</div>
                <div><span className="text-muted-foreground">Last outcome: </span>{c.lastCallOutcome || "—"}</div>
                <div><span className="text-muted-foreground">Next action: </span>{c.nextActionAt ? fmtDate(c.nextActionAt.slice(0, 10)) : "—"}</div>
              </div>
              {(c.targetTests ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {c.targetTests!.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ── 6. Calls & Communication ───────────────────────────────────────────────
function CallsSection({ chart }: SectionProps) {
  const comm = chart.communication;
  const calls = comm.calls ?? [];
  return (
    <SectionCard id="calls" title="Calls & Communication" icon={<Phone className="w-4 h-4" />} count={calls.length}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 mb-4">
        <KV label="Total attempts" value={comm.callAttemptCount ?? calls.length} />
        <KV label="Last outcome" value={comm.lastCallOutcome || "—"} />
        <KV label="Last attempt" value={comm.lastAttemptAt ? fmtDate(comm.lastAttemptAt.slice(0, 10)) : "—"} />
        <KV label="Next action" value={comm.nextActionAt ? fmtDate(comm.nextActionAt.slice(0, 10)) : "—"} />
      </div>
      {calls.length === 0 ? (
        <EmptyState icon={<Phone className="w-8 h-8" />} title="No call history available from connected sources yet" hint="RingCentral call logs will appear here once the integration is connected." testId="empty-calls" />
      ) : (
        <Table head={<><Th>Date</Th><Th>Outcome</Th><Th>Attempt</Th><Th>Notes</Th></>}>
          {calls.map((c, i) => (
            <tr key={c.id ?? i} className="border-b border-slate-100 dark:border-border/40 last:border-0" data-testid={`row-call-${c.id ?? i}`}>
              <Td>{fmtDate((c.occurredAt || "").slice(0, 10) || null)}</Td>
              <Td><Badge variant="outline" className="text-[10px]">{c.outcome || "logged"}</Badge></Td>
              <Td>{c.attemptNumber ?? "—"}</Td>
              <Td className="text-muted-foreground">{c.notes || "—"}</Td>
            </tr>
          ))}
        </Table>
      )}
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

  return (
    <SectionCard id="scheduling" title="Scheduling" icon={<CalendarClock className="w-4 h-4" />} count={appts.length}
      action={<Link href="/appointments"><Button size="sm" variant="ghost" className="h-7 px-2 gap-1 text-xs" data-testid="button-open-appointments"><ExternalLink className="w-3 h-3" />Calendar</Button></Link>}>
      {appts.length === 0 ? (
        <EmptyState icon={<CalendarClock className="w-8 h-8" />} title="No appointments scheduled" hint="Booked ancillary appointments for this patient appear here." testId="empty-scheduling" />
      ) : (
        <Table head={<><Th>Test</Th><Th>Facility</Th><Th>Date</Th><Th>Time</Th><Th>Status</Th></>}>
          {appts.map((a, i) => (
            <tr key={a.id ?? i} className="border-b border-slate-100 dark:border-border/40 last:border-0" data-testid={`row-appointment-${a.id ?? i}`}>
              <Td className="font-medium">{a.testType || "—"}</Td>
              <Td>{a.facility || "—"}</Td>
              <Td>{a.scheduledDate || "—"}{(a.scheduledDate ?? "") >= today && <Badge className="text-[10px] ml-2 bg-blue-100 text-blue-800 hover:bg-blue-100">Upcoming</Badge>}</Td>
              <Td>{a.scheduledTime || "—"}</Td>
              <Td><Badge variant="outline" className="text-[10px]">{a.status || "—"}</Badge></Td>
            </tr>
          ))}
        </Table>
      )}
    </SectionCard>
  );
}

// ── 8. Documents ───────────────────────────────────────────────────────────
function ReportCard({ label, link, testId }: { label: string; link: { available: boolean; url?: string | null; detail?: string | null }; testId: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 dark:border-border/50 px-4 py-3 flex items-center justify-between gap-3" data-testid={testId}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-slate-500 shrink-0" />
          <span className="text-sm font-semibold truncate">{label}</span>
          {link.available
            ? <Pill tone="green"><CheckCircle2 className="w-3 h-3" />Available</Pill>
            : <Pill tone="slate"><MinusCircle className="w-3 h-3" />Not generated</Pill>}
        </div>
        {link.detail && <div className="text-[11px] text-muted-foreground mt-1 ml-6">{link.detail}</div>}
      </div>
      {link.available && link.url ? (
        <Link href={link.url} data-testid={`${testId}-open`}>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 shrink-0 text-xs"><ExternalLink className="w-3.5 h-3.5" />Open / Download</Button>
        </Link>
      ) : (
        <Button size="sm" variant="outline" className="h-8 gap-1.5 shrink-0 text-xs" disabled data-testid={`${testId}-open`}><ExternalLink className="w-3.5 h-3.5" />Open / Download</Button>
      )}
    </div>
  );
}

function DocumentsSection({ chart }: SectionProps) {
  const docs = chart.documents ?? [];
  const reports = chart.reports;
  // Phase 2E-B — when the unified flag is ON and this chart has a screening
  // context, render the CANONICAL ancillary documents card (same reference /
  // source ids as /ancillary-documents) in place of the legacy attached list,
  // so no duplicate legacy + canonical entries appear. Flag OFF → unchanged.
  const canonical = isUnifiedAncillaryDocumentsEnabled();
  const screeningId = chart.patientScreeningId ?? null;
  const showCanonical = canonical && screeningId != null;
  return (
    <SectionCard id="documents" title="Documents" icon={<FileText className="w-4 h-4" />} count={docs.length}>
      {/* Clinician PDF + Plexus PDF (first-class) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <ReportCard label="Clinician PDF" link={reports.clinicianPdf} testId="report-clinician-pdf" />
        <ReportCard label="Plexus PDF" link={reports.plexusPdf} testId="report-plexus-pdf" />
      </div>
      {showCanonical ? (
        <AncillaryDocumentsCard
          params={{ patientScreeningId: screeningId as number }}
          enabled
          title="Ancillary Documents"
        />
      ) : (<>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Attached documents</div>
      {docs.length === 0 ? (
        <EmptyState icon={<FileText className="w-8 h-8" />} title="No documents on file for this patient" hint="Consent forms, screening forms and reports linked to this patient appear here." testId="empty-documents" />
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
      </>)}
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
function LabsSection({ chart }: SectionProps) {
  const labs = chart.labs ?? [];
  return (
    <SectionCard id="labs" title="Labs" icon={<FlaskConical className="w-4 h-4" />} count={labs.length || null}>
      {labs.length === 0 ? (
        <EmptyState icon={<FlaskConical className="w-8 h-8" />} title="No lab results available from connected sources yet" hint="Lab results will populate here once a lab data source is connected." testId="empty-labs" />
      ) : (
        <Table head={<><Th>Test</Th><Th>Value</Th><Th>Reference</Th><Th>Collected</Th></>}>
          {labs.map((l, i) => (
            <tr key={i} className="border-b border-slate-100 dark:border-border/40 last:border-0" data-testid={`row-lab-${i}`}>
              <Td className="font-medium">{l.name}</Td>
              <Td>{[l.value, l.unit].filter(Boolean).join(" ")}</Td>
              <Td>{l.referenceRange || "—"}</Td>
              <Td>{l.collectedAt ? fmtDate(l.collectedAt.slice(0, 10)) : "—"}</Td>
            </tr>
          ))}
        </Table>
      )}
    </SectionCard>
  );
}

// ── 16. Imaging ────────────────────────────────────────────────────────────
function ImagingSection({ chart }: SectionProps) {
  const imaging = chart.imaging ?? [];
  return (
    <SectionCard id="imaging" title="Imaging" icon={<Scan className="w-4 h-4" />} count={imaging.length || null}>
      {imaging.length === 0 ? (
        <EmptyState icon={<Scan className="w-8 h-8" />} title="No imaging studies available from connected sources yet" hint="Imaging studies and impressions will populate here once a PACS/imaging source is connected." testId="empty-imaging" />
      ) : (
        <Table head={<><Th>Study</Th><Th>Modality</Th><Th>Performed</Th><Th>Status</Th></>}>
          {imaging.map((m, i) => (
            <tr key={i} className="border-b border-slate-100 dark:border-border/40 last:border-0" data-testid={`row-imaging-${i}`}>
              <Td className="font-medium">{m.study}</Td>
              <Td>{m.modality || "—"}</Td>
              <Td>{m.performedAt ? fmtDate(m.performedAt.slice(0, 10)) : "—"}</Td>
              <Td>{m.status || "—"}</Td>
            </tr>
          ))}
        </Table>
      )}
    </SectionCard>
  );
}

// ── 17. Vitals ─────────────────────────────────────────────────────────────
function VitalsSection({ chart }: SectionProps) {
  const vitals = chart.vitals ?? [];
  return (
    <SectionCard id="vitals" title="Vitals" icon={<Activity className="w-4 h-4" />} count={vitals.length || null}>
      {vitals.length === 0 ? (
        <EmptyState icon={<Activity className="w-8 h-8" />} title="No vitals available from connected sources yet" hint="Vital signs will populate here once a device or EHR source is connected." testId="empty-vitals" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {vitals.map((v, i) => (
            <div key={i} className="rounded-xl border border-slate-200/70 dark:border-border/50 px-3 py-2.5" data-testid={`tile-vital-${i}`}>
              <div className="text-lg font-bold tabular-nums leading-none">{[v.value, v.unit].filter(Boolean).join(" ") || "—"}</div>
              <div className="text-[11px] text-muted-foreground mt-1">{v.label}</div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ── 18. Encounters / Notes ─────────────────────────────────────────────────
function EncountersSection({ chart }: SectionProps) {
  const encounters = chart.encounters ?? [];
  return (
    <SectionCard id="encounters" title="Encounters / Notes" icon={<FileText className="w-4 h-4" />} count={encounters.length || null}>
      {encounters.length === 0 ? (
        <EmptyState icon={<FileText className="w-8 h-8" />} title="No encounters or notes on file" hint="Visit notes and encounter summaries appear here once recorded." testId="empty-encounters" />
      ) : (
        <div className="space-y-2">
          {encounters.map((e, i) => (
            <div key={i} className="rounded-xl border border-slate-200/70 dark:border-border/50 px-4 py-3" data-testid={`row-encounter-${i}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{e.title || e.kind || "Encounter"}</span>
                <span className="text-[11px] text-muted-foreground">{e.occurredAt ? fmtDate(e.occurredAt.slice(0, 10)) : "—"}</span>
              </div>
              {e.summary && <p className="text-xs text-muted-foreground mt-1 leading-snug">{e.summary}</p>}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ── 19. Billing / Readiness ────────────────────────────────────────────────
function BillingSection({ chart }: SectionProps) {
  const items = chart.billing.items ?? [];
  const records = chart.billing.records ?? [];
  const readyCount = items.filter((i) => i.ready).length;
  return (
    <SectionCard id="billing" title="Billing / Readiness" icon={<Receipt className="w-4 h-4" />}
      action={<Pill tone={readyCount === items.length ? "green" : readyCount === 0 ? "red" : "amber"} testId="badge-billing-readiness">{readyCount}/{items.length} ready</Pill>}>
      <div className="space-y-1.5 mb-4">
        {items.map((it, i) => (
          <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-muted/40" data-testid={`row-billing-check-${i}`}>
            <div className="flex items-center gap-2 min-w-0">
              {it.ready ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
              <span className="text-sm font-medium truncate">{it.label}</span>
            </div>
            {it.detail && <span className="text-[11px] text-muted-foreground text-right truncate max-w-[40%]">{it.detail}</span>}
          </div>
        ))}
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Billing records</div>
      {records.length === 0 ? (
        <EmptyState icon={<Receipt className="w-8 h-8" />} title="No billing records found for this patient" testId="empty-billing" />
      ) : (
        <Table head={<><Th>Service</Th><Th>Facility</Th><Th>Date</Th><Th>Status</Th></>}>
          {records.map((r, i) => (
            <tr key={r.id ?? i} className="border-b border-slate-100 dark:border-border/40 last:border-0" data-testid={`row-billing-${r.id ?? i}`}>
              <Td className="font-medium">{r.service || "—"}</Td>
              <Td>{r.facility || "—"}</Td>
              <Td>{r.dateOfService || "—"}</Td>
              <Td><Badge variant="outline" className="text-[10px]">{r.billingStatus || "Not Billed"}</Badge></Td>
            </tr>
          ))}
        </Table>
      )}
    </SectionCard>
  );
}

// ── 20. Activity Timeline ──────────────────────────────────────────────────
function TimelineSection({ chart }: SectionProps) {
  type Ev = { when: string; label: string; sub: string; tone: string };
  const evs: Ev[] = [];
  for (const a of chart.scheduling ?? []) {
    if (a.scheduledDate) evs.push({ when: a.scheduledDate, label: `Appointment · ${a.testType || "Ancillary"}`, sub: `${a.facility || "—"} · ${a.status || ""}`, tone: "bg-blue-500" });
  }
  for (const c of chart.communication.calls ?? []) {
    const when = (c.occurredAt || "").slice(0, 10);
    if (when) evs.push({ when, label: `Call · ${c.outcome || "logged"}`, sub: c.notes || "", tone: "bg-amber-500" });
  }
  for (const t of chart.cooldown.testCooldowns ?? []) {
    if (t.lastDate) evs.push({ when: t.lastDate, label: `Test on file · ${t.testName}`, sub: (t.insuranceType || "").toUpperCase(), tone: "bg-emerald-500" });
  }
  for (const d of chart.documents ?? []) {
    if (d.createdAt) evs.push({ when: d.createdAt.slice(0, 10), label: `Document · ${d.title}`, sub: d.kind || "", tone: "bg-indigo-500" });
  }
  const timeline = evs.filter((e) => e.when).sort((a, b) => b.when.localeCompare(a.when));
  return (
    <SectionCard id="timeline" title="Activity Timeline" icon={<History className="w-4 h-4" />} count={timeline.length || null}>
      {timeline.length === 0 ? (
        <EmptyState icon={<History className="w-8 h-8" />} title="No activity recorded yet" testId="empty-timeline" />
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
              </div>
            </div>
          ))}
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
};

// Section order reflects an ancillary care-specialist workflow:
// Overview → Qualifying Tests → Cooldown Eligibility → Clinical →
// Calls → Scheduling → Documents → Billing Readiness, with the
// outreach-automation surfaces kept at the end.
export const CHART_SECTIONS: ChartSectionDef[] = [
  { id: "overview", label: "Overview", icon: <User className="w-4 h-4" />, Component: OverviewSection },
  { id: "plexus-iq", label: "Qualifying Tests", icon: <Sparkles className="w-4 h-4" />, Component: PlexusIqSection },
  { id: "cooldown", label: "Cooldown Eligibility", icon: <Clock className="w-4 h-4" />, Component: CooldownSection },
  // Clinical block
  { id: "diagnoses", label: "Diagnoses", icon: <Stethoscope className="w-4 h-4" />, Component: DiagnosesSection },
  { id: "medications", label: "Medications", icon: <PillIcon className="w-4 h-4" />, Component: MedicationsSection },
  { id: "allergies", label: "Allergies", icon: <AlertTriangle className="w-4 h-4" />, Component: AllergiesSection },
  { id: "demographics", label: "Demographics", icon: <User className="w-4 h-4" />, Component: DemographicsSection },
  { id: "insurance", label: "Insurance & Eligibility", icon: <ShieldCheck className="w-4 h-4" />, Component: InsuranceSection },
  { id: "providers", label: "Providers", icon: <UserCog className="w-4 h-4" />, Component: ProvidersSection },
  { id: "labs", label: "Labs", icon: <FlaskConical className="w-4 h-4" />, Component: LabsSection },
  { id: "imaging", label: "Imaging", icon: <Scan className="w-4 h-4" />, Component: ImagingSection },
  { id: "vitals", label: "Vitals", icon: <Activity className="w-4 h-4" />, Component: VitalsSection },
  { id: "encounters", label: "Encounters / Notes", icon: <FileText className="w-4 h-4" />, Component: EncountersSection },
  // Workflow block
  { id: "calls", label: "Calls & Comms", icon: <Phone className="w-4 h-4" />, Component: CallsSection },
  { id: "scheduling", label: "Scheduling", icon: <CalendarClock className="w-4 h-4" />, Component: SchedulingSection },
  { id: "documents", label: "Documents", icon: <FileText className="w-4 h-4" />, Component: DocumentsSection },
  { id: "billing", label: "Billing / Readiness", icon: <Receipt className="w-4 h-4" />, Component: BillingSection },
  // Outreach automation (de-prioritised for the care-specialist view)
  { id: "ad-automation", label: "Ad Automation", icon: <Megaphone className="w-4 h-4" />, Component: AdAutomationSection },
  { id: "execution-cases", label: "Execution Cases", icon: <ClipboardList className="w-4 h-4" />, Component: ExecutionCasesSection },
  { id: "timeline", label: "Activity Timeline", icon: <History className="w-4 h-4" />, Component: TimelineSection },
];
