import { Link } from "wouter";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Shield, Settings, Wrench, Lock, ClipboardList, Building2, ChevronRight,
  Users, ScrollText, History, Inbox, Bot, Loader2, Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";

const ADMIN_SECTIONS = [
  { href: "/settings", icon: Settings, iconBg: "bg-blue-100 text-blue-700",
    title: "Settings", desc: "Team members, clinic spreadsheet connections, and scheduler team configuration.", available: true },
  { href: "/admin-ops", icon: Wrench, iconBg: "bg-emerald-100 text-emerald-700",
    title: "System Architecture", desc: "Billing configuration, qualification mode, and system-level administrative controls.", available: true },
  { href: "/admin/users", icon: Users, iconBg: "bg-purple-100 text-purple-700",
    title: "User Management", desc: "Create and remove team accounts, view all users, and manage access.", available: true },
  { href: "/admin/outbox", icon: Inbox, iconBg: "bg-blue-100 text-blue-700",
    title: "Outbox", desc: "All Drive uploads and Sheet syncs are queued here. One-click 'Upload All'.", available: true },
  { href: "/audit-log", icon: ScrollText, iconBg: "bg-indigo-100 text-indigo-700",
    title: "Audit Log", desc: "A read-only trail of who created, updated, or deleted records — for compliance and dispute resolution.", available: true },
  { href: "/admin/analysis-jobs", icon: History, iconBg: "bg-indigo-100 text-indigo-700",
    title: "Analysis Run History", desc: "Audit recent batch analysis runs — timing, patient counts, errors, and performance.", available: true },
  { href: "#", icon: Lock, iconBg: "bg-amber-100 text-amber-700",
    title: "Access Control", desc: "Manage role-based access, permissions, and security settings.", available: false },
  { href: "#", icon: ClipboardList, iconBg: "bg-violet-100 text-violet-700",
    title: "Ancillary Definitions", desc: "Manage the canonical list of qualifying tests, CPT codes, and cooldown rules.", available: false },
  { href: "#", icon: Building2, iconBg: "bg-rose-100 text-rose-700",
    title: "Clinic Settings", desc: "Facility-level configuration, operating hours, and scheduling constraints.", available: false },
];

export default function AdminPage() {
  const { toast } = useToast();
  const [lastResult, setLastResult] = useState<any>(null);

  const runFixture = useMutation({
    mutationFn: async (autoUpload: boolean) =>
      apiRequest("POST", "/api/admin/test-fixture/run", { autoUpload }),
    onSuccess: async (res: any) => {
      const json = await res.json();
      setLastResult(json);
      toast({ title: "TestGuy Robot ready", description: json.message });
      queryClient.invalidateQueries({ queryKey: ["/api/outbox"] });
    },
    onError: (e: any) => toast({ title: "Fixture failed", description: e.message, variant: "destructive" }),
  });

  const cleanup = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/test-fixture/cleanup", {}),
    onSuccess: async (res: any) => {
      const json = await res.json();
      setLastResult(null);
      toast({
        title: "Cleanup complete",
        description: `Removed ${json.removedBatches} batch, ${json.removedPatients} patient, ${json.removedNotes} notes, ${json.removedBilling} billing, ${json.removedUploadedDocs} docs, ${json.removedBlobs} blobs, ${json.removedOutbox} outbox items.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/outbox"] });
    },
  });

  return (
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-6">
        <PageHeader
          eyebrow="PLEXUS ANCILLARY · ADMIN"
          icon={Shield}
          title="Admin"
          subtitle="System configuration, access control, and administrative surfaces."
        />

        <Card className="rounded-3xl border border-white/60 bg-white/85 p-5 shadow">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-fuchsia-100 p-3 text-fuchsia-700 shrink-0"><Bot className="h-5 w-5" /></div>
            <div className="flex-1">
              <h2 className="text-base font-semibold text-slate-900">TestGuy Robot — End-to-End Verification</h2>
              <p className="mt-1 text-sm text-slate-500">
                Spawns a sandbox patient (TestGuy Robot, MRN <code className="text-xs bg-slate-100 px-1 rounded">TEST-ROBOT-001</code>) at NWPG with 3 qualifying tests,
                creates billing records, generates order notes, saves a sample PDF locally, and enqueues the full Drive + Sheets pipeline into the Outbox.
                Use it to verify your Google folders and spreadsheets receive what you expect.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  onClick={() => runFixture.mutate(false)}
                  disabled={runFixture.isPending}
                  className="bg-fuchsia-600 hover:bg-fuchsia-700 text-white"
                  data-testid="button-run-test-fixture"
                >
                  {runFixture.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Bot className="h-4 w-4 mr-2" />}
                  Run TestGuy Robot
                </Button>
                <Button
                  variant="outline"
                  onClick={() => runFixture.mutate(true)}
                  disabled={runFixture.isPending}
                  data-testid="button-run-test-fixture-auto"
                >
                  Run + Auto-Upload Now
                </Button>
                <Button variant="ghost" onClick={() => cleanup.mutate()} disabled={cleanup.isPending} className="text-rose-600">
                  <Trash2 className="h-3.5 w-3.5 mr-2" />Cleanup
                </Button>
                <Link href="/admin/outbox">
                  <Button variant="ghost" className="text-blue-700">Open Outbox →</Button>
                </Link>
              </div>
              {lastResult && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                  Batch #{lastResult.batch?.id} · Patient #{lastResult.patient?.id} · {lastResult.enqueuedItems?.length} Drive items enqueued
                  {lastResult.drainResult && <> · Drain: {lastResult.drainResult.succeeded}/{lastResult.drainResult.attempted} succeeded</>}
                </div>
              )}
            </div>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          {ADMIN_SECTIONS.map(({ href, icon: Icon, iconBg, title, desc, available }) => {
            const content = (
              <Card
                className={`rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl transition ${
                  available ? "hover:shadow-[0_24px_80px_rgba(15,23,42,0.14)] cursor-pointer" : "opacity-50 cursor-default"
                }`}
                data-testid={`admin-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="flex items-start gap-4">
                  <div className={`rounded-2xl p-3 shrink-0 ${iconBg}`}><Icon className="h-5 w-5" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                      {!available && (
                        <span className="text-[10px] font-medium bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Coming soon</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{desc}</p>
                  </div>
                  {available && <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-1" />}
                </div>
              </Card>
            );
            return available ? <Link key={title} href={href}>{content}</Link> : <div key={title}>{content}</div>;
          })}
        </div>
      </div>

      <section
        className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        data-testid="admin-stovetop-heat-settings"
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Stovetop Heat Settings</h2>
            <p className="mt-1 text-sm text-slate-500">
              Quarterly payout controls, RVU settings, KPI thresholds, permissive qualification controls, and Plex Factor settings.
            </p>
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
            Admin Tile
          </div>
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h3 className="text-base font-semibold text-slate-900">1. RVU and Multiplier Settings</h3>
            <p className="mt-1 text-sm text-slate-500">Base RVU values and payout multipliers that can be adjusted.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">BrainWave RVU</label>
                <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="9" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">VitalWave RVU</label>
                <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="6" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Onsite $ per RVU</label>
                <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="1.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Remote $ per RVU</label>
                <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="0.10" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">If Insurance Does Not Pay — Onsite</label>
                <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="0.20" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">If Insurance Does Not Pay — Remote</label>
                <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="0.00" />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h3 className="text-base font-semibold text-slate-900">2. KPI Threshold Settings</h3>
            <p className="mt-1 text-sm text-slate-500">Minimum KPI thresholds before payout logic evaluates targets.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">BrainWave KPI Threshold</label>
                <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="3" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">VitalWave KPI Threshold</label>
                <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="3" />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h3 className="text-base font-semibold text-slate-900">3. Permissive Prescreening and Qualification Settings</h3>
            <p className="mt-1 text-sm text-slate-500">Controls how permissive intake, prescreening, and qualification are allowed to be.</p>
            <div className="mt-4 space-y-3">
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <input type="checkbox" className="mt-1" defaultChecked />
                <span>
                  <span className="block text-sm font-medium text-slate-900">Allow permissive prescreening</span>
                  <span className="block mt-1 text-xs text-slate-500">Loosen prescreening behavior before final admin or qualification logic.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <input type="checkbox" className="mt-1" defaultChecked />
                <span>
                  <span className="block text-sm font-medium text-slate-900">Allow permissive qualifying</span>
                  <span className="block mt-1 text-xs text-slate-500">Permit broader qualifying behavior when admin settings allow it.</span>
                </span>
              </label>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Fallback Rule</label>
                  <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="admin_review">
                    <option value="admin_review">Admin review</option>
                    <option value="strict_only">Strict only</option>
                    <option value="manual_hold">Manual hold</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Insurance Permissive Rule</label>
                  <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="no_tests_until_review">
                    <option value="no_tests_until_review">No tests until review</option>
                    <option value="manual_release">Manual release</option>
                    <option value="auto_hold">Auto hold</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Review Mode</label>
                  <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="approve_deny">
                    <option value="approve_deny">Approve / Deny</option>
                    <option value="approve_only">Approve only</option>
                    <option value="manual_release">Manual release</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h3 className="text-base font-semibold text-slate-900">4. Quarterly Team Member Payout Settings</h3>
            <p className="mt-1 text-sm text-slate-500">Defines the payout cadence and payout model for assigned team members.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Payout Cadence</label>
                <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="quarterly">
                  <option value="quarterly">Quarterly</option>
                  <option value="monthly">Monthly</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Payout Basis</label>
                <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="rvu_multiplier">
                  <option value="rvu_multiplier">RVU × Multiplier</option>
                  <option value="flat_bonus">Flat bonus</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 xl:col-span-2">
            <h3 className="text-base font-semibold text-slate-900">5. Plex Factor Settings</h3>
            <p className="mt-1 text-sm text-slate-500">
              If selected ancillaries are completed within the chosen time window, their payout multiplier increases by the Plex Factor.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Required Ancillary Count</label>
                <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Plex Factor Multiplier</label>
                <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Time Window</label>
                <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="same_day">
                  <option value="same_day">Same day</option>
                  <option value="7_days">Within 7 days</option>
                  <option value="30_days">Within 30 days</option>
                  <option value="90_days">Within 90 days</option>
                  <option value="custom_months">Custom months</option>
                </select>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-medium text-slate-900 mb-2">Ancillary A</div>
                <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="brainwave">
                  <option value="brainwave">BrainWave</option>
                  <option value="vitalwave">VitalWave</option>
                  <option value="urinalysis">Urinalysis</option>
                </select>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-medium text-slate-900 mb-2">Ancillary B</div>
                <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="urinalysis">
                  <option value="brainwave">BrainWave</option>
                  <option value="vitalwave">VitalWave</option>
                  <option value="urinalysis">Urinalysis</option>
                </select>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
              Example: BrainWave 9 RVU and Urinalysis 0.5 RVU with Plex Factor 2 become 18 and 1 if both are completed within the selected time window.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
