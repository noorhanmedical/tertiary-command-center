// Unified Admin Settings — Task #530 / #756.
//
// Consolidates ~13 scattered admin/settings pages and the two hubs into ONE
// surface at /admin/settings with five sections — System, Billing, Team,
// Facility, Logs. Each section embeds the existing page/section components
// verbatim so every setting reads, saves, and validates exactly as before.
//
// Layout: a dark left navigation rail + a flat white content pane (no
// stacked frosted "tiles"). Each section renders as one continuous page with
// hairline dividers between groups. The active section lives in the URL hash
// (e.g. #team); the Logs sub-tabs continue to deep-link via ?log=.

import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  Shield,
  Settings as SettingsIcon,
  CreditCard,
  Users,
  Flame,
  ScrollText,
  Sparkles,
  Building2,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import { OrganizationSettingsSection } from "@/components/settings/OrganizationSettingsSection";
import { SchedulingCapacitySection } from "@/components/settings/SchedulingCapacitySection";
import { TeamOperationsSettings } from "@/components/settings/TeamOperationsSettings";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { QualificationModeSettings } from "@/components/QualificationModeSettings";

import AdminSettingsCenterPage from "@/pages/admin-settings-center";
import BillingSettingsPage from "@/pages/billing-settings";
import AdminUsersPage from "@/pages/admin-users";
import StovetopHeatSettingsPage from "@/pages/stovetop-heat-settings";
import AuditLogPage from "@/pages/audit-log";
import AdminAnalysisJobsPage from "@/pages/admin-analysis-jobs";
import AdminOutboxPage from "@/pages/admin-outbox";
import BillingAuditorPage from "@/pages/billing-auditor";
import CallListAuditPage from "@/pages/call-list-audit";
import RemittanceAuditPage from "@/pages/remittance-audit";
import { TestFixtureCard } from "@/pages/admin";
import {
  SchedulerTeamSection,
  CallListDistributionCard,
  ChangePasswordCard,
  InvoiceReminderSettingsCard,
  OperationalRuleSections,
} from "@/pages/settings";

const SECTIONS = ["system", "billing", "team", "facility", "logs"] as const;
type SectionKey = (typeof SECTIONS)[number];

type SectionMeta = {
  label: string;
  desc: string;
  Icon: LucideIcon;
  /** Icon accent color on the dark rail. */
  accent: string;
};

const SECTION_META: Record<SectionKey, SectionMeta> = {
  system: {
    label: "System",
    desc: "AI models, qualification mode, and operational rules.",
    Icon: SettingsIcon,
    accent: "text-indigo-300",
  },
  billing: {
    label: "Billing",
    desc: "Pricing, invoice schedules, and overdue reminders.",
    Icon: CreditCard,
    accent: "text-emerald-300",
  },
  team: {
    label: "Team",
    desc: "Users, roles, passwords, and call-list distribution.",
    Icon: Users,
    accent: "text-sky-300",
  },
  facility: {
    label: "Facility",
    desc: "Per-facility heat tuning and qualification thresholds.",
    Icon: Flame,
    accent: "text-amber-300",
  },
  logs: {
    label: "Logs",
    desc: "Audit trail, run history, outbox, and record audits.",
    Icon: ScrollText,
    accent: "text-violet-300",
  },
};

const NAV_GROUPS: ReadonlyArray<{ label: string; keys: SectionKey[] }> = [
  { label: "General", keys: ["system"] },
  { label: "Operations", keys: ["billing", "team", "facility"] },
  { label: "Records", keys: ["logs"] },
];

const LOG_TABS = [
  { key: "audit", label: "Audit Log", Component: AuditLogPage },
  { key: "analysis-jobs", label: "Analysis Run History", Component: AdminAnalysisJobsPage },
  { key: "outbox", label: "Outbox", Component: AdminOutboxPage },
  { key: "billing-auditor", label: "Billing Auditor", Component: BillingAuditorPage },
  { key: "call-list-audit", label: "Call List Audit", Component: CallListAuditPage },
  { key: "remittance", label: "Remittance Audit", Component: RemittanceAuditPage },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  Component: (props: { embedded?: boolean }) => JSX.Element;
}>;

/** A titled group inside a section — flat, divider-separated, no card. */
function Group({
  title,
  desc,
  Icon,
  children,
}: {
  title?: string;
  desc?: string;
  Icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="px-6 py-7">
      {title ? (
        <div className="mb-4 flex items-start gap-2.5">
          {Icon ? <Icon className="mt-0.5 h-5 w-5 text-slate-400" /> : null}
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            {desc ? <p className="mt-0.5 text-sm text-slate-500">{desc}</p> : null}
          </div>
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Full embedded page — renders flush (it brings its own padding). */
function EmbeddedGroup({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

function readHashSection(): SectionKey {
  const raw = window.location.hash.replace(/^#/, "");
  return SECTIONS.includes(raw as SectionKey) ? (raw as SectionKey) : "system";
}

export default function AdminSettingsPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);

  const [activeSection, setActiveSection] = useState<SectionKey>(() =>
    typeof window === "undefined" ? "system" : readHashSection(),
  );

  useEffect(() => {
    const onHash = () => setActiveSection(readHashSection());
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const logParam = params.get("log");
  const activeLog = LOG_TABS.find((l) => l.key === logParam)?.key ?? LOG_TABS[0].key;

  function selectSection(next: SectionKey) {
    window.location.hash = next;
    setActiveSection(next);
  }

  function setLog(next: string) {
    const p = new URLSearchParams(search);
    p.set("log", next);
    navigate(`/admin/settings?${p.toString()}#logs`);
  }

  const meta = SECTION_META[activeSection];

  return (
    <div className="finance-page">
      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-6 px-6 py-6">
        <PageHeader
          eyebrow="PLEXUS ANCILLARY · ADMIN"
          icon={Shield}
          title="Admin Settings"
          subtitle="System, billing, team, facility, and logs — every administrative surface in one place."
        />

        {/* Mobile section selector (< md) */}
        <div className="md:hidden">
          <Select value={activeSection} onValueChange={(v) => selectSection(v as SectionKey)}>
            <SelectTrigger
              className="w-full rounded-xl border-slate-200 bg-white shadow-sm"
              data-testid="select-admin-section"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SECTIONS.map((key) => {
                const m = SECTION_META[key];
                return (
                  <SelectItem key={key} value={key} data-testid={`option-section-${key}`}>
                    <span className="flex items-center gap-2">
                      <m.Icon className="h-4 w-4" /> {m.label}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* Settings console — dark rail + flat white content pane */}
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_70px_-28px_rgba(15,23,42,0.28)] md:flex md:h-[calc(100vh-12rem)] md:min-h-[600px]">
          {/* Dark left-rail nav (>= md) */}
          <nav
            className="hidden shrink-0 flex-col gap-6 overflow-y-auto bg-slate-900 p-4 md:flex md:w-[248px]"
            aria-label="Admin settings sections"
            data-testid="nav-admin-settings"
          >
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {group.label}
                </div>
                <div className="flex flex-col gap-1">
                  {group.keys.map((key) => {
                    const m = SECTION_META[key];
                    const isActive = activeSection === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => selectSection(key)}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                          isActive
                            ? "bg-white/10 text-white"
                            : "text-slate-300 hover:bg-white/5 hover:text-white",
                        )}
                        data-testid={`nav-section-${key}`}
                      >
                        <span
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-md bg-white/5",
                            isActive ? "text-white" : m.accent,
                          )}
                        >
                          <m.Icon className="h-4 w-4" />
                        </span>
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Content pane */}
          <div className="flex min-w-0 flex-1 flex-col bg-white">
            <header className="flex items-center gap-3 border-b border-slate-200/80 px-6 py-5">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-900">{meta.label}</h2>
                <p className="truncate text-sm text-slate-500">{meta.desc}</p>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* System */}
              {activeSection === "system" && (
                <div className="divide-y divide-slate-200/80" data-testid="panel-system">
                  <EmbeddedGroup>
                    <AdminSettingsCenterPage embedded />
                  </EmbeddedGroup>
                  <Group
                    title="Qualification Mode"
                    desc="Control how aggressively the AI qualifies patients per facility."
                    Icon={Sparkles}
                  >
                    <QualificationModeSettings />
                  </Group>
                  <Group>
                    <OperationalRuleSections />
                  </Group>
                  <Group>
                    <TestFixtureCard />
                  </Group>
                </div>
              )}

              {/* Billing */}
              {activeSection === "billing" && (
                <div className="divide-y divide-slate-200/80" data-testid="panel-billing">
                  <EmbeddedGroup>
                    <BillingSettingsPage embedded />
                  </EmbeddedGroup>
                  <Group>
                    <InvoiceReminderSettingsCard />
                  </Group>
                </div>
              )}

              {/* Team */}
              {activeSection === "team" && (
                <div className="divide-y divide-slate-200/80" data-testid="panel-team">
                  <Group
                    title="Team Operations"
                    desc="Canonical teams, memberships, managers, and coverage. Engagement, messaging, and tasks consume these."
                    Icon={Users}
                  >
                    <TeamOperationsSettings />
                  </Group>
                  <Group>
                    <SchedulerTeamSection />
                  </Group>
                  <Group>
                    <CallListDistributionCard />
                  </Group>
                  <Group>
                    <ChangePasswordCard />
                  </Group>
                  <Group
                    title="User Management"
                    desc="Create and remove team accounts, view all users, and manage access."
                    Icon={Users}
                  >
                    <AdminUsersPage embedded />
                  </Group>
                </div>
              )}

              {/* Facility */}
              {activeSection === "facility" && (
                <div data-testid="panel-facility">
                  <Group
                    title="Facilities & Clinicians"
                    desc="Manage facilities and the clinicians associated with them. This is the source for Plexus IQ batch dropdowns."
                    Icon={Building2}
                  >
                    <OrganizationSettingsSection />
                  </Group>
                  <Group
                    title="Scheduling / Equipment Capacity"
                    desc="Per-facility machine counts, service durations, ultrasound turnover, and temporary outage overrides that drive the capacity-aware scheduler."
                    Icon={CalendarClock}
                  >
                    <SchedulingCapacitySection />
                  </Group>
                  <EmbeddedGroup>
                    <StovetopHeatSettingsPage embedded />
                  </EmbeddedGroup>
                </div>
              )}

              {/* Logs */}
              {activeSection === "logs" && (
                <div className="px-6 py-7" data-testid="panel-logs">
                  <Tabs value={activeLog} onValueChange={setLog} className="w-full">
                    <TabsList className="flex h-auto flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                      {LOG_TABS.map((l) => (
                        <TabsTrigger
                          key={l.key}
                          value={l.key}
                          className="rounded-lg data-[state=active]:bg-slate-900 data-[state=active]:text-white"
                          data-testid={`tab-log-${l.key}`}
                        >
                          {l.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    {LOG_TABS.map(({ key, Component }) => (
                      <TabsContent key={key} value={key} className="mt-4" data-testid={`tabpanel-log-${key}`}>
                        <Component embedded />
                      </TabsContent>
                    ))}
                  </Tabs>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
