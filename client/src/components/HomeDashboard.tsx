import { useState, useMemo, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock, FileText, Loader2, Phone, Plus, Upload, Users,
} from "lucide-react";

type DayPatient = { id: number; name: string; time: string | null; ancillaries: string[] };
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
  onNewSchedule: () => void;
  onOpenDir: () => void;
  onOpenSidebar: () => void;
  isCreatingBatch: boolean;
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

export function HomeDashboard({
  batches,
  dashboardData,
  dashboardLoading,
  dashboardWeekOverride,
  setDashboardWeekOverride,
  dashboardClinicKey,
  setDashboardClinicKey,
  onNewSchedule,
  onOpenDir,
  onOpenSidebar,
  isCreatingBatch,
}: HomeDashboardProps) {
  const [, setLocation] = useLocation();
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

  const selectedDayPatients = useMemo<DayPatient[]>(() => {
    if (!effectiveSelectedDate || !activeDashboardClinic) return [];
    const cell = activeDashboardClinic.monthCells.find((c) => c.isoDate === effectiveSelectedDate);
    return cell?.patients ?? [];
  }, [effectiveSelectedDate, activeDashboardClinic]);

  const selectedDayAncillaryBreakdown = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const p of selectedDayPatients) {
      for (const a of p.ancillaries) {
        map[a] = (map[a] || 0) + 1;
      }
    }
    return map;
  }, [selectedDayPatients]);

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-40 bg-white/85 dark:bg-card/80 backdrop-blur-xl border-b border-slate-200/60">
        <div className="px-8 flex items-center gap-4">
          <SidebarTrigger data-testid="button-sidebar-toggle-home" />
          <div className="flex items-center gap-1 text-[13px] font-medium text-indigo-700 border-b-2 border-indigo-600 py-3 -mb-px" data-testid="tab-dashboard">
            <span className="inline-block w-3.5 h-3.5 rounded-sm border border-indigo-600/70" aria-hidden />
            Dashboard
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-8 pt-10 pb-16">
          <div className="mb-12 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 flex items-center justify-center">
                <img
                  src="/plexus-logo-icon.png"
                  alt="Plexus Ancillary Services"
                  className="w-16 h-16 object-contain"
                  data-testid="img-home-logo"
                />
              </div>
              <div>
                <h2 className="text-[32px] leading-tight font-bold tracking-tight text-slate-900 dark:text-foreground" data-testid="text-home-heading">Plexus</h2>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <Card
              className={`glass-tile glass-tile-interactive group cursor-pointer ${isCreatingBatch ? "pointer-events-none opacity-60" : ""}`}
              onClick={onNewSchedule}
              data-testid="tile-new-schedule"
            >
              <div className="aspect-square flex flex-col items-center justify-center gap-3 p-6">
                {isCreatingBatch
                  ? <Loader2 className="glass-tile-icon w-14 h-14 text-indigo-900 animate-spin" strokeWidth={1.5} />
                  : <Plus className="glass-tile-icon w-14 h-14 text-indigo-900" strokeWidth={1.5} />}
                <span className="text-[14px] font-semibold text-slate-900 dark:text-foreground text-center leading-tight" data-testid="text-tile-new-schedule">New Schedule</span>
              </div>
            </Card>
            <Card
              className="glass-tile glass-tile-interactive group cursor-pointer"
              onClick={() => setLocation("/documents")}
              data-testid="tile-documents"
            >
              <div className="aspect-square flex flex-col items-center justify-center gap-3 p-6">
                <FileText className="glass-tile-icon w-14 h-14 text-indigo-900" strokeWidth={1.5} />
                <span className="text-[14px] font-semibold text-slate-900 dark:text-foreground text-center leading-tight" data-testid="text-tile-documents">Ancillary Documents</span>
              </div>
            </Card>
            <Link href="/document-upload">
              <Card className="glass-tile glass-tile-interactive group cursor-pointer" data-testid="tile-document-upload">
                <div className="aspect-square flex flex-col items-center justify-center gap-3 p-6">
                  <Upload className="glass-tile-icon w-14 h-14 text-indigo-900" strokeWidth={1.5} />
                  <span className="text-[14px] font-semibold text-slate-900 dark:text-foreground text-center leading-tight" data-testid="text-tile-document-upload">Document Upload</span>
                </div>
              </Card>
            </Link>
            <Card
              className="glass-tile glass-tile-interactive group cursor-pointer"
              onClick={onOpenDir}
              data-testid="tile-patient-directory"
            >
              <div className="aspect-square flex flex-col items-center justify-center gap-3 p-6">
                <Users className="glass-tile-icon w-14 h-14 text-indigo-900" strokeWidth={1.5} />
                <span className="text-[14px] font-semibold text-slate-900 dark:text-foreground text-center leading-tight" data-testid="text-tile-patient-directory">Patient Directory</span>
              </div>
            </Card>
            <Link href="/outreach">
              <Card className="glass-tile glass-tile-interactive group cursor-pointer" data-testid="tile-outreach">
                <div className="aspect-square flex flex-col items-center justify-center gap-3 p-6">
                  <Phone className="glass-tile-icon w-14 h-14 text-indigo-900" strokeWidth={1.5} />
                  <span className="text-[14px] font-semibold text-slate-900 dark:text-foreground text-center leading-tight" data-testid="text-tile-outreach">Outreach</span>
                </div>
              </Card>
            </Link>
          </div>

          <Card className="glass-tile mt-4" data-testid="tile-schedule-dashboard-inline">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                    <CalendarDays className="w-5 h-5 text-blue-600" strokeWidth={1.75} />
                  </div>
                  <div>
                    <span className="text-[18px] font-semibold text-slate-800 dark:text-foreground">Schedule Dashboard</span>
                    <p className="text-[12px] text-slate-500 mt-0.5">Live clinic schedule</p>
                  </div>
                </div>
                <Link href="/schedule-dashboard">
                  <span className="text-xs text-primary font-medium hover:underline cursor-pointer shrink-0" data-testid="link-view-full-schedule">Full Dashboard →</span>
                </Link>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      const base = dashboardWeekOverride || dashboardData?.weekStart || new Date().toISOString().slice(0, 10);
                      const [y, m] = base.split("-").map(Number);
                      const prev = new Date(y, (m || 1) - 2, 1);
                      setDashboardWeekOverride(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-01`);
                    }}
                    className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-500"
                    data-testid="button-dashboard-prev-month"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-semibold text-slate-700 w-28 text-center tabular-nums" data-testid="text-dashboard-month-label">
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
                    className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-500"
                    data-testid="button-dashboard-next-month"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                {dashboardClinicTabs.length > 1 && (
                  <div className="flex flex-wrap gap-1">
                    {dashboardClinicTabs.map((tab) => (
                      <button
                        key={tab.clinicKey}
                        type="button"
                        onClick={() => setDashboardClinicKey(tab.clinicKey)}
                        className={`rounded-xl border px-2.5 py-0.5 text-xs font-medium transition ${
                          activeDashboardClinic?.clinicKey === tab.clinicKey
                            ? "border-blue-200 bg-blue-50 text-blue-700"
                            : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-700"
                        }`}
                        data-testid={`button-dashboard-clinic-${tab.clinicKey}`}
                      >
                        {tab.clinicLabel}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {dashboardLoading ? (
                <div className="grid grid-cols-7 gap-1 mb-4">
                  {[...Array(35)].map((_, i) => (
                    <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : !activeDashboardClinic ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-8 text-center text-xs text-slate-400 mb-4">
                  No schedule data — create a schedule to get started
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-7 mb-1">
                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                      <div key={d} className="text-center text-[11px] font-medium uppercase tracking-wider text-slate-400 py-2">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1 mb-4">
                    {activeDashboardClinic.monthCells.map((cell) => {
                      const isToday = cell.isoDate === dashboardData?.today;
                      const isSelected = cell.isoDate === effectiveSelectedDate;
                      const cellMonth = cell.isoDate.slice(0, 7);
                      const displayMonth = dashboardData?.weekStart?.slice(0, 7);
                      const isCurrentMonth = cellMonth === displayMonth;
                      const dayNum = parseInt(cell.isoDate.split("-")[2], 10);
                      return (
                        <button
                          type="button"
                          key={cell.isoDate}
                          onClick={() => setSelectedDate(cell.isoDate)}
                          className={`text-left rounded-2xl p-2 min-h-[80px] flex flex-col transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-indigo-50 border-2 border-indigo-400 shadow-sm"
                              : isCurrentMonth
                                ? "bg-white border border-slate-200/70 hover:bg-slate-50 hover:border-slate-300"
                                : "bg-slate-50/40 border border-transparent hover:bg-slate-100/60"
                          }`}
                          data-testid={`dashboard-month-cell-${cell.isoDate}`}
                          aria-pressed={isSelected}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className={`inline-flex items-center justify-center min-w-[1.75rem] h-7 px-1 rounded-2xl text-sm font-semibold ${
                              isToday
                                ? "bg-violet-600 text-white shadow-sm"
                                : isCurrentMonth
                                  ? "text-slate-900"
                                  : "text-slate-300"
                            }`}>{dayNum}</span>
                          </div>
                          {cell.patientCount > 0 && (
                            <div className="flex flex-col gap-0.5 mt-auto">
                              <span className="text-[10px] leading-tight text-slate-500">
                                <span className="font-semibold text-slate-700">{cell.patientCount}</span> pt{cell.patientCount !== 1 ? "s" : ""}
                              </span>
                              {cell.ancillaryCount > 0 && (
                                <span className="text-[10px] leading-tight">
                                  <span className="font-semibold text-violet-600">{cell.ancillaryCount}</span>
                                  <span className="text-slate-400"> anc</span>
                                </span>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              <div className="border-t border-slate-100 pt-3" data-testid="panel-day-detail">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider" data-testid="text-day-detail-header">
                    {effectiveSelectedDate ? formatDayHeader(effectiveSelectedDate, today) : "Selected Day"}
                    {activeDashboardClinic && (
                      <span className="ml-2 text-slate-400 normal-case">· {activeDashboardClinic.clinicLabel}</span>
                    )}
                  </p>
                  {Object.keys(selectedDayAncillaryBreakdown).length > 0 && (
                    <div className="flex flex-wrap gap-1" data-testid="day-ancillary-breakdown">
                      {Object.entries(selectedDayAncillaryBreakdown).map(([test, n]) => (
                        <span key={test} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">
                          {test} <span className="text-violet-500">×{n}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {selectedDayPatients.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400" data-testid="text-day-empty">
                    No patients scheduled for this day.
                  </div>
                ) : (
                  <div className="space-y-1" data-testid="list-day-patients">
                    {selectedDayPatients.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white border border-slate-100 hover:bg-slate-50 transition-colors"
                        data-testid={`day-patient-row-${p.id}`}
                      >
                        <span className="text-xs font-semibold text-primary w-16 shrink-0 tabular-nums">
                          {formatTime12(p.time) || "—"}
                        </span>
                        <span className="text-xs font-medium text-slate-800 flex-1 truncate" data-testid={`text-day-patient-name-${p.id}`}>{p.name || "(unnamed)"}</span>
                        {p.ancillaries.length > 0 && (
                          <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[60%]">
                            {p.ancillaries.map((a, i) => (
                              <span key={`${p.id}-${a}-${i}`} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                                {a}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>

          {batches.length > 0 && (
            <div className="mt-10">
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
