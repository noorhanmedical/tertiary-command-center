// Clinic Onboarding — implementation, SOPs & go-live readiness console.
//
// Self-contained demo page. Takes an approved clinic from kickoff to
// operational: 25 onboarding sections with scored checklist items,
// live-derived progress/maturity metrics, batch intake runner,
// canonical source panels, and a go-live readiness signoff card.

import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Rocket,
  Search,
  Building2,
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  ShieldCheck,
  ListChecks,
  Layers,
  Users,
  Receipt,
  BarChart3,
  Upload,
  PlayCircle,
  Flag,
  ChevronsDownUp,
  ChevronsUpDown,
  Gauge,
  ClipboardCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type {
  OnboardingChecklistItem as ChecklistItem,
  OnboardingPhase as Phase,
  OnboardingStatus as ChecklistStatus,
} from "@/lib/enterprise-demo/types";
// TODO API: replace these demo imports with TanStack Query calls to
// `/api/clinic-onboarding/clinics` and a per-clinic checklist endpoint
// when the backend ships. `buildOnboardingChecklist` is deterministic
// per-seed so the demo stays stable in the meantime.
import {
  ONBOARDING_CLINICS as CLINICS,
  ONBOARDING_SECTION_DEFS as SECTION_DEFS,
  buildOnboardingChecklist,
} from "@/lib/enterprise-demo/clinicOnboardingDemoData";

/* --------------------------- Style maps --------------------------- */

const statusStyles: Record<ChecklistStatus, string> = {
  "Completed": "rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-medium",
  "In Progress": "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  "Not Started": "rounded-md bg-slate-50 text-slate-600 border border-slate-200 px-2 py-0.5 text-xs font-medium",
};

const maturityStyles: Record<number, string> = {
  0: "rounded-md bg-slate-50 text-slate-500 border border-slate-200 px-2 py-0.5 text-xs font-medium",
  1: "rounded-md bg-rose-50 text-rose-600 border border-rose-200 px-2 py-0.5 text-xs font-medium",
  2: "rounded-md bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 text-xs font-medium",
  3: "rounded-md bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 text-xs font-medium",
};

const phaseStyles: Record<Phase, string> = {
  "Sales": "rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 text-xs font-medium",
  "Implementation": "rounded-md bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 text-xs font-medium",
};

function StatusIcon({ status }: { status: ChecklistStatus }) {
  if (status === "Completed") return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
  if (status === "In Progress") return <Clock className="w-4 h-4 text-amber-600 shrink-0" />;
  return <Circle className="w-4 h-4 text-slate-300 shrink-0" />;
}

/* --------------------------- Component --------------------------- */

export default function ClinicOnboardingPage() {
  const { toast } = useToast();

  const [clinicId, setClinicId] = useState<string>(CLINICS[0].id);
  const [search, setSearch] = useState("");
  const [phaseFilter, setPhaseFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [sectionFilter, setSectionFilter] = useState<string>("All");
  const [blockersOnly, setBlockersOnly] = useState(false);
  const [detailed, setDetailed] = useState(true);
  const [openSections, setOpenSections] = useState<string[]>([`section-${SECTION_DEFS[0].id}`]);

  const [batchClinic, setBatchClinic] = useState("");
  const [batchUuids, setBatchUuids] = useState("");

  const clinic = useMemo(
    () => CLINICS.find((c) => c.id === clinicId) ?? CLINICS[0],
    [clinicId],
  );

  // Checklist for the selected clinic (the canonical source of truth for metrics).
  const allItems = useMemo(() => buildOnboardingChecklist(clinic.seed), [clinic.seed]);

  // Live-derived dashboard metrics (over the FULL checklist, not filtered).
  const metrics = useMemo(() => {
    const total = allItems.length;
    const completed = allItems.filter((i) => i.status === "Completed").length;
    const inProgress = allItems.filter((i) => i.status === "In Progress").length;
    const notStarted = allItems.filter((i) => i.status === "Not Started").length;
    const blockers = allItems.filter((i) => i.blocked).length;
    const avgMaturity =
      total === 0 ? 0 : allItems.reduce((s, i) => s + i.maturity.score, 0) / total;
    const progressPct = total === 0 ? 0 : Math.round((completed / total) * 100);

    const salesItems = allItems.filter((i) => i.phase === "Sales");
    const implItems = allItems.filter((i) => i.phase === "Implementation");
    const salesPct =
      salesItems.length === 0
        ? 0
        : Math.round(
            (salesItems.filter((i) => i.status === "Completed").length / salesItems.length) * 100,
          );
    const implPct =
      implItems.length === 0
        ? 0
        : Math.round(
            (implItems.filter((i) => i.status === "Completed").length / implItems.length) * 100,
          );

    const criticalBlockers = allItems.filter((i) => i.blocked && i.maturity.score <= 1).length;
    const goLiveReady = progressPct >= 90 && blockers === 0;

    return {
      total,
      completed,
      inProgress,
      notStarted,
      blockers,
      criticalBlockers,
      avgMaturity,
      progressPct,
      salesPct,
      implPct,
      goLiveReady,
    };
  }, [allItems]);

  // Filtered items drive what is rendered in the accordion sections.
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((item) => {
      if (q && !item.label.toLowerCase().includes(q) && !item.owner.toLowerCase().includes(q)) {
        return false;
      }
      if (phaseFilter !== "All" && item.phase !== phaseFilter) return false;
      if (statusFilter !== "All" && item.status !== statusFilter) return false;
      if (sectionFilter !== "All" && String(item.sectionId) !== sectionFilter) return false;
      if (blockersOnly && !item.blocked) return false;
      return true;
    });
  }, [allItems, search, phaseFilter, statusFilter, sectionFilter, blockersOnly]);

  const visibleSections = useMemo(() => {
    return SECTION_DEFS.map((def) => ({
      def,
      items: filteredItems.filter((i) => i.sectionId === def.id),
    })).filter((s) => s.items.length > 0);
  }, [filteredItems]);

  const expandAll = () => setOpenSections(visibleSections.map((s) => `section-${s.def.id}`));
  const collapseAll = () => setOpenSections([]);

  const missingCritical = useMemo(
    () => allItems.filter((i) => i.blocked && i.status !== "Completed").slice(0, 5),
    [allItems],
  );

  const dashboardCards = [
    { label: "Completed Items", value: metrics.completed, Icon: CheckCircle2, bg: "bg-emerald-100 text-emerald-700", tone: "text-emerald-700" },
    { label: "In Progress", value: metrics.inProgress, Icon: Clock, bg: "bg-amber-100 text-amber-700", tone: "text-amber-700" },
    { label: "Not Started", value: metrics.notStarted, Icon: Circle, bg: "bg-slate-100 text-slate-600", tone: "text-slate-700" },
    { label: "Overall Progress", value: `${metrics.progressPct}%`, Icon: Gauge, bg: "bg-indigo-100 text-indigo-700", tone: "text-indigo-700" },
    { label: "Avg Maturity", value: metrics.avgMaturity.toFixed(1), Icon: BarChart3, bg: "bg-violet-100 text-violet-700", tone: "text-violet-700" },
    { label: "Sales Process", value: `${metrics.salesPct}%`, Icon: ListChecks, bg: "bg-sky-100 text-sky-700", tone: "text-sky-700" },
    { label: "Implementation", value: `${metrics.implPct}%`, Icon: ClipboardCheck, bg: "bg-teal-100 text-teal-700", tone: "text-teal-700" },
    { label: "Critical Blockers", value: metrics.criticalBlockers, Icon: AlertTriangle, bg: "bg-rose-100 text-rose-700", tone: "text-rose-700" },
    { label: "Go-Live Readiness", value: metrics.goLiveReady ? "Ready" : "Pending", Icon: Rocket, bg: "bg-purple-100 text-purple-700", tone: metrics.goLiveReady ? "text-emerald-700" : "text-amber-700" },
  ];

  const runBatch = () => {
    toast({
      title: "Batch intake queued (demo)",
      description:
        "No backend wired in this demo. In production this would create Outreach tasks, refresh the Call list, and update Scheduling triage downstream.",
    });
  };

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/15 to-indigo-500/15 text-purple-700">
            <Rocket className="w-5 h-5" strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900" data-testid="text-clinic-onboarding-title">
              Clinic Onboarding
            </h1>
            <p className="text-sm text-slate-500">Implementation, SOPs &amp; go-live readiness</p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto bg-slate-50/40 px-6 py-6 space-y-6">
        {/* 1. Clinic selector + profile */}
        <Card className="rounded-xl border-slate-200">
          <CardContent className="p-5 space-y-4">
            <div className="flex flex-wrap items-end gap-4 justify-between">
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">Clinic</Label>
                <Select value={clinicId} onValueChange={setClinicId}>
                  <SelectTrigger className="w-[280px]" data-testid="select-clinic">
                    <SelectValue placeholder="Select clinic" />
                  </SelectTrigger>
                  <SelectContent>
                    {CLINICS.map((c) => (
                      <SelectItem key={c.id} value={c.id} data-testid={`option-clinic-${c.id}`}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={statusStyles["In Progress"]} data-testid="badge-clinic-phase">
                  {clinic.phase} phase
                </span>
                <Badge variant="secondary" data-testid="badge-clinic-status">{clinic.status}</Badge>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-slate-500">Clinic</div>
                <div className="text-sm font-semibold text-slate-900" data-testid="text-clinic-name">{clinic.name}</div>
                <div className="text-xs text-slate-500 mt-0.5">{clinic.location}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Owner / Admin</div>
                <div className="text-sm font-semibold text-slate-900">{clinic.ownerContact}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Go-Live Target</div>
                <div className="text-sm font-semibold text-slate-900 tabular-nums">{clinic.goLiveTarget}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Open Blockers</div>
                <div className="text-sm font-semibold text-rose-700 tabular-nums" data-testid="text-clinic-blockers">{metrics.blockers}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Overall onboarding progress</span>
                <span className="font-semibold text-slate-900 tabular-nums" data-testid="text-overall-progress">{metrics.progressPct}%</span>
              </div>
              <Progress value={metrics.progressPct} data-testid="progress-overall" />
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span>Maturity score: <span className="font-semibold text-slate-700 tabular-nums">{metrics.avgMaturity.toFixed(1)} / 3.0</span></span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 2. Dashboard metric cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="onboarding-metrics">
          {dashboardCards.map((m) => (
            <Card key={m.label} className="rounded-xl border-slate-200" data-testid={`metric-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <span className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${m.bg}`}>
                  <m.Icon className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <div className={`text-2xl font-bold tabular-nums ${m.tone}`}>{m.value}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">{m.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 4. Filters bar */}
        <Card className="rounded-xl border-slate-200">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search checklist items or owners…"
                  className="pl-8"
                  data-testid="input-search-checklist"
                />
              </div>

              <Select value={phaseFilter} onValueChange={setPhaseFilter}>
                <SelectTrigger className="w-[160px]" data-testid="select-phase">
                  <SelectValue placeholder="Phase" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Phases</SelectItem>
                  <SelectItem value="Sales">Sales</SelectItem>
                  <SelectItem value="Implementation">Implementation</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[170px]" data-testid="select-status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Statuses</SelectItem>
                  <SelectItem value="Not Started">Not Started</SelectItem>
                  <SelectItem value="In Progress">In Progress</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sectionFilter} onValueChange={setSectionFilter}>
                <SelectTrigger className="w-[220px]" data-testid="select-section">
                  <SelectValue placeholder="Section" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Sections</SelectItem>
                  {SECTION_DEFS.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.id}. {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div className="flex items-center gap-2">
                <Switch
                  id="blockers-only"
                  checked={blockersOnly}
                  onCheckedChange={setBlockersOnly}
                  data-testid="switch-blockers-only"
                />
                <Label htmlFor="blockers-only" className="text-sm text-slate-600">Blockers only</Label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={expandAll} data-testid="button-expand-all">
                  <ChevronsUpDown className="w-4 h-4 mr-1.5" /> Expand all
                </Button>
                <Button variant="outline" size="sm" onClick={collapseAll} data-testid="button-collapse-all">
                  <ChevronsDownUp className="w-4 h-4 mr-1.5" /> Collapse all
                </Button>
                <Button
                  variant={detailed ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDetailed((v) => !v)}
                  data-testid="button-toggle-view"
                >
                  {detailed ? "Detailed view" : "Snapshot view"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 5. The 25 onboarding sections */}
        {visibleSections.length === 0 ? (
          <Card className="rounded-xl border-slate-200">
            <CardContent className="p-10 text-center text-slate-400 text-sm" data-testid="status-checklist-empty">
              No checklist items match the current filters.
            </CardContent>
          </Card>
        ) : (
          <Accordion
            type="multiple"
            value={openSections}
            onValueChange={setOpenSections}
            className="space-y-3"
            data-testid="onboarding-sections"
          >
            {visibleSections.map(({ def, items }) => {
              const done = items.filter((i) => i.status === "Completed").length;
              const sectionBlocked = items.some((i) => i.blocked);
              return (
                <AccordionItem
                  key={def.id}
                  value={`section-${def.id}`}
                  className="border border-slate-200 rounded-xl bg-white px-4"
                  data-testid={`section-${def.id}`}
                >
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-semibold text-slate-400 tabular-nums w-6 shrink-0">{def.id}</span>
                        <span className="text-sm font-semibold text-slate-800 truncate">{def.name}</span>
                        <span className={phaseStyles[def.phase]}>{def.phase}</span>
                        {sectionBlocked && (
                          <span className="rounded-md bg-rose-50 text-rose-600 border border-rose-200 px-2 py-0.5 text-xs font-medium inline-flex items-center gap-1">
                            <Flag className="w-3 h-3" /> Blocker
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-500 tabular-nums shrink-0">{done}/{items.length}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="divide-y divide-slate-100">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className="py-3 flex items-start gap-3"
                          data-testid={`checklist-item-${item.id}`}
                        >
                          <StatusIcon status={item.status} />
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-slate-800">{item.label}</span>
                              <span className={statusStyles[item.status]}>{item.status}</span>
                              <span className={maturityStyles[item.maturity.score]}>
                                M{item.maturity.score} · {item.maturity.label}
                              </span>
                              {item.blocked && (
                                <span className="rounded-md bg-rose-50 text-rose-600 border border-rose-200 px-2 py-0.5 text-xs font-medium">
                                  Blocked
                                </span>
                              )}
                            </div>
                            {detailed && (
                              <>
                                <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs text-slate-500">
                                  <span>Owner: <span className="text-slate-700">{item.owner}</span></span>
                                  <span>Due: <span className="text-slate-700 tabular-nums">{item.dueDate}</span></span>
                                  <span>Phase: <span className="text-slate-700">{item.phase}</span></span>
                                  <span>Updated: <span className="text-slate-700 tabular-nums">{item.lastUpdated}</span></span>
                                </div>
                                <div className="mt-1 text-xs text-slate-500 italic">{item.notes}</div>
                                <div className="mt-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled
                                    data-testid={`button-upload-evidence-${item.id}`}
                                  >
                                    <Upload className="w-3.5 h-3.5 mr-1.5" /> Upload evidence
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}

        {/* 6. Batch Patient Intake Runner */}
        <Card className="rounded-xl border-slate-200">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <PlayCircle className="w-4 h-4 text-indigo-600" /> Batch Patient Intake Runner
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Demo only — no backend wired. Running a batch will simulate downstream invalidation of
              Outreach tasks, the Call list, and Scheduling triage.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">Clinic ID (optional)</Label>
                <Input
                  value={batchClinic}
                  onChange={(e) => setBatchClinic(e.target.value)}
                  placeholder={clinic.id}
                  data-testid="input-batch-clinic"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">Patient UUIDs (max 50, comma-separated)</Label>
                <Input
                  value={batchUuids}
                  onChange={(e) => setBatchUuids(e.target.value)}
                  placeholder="uuid-1, uuid-2, …"
                  data-testid="input-batch-uuids"
                />
              </div>
            </div>
            <Button onClick={runBatch} data-testid="button-run-batch">
              <PlayCircle className="w-4 h-4 mr-1.5" /> Run batch
            </Button>
          </CardContent>
        </Card>

        {/* 7. Canonical Source Panels */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="rounded-xl border-slate-200" data-testid="panel-clinic-profiles">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Building2 className="w-4 h-4 text-indigo-600" /> Clinic Profiles
              </div>
              <div className="text-xs text-slate-500">{CLINICS.length} active clinic profiles. Read-only canonical source.</div>
              <Separator />
              <div className="text-xs text-slate-600">{clinic.name} · {clinic.location}</div>
            </CardContent>
          </Card>
          <Card className="rounded-xl border-slate-200" data-testid="panel-facilities">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Layers className="w-4 h-4 text-teal-600" /> Facilities
              </div>
              <div className="text-xs text-slate-500">Linked facility records & site coverage. Read-only canonical source.</div>
              <Separator />
              <div className="text-xs text-slate-600">1 primary site · go-live {clinic.goLiveTarget}</div>
            </CardContent>
          </Card>
          <Card className="rounded-xl border-slate-200" data-testid="panel-ancillary-registry">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <ShieldCheck className="w-4 h-4 text-violet-600" /> Ancillary Registry
              </div>
              <div className="text-xs text-slate-500">Registered ancillary services. Read-only canonical source.</div>
              <Separator />
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">BrainWave</Badge>
                <Badge variant="secondary">VitalWave</Badge>
                <Badge variant="secondary">Ultrasound</Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 8. Go-Live Readiness final card */}
        <Card className="rounded-xl border-slate-200">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Rocket className="w-4 h-4 text-purple-600" /> Go-Live Readiness
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-slate-500">Ready for go-live</div>
                <div className="mt-1">
                  {metrics.goLiveReady ? (
                    <span className={statusStyles["Completed"]} data-testid="badge-golive-ready">Yes</span>
                  ) : (
                    <span className={statusStyles["In Progress"]} data-testid="badge-golive-ready">Not yet</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Open blockers</div>
                <div className="text-sm font-semibold text-rose-700 tabular-nums">{metrics.blockers}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Recommended launch</div>
                <div className="text-sm font-semibold text-slate-900 tabular-nums">{clinic.goLiveTarget}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Required before launch</div>
                <div className="text-sm font-semibold text-slate-900 tabular-nums">{metrics.notStarted + metrics.inProgress} items</div>
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500 mb-1.5">Missing critical items</div>
              {missingCritical.length === 0 ? (
                <div className="text-sm text-emerald-700">No critical blockers — clear for launch.</div>
              ) : (
                <ul className="space-y-1">
                  {missingCritical.map((i) => {
                    const sec = SECTION_DEFS.find((s) => s.id === i.sectionId);
                    return (
                      <li key={i.id} className="text-sm text-slate-700 flex items-center gap-2" data-testid={`missing-item-${i.id}`}>
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        <span>{sec?.name}: {i.label}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <Separator />

            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => toast({ title: "Admin signoff recorded (demo)", description: `${clinic.name} signed off by admin.` })}
                  data-testid="button-admin-signoff"
                >
                  <ShieldCheck className="w-4 h-4 mr-1.5" /> Admin signoff
                </Button>
                <Button
                  variant="outline"
                  onClick={() => toast({ title: "Owner signoff recorded (demo)", description: `${clinic.name} signed off by owner.` })}
                  data-testid="button-owner-signoff"
                >
                  <CheckCircle2 className="w-4 h-4 mr-1.5" /> Owner signoff
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/clinic-analytics">
                  <Button variant="outline" data-testid="link-clinic-analytics">
                    <BarChart3 className="w-4 h-4 mr-1.5" /> Clinic Analytics
                  </Button>
                </Link>
                <Link href="/billing">
                  <Button variant="outline" data-testid="link-billing">
                    <Receipt className="w-4 h-4 mr-1.5" /> Billing
                  </Button>
                </Link>
                <Link href="/team-ops">
                  <Button variant="outline" data-testid="link-team-ops">
                    <Users className="w-4 h-4 mr-1.5" /> Team Ops
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
