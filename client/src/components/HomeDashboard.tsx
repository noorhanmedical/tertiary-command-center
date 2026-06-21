import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  ChevronRight,
  Clock,
  FileText,
  FolderOpen,
  Phone,
  Radar,
  Sparkles,
  Stethoscope,
  Upload,
  Users,
  Users2,
  Waves,
  CheckSquare,
} from "lucide-react";
import { HomeLiveDashboard } from "./HomeLiveDashboard";
import { HomeWorldClocks } from "./HomeWorldClocks";
import { CanonicalMonthCalendar } from "@/calendar";
import {
  buildCommandCalendarCells,
  defaultCommandCalendarEventWindow,
  ANCILLARY_DOT_CLASS,
} from "@/lib/calendar/commandCalendarViewModel";
import type { CalendarSummaryRow } from "@/components/plexus-iq/PlexusIQCalendar";
import type { GlobalScheduleEvent } from "@shared/schema/globalSchedule";

const ANCILLARY_CATEGORY_KEYS = ["brainwave", "vitalwave", "ultrasound"] as const;

function DayPopoverContent({
  isoDate,
  rows,
  today,
  onOpenSchedule,
}: {
  isoDate: string;
  rows: CalendarSummaryRow[];
  today: string;
  onOpenSchedule: (batchId: number) => void;
}) {
  const totalPatients = rows.reduce((sum, r) => sum + r.patientCount, 0);
  return (
    <div data-testid={`home-calendar-day-popover-${isoDate}`}>
      <div className="px-4 py-3 border-b border-slate-100 dark:border-border">
        <div className="text-sm font-semibold text-slate-900 dark:text-foreground" data-testid="text-home-popover-date">
          {formatDayHeader(isoDate, today)}
        </div>
        <div className="text-[11px] text-slate-500 dark:text-muted-foreground mt-0.5">
          {totalPatients} {totalPatients === 1 ? "patient" : "patients"} ·{" "}
          {rows.length} {rows.length === 1 ? "schedule" : "schedules"}
        </div>
      </div>
      <ul className="max-h-72 overflow-auto divide-y divide-slate-100 dark:divide-border">
        {rows.map((row) => (
          <li key={row.id} className="px-4 py-2.5" data-testid={`home-popover-batch-${row.id}`}>
            <div className="flex items-start gap-2">
              <Building2 className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div
                  className="text-sm font-medium text-slate-900 dark:text-foreground truncate"
                  title={row.facility ?? row.name}
                >
                  {row.facility ?? row.name}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-muted-foreground">
                  {row.patientCount} {row.patientCount === 1 ? "patient" : "patients"}
                </div>
                {ANCILLARY_CATEGORY_KEYS.some((c) => (row.byCategory?.[c] ?? 0) > 0) && (
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                    {ANCILLARY_CATEGORY_KEYS.map((cat) =>
                      (row.byCategory?.[cat] ?? 0) > 0 ? (
                        <span
                          key={cat}
                          className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-600 dark:text-muted-foreground"
                        >
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${ANCILLARY_DOT_CLASS[cat].className}`} />
                          {ANCILLARY_DOT_CLASS[cat].title} {row.byCategory[cat]}
                        </span>
                      ) : null,
                    )}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenSchedule(row.id)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 dark:text-indigo-300 hover:underline"
              data-testid={`button-home-popover-view-schedule-${row.id}`}
            >
              View schedule <ArrowRight className="w-3 h-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
      <Card className="glass-tile glass-tile-interactive group cursor-pointer h-full" data-testid={testId}>
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

  const { data: calendarSummary = [] } = useQuery<CalendarSummaryRow[]>({
    queryKey: ["/api/screening-batches/calendar-summary"],
    queryFn: async () => {
      const res = await fetch("/api/screening-batches/calendar-summary", {
        credentials: "include",
      });
      if (!res.ok)
        throw new Error(`Calendar summary fetch failed (${res.status})`);
      return res.json();
    },
    staleTime: 15_000,
  });

  const completedEventRange = useMemo(
    () => defaultCommandCalendarEventWindow(),
    [],
  );
  const { data: completedEvents = [] } = useQuery<GlobalScheduleEvent[]>({
    queryKey: [
      "/api/global-schedule-events",
      {
        eventType: "procedure_complete",
        startDate: completedEventRange.start,
        endDate: completedEventRange.end,
      },
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("eventType", "procedure_complete");
      params.set("startDate", completedEventRange.start);
      params.set("endDate", completedEventRange.end);
      params.set("limit", "500");
      const res = await fetch(
        `/api/global-schedule-events?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok)
        throw new Error(`Calendar events fetch failed (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const calendarCells = useMemo(
    () => buildCommandCalendarCells({ summary: calendarSummary, completedEvents }),
    [calendarSummary, completedEvents],
  );

  const batchesByDate = useMemo(() => {
    const map: Record<string, CalendarSummaryRow[]> = {};
    for (const row of calendarSummary) {
      if (!row.scheduleDate || row.patientCount === 0) continue;
      (map[row.scheduleDate] ??= []).push(row);
    }
    for (const dateKey of Object.keys(map)) {
      map[dateKey].sort((a, b) => (a.facility ?? "").localeCompare(b.facility ?? ""));
    }
    return map;
  }, [calendarSummary]);

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
            <div className="space-y-6">
              <HomeLiveDashboard />

              <HomeWorldClocks />

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 auto-rows-fr">
                <Link href="/plexus-iq">
                  <Card
                    className="glass-tile-interactive group cursor-pointer relative overflow-hidden border-0 bg-[radial-gradient(ellipse_at_top_left,_#1e1b4b_0%,_#000000_55%,_#0b0716_100%)] text-white shadow-2xl h-full"
                    data-testid="tile-plexus-iq"
                  >
                    <div
                      className="pointer-events-none absolute inset-0 opacity-70"
                      style={{
                        backgroundImage:
                          "radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.9) 50%, transparent 51%), radial-gradient(1px 1px at 60% 70%, rgba(255,255,255,0.7) 50%, transparent 51%), radial-gradient(1.5px 1.5px at 80% 20%, rgba(255,255,255,0.95) 50%, transparent 51%), radial-gradient(1px 1px at 40% 80%, rgba(255,255,255,0.6) 50%, transparent 51%), radial-gradient(1px 1px at 10% 60%, rgba(255,255,255,0.8) 50%, transparent 51%), radial-gradient(1.2px 1.2px at 90% 50%, rgba(255,255,255,0.85) 50%, transparent 51%)",
                        backgroundRepeat: "no-repeat",
                      }}
                      aria-hidden="true"
                    />
                    <div className="relative h-[122px] flex items-center gap-4 px-5">
                      <div className="shrink-0 w-11 h-11 rounded-xl bg-white/10 ring-1 ring-white/20 flex items-center justify-center">
                        <Sparkles className="w-6 h-6 text-white" strokeWidth={1.75} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">
                          Plexus Ancillary
                        </div>
                        <div className="text-[18px] font-semibold text-white tracking-tight leading-tight mt-0.5">
                          Plexus IQ
                        </div>
                        <p className="text-[11px] text-white/60 mt-1 leading-snug line-clamp-2">
                          Build, qualify, and review schedules.
                        </p>
                      </div>
                      <ChevronRight className="hidden sm:block w-5 h-5 text-white/40 shrink-0 transition-transform group-hover:translate-x-1" strokeWidth={1.75} />
                    </div>
                  </Card>
                </Link>
                <SecondaryTile
                  href="/mission-control"
                  testId="tile-mission-control"
                  label="Mission Control"
                  icon={<Radar className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
                <SecondaryTile
                  href="/ultrasound-central"
                  testId="tile-ultrasound-central"
                  label="Ultrasound Central"
                  icon={<Waves className="w-9 h-9 text-emerald-600" strokeWidth={1.5} />}
                />
                <SecondaryTile
                  href="/team-member-portals"
                  testId="tile-team-member-portals"
                  label="Team Member Portals"
                  icon={<Users2 className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
                <SecondaryTile
                  href="/engagement-center"
                  testId="tile-engagement-center"
                  label="Outreach / Engagement Center"
                  icon={<Phone className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
                <SecondaryTile
                  href="/team-ops"
                  testId="tile-team-ops"
                  label="Team Ops"
                  icon={<Stethoscope className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
                <SecondaryTile
                  href="/patient-directory"
                  testId="tile-patient-directory"
                  label="Patient Directory"
                  icon={<Users className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
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
                        <p className="text-[12px] text-slate-500 dark:text-muted-foreground mt-0.5">Click a day to view its schedules</p>
                      </div>
                    </div>

                    <Link href="/dashboard">
                      <span className="text-xs text-indigo-700 dark:text-indigo-300 font-medium hover:underline cursor-pointer shrink-0 px-2" data-testid="link-view-full-schedule">Full Dashboard →</span>
                    </Link>
                  </div>

                  <CanonicalMonthCalendar
                    cells={calendarCells}
                    onSelectDate={(date) => setSelectedDate(date)}
                    renderDayPopoverContent={(date) => {
                      const rows = batchesByDate[date];
                      if (!rows || rows.length === 0) return null;
                      return (
                        <DayPopoverContent
                          isoDate={date}
                          rows={rows}
                          today={today}
                          onOpenSchedule={onOpenSchedule}
                        />
                      );
                    }}
                  />
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
