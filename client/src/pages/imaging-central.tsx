// Imaging Central — imaging EXECUTION center (ultrasound focus).
//
// Self-contained demo page for the imaging execution module. This is the
// operational console for getting imaging studies done: coverage, the
// technician roster, the live work queue, an action workbench, and the
// downstream readiness queue. Currently ULTRASOUND-ONLY by design.
//
// BOUNDARY: imaging execution only. No BrainWave / VitalWave / EKG / PGX /
// CGX here. "Technician" is a role label; "Ultrasound" is the study type.
// The module name is always "Imaging Central".
//
// Demo data + domain types live in
// `client/src/lib/enterprise-demo/`. When backend endpoints ship, swap
// the demo imports for TanStack Query hooks.

import { useMemo, useState } from "react";
import { Link } from "wouter";
import type {
  CoverageStatus,
  ImagingStatus,
  ImagingTask,
  YesNo,
} from "@/lib/enterprise-demo/types";
// TODO API: replace these demo imports with TanStack Query calls to
// `/api/imaging-central/work-queue`, `/coverage`, `/technicians` when
// backend endpoints ship.
import {
  IMAGING_CENTRAL_CLINICS as CLINICS,
  IMAGING_CENTRAL_TECHNICIANS as TECHNICIANS,
  IMAGING_CENTRAL_ULTRASOUND_TYPES as ULTRASOUND_TYPES,
  IMAGING_CENTRAL_STATUSES as ALL_STATUSES,
  IMAGING_CENTRAL_WORK_QUEUE as WORK_QUEUE,
  IMAGING_CENTRAL_COVERAGE_ROWS as COVERAGE_ROWS,
  IMAGING_CENTRAL_TECH_ROSTER as TECH_ROSTER,
} from "@/lib/enterprise-demo/imagingCentralDemoData";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  ScanLine,
  Waves,
  MapPin,
  UserCog,
  Search,
  RefreshCw,
  AlertCircle,
  Upload,
  FileText,
  Binary,
  ClipboardCheck,
  CheckCircle2,
  UserX,
  CalendarClock,
  XCircle,
  Send,
  FolderOpen,
  Clock,
  Stethoscope,
  Phone,
  Activity,
  Wifi,
  WifiOff,
} from "lucide-react";


const statusStyles: Record<ImagingStatus, string> = {
  Assigned:
    "rounded-md bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 text-xs font-medium",
  "In Field":
    "rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 text-xs font-medium",
  Uploaded:
    "rounded-md bg-cyan-50 text-cyan-700 border border-cyan-200 px-2 py-0.5 text-xs font-medium",
  "Needs Review":
    "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  Completed:
    "rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-medium",
  "No Show":
    "rounded-md bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 text-xs font-medium",
  "Reschedule Needed":
    "rounded-md bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 text-xs font-medium",
  Cancelled:
    "rounded-md bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 text-xs font-medium",
};

const coverageStyles: Record<CoverageStatus, string> = {
  Confirmed:
    "rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-medium",
  Pending:
    "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  Gap: "rounded-md bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 text-xs font-medium",
};

function pill(text: string, tone: "green" | "amber" | "rose" | "slate" | "blue") {
  const map: Record<string, string> = {
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    slate: "bg-slate-100 text-slate-600 border-slate-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
  };
  return `rounded-md border px-2 py-0.5 text-xs font-medium ${map[tone]}`;
}


// View state for demo of loading / empty / error.
type ViewState = "success" | "loading" | "empty" | "error";

export default function ImagingCentralPage() {
  const { toast } = useToast();

  const [view, setView] = useState<ViewState>("success");

  // Filters
  const [search, setSearch] = useState("");
  const [clinicFilter, setClinicFilter] = useState<string>("all");
  const [techFilter, setTechFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [imagingTypeFilter] = useState<string>("Ultrasound"); // ultrasound-only for now
  const [usTypeFilter, setUsTypeFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");

  // Workbench sheet
  const [activeRow, setActiveRow] = useState<ImagingTask | null>(null);

  const dates = useMemo(() => {
    return Array.from(new Set(WORK_QUEUE.map((r) => r.appointmentIso))).sort();
  }, []);

  const filteredQueue = useMemo(() => {
    if (view !== "success") return [];
    const q = search.trim().toLowerCase();
    return WORK_QUEUE.filter((r) => {
      if (q && !`${r.patientName} ${r.patientMrn}`.toLowerCase().includes(q)) return false;
      if (clinicFilter !== "all" && r.clinic !== clinicFilter) return false;
      if (techFilter !== "all" && r.technician !== techFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (usTypeFilter !== "all" && r.ultrasoundType !== usTypeFilter) return false;
      if (dateFilter !== "all" && r.appointmentIso !== dateFilter) return false;
      return true;
    });
  }, [view, search, clinicFilter, techFilter, statusFilter, usTypeFilter, dateFilter]);

  // KPI band — derived from the full work queue.
  const kpis = useMemo(() => {
    const q = WORK_QUEUE;
    const count = (fn: (r: ImagingTask) => boolean) => q.filter(fn).length;
    return [
      { label: "Total Imaging Tasks", value: q.length, Icon: ScanLine, tone: "text-slate-900", bg: "bg-slate-100 text-slate-700" },
      { label: "Ultrasound Tasks", value: count((r) => r.imagingType === "Ultrasound"), Icon: Waves, tone: "text-cyan-700", bg: "bg-cyan-100 text-cyan-700" },
      { label: "Assigned", value: count((r) => r.status === "Assigned"), Icon: ClipboardCheck, tone: "text-blue-700", bg: "bg-blue-100 text-blue-700" },
      { label: "In Field", value: count((r) => r.status === "In Field"), Icon: Activity, tone: "text-indigo-700", bg: "bg-indigo-100 text-indigo-700" },
      { label: "Uploaded", value: count((r) => r.uploadStatus === "Uploaded"), Icon: Upload, tone: "text-cyan-700", bg: "bg-cyan-100 text-cyan-700" },
      { label: "Needs Review", value: count((r) => r.status === "Needs Review"), Icon: AlertCircle, tone: "text-amber-700", bg: "bg-amber-100 text-amber-700" },
      { label: "Completed", value: count((r) => r.status === "Completed"), Icon: CheckCircle2, tone: "text-emerald-700", bg: "bg-emerald-100 text-emerald-700" },
      { label: "Report Ready", value: count((r) => r.uploadStatus === "Uploaded" && r.qcStatus === "Passed"), Icon: FileText, tone: "text-teal-700", bg: "bg-teal-100 text-teal-700" },
      { label: "Procedure Ready", value: count((r) => r.procedureNoteStatus === "Complete"), Icon: Stethoscope, tone: "text-violet-700", bg: "bg-violet-100 text-violet-700" },
      { label: "Ready for Billing", value: count((r) => r.billingReadiness === "Ready"), Icon: Send, tone: "text-emerald-700", bg: "bg-emerald-100 text-emerald-700" },
      { label: "Coverage Confirmed", value: count((r) => r.coverage === "Confirmed"), Icon: MapPin, tone: "text-emerald-700", bg: "bg-emerald-100 text-emerald-700" },
    ];
  }, []);

  // Readiness queue rows derived from work queue.
  const readinessRows = useMemo(() => {
    return WORK_QUEUE.filter((r) => r.status !== "Cancelled").map((r) => {
      const reportUploaded: YesNo = r.uploadStatus === "Uploaded" ? "Yes" : "No";
      const procedureComplete: YesNo = r.procedureNoteStatus === "Complete" ? "Yes" : "No";
      const billingReady: YesNo = r.billingReadiness === "Ready" ? "Yes" : "No";
      let missing = "—";
      if (reportUploaded === "No") missing = "Report upload";
      else if (r.qcStatus !== "Passed") missing = "QC review";
      else if (procedureComplete === "No") missing = "Procedure note";
      else if (billingReady === "No") missing = "Billing handoff";
      return {
        id: r.id,
        patientName: r.patientName,
        clinic: r.clinic,
        study: r.ultrasoundType,
        imagingType: r.imagingType,
        reportUploaded,
        procedureComplete,
        billingReady,
        missing,
        nextAction: r.nextAction,
      };
    });
  }, []);

  const fireToast = (title: string, description?: string) =>
    toast({ title, description });

  const resetFilters = () => {
    setSearch("");
    setClinicFilter("all");
    setTechFilter("all");
    setStatusFilter("all");
    setUsTypeFilter("all");
    setDateFilter("all");
  };

  const workbenchActions: { label: string; Icon: typeof Upload; ultrasoundOnly?: boolean }[] = [
    { label: "Upload Imaging Report", Icon: Upload },
    { label: "Upload Ultrasound Report", Icon: Waves, ultrasoundOnly: true },
    { label: "Attach Report Metadata", Icon: FileText },
    { label: "Register Report Binary", Icon: Binary },
    { label: "QC Review", Icon: ClipboardCheck },
    { label: "Complete Procedure", Icon: CheckCircle2 },
    { label: "Mark No Show", Icon: UserX },
    { label: "Needs Reschedule", Icon: CalendarClock },
    { label: "Cancelled", Icon: XCircle },
    { label: "Send to Billing", Icon: Send },
    { label: "View Document Package", Icon: FolderOpen },
  ];

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/15 to-teal-500/15 text-cyan-700">
              <ScanLine className="w-5 h-5" strokeWidth={1.75} />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-slate-900" data-testid="text-imaging-central-title">
                Imaging Central
              </h1>
              <p className="text-sm text-slate-500">Imaging execution · ultrasound focus</p>
            </div>
          </div>
          {/* Demo state switcher */}
          <div className="flex items-center gap-2">
            <Select value={view} onValueChange={(v) => setView(v as ViewState)}>
              <SelectTrigger className="w-[150px]" data-testid="select-view-state">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="success">Live data</SelectItem>
                <SelectItem value="loading">Loading state</SelectItem>
                <SelectItem value="empty">Empty state</SelectItem>
                <SelectItem value="error">Error state</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto bg-slate-50/40 px-6 py-6 space-y-6">
        {/* KPI HEADER BAND */}
        <section data-testid="imaging-kpi-band">
          {view === "loading" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {Array.from({ length: 11 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {kpis.map((k) => (
                <Card
                  key={k.label}
                  className="p-3 rounded-xl border-slate-200 flex items-center gap-3"
                  data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${k.bg}`}>
                    <k.Icon className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className={`text-xl font-bold tabular-nums ${k.tone}`}>{view === "empty" ? 0 : k.value}</div>
                    <div className="text-[11px] text-slate-500 leading-tight">{k.label}</div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {view === "error" && (
          <Card
            className="rounded-xl border-rose-200 bg-rose-50 p-8 text-center"
            data-testid="status-imaging-error"
          >
            <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
            <div className="text-sm font-medium text-rose-700">Couldn't load imaging operations data.</div>
            <div className="text-xs text-rose-600 mt-1">Please refresh to try again.</div>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setView("success")}
              data-testid="button-retry"
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </Card>
        )}

        {view === "loading" && (
          <div className="space-y-4" data-testid="status-imaging-loading">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        )}

        {(view === "success" || view === "empty") && (
          <>
            {/* GLOBAL IMAGING COVERAGE */}
            <Card className="rounded-xl border-slate-200" data-testid="section-coverage">
              <div className="px-5 pt-5 pb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-cyan-600" />
                <h2 className="text-sm font-semibold text-slate-900">Global Imaging Coverage</h2>
              </div>
              <Separator />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Clinic</TableHead>
                      <TableHead>Technician</TableHead>
                      <TableHead>Imaging Type</TableHead>
                      <TableHead>Ultrasound Type</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Time Window</TableHead>
                      <TableHead>Coverage</TableHead>
                      <TableHead className="text-right">Assigned</TableHead>
                      <TableHead className="text-right">Completed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view === "empty" ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-sm text-slate-400 py-8">
                          No coverage scheduled.
                        </TableCell>
                      </TableRow>
                    ) : (
                      COVERAGE_ROWS.map((c) => (
                        <TableRow key={c.id} data-testid={`coverage-row-${c.id}`}>
                          <TableCell className="font-medium text-slate-800">{c.clinic}</TableCell>
                          <TableCell className="text-slate-600">{c.technician}</TableCell>
                          <TableCell className="text-slate-600">{c.imagingType}</TableCell>
                          <TableCell className="text-slate-600">{c.ultrasoundType}</TableCell>
                          <TableCell className="text-slate-600 whitespace-nowrap">{c.date}</TableCell>
                          <TableCell className="text-slate-600 whitespace-nowrap">{c.timeWindow}</TableCell>
                          <TableCell><span className={coverageStyles[c.coverage]}>{c.coverage}</span></TableCell>
                          <TableCell className="text-right tabular-nums text-slate-800">{c.assignedCount}</TableCell>
                          <TableCell className="text-right tabular-nums text-slate-800">{c.completedCount}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>

            {/* TECHNICIAN ROSTER */}
            <section data-testid="section-roster">
              <div className="flex items-center gap-2 mb-3">
                <UserCog className="w-4 h-4 text-cyan-600" />
                <h2 className="text-sm font-semibold text-slate-900">Imaging Technician Roster</h2>
              </div>
              {view === "empty" ? (
                <Card className="rounded-xl border-slate-200 p-8 text-center text-sm text-slate-400">
                  No technicians on roster.
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {TECH_ROSTER.map((t) => {
                    const pct = Math.round((t.capacityToday.booked / t.capacityToday.max) * 100);
                    return (
                      <Card key={t.id} className="rounded-xl border-slate-200 p-4 space-y-3" data-testid={`tech-card-${t.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate">{t.name}</div>
                            <div className="text-[11px] text-slate-500 mt-0.5">{t.shift}</div>
                          </div>
                          {t.online ? (
                            <span className={pill("Online", "green") + " inline-flex items-center gap-1 shrink-0"}>
                              <Wifi className="w-3 h-3" /> Online
                            </span>
                          ) : (
                            <span className={pill("Offline", "slate") + " inline-flex items-center gap-1 shrink-0"}>
                              <WifiOff className="w-3 h-3" /> Offline
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {t.assignedClinics.map((c) => (
                            <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                          ))}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                          <Phone className="w-3 h-3" /> {t.phone}
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                            <span>Capacity today</span>
                            <span className="tabular-nums">{t.capacityToday.booked}/{t.capacityToday.max}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full bg-cyan-500" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500">Current</span>
                          <span className="text-slate-700 font-medium truncate ml-2">{t.currentAssignment}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500">Completion rate</span>
                          <span className="text-emerald-700 font-semibold tabular-nums">{t.completionRate}%</span>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>

            {/* FILTERS */}
            <Card className="rounded-xl border-slate-200 p-4" data-testid="section-filters">
              <div className="flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search patient or MRN…"
                    className="pl-8"
                    data-testid="input-search-patient"
                  />
                </div>

                <Select value={clinicFilter} onValueChange={setClinicFilter}>
                  <SelectTrigger className="w-[180px]" data-testid="select-clinic">
                    <SelectValue placeholder="Clinic" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All clinics</SelectItem>
                    {CLINICS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={techFilter} onValueChange={setTechFilter}>
                  <SelectTrigger className="w-[170px]" data-testid="select-technician">
                    <SelectValue placeholder="Technician" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All technicians</SelectItem>
                    {TECHNICIANS.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[160px]" data-testid="select-status">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {ALL_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={imagingTypeFilter} disabled>
                  <SelectTrigger className="w-[150px]" data-testid="select-imaging-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Ultrasound">Ultrasound</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={usTypeFilter} onValueChange={setUsTypeFilter}>
                  <SelectTrigger className="w-[190px]" data-testid="select-ultrasound-type">
                    <SelectValue placeholder="Ultrasound type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All ultrasound types</SelectItem>
                    {ULTRASOUND_TYPES.map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={dateFilter} onValueChange={setDateFilter}>
                  <SelectTrigger className="w-[150px]" data-testid="select-date">
                    <SelectValue placeholder="Date" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All dates</SelectItem>
                    {dates.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button variant="outline" size="default" onClick={resetFilters} data-testid="button-reset-filters">
                  Reset
                </Button>
              </div>
            </Card>

            {/* IMAGING WORK QUEUE */}
            <Card className="rounded-xl border-slate-200" data-testid="section-work-queue">
              <div className="px-5 pt-5 pb-3 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <ScanLine className="w-4 h-4 text-cyan-600" />
                  <h2 className="text-sm font-semibold text-slate-900">Imaging Work Queue</h2>
                </div>
                <span className="text-xs text-slate-500 tabular-nums" data-testid="text-queue-count">
                  {filteredQueue.length} of {WORK_QUEUE.length} studies
                </span>
              </div>
              <Separator />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Patient</TableHead>
                      <TableHead>Clinic</TableHead>
                      <TableHead>Imaging Study</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Technician</TableHead>
                      <TableHead>Appointment</TableHead>
                      <TableHead>Coverage</TableHead>
                      <TableHead>Upload</TableHead>
                      <TableHead>QC</TableHead>
                      <TableHead>Proc. Note</TableHead>
                      <TableHead>Billing</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Updated</TableHead>
                      <TableHead>Next Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredQueue.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={14} className="text-center text-sm text-slate-400 py-10" data-testid="empty-work-queue">
                          No imaging studies match the current filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredQueue.map((r) => (
                        <TableRow
                          key={r.id}
                          className="cursor-pointer hover:bg-slate-50"
                          onClick={() => setActiveRow(r)}
                          data-testid={`queue-row-${r.id}`}
                        >
                          <TableCell>
                            <div className="font-medium text-slate-800">{r.patientName}</div>
                            <div className="text-[11px] text-slate-500">{r.patientMrn}</div>
                          </TableCell>
                          <TableCell className="text-slate-600">{r.clinic}</TableCell>
                          <TableCell className="text-slate-600">{r.ultrasoundType}</TableCell>
                          <TableCell className="text-slate-600">{r.imagingType}</TableCell>
                          <TableCell className="text-slate-600">{r.technician}</TableCell>
                          <TableCell className="text-slate-600 whitespace-nowrap">{r.appointment}</TableCell>
                          <TableCell><span className={coverageStyles[r.coverage]}>{r.coverage}</span></TableCell>
                          <TableCell className="text-slate-600">{r.uploadStatus}</TableCell>
                          <TableCell className="text-slate-600">{r.qcStatus}</TableCell>
                          <TableCell className="text-slate-600">{r.procedureNoteStatus}</TableCell>
                          <TableCell>
                            <span
                              className={pill(
                                r.billingReadiness,
                                r.billingReadiness === "Ready" ? "green" : r.billingReadiness === "Blocked" ? "rose" : "amber",
                              )}
                            >
                              {r.billingReadiness}
                            </span>
                          </TableCell>
                          <TableCell><span className={statusStyles[r.status]}>{r.status}</span></TableCell>
                          <TableCell className="text-[11px] text-slate-500 whitespace-nowrap">{r.lastUpdated}</TableCell>
                          <TableCell className="text-[11px] text-slate-600 max-w-[180px]">{r.nextAction}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>

            {/* IMAGING READINESS QUEUE */}
            <Card className="rounded-xl border-slate-200" data-testid="section-readiness">
              <div className="px-5 pt-5 pb-3 flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-cyan-600" />
                <h2 className="text-sm font-semibold text-slate-900">Imaging Readiness Queue</h2>
              </div>
              <Separator />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Patient</TableHead>
                      <TableHead>Clinic</TableHead>
                      <TableHead>Study</TableHead>
                      <TableHead>Imaging Type</TableHead>
                      <TableHead>Report Uploaded</TableHead>
                      <TableHead>Procedure Complete</TableHead>
                      <TableHead>Billing Ready</TableHead>
                      <TableHead>Missing Item</TableHead>
                      <TableHead>Next Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view === "empty" ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-sm text-slate-400 py-8">
                          No readiness items.
                        </TableCell>
                      </TableRow>
                    ) : (
                      readinessRows.map((r) => (
                        <TableRow key={r.id} data-testid={`readiness-row-${r.id}`}>
                          <TableCell className="font-medium text-slate-800">{r.patientName}</TableCell>
                          <TableCell className="text-slate-600">{r.clinic}</TableCell>
                          <TableCell className="text-slate-600">{r.study}</TableCell>
                          <TableCell className="text-slate-600">{r.imagingType}</TableCell>
                          <TableCell><span className={pill(r.reportUploaded, r.reportUploaded === "Yes" ? "green" : "rose")}>{r.reportUploaded}</span></TableCell>
                          <TableCell><span className={pill(r.procedureComplete, r.procedureComplete === "Yes" ? "green" : "rose")}>{r.procedureComplete}</span></TableCell>
                          <TableCell><span className={pill(r.billingReady, r.billingReady === "Yes" ? "green" : "rose")}>{r.billingReady}</span></TableCell>
                          <TableCell className="text-slate-600">{r.missing}</TableCell>
                          <TableCell className="text-[11px] text-slate-600 max-w-[180px]">{r.nextAction}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </>
        )}
      </main>

      {/* IMAGING ACTION WORKBENCH (right Sheet) */}
      <Sheet open={!!activeRow} onOpenChange={(o) => !o && setActiveRow(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" data-testid="sheet-workbench">
          {activeRow && (
            <>
              <SheetHeader>
                <SheetTitle data-testid="text-workbench-patient">{activeRow.patientName}</SheetTitle>
                <SheetDescription>
                  {activeRow.patientMrn} · DOB {activeRow.patientDob}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4">
                {/* Summary facts */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Clinic", activeRow.clinic],
                    ["Study type", activeRow.ultrasoundType],
                    ["Imaging type", activeRow.imagingType],
                    ["Technician", activeRow.technician],
                    ["Scheduled", activeRow.appointment],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div className="text-[11px] text-slate-500">{k}</div>
                      <div className="text-slate-800 font-medium">{v}</div>
                    </div>
                  ))}
                </div>

                <Separator />

                {/* Status chips */}
                <div className="flex flex-wrap gap-2">
                  <span className={statusStyles[activeRow.status]}>{activeRow.status}</span>
                  <span className={coverageStyles[activeRow.coverage]}>Coverage: {activeRow.coverage}</span>
                  <span className={pill(`Upload: ${activeRow.uploadStatus}`, activeRow.uploadStatus === "Uploaded" ? "green" : "amber")}>
                    Upload: {activeRow.uploadStatus}
                  </span>
                  <span className={pill(`QC: ${activeRow.qcStatus}`, activeRow.qcStatus === "Passed" ? "green" : activeRow.qcStatus === "Flagged" ? "rose" : "amber")}>
                    QC: {activeRow.qcStatus}
                  </span>
                  <span className={pill(`Proc: ${activeRow.procedureNoteStatus}`, activeRow.procedureNoteStatus === "Complete" ? "green" : "amber")}>
                    Proc: {activeRow.procedureNoteStatus}
                  </span>
                  <span className={pill(`Billing: ${activeRow.billingReadiness}`, activeRow.billingReadiness === "Ready" ? "green" : activeRow.billingReadiness === "Blocked" ? "rose" : "amber")}>
                    Billing: {activeRow.billingReadiness}
                  </span>
                </div>

                <Separator />

                {/* Notes */}
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Notes</div>
                  <p className="text-sm text-slate-700">{activeRow.notes}</p>
                </div>

                {/* Timeline */}
                <div>
                  <div className="text-[11px] text-slate-500 mb-2">Timeline</div>
                  <div className="space-y-2">
                    {activeRow.timeline.map((t, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm" data-testid={`timeline-${activeRow.id}-${i}`}>
                        <Clock className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                        <div>
                          <div className="text-slate-700">{t.label}</div>
                          <div className="text-[11px] text-slate-400">{t.time}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Action buttons */}
                <div className="grid grid-cols-1 gap-2">
                  {workbenchActions
                    .filter((a) => !a.ultrasoundOnly || activeRow.imagingType === "Ultrasound")
                    .map((a) => (
                      <Button
                        key={a.label}
                        variant="outline"
                        size="default"
                        className="justify-start"
                        onClick={() =>
                          fireToast(a.label, `${a.label} for ${activeRow.patientName} (${activeRow.ultrasoundType}).`)
                        }
                        data-testid={`button-${a.label.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <a.Icon className="w-4 h-4 mr-2" /> {a.label}
                      </Button>
                    ))}
                </div>

                <div className="pt-2">
                  <Link
                    href="/billing"
                    className="text-xs text-cyan-700 hover:underline"
                    data-testid="link-billing"
                  >
                    Open Billing →
                  </Link>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
