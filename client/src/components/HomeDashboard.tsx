import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  FolderOpen,
  Phone,
  Sparkles,
  Stethoscope,
  Upload,
  Users,
  Users2,
} from "lucide-react";

type DayPatient = { id: number; batchId: number; name: string; time: string | null; ancillaries: string[] };
type ClinicMonthCell = { isoDate: string; patientCount: number; ancillaryCount: number; patients?: DayPatient[] };
type ClinicTab = {
  clinicKey: string;
  clinicLabel: string;
  scheduler: { id: string; name: string; initials: string } | null;
  weekDays: { isoDate: string; patientCount: number; ancillaryCount: number; ancillaryBreakdown: Record<string, number>; providerNames: string[] }[];
  monthCells: ClinicMonthCell[];
};
export type ScheduleDashboardResponse = {
  today: string;
  weekStart: string;
  previousWeekStart: string;
  nextWeekStart: string;
  clinicTabs: ClinicTab[];
};

interface HomeDashboardProps {
  batches: { id: number }[];
  dashboardData: ScheduleDashboardResponse | undefined;
  dashboardLoading: boolean;
  dashboardWeekOverride: string | null;
  setDashboardWeekOverride: (v: string | null) => void;
  dashboardClinicKey: string | null;
  setDashboardClinicKey: (v: string | null) => void;
  onOpenSidebar: () => void;
  onOpenSchedule: (batchId: number) => void;
}

function formatTime12(time24: string | null): string {
  if (!time24) return "";
  const [h, m] = time24.split(":").map(Number);
  if (Number.isNaN(h)) return time24;
  return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function formatDayHeader(iso: string, today: string): string {
  const d = new Date(iso + "T00:00:00");
  const label = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return iso === today ? `Today — ${label}` : label;
}

function firstName(full: string): string {
  const trimmed = full.trim();
  if (!trimmed) return full;
  const afterComma = trimmed.includes(",") ? trimmed.split(",")[1]?.trim().split(/\s+/)[0] : "";
  return afterComma || trimmed.split(/\s+/)[0] || full;
}

function countAncillaryLike(breakdown: Record<string, number>, patterns: string[]) {
  return Object.entries(breakdown).reduce((sum, [name, count]) => {
    const normalized = name.toLowerCase();
    return patterns.some((pattern) => normalized.includes(pattern)) ? sum + count : sum;
  }, 0);
}

function buildBreakdownFromPatients(patients: DayPatient[]) {
  const map: Record<string, number> = {};
  for (const patient of patients) {
    for (const ancillary of patient.ancillaries ?? []) map[ancillary] = (map[ancillary] || 0) + 1;
  }
  return map;
}

function Pill({ children, tone = "steel" }: { children: ReactNode; tone?: "steel" | "dark" | "blue" | "green" | "amber" | "red" }) {
  const tones = {
    steel: "border-slate-200 bg-slate-100 text-slate-700",
    dark: "border-slate-950 bg-slate-950 text-white",
    blue: "border-blue-100 bg-blue-50 text-blue-800",
    green: "border-emerald-100 bg-emerald-50 text-emerald-800",
    amber: "border-amber-100 bg-amber-50 text-amber-800",
    red: "border-rose-100 bg-rose-50 text-rose-800",
  };
  return <span className={`inline-flex items-center rounded-sm border px-2 py-1 text-[11px] font-normal uppercase tracking-[0.07em] ${tones[tone]}`}>{children}</span>;
}

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-[10px] font-normal uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-2 text-[26px] font-light leading-none tracking-[-0.035em] text-slate-950">{value}</div>
      {note && <div className="mt-1 text-[11px] font-light text-slate-500">{note}</div>}
    </div>
  );
}

function SecondaryTile({ href, icon, label, testId, dark = false }: { href: string; icon: ReactNode; label: string; testId: string; dark?: boolean }) {
  return (
    <Link href={href}>
      <Card
        className={`group h-full min-h-[112px] cursor-pointer rounded-md border shadow-[0_16px_42px_rgba(15,23,42,0.055)] transition-colors ${dark ? "border-slate-950 bg-slate-950 text-white hover:bg-slate-900" : "border-slate-200 bg-white hover:border-slate-400"}`}
        data-testid={testId}
      >
        <div className="flex h-full min-h-[112px] flex-col justify-between gap-4 px-4 py-4">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-sm ${dark ? "bg-white/10 text-white" : "bg-slate-100 text-slate-950"}`}>{icon}</div>
          <div className={`min-w-0 whitespace-normal break-words text-[12px] font-light leading-[1.18] tracking-[-0.01em] ${dark ? "text-white" : "text-slate-950"}`}>{label}</div>
        </div>
      </Card>
    </Link>
  );
}

function MonthControls({ dashboardWeekOverride, dashboardData, setDashboardWeekOverride }: { dashboardWeekOverride: string | null; dashboardData: ScheduleDashboardResponse | undefined; setDashboardWeekOverride: (v: string | null) => void }) {
  const shift = (delta: number) => {
    const base = dashboardWeekOverride || dashboardData?.weekStart || new Date().toISOString().slice(0, 10);
    const [y, m] = base.split("-").map(Number);
    const next = new Date(y, (m || 1) - 1 + delta, 1);
    setDashboardWeekOverride(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`);
  };

  return (
    <div className="flex items-center rounded-md border border-slate-200 bg-white">
      <button type="button" onClick={() => shift(-1)} className="rounded-l-md p-2 text-slate-600 hover:bg-slate-100" data-testid="button-dashboard-prev-month" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
      <span className="w-36 border-x border-slate-200 px-3 text-center text-sm font-light tabular-nums text-slate-900" data-testid="text-dashboard-month-label">
        {dashboardData?.weekStart ? new Date(dashboardData.weekStart + "T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "—"}
      </span>
      <button type="button" onClick={() => shift(1)} className="rounded-r-md p-2 text-slate-600 hover:bg-slate-100" data-testid="button-dashboard-next-month" aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
    </div>
  );
}

export function HomeDashboard({ batches, dashboardData, dashboardLoading, dashboardWeekOverride, setDashboardWeekOverride, dashboardClinicKey, setDashboardClinicKey, onOpenSidebar, onOpenSchedule }: HomeDashboardProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const dashboardClinicTabs = dashboardData?.clinicTabs || [];
  const activeDashboardClinic = dashboardClinicTabs.find((t) => t.clinicKey === dashboardClinicKey) || dashboardClinicTabs[0] || null;
  const today = dashboardData?.today ?? "";
  const effectiveSelectedDate = selectedDate ?? today;
  const displayMonth = dashboardData?.weekStart?.slice(0, 7);

  useEffect(() => {
    if (!selectedDate && today) setSelectedDate(today);
  }, [today, selectedDate]);

  const selectedMonthCell = useMemo<ClinicMonthCell | null>(() => {
    if (!effectiveSelectedDate || !activeDashboardClinic) return null;
    return activeDashboardClinic.monthCells.find((c) => c.isoDate === effectiveSelectedDate) || null;
  }, [effectiveSelectedDate, activeDashboardClinic]);

  const selectedDayPatients = useMemo<DayPatient[]>(() => selectedMonthCell?.patients ?? [], [selectedMonthCell]);
  const selectedDayAncillaryBreakdown = useMemo<Record<string, number>>(() => buildBreakdownFromPatients(selectedDayPatients), [selectedDayPatients]);
  const selectedClinicBrainWaveCount = useMemo(() => countAncillaryLike(selectedDayAncillaryBreakdown, ["brainwave", "brain wave", "brain"]), [selectedDayAncillaryBreakdown]);
  const selectedClinicVitalWaveCount = useMemo(() => countAncillaryLike(selectedDayAncillaryBreakdown, ["vitalwave", "vital wave", "vital"]), [selectedDayAncillaryBreakdown]);
  const selectedClinicUltrasoundCount = useMemo(() => countAncillaryLike(selectedDayAncillaryBreakdown, ["ultrasound", "ultra sound", "us"]), [selectedDayAncillaryBreakdown]);
  const selectedClinicAncillaryCount = useMemo(() => Object.values(selectedDayAncillaryBreakdown).reduce((sum, count) => sum + count, 0), [selectedDayAncillaryBreakdown]);
  const selectedPatientsCount = selectedMonthCell?.patientCount ?? 0;

  const clinicMonthTotals = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const tab of dashboardClinicTabs) {
      map[tab.clinicKey] = tab.monthCells.reduce((sum, cell) => sum + (cell.isoDate.slice(0, 7) === displayMonth ? cell.patientCount : 0), 0);
    }
    return map;
  }, [dashboardClinicTabs, displayMonth]);

  return (
    <div className="flex h-full flex-col bg-[#EEF1F6]">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-[#101115] text-white">
        <div className="flex h-16 items-center px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <SidebarTrigger data-testid="button-sidebar-toggle-home" />
            <div>
              <div className="text-sm font-light tracking-tight">Plexus</div>
              <div className="text-[10px] font-light uppercase tracking-[0.18em] text-slate-400">Ancillary Screening Platform</div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          <div className="space-y-4">
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_420px]">
              <Card className="relative min-h-[320px] overflow-hidden rounded-md border border-slate-800 bg-[linear-gradient(135deg,#0D0E12_0%,#171B26_52%,#2A3D5A_100%)] p-8 text-white shadow-[0_34px_90px_rgba(4,8,16,0.28)]">
                <div className="pointer-events-none absolute inset-0 opacity-60" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px), radial-gradient(1px 1px at 12% 22%, rgba(255,255,255,0.85) 50%, transparent 51%), radial-gradient(1px 1px at 74% 18%, rgba(255,255,255,0.75) 50%, transparent 51%), radial-gradient(1px 1px at 86% 62%, rgba(255,255,255,0.7) 50%, transparent 51%)", backgroundSize: "56px 56px, 56px 56px, auto, auto, auto" }} aria-hidden="true" />
                <div className="relative z-10 flex h-full min-h-[256px] flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-sm border border-white/15 bg-white/10"><Sparkles className="h-5 w-5 text-white" strokeWidth={1.75} /></div><span className="text-[11px] font-light uppercase tracking-[0.18em] text-slate-300">Primary System</span></div>
                    <h1 className="mt-8 text-[52px] font-light leading-[0.95] tracking-[-0.045em] text-white sm:text-[70px]" data-testid="text-home-heading">Plexus Clinical</h1>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => document.getElementById("live-command-row")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="rounded-sm border border-white bg-white px-4 py-2 text-xs font-light uppercase tracking-[0.08em] text-slate-950">Live Command Row</button>
                    <button type="button" onClick={() => document.getElementById("global-calendar")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="rounded-sm border border-white/20 bg-white/10 px-4 py-2 text-xs font-light uppercase tracking-[0.08em] text-white">Global Calendar</button>
                  </div>
                </div>
              </Card>

              <Card className="rounded-md border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.055)]">
                <div className="flex items-start justify-between gap-3"><div><div className="text-[11px] font-light uppercase tracking-[0.14em] text-slate-500">Today</div><div className="mt-2 text-xl font-light tracking-[-0.02em] text-slate-950">{effectiveSelectedDate ? formatDayHeader(effectiveSelectedDate, today) : "Selected day"}</div></div><Pill tone="green">Live</Pill></div>
                <div className="mt-5 grid grid-cols-2 gap-3"><Metric label="BrainWave" value={selectedClinicBrainWaveCount} /><Metric label="VitalWave" value={selectedClinicVitalWaveCount} /><Metric label="Ultrasound" value={selectedClinicUltrasoundCount} /><Metric label="Total" value={selectedClinicAncillaryCount} /></div>
                <div className="mt-5 grid grid-cols-3 gap-2 border-t border-slate-200 pt-4"><div><div className="text-[10px] font-light uppercase tracking-[0.1em] text-slate-500">Patients</div><div className="mt-1 text-xl font-light text-slate-950">{selectedPatientsCount}</div></div><div><div className="text-[10px] font-light uppercase tracking-[0.1em] text-slate-500">Clinic</div><div className="mt-1 truncate text-sm font-light text-slate-950">{activeDashboardClinic?.clinicLabel || "—"}</div></div><div><div className="text-[10px] font-light uppercase tracking-[0.1em] text-slate-500">Scheduler</div><div className="mt-1 truncate text-sm font-light text-slate-950">{activeDashboardClinic?.scheduler?.name || "—"}</div></div></div>
              </Card>
            </section>

            <section className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-white p-2 shadow-[0_18px_48px_rgba(15,23,42,0.055)] sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-9">
              <SecondaryTile href="/plexus-iq" testId="tile-plexus-iq" label="Plexus IQ" icon={<Sparkles className="h-5 w-5" strokeWidth={1.75} />} dark />
              <SecondaryTile href="/team-member-portals" testId="tile-team-member-portals" label="Team Member Portals" icon={<Users2 className="h-5 w-5" strokeWidth={1.75} />} />
              <SecondaryTile href="/engagement-center" testId="tile-engagement-center" label="Outreach / Engagement Center" icon={<Phone className="h-5 w-5" strokeWidth={1.75} />} />
              <SecondaryTile href="/team-ops" testId="tile-team-ops" label="Team Ops" icon={<Stethoscope className="h-5 w-5" strokeWidth={1.75} />} />
              <SecondaryTile href="/patient-directory" testId="tile-patient-directory" label="Patient Directory" icon={<Users className="h-5 w-5" strokeWidth={1.75} />} />
              <SecondaryTile href="/document-upload" testId="tile-document-upload" label="Document Upload" icon={<Upload className="h-5 w-5" strokeWidth={1.75} />} />
              <SecondaryTile href="/ancillary-documents" testId="tile-documents" label="Ancillary Documents" icon={<FileText className="h-5 w-5" strokeWidth={1.75} />} />
              <SecondaryTile href="/plexus-tasks" testId="tile-plexus-tasks" label="Plexus Tasks" icon={<CheckSquare className="h-5 w-5" strokeWidth={1.75} />} />
              <SecondaryTile href="/drive" testId="tile-plexus-drive" label="Plexus Drive" icon={<FolderOpen className="h-5 w-5" strokeWidth={1.75} />} />
            </section>

            <Card id="live-command-row" className="scroll-mt-20 rounded-md border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.055)]" data-testid="tile-live-dashboard-row">
              <div className="border-b border-slate-200 px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-lg font-light tracking-[-0.02em] text-slate-950">Live Command Row</div><div className="mt-1 text-xs font-light text-slate-500">Only current action signals.</div></div><Pill tone="dark">Live</Pill></div></div>
              <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Qualification" value={selectedPatientsCount} note="patients today" /><Metric label="BrainWave" value={selectedClinicBrainWaveCount} /><Metric label="VitalWave" value={selectedClinicVitalWaveCount} /><Metric label="Ultrasound" value={selectedClinicUltrasoundCount} /><Metric label="Ancillaries" value={selectedClinicAncillaryCount} /></div>
            </Card>

            <Card id="global-calendar" className="scroll-mt-20 rounded-md border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.055)]" data-testid="tile-calendar-bottom">
              <div className="border-b border-slate-200 px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-sm bg-slate-100 text-slate-950"><CalendarDays className="h-5 w-5" strokeWidth={1.75} /></div><div><div className="text-lg font-light tracking-[-0.02em] text-slate-950">Global Calendar</div><div className="mt-1 text-xs font-light text-slate-500">Qualification · calls · schedules · tests</div></div></div><div className="flex items-center gap-2"><MonthControls dashboardWeekOverride={dashboardWeekOverride} dashboardData={dashboardData} setDashboardWeekOverride={setDashboardWeekOverride} /><Link href="/dashboard"><span className="hidden rounded-sm border border-slate-950 bg-slate-950 px-3 py-2 text-xs font-light uppercase tracking-[0.07em] text-white hover:bg-slate-800 sm:inline-flex" data-testid="link-view-full-schedule">Full Dashboard</span></Link></div></div></div>
              <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                {dashboardClinicTabs.length > 0 && <div className="overflow-x-auto xl:col-span-2" data-testid="dashboard-clinic-tabs"><div className="inline-flex min-w-full items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-1">{dashboardClinicTabs.map((tab) => { const isActive = activeDashboardClinic?.clinicKey === tab.clinicKey; const count = clinicMonthTotals[tab.clinicKey] ?? 0; return <button key={tab.clinicKey} type="button" onClick={() => setDashboardClinicKey(tab.clinicKey)} className={`rounded-sm px-3 py-2 text-xs font-light uppercase tracking-[0.07em] transition-colors ${isActive ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-white hover:text-slate-950"}`} data-testid={`button-dashboard-clinic-${tab.clinicKey}`} aria-pressed={isActive}><span>{tab.clinicLabel}</span>{count > 0 && <span className={`ml-2 inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded-sm px-1.5 text-[10px] font-light tabular-nums ${isActive ? "bg-white text-slate-950" : "bg-slate-200 text-slate-600"}`} data-testid={`badge-clinic-count-${tab.clinicKey}`}>{count}</span>}</button>; })}</div></div>}
                <div>{dashboardLoading ? <div className="overflow-x-auto"><div className="min-w-[700px]"><div className="mb-2 grid grid-cols-7">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2 text-center text-[10px] font-light uppercase tracking-[0.1em] text-slate-400">{d}</div>)}</div><div className="grid grid-cols-7 gap-1.5">{[...Array(42)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-sm bg-slate-100" />)}</div></div></div> : !activeDashboardClinic ? <div className="rounded-sm border border-dashed border-slate-200 bg-slate-50 py-16 text-center text-sm font-light text-slate-400">No schedule data.</div> : <div className="overflow-x-auto"><div className="min-w-[700px]"><div className="mb-2 grid grid-cols-7">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2 text-center text-[10px] font-light uppercase tracking-[0.1em] text-slate-400">{d}</div>)}</div><div className="grid grid-cols-7 gap-1.5">{activeDashboardClinic.monthCells.map((cell) => { const isToday = cell.isoDate === dashboardData?.today; const isSelected = cell.isoDate === effectiveSelectedDate; const isCurrentMonth = cell.isoDate.slice(0, 7) === displayMonth; const dayNum = parseInt(cell.isoDate.split("-")[2], 10); const previewPatients = (cell.patients ?? []).slice(0, 1); const moreCount = Math.max(0, (cell.patients?.length ?? cell.patientCount) - previewPatients.length); const baseStyle = isToday ? "border-slate-950 bg-slate-950 text-white" : isSelected ? "border-blue-800 bg-white text-slate-950 ring-2 ring-blue-800 ring-inset" : isCurrentMonth ? "border-slate-200 bg-slate-50 text-slate-950 hover:border-slate-400 hover:bg-white" : "border-transparent bg-slate-50/50 text-slate-300 hover:bg-slate-100"; return <button type="button" key={cell.isoDate} onClick={() => setSelectedDate(cell.isoDate)} className={`flex min-h-[84px] cursor-pointer flex-col rounded-sm border p-2 text-left transition-colors ${baseStyle}`} data-testid={`dashboard-month-cell-${cell.isoDate}`} aria-pressed={isSelected}><div className="mb-1.5 flex items-center justify-between gap-1"><span className="text-sm font-light tabular-nums">{dayNum}</span>{cell.patientCount > 0 && <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-light tabular-nums ${isToday ? "bg-white/10 text-white" : "bg-white text-blue-800"}`}>{cell.patientCount}</span>}</div>{previewPatients.length > 0 && <div className="overflow-hidden">{previewPatients.map((p) => <span key={p.id} className={`block truncate text-[11px] font-light leading-tight ${isToday ? "text-white/85" : isCurrentMonth ? "text-slate-700" : "text-slate-400"}`} data-testid={`text-cell-patient-${p.id}`}>{p.time && <span className="mr-1 tabular-nums opacity-70">{formatTime12(p.time).replace(/ (AM|PM)$/i, "")}</span>}{firstName(p.name) || "(unnamed)"}</span>)}{moreCount > 0 && <span className={`text-[10px] font-light ${isToday ? "text-white" : "text-blue-800"}`}>+{moreCount}</span>}</div>}</button>; })}</div></div></div>}</div>
                <aside className="rounded-md border border-slate-200 bg-slate-50 p-4" data-testid="panel-day-detail"><div className="mb-4"><div className="text-[10px] font-light uppercase tracking-[0.12em] text-slate-500">Selected Day</div><h3 className="mt-2 text-xl font-light tracking-[-0.02em] text-slate-950" data-testid="text-day-detail-header">{effectiveSelectedDate ? formatDayHeader(effectiveSelectedDate, today) : "Selected Day"}</h3>{activeDashboardClinic && <div className="mt-1 text-xs font-light text-slate-500">{activeDashboardClinic.clinicLabel}{activeDashboardClinic.scheduler && <span className="ml-1.5 text-slate-400">· {activeDashboardClinic.scheduler.name}</span>}</div>}</div><div className="mb-4 grid grid-cols-2 gap-2"><Metric label="Patients" value={selectedPatientsCount} /><Metric label="Ancillary" value={selectedClinicAncillaryCount} /></div>{Object.keys(selectedDayAncillaryBreakdown).length > 0 && <div className="mb-4 flex flex-wrap gap-1.5" data-testid="day-ancillary-breakdown">{Object.entries(selectedDayAncillaryBreakdown).map(([test, n]) => <Pill key={test}>{test} ×{n}</Pill>)}</div>}{selectedDayPatients.length === 0 ? <div className="rounded-sm border border-dashed border-slate-200 bg-white py-10 text-center text-sm font-light text-slate-400" data-testid="text-day-empty">No patients scheduled.</div> : <div className="space-y-2" data-testid="list-day-patients">{selectedDayPatients.slice(0, 6).map((p) => <button type="button" key={p.id} onClick={() => onOpenSchedule(p.batchId)} className="grid w-full grid-cols-[68px_1fr] items-center gap-3 rounded-sm border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-slate-400" data-testid={`button-day-patient-${p.id}`}><span className="text-xs font-light tabular-nums text-blue-800">{formatTime12(p.time) || "—"}</span><span className="min-w-0"><span className="block truncate text-sm font-light text-slate-900" data-testid={`text-day-patient-name-${p.id}`}>{p.name || "(unnamed)"}</span>{p.ancillaries.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{p.ancillaries.slice(0, 2).map((a, i) => <span key={`${p.id}-${a}-${i}`} className="rounded-sm bg-slate-50 px-1.5 py-0.5 text-[10px] font-light text-emerald-700 ring-1 ring-emerald-100">{a}</span>)}</span>}</span></button>)}</div>}</aside>
              </div>
            </Card>
          </div>
          {batches.length > 0 && <div className="mt-8"><Button variant="outline" size="sm" onClick={onOpenSidebar} className="gap-2 rounded-sm text-sm font-light" data-testid="button-view-history"><Clock className="h-4 w-4" />Schedule History ({batches.length})</Button></div>}
        </div>
      </main>
    </div>
  );
}
