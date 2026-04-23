import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Layers3,
  Settings as SettingsIcon,
  Shield,
  Users2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageHeader, HeaderPill, HeaderStatusPill } from "@/components/PageHeader";
import { CalendarDays as CalendarHeaderIcon } from "lucide-react";

type TeamMember = {
  id: string;
  name: string;
  initials: string;
};

type ClinicDay = {
  isoDate: string;
  patientCount: number;
  ancillaryCount: number;
  newCommittedToday: number;
  ancillaryBreakdown: Record<string, number>;
  providerNames: string[];
};

type ClinicMonthCell = {
  isoDate: string;
  patientCount: number;
  ancillaryCount: number;
  newCommittedToday: number;
};

type RecentlyCommittedEntry = {
  patientId: number;
  patientName: string;
  batchId: number;
  clinicLabel: string;
  clinicKey: string;
  isoDate: string;
  committedAt: string;
  committedByUserId: string | null;
  committerName: string | null;
  schedulerName: string | null;
};

type ClinicTab = {
  clinicKey: string;
  clinicLabel: string;
  spreadsheetId: string;
  patientTabName: string;
  calendarTabName: string;
  scheduler: TeamMember | null;
  weekDays: ClinicDay[];
  monthCells: ClinicMonthCell[];
};

type DashboardResponse = {
  today: string;
  weekStart: string;
  previousWeekStart: string;
  nextWeekStart: string;
  sharedCalendarSpreadsheetId: string;
  recentlyCommitted: RecentlyCommittedEntry[];
  committedTodayDetails: RecentlyCommittedEntry[];
  newCommittedTodayTotal: number;
  dailySnapshot: {
    totalAncillariesScheduled: number;
    ancillaryBreakdown: Record<string, number>;
    activeClinicsToday: number;
    activeSchedulersToday: number;
  };
  clinicTabs: ClinicTab[];
};

function formatDateLabel(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const dt = new Date(year, (month || 1) - 1, day || 1);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatMonthDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const dt = new Date(year, (month || 1) - 1, day || 1);
  return dt.getDate();
}

export default function ScheduleDashboardPage() {
  const [weekStartOverride, setWeekStartOverride] = useState<string | null>(null);
  const [selectedClinicKey, setSelectedClinicKey] = useState<string | null>(null);

  const queryKey = useMemo(
    () => ["/api/schedule/dashboard", weekStartOverride || "current"],
    [weekStartOverride],
  );

  const { data, isLoading } = useQuery<DashboardResponse>({
    queryKey,
    queryFn: async () => {
      const url = weekStartOverride
        ? `/api/schedule/dashboard?weekStart=${encodeURIComponent(weekStartOverride)}`
        : "/api/schedule/dashboard";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load schedule dashboard");
      return res.json();
    },
  });

  const clinicTabs = data?.clinicTabs || [];
  const selectedClinic =
    clinicTabs.find((tab) => tab.clinicKey === selectedClinicKey) || clinicTabs[0] || null;

  const breakdownEntries = Object.entries(data?.dailySnapshot.ancillaryBreakdown || {}).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1650px] flex-col gap-6 px-6 py-6">
        <PageHeader
          variant="light"
          eyebrow="PLEXUS ANCILLARY"
          title="Dashboard"
          subtitle="Canonical schedule view with clinic tabs, week navigation, month grid, and scheduler coverage."
          icon={CalendarHeaderIcon}
          titleTestId="text-calendar-header-title"
          actions={
            <>
              <HeaderStatusPill />
              <Link href="/">
                <HeaderPill icon={<ArrowLeft className="w-3.5 h-3.5" />}>Home</HeaderPill>
              </Link>
              <Link href="/admin-ops">
                <HeaderPill icon={<Shield className="w-3.5 h-3.5" />}>Admin</HeaderPill>
              </Link>
              <Link href="/settings">
                <HeaderPill icon={<SettingsIcon className="w-3.5 h-3.5" />}>Settings</HeaderPill>
              </Link>
            </>
          }
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-blue-100 p-2 text-blue-700">
                <Layers3 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Ancillaries Today</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">
                  {data?.dailySnapshot.totalAncillariesScheduled || 0}
                </p>
              </div>
            </div>
          </Card>

          <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-emerald-100 p-2 text-emerald-700">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Active Clinics Today</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">
                  {data?.dailySnapshot.activeClinicsToday || 0}
                </p>
              </div>
            </div>
          </Card>

          <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-violet-100 p-2 text-violet-700">
                <Users2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Schedulers Today</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">
                  {data?.dailySnapshot.activeSchedulersToday || 0}
                </p>
              </div>
            </div>
          </Card>

          <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Ancillary Breakdown</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {breakdownEntries.length > 0 ? breakdownEntries.slice(0, 5).map(([name, count]) => (
                  <Badge key={name} className="rounded-full bg-blue-50 text-blue-700 hover:bg-blue-50">
                    {name}: {count}
                  </Badge>
                )) : (
                  <span className="text-sm text-slate-400">No ancillaries scheduled today</span>
                )}
              </div>
            </div>
          </Card>
        </div>

        <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Clinic Week Tabs</h2>
              <p className="text-sm text-slate-500">
                Shared calendar spreadsheet: {data?.sharedCalendarSpreadsheetId || "Not configured"}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="rounded-2xl border-white/60 bg-white/80"
                onClick={() => setWeekStartOverride(data?.previousWeekStart || null)}
              >
                <ChevronLeft className="mr-2 h-4 w-4" />
                Previous Week
              </Button>
              <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                Week of {data?.weekStart ? formatDateLabel(data.weekStart) : "—"}
              </Badge>
              <Button
                variant="outline"
                className="rounded-2xl border-white/60 bg-white/80"
                onClick={() => setWeekStartOverride(data?.nextWeekStart || null)}
              >
                Next Week
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {clinicTabs.map((tab) => {
              const active = selectedClinic?.clinicKey === tab.clinicKey;
              return (
                <button
                  key={tab.clinicKey}
                  type="button"
                  onClick={() => setSelectedClinicKey(tab.clinicKey)}
                  className={[
                    "rounded-2xl border px-4 py-2 text-sm font-medium transition",
                    active
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-blue-700",
                  ].join(" ")}
                >
                  {tab.clinicLabel}
                </button>
              );
            })}
          </div>

          {isLoading ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
              Loading schedule dashboard...
            </div>
          ) : !selectedClinic ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
              No clinic schedule data available.
            </div>
          ) : (
            <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
              <div className="space-y-4">
                <div className="rounded-3xl border border-white/60 bg-white/70 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">{selectedClinic.clinicLabel}</h3>
                      <p className="text-sm text-slate-500">Week schedule and team coverage</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedClinic.scheduler ? (
                        <Badge className="rounded-full bg-violet-50 text-violet-700 hover:bg-violet-50">
                          {selectedClinic.scheduler.initials} • {selectedClinic.scheduler.name}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                          No scheduler assigned
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {selectedClinic.weekDays.map((day) => (
                      <div key={day.isoDate} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{formatDateLabel(day.isoDate)}</p>
                            <p className="text-xs text-slate-500">{day.isoDate}</p>
                          </div>
                          {selectedClinic.scheduler ? (
                            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-xs font-semibold text-blue-700">
                              {selectedClinic.scheduler.initials}
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-3 space-y-1 text-sm text-slate-600">
                          <p>Patients: {day.patientCount}</p>
                          <p>Ancillaries: {day.ancillaryCount}</p>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {Object.entries(day.ancillaryBreakdown).length > 0 ? (
                            Object.entries(day.ancillaryBreakdown).slice(0, 4).map(([name, count]) => (
                              <Badge key={name} variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                                {name}: {count}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-slate-400">No ancillaries</span>
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {day.providerNames.length > 0 ? day.providerNames.slice(0, 3).map((provider) => (
                            <Badge key={provider} className="rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                              {provider}
                            </Badge>
                          )) : (
                            <span className="text-xs text-slate-400">No provider listed</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/60 bg-white/70 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Clock3 className="h-5 w-5 text-slate-700" />
                  <h3 className="text-base font-semibold text-slate-900">Month Schedule</h3>
                </div>

                <div className="grid grid-cols-7 gap-2 text-center text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
                    <div key={label} className="py-2">{label}</div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-2">
                  {selectedClinic.monthCells.map((cell) => {
                    const cellCommits = (data?.committedTodayDetails ?? []).filter(
                      (c) => c.clinicKey === selectedClinic.clinicKey && c.isoDate === cell.isoDate,
                    );
                    return (
                      <div
                        key={cell.isoDate}
                        className="min-h-[92px] rounded-2xl border border-slate-200 bg-slate-50 p-2"
                        data-testid={`month-cell-${cell.isoDate}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900">{formatMonthDay(cell.isoDate)}</span>
                          {cell.newCommittedToday > 0 ? (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  className="inline-flex items-center justify-center rounded-full bg-violet-600 px-1.5 h-5 text-[10px] font-semibold text-white shadow-sm hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
                                  title={`${cell.newCommittedToday} newly committed today — click for details`}
                                  data-testid={`badge-new-today-${cell.isoDate}`}
                                >
                                  +{cell.newCommittedToday} new
                                </button>
                              </PopoverTrigger>
                              <PopoverContent
                                align="end"
                                className="w-72 p-0"
                                data-testid={`popover-new-today-${cell.isoDate}`}
                              >
                                <div className="border-b border-slate-100 px-3 py-2">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Newly committed
                                  </p>
                                  <p className="text-sm font-semibold text-slate-900">
                                    {selectedClinic.clinicLabel} • {formatMonthDay(cell.isoDate)}
                                  </p>
                                </div>
                                {cellCommits.length === 0 ? (
                                  <div className="px-3 py-3 text-xs text-slate-500">
                                    Newly committed today, but full details aren't loaded yet — refresh to see names.
                                  </div>
                                ) : (
                                  <ul className="max-h-64 divide-y divide-slate-100 overflow-auto">
                                    {cellCommits.map((c) => {
                                      const t = new Date(c.committedAt).toLocaleTimeString(undefined, {
                                        hour: "numeric",
                                        minute: "2-digit",
                                      });
                                      return (
                                        <li
                                          key={`${c.patientId}-${c.committedAt}`}
                                          className="px-3 py-2"
                                          data-testid={`row-cell-commit-${c.patientId}`}
                                        >
                                          <Link href={`/schedule/${c.batchId}`}>
                                            <a className="text-sm font-semibold text-indigo-700 hover:underline">
                                              {c.patientName}
                                            </a>
                                          </Link>
                                          <p className="text-[11px] text-slate-500">
                                            Sent by {c.committerName ?? "system"} at {t}
                                          </p>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </PopoverContent>
                            </Popover>
                          ) : selectedClinic.scheduler ? (
                            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-100 text-[10px] font-semibold text-blue-700">
                              {selectedClinic.scheduler.initials}
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-slate-600">
                          <p>Pts: {cell.patientCount}</p>
                          <p>Anc: {cell.ancillaryCount}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card
          className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl"
          data-testid="card-recently-committed"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Recently committed today</h3>
              <p className="text-sm text-slate-500">
                Patients newly handed off to schedulers across all clinics.
              </p>
            </div>
            <Badge className="rounded-full bg-violet-100 text-violet-700 hover:bg-violet-100">
              {data?.newCommittedTodayTotal ?? 0} new today
            </Badge>
          </div>
          {(data?.recentlyCommitted ?? []).length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-500" data-testid="text-no-recent-commits">
              Nothing committed yet today — when a patient is sent to schedulers it will appear here.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {(data?.recentlyCommitted ?? []).map((entry) => {
                const time = new Date(entry.committedAt).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                });
                return (
                  <li
                    key={`${entry.patientId}-${entry.committedAt}`}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                    data-testid={`row-recent-commit-${entry.patientId}`}
                  >
                    <div className="min-w-0">
                      <Link href={`/schedule/${entry.batchId}`}>
                        <a
                          className="text-sm font-semibold text-indigo-700 hover:underline truncate block"
                          data-testid={`link-recent-patient-${entry.patientId}`}
                        >
                          {entry.patientName}
                        </a>
                      </Link>
                      <p className="text-xs text-slate-500 truncate">
                        {entry.clinicLabel}
                        {entry.schedulerName ? ` • ${entry.schedulerName}` : ""}
                      </p>
                    </div>
                    <div className="text-xs text-slate-500 shrink-0">{time}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
