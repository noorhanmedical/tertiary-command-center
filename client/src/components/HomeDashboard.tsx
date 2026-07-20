import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  ArrowRight,
  Building2,
  ChevronRight,
  Clock,
  FileText,
  Filter,
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
  ScanLine,
  BarChart3,
  ClipboardCheck,
  FileSignature,
} from "lucide-react";
import {
  CALENDAR_FILTERS,
  type CalendarFilterId,
} from "@/calendar/calendarFilters";
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

// Filter options exposed in the home calendar header dropdown. Drawn from the
// canonical filter definitions in calendarFilters.ts.
const HOME_CALENDAR_FILTER_IDS: CalendarFilterId[] = [
  "clinicVisits",
  "qualifiedVisitPatients",
  "ancillaryScheduled",
  "dailyCallList",
  "completedCalls",
  "procedureCompleted",
  "teamAvailability",
];

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


function ClinicianPortalTile() {
  const { data: me } = useQuery<{ role?: string }>({ queryKey: ["/api/auth/me"] });
  const role = me?.role;
  const enabled = role === "admin" || role === "clinician";
  const { data: summary } = useQuery<{ needsSignature: number; reportsPending: number; pendingAR: number }>({
    queryKey: ["/api/physician-portal/summary"],
    enabled,
  });
  if (!enabled) return null;
  const needs = summary?.needsSignature ?? 0;
  return (
    <Link href="/clinician-portal" className="xl:col-start-1">
      <Card className="glass-tile glass-tile-interactive group cursor-pointer h-full" data-testid="tile-clinician-portal">
        <div className="h-[122px] flex items-center gap-4 px-5">
          <div className="shrink-0 relative">
            <FileSignature className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />
            {needs > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center tabular-nums" data-testid="badge-clinician-needs-signature">
                {needs}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-slate-900 dark:text-foreground leading-tight">
              Clinician Portal
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight" data-testid="text-clinician-tile-subtitle">
              Sign, review, and monitor clinic financial health.
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
  const [activeCalendarFilters, setActiveCalendarFilters] = useState<CalendarFilterId[]>([]);

  function toggleCalendarFilter(id: CalendarFilterId) {
    setActiveCalendarFilters((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id],
    );
  }

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
    () =>
      buildCommandCalendarCells({
        summary: calendarSummary,
        completedEvents,
        activeFilters: activeCalendarFilters,
      }),
    [calendarSummary, completedEvents, activeCalendarFilters],
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
    <div className="flex flex-col h-full" data-testid="home-dashboard">
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-10 pb-16">
          <div className="max-w-5xl mx-auto">
            <div className="space-y-6">
              <div className="flex justify-end">
                <Link href="/home-preview">
                  <Button
                    variant="outline"
                    className="gap-2"
                    data-testid="button-home-preview"
                  >
                    <Sparkles className="w-4 h-4" />
                    Preview new home design
                  </Button>
                </Link>
              </div>

              <HomeLiveDashboard />

              <HomeWorldClocks />

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 auto-rows-fr">
                {/* Row 1: Mission Control | Patient EHR | Plexus IQ | Outreach / Engagement Center */}
                <SecondaryTile
                  href="/mission-control"
                  testId="tile-mission-control"
                  label="Mission Control"
                  icon={<Radar className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
                <SecondaryTile
                  href="/patient-directory"
                  testId="tile-patient-directory"
                  label="Patient EHR"
                  icon={<Users className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
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
                  href="/engagement-center"
                  testId="tile-engagement-center"
                  label="Outreach / Engagement Center"
                  icon={<Phone className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />

                {/* Row 2: Team Member Portals | Team Ops | Plexus Tasks */}
                <SecondaryTile
                  href="/team-member-portals"
                  testId="tile-team-member-portals"
                  label="Team Member Portals"
                  icon={<Users2 className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
                <SecondaryTile
                  href="/team-ops"
                  testId="tile-team-ops"
                  label="Team Ops"
                  icon={<Stethoscope className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
                <SecondaryTile
                  href="/plexus-tasks"
                  testId="tile-plexus-tasks"
                  label="Plexus Tasks"
                  icon={<CheckSquare className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
                {/* Row 3: Imaging Central | Document Upload | Ancillary Documents */}
                <SecondaryTile
                  href="/imaging-central"
                  testId="tile-imaging-central"
                  label="Imaging Central"
                  icon={<ScanLine className="w-9 h-9 text-emerald-600" strokeWidth={1.5} />}
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

                {/* Row 4: Clinician Portal | Clinic Onboarding | Clinic Analytics */}
                <ClinicianPortalTile />
                <SecondaryTile
                  href="/clinic-onboarding"
                  testId="tile-clinic-onboarding"
                  label="Clinic Onboarding"
                  icon={<ClipboardCheck className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
                <SecondaryTile
                  href="/clinic-analytics"
                  testId="tile-clinic-analytics"
                  label="Clinic Analytics"
                  icon={<BarChart3 className="w-9 h-9 text-indigo-900" strokeWidth={1.5} />}
                />
              </div>

              <Card className="glass-tile overflow-hidden" data-testid="tile-calendar-bottom">
                <div className="relative flex items-center justify-center bg-black px-6 py-4">
                  <span
                    className="text-[18px] font-semibold tracking-tight text-white"
                    data-testid="text-calendar-header"
                  >
                    Calendar
                  </span>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 px-2.5 text-white hover:bg-white/15 hover:text-white"
                          data-testid="button-calendar-filter"
                        >
                          <Filter className="h-4 w-4" strokeWidth={1.75} />
                          <span className="text-[12px] font-medium">
                            Filter
                            {activeCalendarFilters.length > 0
                              ? ` (${activeCalendarFilters.length})`
                              : ""}
                          </span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-60"
                        data-testid="menu-calendar-filter"
                      >
                        <DropdownMenuLabel>Show on calendar</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {HOME_CALENDAR_FILTER_IDS.map((id) => {
                          const def = CALENDAR_FILTERS[id];
                          if (!def) return null;
                          return (
                            <DropdownMenuCheckboxItem
                              key={id}
                              checked={activeCalendarFilters.includes(id)}
                              onCheckedChange={() => toggleCalendarFilter(id)}
                              onSelect={(e) => e.preventDefault()}
                              data-testid={`filter-option-${id}`}
                            >
                              {def.label}
                            </DropdownMenuCheckboxItem>
                          );
                        })}
                        {activeCalendarFilters.length > 0 && (
                          <>
                            <DropdownMenuSeparator />
                            <button
                              type="button"
                              onClick={() => setActiveCalendarFilters([])}
                              className="w-full px-2 py-1.5 text-left text-[12px] font-medium text-slate-600 hover:bg-slate-100 rounded-sm dark:text-muted-foreground dark:hover:bg-muted"
                              data-testid="button-clear-calendar-filters"
                            >
                              Clear filters
                            </button>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="p-6 lg:p-8">
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
