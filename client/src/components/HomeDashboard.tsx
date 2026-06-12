import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, FileText, FolderOpen, Phone, Sparkles, Stethoscope, Upload, Users, Users2, CheckSquare } from "lucide-react";

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
  for (const patient of patients) for (const ancillary of patient.ancillaries ?? []) map[ancillary] = (map[ancillary] || 0) + 1;
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
  return <span className={`inline-flex items-center border px-2 py-1 text-[11px] font-black uppercase tracking-[0.08em] rounded-none ${tones[tone]}`}>{children}</span>;
}
function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div className="rounded-none border border-slate-200 bg-slate-50 px-4 py-3"><div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div><div className="mt-2 text-[28px] font-black leading-none tracking-[-0.06em] text-slate-950">{value}</div>{note && <div className="mt-1 text-[11px] font-medium text-slate-500">{note}</div>}</div>;
}
function SecondaryTile({ href, icon, label, testId }: { href: string; icon: ReactNode; label: string; testId: string }) {
  return <Link href={href}><Card className="group h-full cursor-pointer rounded-none border border-slate-200 bg-white shadow-[0_16px_42px_rgba(15,23,42,0.055)] transition-colors hover:border-slate-400" data-testid={testId}><div className="flex h-[96px] items-center gap-3 px-4"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-none bg-slate-100 text-slate-950">{icon}</div><div className="min-w-0 text-[13px] font-black leading-tight tracking-[-0.02em] text-slate-950">{label}</div></div></Card></Link>;
}

function MonthControls({ dashboardWeekOverride, dashboardData, setDashboardWeekOverride }: { dashboardWeekOverride: string | null; dashboardData: ScheduleDashboardResponse | undefined; setDashboardWeekOverride: (v: string | null) => void }) {
  const shift = (delta: number) => {
    const base = dashboardWeekOverride || dashboardData?.weekStart || new Date().toISOString().slice(0, 10);
    const [y, m] = base.split("-").map(Number);
    const d = new Date(y, (m || 1) - 1 + delta, 1);
    setDashboardWeekOverride(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
  };
  return <div className="flex items-center rounded-none border border-slate-200 bg-white"><button type="button" onClick={() => shift(-1)} className="rounded-none p-2 text-slate-600 hover:bg-slate-100" data-testid="button-dashboard-prev-month" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button><span className="w-36 border-x border-slate-200 px-3 text-center text-sm font-black tabular-nums text-slate-900" data-testid="text-dashboard-month-label">{dashboardData?.weekStart ? new Date(dashboardData.weekStart + "T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "—"}</span><button type="button" onClick={() => shift(1)} className="rounded-none p-2 text-slate-600 hover:bg-slate-100" data-testid="button-dashboard-next-month" aria-label="Next month"><ChevronRight className="h-4 w-4" /></button></div>;
}

export function HomeDashboard({ batches, dashboardData, dashboardLoading, dashboardWeekOverride, setDashboardWeekOverride, dashboardClinicKey, setDashboardClinicKey, onOpenSidebar, onOpenSchedule }: HomeDashboardProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const dashboardClinicTabs = dashboardData?.clinicTabs || [];
  const activeDashboardClinic = dashboardClinicTabs.find((t) => t.clinicKey === dashboardClinicKey) || dashboardClinicTabs[0] || null;
  const today = dashboardData?.today ?? "";
  const effectiveSelectedDate = selectedDate ?? today;
  const displayMonth = dashboardData?.weekStart?.slice(0, 7);

  useEffect(() => { if (!selectedDate && today) setSelectedDate(today); }, [today, selectedDate]);

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

  const clinicDaySummaries = useMemo(() => dashboardClinicTabs.map((tab) => {
    const cell = tab.monthCells.find((c) => c.isoDate === effectiveSelectedDate) || null;
    const patients = cell?.patients ?? [];
    const breakdown = buildBreakdownFromPatients(patients);
    return { clinicKey: tab.clinicKey, clinicLabel: tab.clinicLabel, patientCount: cell?.patientCount ?? 0, ancillaryCount: Object.values(breakdown).reduce((sum, count) => sum + count, 0), brainWaveCount: countAncillaryLike(breakdown, ["brainwave", "brain wave", "brain"]), vitalWaveCount: countAncillaryLike(breakdown, ["vitalwave", "vital wave", "vital"]), ultrasoundCount: countAncillaryLike(breakdown, ["ultrasound", "ultra sound", "us"]) };
  }), [dashboardClinicTabs, effectiveSelectedDate]);

  const visibleLiveDashboardSites = useMemo(() => {
    const rank = (label: string) => label.toLowerCase().includes("spring") ? 0 : label.toLowerCase().includes("veteran") ? 1 : label.toLowerCase().includes("taylor") ? 2 : 3;
    const preferred = clinicDaySummaries.filter((site) => /spring|veteran|taylor/i.test(site.clinicLabel)).sort((a, b) => rank(a.clinicLabel) - rank(b.clinicLabel) || a.clinicLabel.localeCompare(b.clinicLabel));
    return preferred.length > 0 ? preferred : clinicDaySummaries.slice(0, 3);
  }, [clinicDaySummaries]);

  const nextPatientsPreview = useMemo(() => selectedDayPatients.slice(0, 4), [selectedDayPatients]);
  const clinicMonthTotals = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const tab of dashboardClinicTabs) map[tab.clinicKey] = tab.monthCells.reduce((sum, cell) => sum + (cell.isoDate.slice(0, 7) === displayMonth ? cell.patientCount : 0), 0);
    return map;
  }, [dashboardClinicTabs, displayMonth]);
  const selectedPatientsCount = selectedMonthCell?.patientCount ?? 0;

  return <div className="flex h-full flex-col bg-[#EEF1F6]">
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-[#101115] text-white"><div className="flex h-16 items-center justify-between px-6 lg:px-8"><div className="flex items-center gap-4"><SidebarTrigger data-testid="button-sidebar-toggle-home" /><div><div className="text-sm font-black tracking-tight">Plexus</div><div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Ancillary Screening Platform</div></div></div><div className="hidden items-center gap-2 md:flex"><span className="rounded-none border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-slate-300">Global Calendar</span><span className="rounded-none border border-white bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-slate-950">Admin</span></div></div></header>
    <main className="flex-1 overflow-auto"><div className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8"><div className="space-y-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_420px]">
        <Link href="/plexus-iq"><Card className="group relative min-h-[340px] cursor-pointer overflow-hidden rounded-none border border-slate-800 bg-[linear-gradient(135deg,#0D0E12_0%,#171B26_52%,#2A3D5A_100%)] p-8 text-white shadow-[0_34px_90px_rgba(4,8,16,0.28)]" data-testid="tile-plexus-iq"><div className="pointer-events-none absolute inset-0 opacity-60" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px), radial-gradient(1px 1px at 12% 22%, rgba(255,255,255,0.85) 50%, transparent 51%), radial-gradient(1px 1px at 74% 18%, rgba(255,255,255,0.75) 50%, transparent 51%), radial-gradient(1px 1px at 86% 62%, rgba(255,255,255,0.7) 50%, transparent 51%)", backgroundSize: "56px 56px, 56px 56px, auto, auto, auto" }} aria-hidden="true" /><div className="relative z-10 flex h-full min-h-[276px] flex-col justify-between"><div><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-none border border-white/15 bg-white/10"><Sparkles className="h-5 w-5 text-white" strokeWidth={1.75} /></div><span className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">Primary System</span></div><h1 className="mt-8 text-[52px] font-black leading-[0.9] tracking-[-0.08em] text-white sm:text-[70px]" data-testid="text-home-heading">Plexus Clinical</h1><p className="mt-5 max-w-2xl text-[15px] leading-6 text-slate-300">Qualification engine for Batch Flow, Visit, Outreach, Admin Review, packets, and patient progression.</p></div><div className="flex flex-wrap gap-2"><span className="rounded-none border border-white bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-950">Open Plexus IQ</span><span className="rounded-none border border-white/20 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-white">Run Status</span></div></div></Card></Link>
        <Card className="rounded-none border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.055)]"><div className="flex items-start justify-between gap-3"><div><div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Today</div><div className="mt-2 text-xl font-black tracking-[-0.04em] text-slate-950">{effectiveSelectedDate ? formatDayHeader(effectiveSelectedDate, today) : "Selected day"}</div></div><Pill tone="green">Live</Pill></div><div className="mt-5 grid grid-cols-2 gap-3"><Metric label="BrainWave" value={selectedClinicBrainWaveCount} /><Metric label="VitalWave" value={selectedClinicVitalWaveCount} /><Metric label="Ultrasound" value={selectedClinicUltrasoundCount} /><Metric label="Total" value={selectedClinicAncillaryCount} /></div><div className="mt-5 grid grid-cols-3 gap-2 border-t border-slate-200 pt-4"><div><div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Patients</div><div className="mt-1 text-xl font-black text-slate-950">{selectedPatientsCount}</div></div><div><div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Clinic</div><div className="mt-1 truncate text-sm font-black text-slate-950">{activeDashboardClinic?.clinicLabel || "—"}</div></div><div><div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Scheduler</div><div className="mt-1 truncate text-sm font-black text-slate-950">{activeDashboardClinic?.scheduler?.name || "—"}</div></div></div></Card>
      </section>

      <section className="grid grid-cols-2 gap-2 rounded-none border border-slate-200 bg-white p-2 shadow-[0_18px_48px_rgba(15,23,42,0.055)] sm:grid-cols-3 lg:grid-cols-8">
        <SecondaryTile href="/team-member-portals" testId="tile-team-member-portals" label="Team Member Portals" icon={<Users2 className="h-5 w-5" strokeWidth={1.75} />} />
        <SecondaryTile href="/engagement-center" testId="tile-engagement-center" label="Outreach / Engagement Center" icon={<Phone className="h-5 w-5" strokeWidth={1.75} />} />
        <SecondaryTile href="/team-ops" testId="tile-team-ops" label="Team Ops" icon={<Stethoscope className="h-5 w-5" strokeWidth={1.75} />} />
        <SecondaryTile href="/patient-directory" testId="tile-patient-directory" label="Patient Directory" icon={<Users className="h-5 w-5" strokeWidth={1.75} />} />
        <SecondaryTile href="/document-upload" testId="tile-document-upload" label="Document Upload" icon={<Upload className="h-5 w-5" strokeWidth={1.75} />} />
        <SecondaryTile href="/ancillary-documents" testId="tile-documents" label="Ancillary Documents" icon={<FileText className="h-5 w-5" strokeWidth={1.75} />} />
        <SecondaryTile href="/plexus-tasks" testId="tile-plexus-tasks" label="Plexus Tasks" icon={<CheckSquare className="h-5 w-5" strokeWidth={1.75} />} />
        <SecondaryTile href="/drive" testId="tile-plexus-drive" label="Plexus Drive" icon={<FolderOpen className="h-5 w-5" strokeWidth={1.75} />} />
      </section>

      <Card className="rounded-none border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.055)]" data-testid="tile-live-dashboard-row"><div className="border-b border-slate-200 px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-lg font-black tracking-[-0.04em] text-slate-950">Live Dashboard</div><div className="mt-1 text-xs font-medium text-slate-500">Current operating state</div></div><Pill tone="dark">Full Row</Pill></div></div><div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Patients" value={selectedPatientsCount} note="selected day" /><Metric label="BrainWave" value={selectedClinicBrainWaveCount} /><Metric label="VitalWave" value={selectedClinicVitalWaveCount} /><Metric label="Ultrasound" value={selectedClinicUltrasoundCount} /><Metric label="Ancillaries" value={selectedClinicAncillaryCount} /></div><div className="grid gap-4 border-t border-slate-200 p-5 xl:grid-cols-[1.35fr_0.8fr]"><div><div className="mb-3 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">By Site</div>{visibleLiveDashboardSites.length === 0 ? <div className="rounded-none border border-dashed border-slate-200 bg-slate-50 py-8 text-center text-sm text-slate-400">No site data.</div> : <div className="grid gap-3 md:grid-cols-3">{visibleLiveDashboardSites.map((site) => <button type="button" key={site.clinicKey} onClick={() => setDashboardClinicKey(site.clinicKey)} className={`rounded-none border p-4 text-left transition-colors ${activeDashboardClinic?.clinicKey === site.clinicKey ? "border-slate-950 bg-white" : "border-slate-200 bg-slate-50 hover:border-slate-400"}`}><div className="flex items-center justify-between gap-2"><div className="truncate text-sm font-black text-slate-950">{site.clinicLabel}</div><span className="text-xs font-black tabular-nums text-slate-500">{site.patientCount} pts</span></div><div className="mt-3 flex flex-wrap gap-1.5"><Pill tone="blue">BrainWave {site.brainWaveCount}</Pill><Pill tone="red">VitalWave {site.vitalWaveCount}</Pill><Pill tone="green">Ultrasound {site.ultrasoundCount}</Pill></div></button>)}</div>}</div><div><div className="mb-3 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Next Patients</div>{nextPatientsPreview.length === 0 ? <div className="rounded-none border border-dashed border-slate-200 bg-slate-50 py-8 text-center text-sm text-slate-400">No patients.</div> : <div className="space-y-2">{nextPatientsPreview.map((patient) => <button type="button" key={patient.id} onClick={() => onOpenSchedule(patient.batchId)} className="grid w-full grid-cols-[72px_1fr] gap-3 rounded-none border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition-colors hover:border-slate-400 hover:bg-white"><span className="text-xs font-black tabular-nums text-blue-800">{formatTime12(patient.time) || "—"}</span><span className="min-w-0"><span className="block truncate text-sm font-black text-slate-900">{patient.name || "(unnamed)"}</span>{patient.ancillaries.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{patient.ancillaries.slice(0, 2).map((ancillary, idx) => <span key={`${patient.id}-${ancillary}-${idx}`} className="rounded-none border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-black text-slate-600">{ancillary}</span>)}</span>}</span></button>)}</div>}</div></div></Card>

      <Card className="rounded-none border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.055)]" data-testid="tile-calendar-bottom"><div className="border-b border-slate-200 px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-none bg-slate-100 text-slate-950"><CalendarDays className="h-5 w-5" strokeWidth={1.75} /></div><div><div className="text-lg font-black tracking-[-0.04em] text-slate-950">Global Calendar</div><div className="mt-1 text-xs font-medium text-slate-500">Qualification · calls · schedules · tests</div></div></div><div className="flex items-center gap-2"><MonthControls dashboardWeekOverride={dashboardWeekOverride} dashboardData={dashboardData} setDashboardWeekOverride={setDashboardWeekOverride} /><Link href="/dashboard"><span className="hidden rounded-none border border-slate-950 bg-slate-950 px-3 py-2 text-xs font-black uppercase tracking-[0.08em] text-white hover:bg-slate-800 sm:inline-flex" data-testid="link-view-full-schedule">Full Dashboard</span></Link></div></div></div><div className="p-5">{dashboardClinicTabs.length > 0 && <div className="mb-4 overflow-x-auto" data-testid="dashboard-clinic-tabs"><div className="inline-flex min-w-full items-center gap-1 rounded-none border border-slate-200 bg-slate-50 p-1">{dashboardClinicTabs.map((tab) => { const isActive = activeDashboardClinic?.clinicKey === tab.clinicKey; const count = clinicMonthTotals[tab.clinicKey] ?? 0; return <button key={tab.clinicKey} type="button" onClick={() => setDashboardClinicKey(tab.clinicKey)} className={`rounded-none px-3 py-2 text-xs font-black uppercase tracking-[0.08em] transition-colors ${isActive ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-white hover:text-slate-950"}`} data-testid={`button-dashboard-clinic-${tab.clinicKey}`} aria-pressed={isActive}><span>{tab.clinicLabel}</span>{count > 0 && <span className={`ml-2 inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded-none px-1.5 text-[10px] font-black tabular-nums ${isActive ? "bg-white text-slate-950" : "bg-slate-200 text-slate-600"}`} data-testid={`badge-clinic-count-${tab.clinicKey}`}>{count}</span>}</button>; })}</div></div>}
        {dashboardLoading ? <div className="overflow-x-auto"><div className="min-w-[760px]"><div className="mb-2 grid grid-cols-7">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2 text-center text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{d}</div>)}</div><div className="grid grid-cols-7 gap-1.5">{[...Array(42)].map((_, i) => <div key={i} className="h-28 animate-pulse rounded-none bg-slate-100" />)}</div></div></div> : !activeDashboardClinic ? <div className="rounded-none border border-dashed border-slate-200 bg-slate-50 py-16 text-center text-sm text-slate-400">No schedule data.</div> : <div className="overflow-x-auto"><div className="min-w-[760px]"><div className="mb-2 grid grid-cols-7">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2 text-center text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{d}</div>)}</div><div className="mb-5 grid grid-cols-7 gap-1.5">{activeDashboardClinic.monthCells.map((cell) => { const isToday = cell.isoDate === dashboardData?.today; const isSelected = cell.isoDate === effectiveSelectedDate; const isCurrentMonth = cell.isoDate.slice(0, 7) === displayMonth; const dayNum = parseInt(cell.isoDate.split("-")[2], 10); const previewPatients = (cell.patients ?? []).slice(0, 2); const moreCount = Math.max(0, (cell.patients?.length ?? cell.patientCount) - previewPatients.length); const baseStyle = isToday ? "border-slate-950 bg-slate-950 text-white" : isSelected ? "border-blue-800 bg-white text-slate-950 ring-2 ring-blue-800 ring-inset" : isCurrentMonth ? "border-slate-200 bg-slate-50 text-slate-950 hover:border-slate-400 hover:bg-white" : "border-transparent bg-slate-50/50 text-slate-300 hover:bg-slate-100"; return <button type="button" key={cell.isoDate} onClick={() => setSelectedDate(cell.isoDate)} className={`flex min-h-[112px] cursor-pointer flex-col rounded-none border p-2.5 text-left transition-colors ${baseStyle}`} data-testid={`dashboard-month-cell-${cell.isoDate}`} aria-pressed={isSelected}><div className="mb-2 flex items-center justify-between gap-1"><span className="text-sm font-black tabular-nums">{dayNum}</span>{cell.patientCount > 0 && <span className={`rounded-none px-1.5 py-0.5 text-[10px] font-black tabular-nums ${isToday ? "bg-white/10 text-white" : "bg-white text-blue-800"}`}>{cell.patientCount} pt</span>}</div>{previewPatients.length > 0 && <div className="mt-0.5 flex flex-col gap-0.5 overflow-hidden">{previewPatients.map((p) => <span key={p.id} className={`truncate text-[11px] leading-tight ${isToday ? "text-white/85" : isCurrentMonth ? "text-slate-700" : "text-slate-400"}`} data-testid={`text-cell-patient-${p.id}`}>{p.time && <span className="mr-1 tabular-nums opacity-70">{formatTime12(p.time).replace(/ (AM|PM)$/i, "")}</span>}{firstName(p.name) || "(unnamed)"}</span>)}{moreCount > 0 && <span className={`mt-0.5 text-[10px] font-black ${isToday ? "text-white" : "text-blue-800"}`}>+{moreCount}</span>}</div>}</button>; })}</div></div></div>}
        <div className="border-t border-slate-200 pt-5" data-testid="panel-day-detail"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-black tracking-[-0.03em] text-slate-950" data-testid="text-day-detail-header">{effectiveSelectedDate ? formatDayHeader(effectiveSelectedDate, today) : "Selected Day"}</h3>{activeDashboardClinic && <div className="mt-1 text-xs font-medium text-slate-500">{activeDashboardClinic.clinicLabel}{activeDashboardClinic.scheduler && <span className="ml-1.5 text-slate-400">· {activeDashboardClinic.scheduler.name}</span>}</div>}</div>{Object.keys(selectedDayAncillaryBreakdown).length > 0 && <div className="flex flex-wrap gap-1.5" data-testid="day-ancillary-breakdown">{Object.entries(selectedDayAncillaryBreakdown).map(([test, n]) => <Pill key={test}>{test} ×{n}</Pill>)}</div>}</div>{selectedDayPatients.length === 0 ? <div className="rounded-none border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400" data-testid="text-day-empty">No patients scheduled.</div> : <div className="grid gap-2 sm:grid-cols-2" data-testid="list-day-patients">{selectedDayPatients.map((p) => <button type="button" key={p.id} onClick={() => onOpenSchedule(p.batchId)} className="grid grid-cols-[72px_1fr] items-center gap-3 rounded-none border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-left transition-colors hover:border-slate-400 hover:bg-white" data-testid={`button-day-patient-${p.id}`}><span className="text-xs font-black tabular-nums text-blue-800">{formatTime12(p.time) || "—"}</span><span className="min-w-0"><span className="block truncate text-sm font-black text-slate-900" data-testid={`text-day-patient-name-${p.id}`}>{p.name || "(unnamed)"}</span>{p.ancillaries.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{p.ancillaries.slice(0, 3).map((a, i) => <span key={`${p.id}-${a}-${i}`} className="rounded-none bg-white px-1.5 py-0.5 text-[10px] font-black text-emerald-700 ring-1 ring-emerald-100">{a}</span>)}</span>}</span></button>)}</div>}</div></div></Card>
    </div>
    {batches.length > 0 && <div className="mt-8"><Button variant="outline" size="sm" onClick={onOpenSidebar} className="gap-2 rounded-none text-sm" data-testid="button-view-history"><Clock className="h-4 w-4" />Schedule History ({batches.length})</Button></div>}
    </div></main>
  </div>;
}
