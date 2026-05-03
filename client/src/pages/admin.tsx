import {
  Link } from "wouter";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest,
  queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Shield,
  Settings,
  Wrench,
  Lock,
  ClipboardList,
  Building2,
  ChevronRight,
  Users,
  ScrollText,
  History,
  Inbox,
  Bot,
  Loader2,
  Trash2,
  Flame,
  FlameKindling
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { PatientJourneyDrawer } from "@/components/patient/PatientJourneyDrawer";

const ADMIN_SECTIONS = [
  { href: "/settings", icon: Settings, iconBg: "bg-blue-100 text-blue-700",
    title: "Settings", desc: "Team members, clinic spreadsheet connections, and scheduler team configuration.", available: true },
  { href: "/admin/stovetop-heat-settings", icon: Flame, iconBg: "bg-orange-100 text-orange-700",
    title: "Stovetop Heat Settings", desc: "Facility presets, knobs, RVU payout controls, KPI thresholds, permissive qualification behavior, and Plex Factor.", available: true },
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

  const [stoveRegion, setStoveRegion] = useState("Southwest");
  const [stoveFacility, setStoveFacility] = useState("NWPG - Spring");
  const [stoveKnob, setStoveKnob] = useState<"low" | "mediumLow" | "medium" | "mediumHigh" | "high">("medium");

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

  const stoveOptions = [
    { key: "low", label: "Low / Simmer", description: "Keeping food warm, gentle simmer", flames: 1 },
    { key: "mediumLow", label: "Medium-Low", description: "Slow cooking, sauces", flames: 2 },
    { key: "medium", label: "Medium", description: "General cooking", flames: 3 },
    { key: "mediumHigh", label: "Medium-High", description: "Sauteing, pan frying", flames: 4 },
    { key: "high", label: "High", description: "Boiling water, searing", flames: 5 },
  ] as const;

  const activeStoveOption =
    stoveOptions.find((option) => option.key === stoveKnob) ?? stoveOptions[2];

  return (
    <div className="min-h-full flex-1 overflow-auto plexus-page-radial">
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
                {/* Name-only lookup intentionally — the server's resolution
                    chain prefers the canonical-spine row, and after running
                    `npm run reconcile:testguy` every TestGuy row carries the
                    canonical identity. Avoid hardcoding screening or case
                    ids here so the admin button stays correct across re-seeds. */}
                <PatientJourneyDrawer
                  lookup={{ patientName: "TestGuy Robot" }}
                  triggerLabel="Open TestGuy Packet"
                  triggerSize="default"
                  triggerVariant="ghost"
                  triggerClassName="text-fuchsia-700 hover:bg-fuchsia-50"
                />
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
    </div>
  );
}
