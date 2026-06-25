// Unified Admin Settings — Task #530.
//
// Consolidates ~13 scattered admin/settings pages and the two hubs
// (/admin, /admin-ops) into ONE tabbed surface at /admin/settings with
// five tabs — System, Billing, Team, Facility, Logs. Each tab embeds the
// existing page/section components verbatim so every setting reads, saves,
// and validates exactly as before. Deep-link via ?tab= (and Logs via
// ?log= for its sub-tabs).

import { useLocation, useSearch } from "wouter";
import {
  Shield,
  Settings as SettingsIcon,
  CreditCard,
  Users,
  Flame,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  ClinicConnectionsCard,
  StorageProviderCard,
  OperationalRuleSections,
} from "@/pages/settings";

const TABS = ["system", "billing", "team", "facility", "logs"] as const;
type TabKey = (typeof TABS)[number];

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

function SectionTitle({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="px-1">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {desc ? <p className="mt-0.5 text-sm text-slate-500">{desc}</p> : null}
    </div>
  );
}

export default function AdminSettingsPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);

  const tabParam = params.get("tab");
  const activeTab: TabKey = TABS.includes(tabParam as TabKey) ? (tabParam as TabKey) : "system";

  const logParam = params.get("log");
  const activeLog =
    LOG_TABS.find((l) => l.key === logParam)?.key ?? LOG_TABS[0].key;

  function setTab(next: string) {
    const p = new URLSearchParams(search);
    p.set("tab", next);
    if (next !== "logs") p.delete("log");
    navigate(`/admin/settings?${p.toString()}`);
  }

  function setLog(next: string) {
    const p = new URLSearchParams(search);
    p.set("tab", "logs");
    p.set("log", next);
    navigate(`/admin/settings?${p.toString()}`);
  }

  return (
    <div className="finance-page">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-6 py-6">
        <PageHeader
          eyebrow="PLEXUS ANCILLARY · ADMIN"
          icon={Shield}
          title="Admin Settings"
          subtitle="System, billing, team, facility, and logs — every administrative surface in one place."
        />

        <Tabs value={activeTab} onValueChange={setTab} className="w-full">
          <TabsList className="flex flex-wrap h-auto gap-1 rounded-2xl bg-white/70 p-1.5 shadow-sm backdrop-blur">
            <TabsTrigger value="system" className="gap-1.5 rounded-xl" data-testid="tab-system">
              <SettingsIcon className="h-4 w-4" /> System
            </TabsTrigger>
            <TabsTrigger value="billing" className="gap-1.5 rounded-xl" data-testid="tab-billing">
              <CreditCard className="h-4 w-4" /> Billing
            </TabsTrigger>
            <TabsTrigger value="team" className="gap-1.5 rounded-xl" data-testid="tab-team">
              <Users className="h-4 w-4" /> Team
            </TabsTrigger>
            <TabsTrigger value="facility" className="gap-1.5 rounded-xl" data-testid="tab-facility">
              <Flame className="h-4 w-4" /> Facility
            </TabsTrigger>
            <TabsTrigger value="logs" className="gap-1.5 rounded-xl" data-testid="tab-logs">
              <ScrollText className="h-4 w-4" /> Logs
            </TabsTrigger>
          </TabsList>

          {/* System */}
          <TabsContent value="system" className="flex flex-col gap-6" data-testid="tabpanel-system">
            <Card className="rounded-3xl border border-white/60 bg-white/75 p-0 shadow-sm overflow-hidden">
              <AdminSettingsCenterPage embedded />
            </Card>

            <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-3">
                <div className="rounded-2xl bg-violet-100 p-3 text-violet-700">
                  <Sparkles className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Qualification Mode</h2>
                  <p className="text-sm text-slate-600">Control how aggressively the AI qualifies patients per facility.</p>
                </div>
              </div>
              <QualificationModeSettings />
            </Card>

            <ClinicConnectionsCard />
            <StorageProviderCard />
            <OperationalRuleSections />
            <TestFixtureCard />
          </TabsContent>

          {/* Billing */}
          <TabsContent value="billing" className="flex flex-col gap-6" data-testid="tabpanel-billing">
            <Card className="rounded-3xl border border-white/60 bg-white/75 p-0 shadow-sm overflow-hidden">
              <BillingSettingsPage embedded />
            </Card>
            <InvoiceReminderSettingsCard />
          </TabsContent>

          {/* Team */}
          <TabsContent value="team" className="flex flex-col gap-6" data-testid="tabpanel-team">
            <SchedulerTeamSection />
            <CallListDistributionCard />
            <ChangePasswordCard />
            <div>
              <SectionTitle title="User Management" desc="Create and remove team accounts, view all users, and manage access." />
              <div className="mt-3">
                <AdminUsersPage embedded />
              </div>
            </div>
          </TabsContent>

          {/* Facility */}
          <TabsContent value="facility" data-testid="tabpanel-facility">
            <StovetopHeatSettingsPage embedded />
          </TabsContent>

          {/* Logs */}
          <TabsContent value="logs" data-testid="tabpanel-logs">
            <Tabs value={activeLog} onValueChange={setLog} className="w-full">
              <TabsList className="flex flex-wrap h-auto gap-1 rounded-2xl bg-white/70 p-1.5 shadow-sm backdrop-blur">
                {LOG_TABS.map((l) => (
                  <TabsTrigger
                    key={l.key}
                    value={l.key}
                    className="rounded-xl"
                    data-testid={`tab-log-${l.key}`}
                  >
                    {l.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {LOG_TABS.map(({ key, Component }) => (
                <TabsContent key={key} value={key} data-testid={`tabpanel-log-${key}`}>
                  <Component embedded />
                </TabsContent>
              ))}
            </Tabs>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
