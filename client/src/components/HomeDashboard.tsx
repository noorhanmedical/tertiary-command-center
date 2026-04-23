import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { PageHeader } from "@/components/PageHeader";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  FolderOpen,
  Phone,
  Plus,
  Radio,
  Stethoscope,
  Upload,
  Users,
  Users2,
  CheckSquare,
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
  if (iso === today) return `Today — ${label}`;
  return label;
}

function firstName(full: string): string {
  const trimmed = full.trim();
  if (!trimmed) return full;
  if (trimmed.includes(",")) {
    const after = trimmed.split(",")[1]?.trim();
    if (after) {
      const firstAfter = after.split(/\s+/)[0];
      if (firstAfter) return firstAfter;
    }
  }
  const first = trimmed.split(/\s+/)[0];
  return first || full;
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
    for (const ancillary of patient.ancillaries ?? []) {
      map[ancillary] = (map[ancillary] || 0) + 1;
    }
  }
  return map;
}

function PrimaryTile({
  href,
  icon,
  label,
  testId,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  testId: string;
}) {
  return (
    <Link href={href}>
      <Card className="glass-tile glass-tile-interactive group cursor-pointer" data-testid={testId}>
        <div className="aspect-square flex flex-col items-center justify-center gap-3 p-6">
          {icon}
          <span className="text-[14px] font-semibold text-slate-900 dark:text-foreground text-center leading-tight">
            {label}
          </span>
        </div>
      </Card>
    </Link>
  );
}

function SecondaryTile({
  href,
  icon,
  label,
  testId,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  testId: string;
}) {
  return (
    <Link href={href}>
      <Card className="glass-tile glass-tile-interactive group cursor-pointer" data-testid={testId}>
        <div className="h-[122px] flex items-center gap-4 px-5">
          <div className="shrink-0">{icon}</div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-slate-900 dark:text-foreground leading-tight">
              {label}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export function HomeDashboard({
  batches,
  dashboardData,
  dashboardLoading,
  dashboardWeekOverride,
  setDashboardWeekOverride,
  dashboardClinicKey,
  setDashboardClinicKey,
  onOpenSidebar,
  onOpenSchedule,
}: HomeDashboardProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const dashboardClinicTabs = dashboardData?.clinicTabs || [];
  const activeDashboardClinic =
    dashboardClinicTabs.find((t) => t.clinicKey === dashboardClinicKey) ||
    dashboardClinicTabs[0] || null;

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

  const selectedDayAncillaryBreakdown = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const p of selectedDayPatients) {
      for (const a of p.ancillaries) map[a] = (map[a] || 0) + 1;
    }
    return map;
  }, [selectedDayPatients]);

  const selectedClinicBrainWaveCount = useMemo(
    () => countAncillaryLike(selectedDayAncillaryBreakdown, ["brainwave", "brain wave", "brain"]),
    [selectedDayAncillaryBreakdown]
  );

  const selectedClinicVitalWaveCount = useMemo(
    () => countAncillaryLike(selectedDayAncillaryBreakdown, ["vitalwave", "vital wave", "vital"]),
    [selectedDayAncillaryBreakdown]
  );

  const selectedClinicUltrasoundCount = useMemo(
    () => countAncillaryLike(selectedDayAncillaryBreakdown, ["ultrasound", "ultra sound", "us"]),
    [selectedDayAncillaryBreakdown]
  );

  const selectedClinicAncillaryCount = useMemo(
    () => Object.values(selectedDayAncillaryBreakdown).reduce((sum, count) => sum + count, 0),
    [selectedDayAncillaryBreakdown]
  );

  const clinicDaySummaries = useMemo(() => {
    return dashboardClinicTabs.map((tab) => {
      const cell = tab.monthCells.find((c) => c.isoDate === effectiveSelectedDate) || null;
      const patients = cell?.patients ?? [];
      const breakdown = buildBreakdownFromPatients(patients);
      return {
        clinicKey: tab.clinicKey,
        clinicLabel: tab.clinicLabel,
        patientCount: cell?.patientCount ?? 0,
        ancillaryCount: Object.values(breakdown).reduce((sum, count) => sum + count, 0),
        brainWaveCount: countAncillaryLike(breakdown, ["brainwave", "brain wave", "brain"]),
        vitalWaveCount: countAncillaryLike(breakdown, ["vitalwave", "vital wave", "vital"]),
        ultrasoundCount: countAncillaryLike(breakdown, ["ultrasound", "ultra sound", "us"]),
      };
    });
  }, [dashboardClinicTabs, effectiveSelectedDate]);

  const visibleLiveDashboardSites = useMemo(() => {
    const rank = (label: string) => {
      const normalized = label.toLowerCase();
      if (normalized.includes("spring")) return 0;
      if (normalized.includes("veteran")) return 1;
      if (normalized.includes("taylor")) return 2;
      return 3;
    };

    return clinicDaySummaries
      .filter((site) => {
        const normalized = site.clinicLabel.toLowerCase();
        return normalized.includes("spring") || normalized.includes("veteran") || normalized.includes("taylor");
      })
      .sort((a, b) => rank(a.clinicLabel) - rank(b.clinicLabel) || a.clinicLabel.localeCompare(b.clinicLabel));
  }, [clinicDaySummaries]);

  const nextPatientsPreview = useMemo(() => selectedDayPatients.slice(0, 4), [selectedDayPatients]);

  const clinicMonthTotals = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const tab of dashboardClinicTabs) {
      let total = 0;
      for (const cell of tab.monthCells) {
        if (cell.isoDate.slice(0, 7) === displayMonth) total += cell.patientCount;
      }
      map[tab.clinicKey] = total;
    }
    return map;
  }, [dashboardClinicTabs, displayMonth]);

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-40 bg-white/85 dark:bg-card/80 backdrop-blur-xl border-b border-slate-200/60 dark:border-border/60">
        <div className="px-8 flex items-center gap-4">
          <SidebarTrigger data-testid="button-sidebar-toggle-home" />
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-10 pb-16">
          <div className="max-w-5xl mx-auto">
            <PageHeader
              eyebrow="PLEXUS ANCILLARY · HOME"
              title="Plexus"
              subtitle="Ancillary Screening Platform"
              titleTestId="text-home-heading"
              className="mb-10"
            />

            <div className="space-y-6">
              <Card className="glass-tile" data-testid="tile-live-dashboard-row">
                <div className="p-6 lg:p-8 space-y-6">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15 flex items-center justify-center shrink-0">
                        <CalendarDays className="w-5 h-5 text-indigo-600 dark:text-indigo-300" strokeWidth={1.75} />
                      </div>
                      <div>
                        <div className="text-[20px] font-semibold text-slate-900 dark:text-foreground tracking-tight">Live Dashboard</div>
                        <p className="text-[12px] text-slate-500 dark:text-muted-foreground mt-0.5">
                          {effectiveSelectedDate ? formatDayHeader(effectiveSelectedDate, today) : "Selected day"}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                        Clinic: {activeDashboardClinic?.clinicLabel || "—"}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                        Scheduler: {activeDashboardClinic?.scheduler?.name || "—"}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                        Patients: {selectedMonthCell?.patientCount ?? 0}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">BrainWave</div>
                      <div className="mt-1 text-2xl font-semibold text-slate-900">{selectedClinicBrainWaveCount}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">VitalWave</div>
                      <div className="mt-1 text-2xl font-semibold text-slate-900">{selectedClinicVitalWaveCount}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">Ultrasound</div>
                      <div className="mt-1 text-2xl font-semibold text-slate-900">{selectedClinicUltrasoundCount}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">Total Ancillaries</div>
                      <div className="mt-1 text-2xl font-semibold text-slate-900">{selectedClinicAncillaryCount}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-3">By Site</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {visibleLiveDashboardSites.map((site) => (
                          <div key={site.clinicKey} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-slate-900">{site.clinicLabel}</div>
                              <div className="text-[11px] text-slate-500">{site.patientCount} pts</div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700">
                                BrainWave {site.brainWaveCount}
                              </span>
                              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700">
                                VitalWave {site.vitalWaveCount}
                              </span>
                              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700">
                                Ultrasound {site.ultrasoundCount}
                              </span>
                              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700">
                                Total {site.ancillaryCount}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-3">Next Patients</div>
                      {nextPatientsPreview.length === 0 ? (
                        <div className="text-sm text-slate-500">No patients on this day.</div>
                      ) : (
                        <div className="space-y-2">
                          {nextPatientsPreview.map((patient) => (
                            <button
                              type="button"
                              key={patient.id}
                              onClick={() => onOpenSchedule(patient.batchId)}
                              className="w-full text-left rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 hover-elevate active-elevate-2"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-slate-900">{patient.name || "(unnamed)"}</div>
                                  <div className="text-xs text-slate-500 mt-0.5">{formatTime12(patient.time) || "—"}</div>
                                </div>
                                <div className="flex flex-wrap gap-1 justify-end">
                                  {(patient.ancillaries ?? []).slice(0, 2).map((ancillary, idx) => (
                                    <span
                                      key={`${patient.id}-${ancillary}-${idx}`}
                                      className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700"
                                    >
                                      {ancillary}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <PrimaryTile
                  href="/patient-directory"
                  testId="tile-patient-directory"
                  label="Patient Directory"
                  icon={<Users className="glass-tile-icon w-14 h-14 text-indigo-900" strokeWidth={1.5} />}
                />
                <PrimaryTile
                  href="/visit-patients"
                  testId="tile-visit-patients"
                  label="Visit Patients"
                  icon={<Plus className="glass-tile-icon w-14 h-14 text-indigo-900" strokeWidth={1.5} />}
                />
                <PrimaryTile
                  href="/outreach-patients"
                  testId="tile-outreach-patients"
                  label="Outreach Patients"
                  icon={<Radio className="glass-tile-icon w-14 h-14 text-indigo-900" strokeWidth={1.5} />}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <SecondaryTile
                  href="/liaison-technician-portal"
                  testId="tile-liaison-technician-portal"
                  label="Liaison Technician Portal"
                  icon={<Stethoscope className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
                <SecondaryTile
                  href="/scheduler-portal"
                  testId="tile-scheduler-portal"
                  label="Scheduler Portal"
                  icon={<Phone className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
                <SecondaryTile
                  href="/team-ops"
                  testId="tile-team-ops"
                  label="Team Ops"
                  icon={<Users2 className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <SecondaryTile
                  href="/document-upload"
                  testId="tile-document-upload"
                  label="Document Upload"
                  icon={<Upload className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
                <SecondaryTile
                  href="/ancillary-documents"
                  testId="tile-documents"
                  label="Ancillary Documents"
                  icon={<FileText className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
                <SecondaryTile
                  href="/plexus-tasks"
                  testId="tile-plexus-tasks"
                  label="Plexus Tasks"
                  icon={<CheckSquare className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
                <SecondaryTile
                  href="/drive"
                  testId="tile-plexus-drive"
                  label="Plexus Drive"
                  icon={<FolderOpen className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
              </div>

              <Card className="glass-tile" data-testid="tile-calendar-bottom">
                <div className="p-6 lg:p-8">
                  <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15 flex items-center justify-center shrink-0">
                        <CalendarDays className="w-5 h-5 text-indigo-600 dark:text-indigo-300" strokeWidth={1.75} />
                      </div>
                      <div>
                        <span className="text-[20px] font-semibold text-slate-900 dark:text-foreground tracking-tight">Calendar</span>
                        <p className="text-[12px] text-slate-500 dark:text-muted-foreground mt-0.5">Monthly clinic calendar</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 rounded-xl border border-slate-200/80 dark:border-border bg-white/60 dark:bg-card/40 backdrop-blur px-1 py-1">
                        <button
                          type="button"
                          onClick={() => {
                            const base = dashboardWeekOverride || dashboardData?.weekStart || new Date().toISOString().slice(0, 10);
                            const [y, m] = base.split("-").map(Number);
                            const prev = new Date(y, (m || 1) - 2, 1);
                            setDashboardWeekOverride(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-01`);
                          }}
                          className="p-1.5 rounded-lg hover-elevate active-elevate-2 text-slate-600 dark:text-muted-foreground"
                          data-testid="button-dashboard-prev-month"
                          aria-label="Previous month"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-sm font-semibold text-slate-800 dark:text-foreground w-32 text-center tabular-nums" data-testid="text-dashboard-month-label">
                          {dashboardData?.weekStart
                            ? new Date(dashboardData.weekStart + "T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" })
                            : "—"}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const base = dashboardWeekOverride || dashboardData?.weekStart || new Date().toISOString().slice(0, 10);
                            const [y, m] = base.split("-").map(Number);
                            const next = new Date(y, (m || 1), 1);
                            setDashboardWeekOverride(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`);
                          }}
                          className="p-1.5 rounded-lg hover-elevate active-elevate-2 text-slate-600 dark:text-muted-foreground"
                          data-testid="button-dashboard-next-month"
                          aria-label="Next month"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>

                      <Link href="/dashboard">
                        <span className="text-xs text-indigo-700 dark:text-indigo-300 font-medium hover:underline cursor-pointer shrink-0 px-2" data-testid="link-view-full-schedule">Full Dashboard →</span>
                      </Link>
                    </div>
                  </div>

                  {dashboardClinicTabs.length > 0 && (
                    <div className="mb-5 -mx-1 overflow-x-auto" data-testid="dashboard-clinic-tabs">
                      <div className="inline-flex items-center gap-1 rounded-2xl bg-slate-100/80 dark:bg-muted/40 p-1 min-w-full">
                        {dashboardClinicTabs.map((tab) => {
                          const isActive = activeDashboardClinic?.clinicKey === tab.clinicKey;
                          const count = clinicMonthTotals[tab.clinicKey] ?? 0;
                          return (
                            <button
                              key={tab.clinicKey}
                              type="button"
                              onClick={() => setDashboardClinicKey(tab.clinicKey)}
                              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium whitespace-nowrap transition-all ${
                                isActive
                                  ? "bg-white dark:bg-card text-indigo-700 dark:text-indigo-300 shadow-sm ring-1 ring-indigo-200/70 dark:ring-indigo-500/20"
                                  : "text-slate-600 dark:text-muted-foreground hover:text-slate-900 dark:hover:text-foreground"
                              }`}
                              data-testid={`button-dashboard-clinic-${tab.clinicKey}`}
                              aria-pressed={isActive}
                            >
                              <span>{tab.clinicLabel}</span>
                              {count > 0 && (
                                <span
                                  className={`inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full text-[10px] font-semibold tabular-nums ${
                                    isActive
                                      ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200"
                                      : "bg-slate-200/80 text-slate-600 dark:bg-muted dark:text-muted-foreground"
                                  }`}
                                  data-testid={`badge-clinic-count-${tab.clinicKey}`}
                                >
                                  {count}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {dashboardLoading ? (
                    <div className="overflow-x-auto">
                      <div className="min-w-[760px]">
                        <div className="grid grid-cols-7 mb-2">
                          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                            <div key={d} className="text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-muted-foreground py-2">{d}</div>
                          ))}
                        </div>
                        <div className="grid grid-cols-7 gap-1.5">
                          {[...Array(42)].map((_, i) => (
                            <div key={i} className="h-32 bg-slate-100 dark:bg-muted/40 rounded-2xl animate-pulse" />
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : !activeDashboardClinic ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 dark:border-border bg-slate-50/60 dark:bg-muted/20 py-16 text-center text-sm text-slate-400 dark:text-muted-foreground mb-4">
                      No schedule data — create a schedule to get started
                    </div>
                  ) : (
                    <div className="overflow-x-auto -mx-1 px-1">
                      <div className="min-w-[760px]">
                        <div className="grid grid-cols-7 mb-2">
                          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                            <div key={d} className="text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-muted-foreground py-2">{d}</div>
                          ))}
                        </div>

                        <div className="grid grid-cols-7 gap-1.5 mb-6">
                          {activeDashboardClinic.monthCells.map((cell) => {
                            const isToday = cell.isoDate === dashboardData?.today;
                            const isSelected = cell.isoDate === effectiveSelectedDate;
                            const cellMonth = cell.isoDate.slice(0, 7);
                            const isCurrentMonth = cellMonth === displayMonth;
                            const dayNum = parseInt(cell.isoDate.split("-")[2], 10);
                            const previewPatients = (cell.patients ?? []).slice(0, 2);
                            const moreCount = Math.max(0, (cell.patients?.length ?? cell.patientCount) - previewPatients.length);

                            const baseStyle = isToday
                              ? "bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-500/15 dark:to-violet-500/15 border-2 border-indigo-400 dark:border-indigo-400/60 shadow-sm"
                              : isSelected
                                ? "bg-white dark:bg-card border-2 border-indigo-300 dark:border-indigo-500/40 shadow-sm"
                                : isCurrentMonth
                                  ? "bg-white dark:bg-card/60 border border-slate-200/70 dark:border-border hover:border-indigo-200 dark:hover:border-indigo-500/40 hover:bg-indigo-50/30 dark:hover:bg-indigo-500/5"
                                  : "bg-slate-50/40 dark:bg-muted/20 border border-transparent hover:bg-slate-100/60 dark:hover:bg-muted/30";

                            return (
                              <button
                                type="button"
                                key={cell.isoDate}
                                onClick={() => setSelectedDate(cell.isoDate)}
                                className={`group text-left rounded-2xl p-2.5 min-h-[120px] flex flex-col transition-all cursor-pointer ${baseStyle}`}
                                data-testid={`dashboard-month-cell-${cell.isoDate}`}
                                aria-pressed={isSelected}
                              >
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className={`inline-flex items-center justify-center min-w-[1.75rem] h-7 px-1.5 rounded-full text-sm font-semibold tabular-nums ${
                                    isToday
                                      ? "bg-violet-600 text-white shadow"
                                      : isCurrentMonth
                                        ? "text-slate-900 dark:text-foreground"
                                        : "text-slate-300 dark:text-muted-foreground/50"
                                  }`}>{dayNum}</span>
                                  {cell.patientCount > 0 && (
                                    <div className="flex items-center gap-1">
                                      {cell.ancillaryCount > 0 && (
                                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200 tabular-nums">
                                          {cell.ancillaryCount}<span className="font-normal opacity-70 ml-0.5">anc</span>
                                        </span>
                                      )}
                                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200 tabular-nums">
                                        {cell.patientCount}<span className="font-normal opacity-70 ml-0.5">pt</span>
                                      </span>
                                    </div>
                                  )}
                                </div>

                                {previewPatients.length > 0 && (
                                  <div className="flex flex-col gap-0.5 mt-0.5 overflow-hidden">
                                    {previewPatients.map((p) => (
                                      <span
                                        key={p.id}
                                        className={`text-[11px] leading-tight truncate ${
                                          isCurrentMonth
                                            ? "text-slate-700 dark:text-foreground/90"
                                            : "text-slate-400 dark:text-muted-foreground/60"
                                        }`}
                                        data-testid={`text-cell-patient-${p.id}`}
                                      >
                                        {p.time && (
                                          <span className="text-slate-400 dark:text-muted-foreground/70 mr-1 tabular-nums">
                                            {formatTime12(p.time).replace(/ (AM|PM)$/i, "")}
                                          </span>
                                        )}
                                        {firstName(p.name) || "(unnamed)"}
                                      </span>
                                    ))}
                                    {moreCount > 0 && (
                                      <span className="text-[10px] font-medium text-indigo-600 dark:text-indigo-300 mt-0.5">
                                        +{moreCount} more
                                      </span>
                                    )}
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="border-t border-slate-200/70 dark:border-border pt-5 mt-2" data-testid="panel-day-detail">
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                      <div className="flex items-baseline gap-3 flex-wrap">
                        <h3 className="text-base font-semibold text-slate-900 dark:text-foreground tracking-tight" data-testid="text-day-detail-header">
                          {effectiveSelectedDate ? formatDayHeader(effectiveSelectedDate, today) : "Selected Day"}
                        </h3>
                        {activeDashboardClinic && (
                          <span className="text-xs text-slate-500 dark:text-muted-foreground">
                            {activeDashboardClinic.clinicLabel}
                            {activeDashboardClinic.scheduler && (
                              <span className="ml-1.5 text-slate-400 dark:text-muted-foreground/70">· {activeDashboardClinic.scheduler.name}</span>
                            )}
                          </span>
                        )}
                      </div>

                      {Object.keys(selectedDayAncillaryBreakdown).length > 0 && (
                        <div className="flex flex-wrap gap-1.5" data-testid="day-ancillary-breakdown">
                          {Object.entries(selectedDayAncillaryBreakdown).map(([test, n]) => (
                            <span key={test} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200 ring-1 ring-violet-100 dark:ring-violet-500/20">
                              {test} <span className="text-violet-500 dark:text-violet-300 ml-0.5">×{n}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {selectedDayPatients.length === 0 ? (
                      <div className="py-10 text-center text-sm text-slate-400 dark:text-muted-foreground rounded-xl border border-dashed border-slate-200/70 dark:border-border" data-testid="text-day-empty">
                        No patients scheduled for this day.
                      </div>
                    ) : (
                      <div className="grid sm:grid-cols-2 gap-2" data-testid="list-day-patients">
                        {selectedDayPatients.map((p) => (
                          <button
                            type="button"
                            key={p.id}
                            onClick={() => onOpenSchedule(p.batchId)}
                            className="text-left flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-white dark:bg-card border border-slate-200/70 dark:border-border hover-elevate active-elevate-2 cursor-pointer transition-colors"
                            data-testid={`button-day-patient-${p.id}`}
                          >
                            <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 w-16 shrink-0 tabular-nums">
                              {formatTime12(p.time) || "—"}
                            </span>
                            <span className="text-sm font-medium text-slate-800 dark:text-foreground flex-1 truncate" data-testid={`text-day-patient-name-${p.id}`}>{p.name || "(unnamed)"}</span>
                            {p.ancillaries.length > 0 && (
                              <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[55%]">
                                {p.ancillaries.map((a, i) => (
                                  <span key={`${p.id}-${a}-${i}`} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200">
                                    {a}
                                  </span>
                                ))}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {batches.length > 0 && (
            <div className="max-w-5xl mx-auto mt-10">
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenSidebar}
                className="gap-2 text-sm"
                data-testid="button-view-history"
              >
                <Clock className="w-4 h-4" />
                Schedule History ({batches.length})
              </Button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
