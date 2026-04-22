import { useState, useMemo, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { PageHeader } from "@/components/PageHeader";
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock, FileText, Loader2, Phone, Plus, Upload, Users, Stethoscope, Radio,
} from "lucide-react";

type DayPatient = { id: number; batchId: number; name: string; time: string | null; ancillaries: string[] };
type ClinicMonthCell = { isoDate: string; patientCount: number; ancillaryCount: number; patients?: DayPatient[]; providerNames?: string[]; ancillaryBreakdown?: Record<string, number> };
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
  onOpenSchedule: (batchId: number) => void;
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
  onOpenSchedule,
  isCreatingBatch,
}: HomeDashboardProps) {
  const [, setLocation] = useLocation();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarPopupDate, setCalendarPopupDate] = useState<string | null>(null);
  const [calendarDetailDate, setCalendarDetailDate] = useState<string | null>(null);

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

  const selectedMonthCell = useMemo<ClinicMonthCell | null>(() => {
    if (!calendarPopupDate || !activeDashboardClinic) return null;
    return activeDashboardClinic.monthCells.find((c) => c.isoDate === calendarPopupDate) || null;
  }, [calendarPopupDate, activeDashboardClinic]);

  const popupBreakdown = useMemo<Record<string, number>>(() => {
    const existing = selectedMonthCell?.ancillaryBreakdown;
    if (existing && Object.keys(existing).length > 0) return existing;
    const map: Record<string, number> = {};
    for (const p of selectedMonthCell?.patients ?? []) {
      for (const a of p.ancillaries ?? []) map[a] = (map[a] || 0) + 1;
    }
    return map;
  }, [selectedMonthCell]);

  const popupTeamMembers = useMemo<string[]>(() => {
    if (selectedMonthCell?.providerNames?.length) return selectedMonthCell.providerNames;
    return [];
  }, [selectedMonthCell]);

  function countFor(labels: string[]) {
    let total = 0;
    for (const [name, count] of Object.entries(popupBreakdown)) {
      const normalized = name.toLowerCase();
      if (labels.some((label) => normalized.includes(label))) total += Number(count || 0);
    }
    return total;
  }

  const popupBrainwaveCount = countFor(["brainwave"]);
  const popupVitalwaveCount = countFor(["vitalwave"]);
  const popupUltrasoundCount = countFor(["ultrasound", "carotid", "echo", "vascular"]);

  const clinicMonthTotals = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const tab of dashboardClinicTabs) {
      let total = 0;
      for (const cell of tab.monthCells) {
        if (cell.isoDate.slice(0, 7) === displayMonth) {
          total += cell.patientCount;
        }
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
          <div className="flex items-center gap-1 text-[13px] font-medium text-indigo-700 dark:text-indigo-300 border-b-2 border-indigo-600 py-3 -mb-px" data-testid="tab-dashboard">
            <span className="inline-block w-3.5 h-3.5 rounded-sm border border-indigo-600/70" aria-hidden />
            Dashboard
          </div>
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

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Row 1 */}
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

              <Card
                className={`glass-tile glass-tile-interactive group cursor-pointer ${isCreatingBatch ? "pointer-events-none opacity-60" : ""}`}
                onClick={onNewSchedule}
                data-testid="tile-visit-patients"
              >
                <div className="aspect-square flex flex-col items-center justify-center gap-3 p-6">
                  {isCreatingBatch
                    ? <Loader2 className="glass-tile-icon w-14 h-14 text-indigo-900 animate-spin" strokeWidth={1.5} />
                    : <Plus className="glass-tile-icon w-14 h-14 text-indigo-900" strokeWidth={1.5} />}
                  <span className="text-[14px] font-semibold text-slate-900 dark:text-foreground text-center leading-tight" data-testid="text-tile-visit-patients">Visit Patients</span>
                </div>
              </Card>

              <Link href="/outreach-qualification">
                <Card className="glass-tile glass-tile-interactive group cursor-pointer" data-testid="tile-outreach-patients">
                  <div className="aspect-square flex flex-col items-center justify-center gap-3 p-6">
                    <Radio className="glass-tile-icon w-14 h-14 text-indigo-900" strokeWidth={1.5} />
                    <span className="text-[14px] font-semibold text-slate-900 dark:text-foreground text-center leading-tight" data-testid="text-tile-outreach-patients">Outreach Patients</span>
                  </div>
                </Card>
              </Link>

              {/* Row 2 */}
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
                onClick={() => setLocation("/documents")}
                data-testid="tile-documents"
              >
                <div className="aspect-square flex flex-col items-center justify-center gap-3 p-6">
                  <FileText className="glass-tile-icon w-14 h-14 text-indigo-900" strokeWidth={1.5} />
                  <span className="text-[14px] font-semibold text-slate-900 dark:text-foreground text-center leading-tight" data-testid="text-tile-documents">Ancillary Documents</span>
                </div>
              </Card>

              <Link href="/schedule-dashboard">
                <Card className="glass-tile glass-tile-interactive group cursor-pointer" data-testid="tile-dashboard">
                  <div className="aspect-square flex flex-col items-center justify-center gap-3 p-6">
                    <CalendarDays className="glass-tile-icon w-14 h-14 text-indigo-900" strokeWidth={1.5} />
                    <span className="text-[14px] font-semibold text-slate-900 dark:text-foreground text-center leading-tight" data-testid="text-tile-dashboard">Dashboard</span>
                  </div>
                </Card>
              </Link>

              {/* Row 3 */}
              <Link href="/liaison-portal">
                <Card className="glass-tile glass-tile-interactive group cursor-pointer" data-testid="tile-liaison-technician-portal">
                  <div className="aspect-square flex flex-col items-center justify-center gap-3 p-6">
                    <Stethoscope className="glass-tile-icon w-14 h-14 text-indigo-900" strokeWidth={1.5} />
                    <span className="text-[14px] font-semibold text-slate-900 dark:text-foreground text-center leading-tight" data-testid="text-tile-liaison-technician-portal">Liaison Technician Portal</span>
                  </div>
                </Card>
              </Link>

              <Link href="/outreach">
                <Card className="glass-tile glass-tile-interactive group cursor-pointer" data-testid="tile-scheduler-portal">
                  <div className="aspect-square flex flex-col items-center justify-center gap-3 p-6">
                    <Phone className="glass-tile-icon w-14 h-14 text-indigo-900" strokeWidth={1.5} />
                    <span className="text-[14px] font-semibold text-slate-900 dark:text-foreground text-center leading-tight" data-testid="text-tile-scheduler-portal">Scheduler Portal</span>
                  </div>
                </Card>
              </Link>
            </div>
          </div>

          <Card className="glass-tile mt-6" data-testid="tile-schedule-dashboard-inline">
            <div className="p-6 lg:p-8">
              <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15 flex items-center justify-center shrink-0">
                    <CalendarDays className="w-5 h-5 text-indigo-600 dark:text-indigo-300" strokeWidth={1.75} />
                  </div>
                  <div>
                    <span className="text-[20px] font-semibold text-slate-900 dark:text-foreground tracking-tight">Schedule Dashboard</span>
                    <p className="text-[12px] text-slate-500 dark:text-muted-foreground mt-0.5">Live monthly view across clinics</p>
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
                  <Link href="/schedule-dashboard">
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

              <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="w-4 h-4 text-indigo-600" />
                    <h2 className="text-sm font-semibold">Selected Day</h2>
                  </div>
                  <div className="text-sm font-medium text-slate-900 mb-1" data-testid="text-selected-day-header">
                    {effectiveSelectedDate ? formatDayHeader(effectiveSelectedDate, today) : "Select a day"}
                  </div>
                  <div className="text-xs text-slate-500 mb-4">
                    {selectedDayPatients.length} patient{selectedDayPatients.length === 1 ? "" : "s"} scheduled
                  </div>
                  {Object.keys(selectedDayAncillaryBreakdown).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(selectedDayAncillaryBreakdown).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
                        <div key={name} className="flex items-center justify-between text-sm">
                          <span className="text-slate-600 dark:text-muted-foreground">{name}</span>
                          <span className="font-medium text-slate-900 dark:text-foreground">{count}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">No ancillary services scheduled.</div>
                  )}
                </Card>

                <Card className="p-4">
                  <div className="grid grid-cols-7 gap-1.5 text-[11px] font-medium text-slate-400 mb-2 px-1">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                      <div key={d} className="text-center py-1">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1.5" data-testid="dashboard-month-grid">
                    {Array.from({ length: new Date(new Date(displayMonth + "-01T00:00:00").getFullYear(), new Date(displayMonth + "-01T00:00:00").getMonth(), 1).getDay() }).map((_, idx) => (
                      <div key={`empty-${idx}`} className="aspect-square" aria-hidden />
                    ))}
                    {activeDashboardClinic?.monthCells.map((cell) => {
                      const isSelected = cell.isoDate === effectiveSelectedDate;
                      const isToday = cell.isoDate === today;
                      const count = cell.patientCount;
                      return (
                        <button
                          key={cell.isoDate}
                          type="button"
                          onClick={() => { setSelectedDate(cell.isoDate); setCalendarPopupDate(cell.isoDate); }}
                          className={`aspect-square rounded-2xl border text-left p-2 transition-all hover-elevate ${
                            isSelected
                              ? "bg-indigo-600 text-white border-indigo-600 shadow-md"
                              : isToday
                                ? "bg-indigo-50 border-indigo-200 dark:bg-indigo-500/10 dark:border-indigo-500/30"
                                : "bg-white/70 dark:bg-card/40 border-slate-200/70 dark:border-border hover:border-indigo-200 dark:hover:border-indigo-500/20"
                          }`}
                          data-testid={`dashboard-day-${cell.isoDate}`}
                        >
                          <div className={`text-[11px] font-semibold ${isSelected ? "text-white" : "text-slate-700 dark:text-foreground"}`}>
                            {new Date(cell.isoDate + "T00:00:00").getDate()}
                          </div>
                          <div className={`mt-2 text-[11px] font-medium ${isSelected ? "text-white/90" : "text-slate-900 dark:text-foreground"}`}>
                            {count > 0 ? `${count} pt${count === 1 ? "" : "s"}` : "—"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Card>
              </div>
            </div>
          </Card>

      <Dialog open={!!calendarPopupDate} onOpenChange={(open) => !open && setCalendarPopupDate(null)}>
        <DialogContent className="max-w-md" data-testid="dialog-calendar-day-summary">
          <DialogHeader>
            <DialogTitle>
              {calendarPopupDate
                ? new Date(calendarPopupDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
                : "Day Summary"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <div className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Team Members On</div>
              {popupTeamMembers.length > 0 ? (
                <div className="space-y-1">
                  {popupTeamMembers.map((name) => (
                    <div key={name} className="text-sm text-slate-800">{name}</div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-500">No team members listed yet.</div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Card className="p-3">
                <div className="text-xs text-slate-500 mb-1">BrainWave</div>
                <div className="text-xl font-semibold text-slate-900" data-testid="text-popup-brainwave-count">{popupBrainwaveCount}</div>
              </Card>
              <Card className="p-3">
                <div className="text-xs text-slate-500 mb-1">VitalWave</div>
                <div className="text-xl font-semibold text-slate-900" data-testid="text-popup-vitalwave-count">{popupVitalwaveCount}</div>
              </Card>
              <Card className="p-3">
                <div className="text-xs text-slate-500 mb-1">Ultrasound</div>
                <div className="text-xl font-semibold text-slate-900" data-testid="text-popup-ultrasound-count">{popupUltrasoundCount}</div>
              </Card>
            </div>

            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setCalendarDetailDate(calendarPopupDate)} data-testid="button-calendar-popup-more-info">
                More Info
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!calendarDetailDate} onOpenChange={(open) => !open && setCalendarDetailDate(null)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-calendar-day-detail">
          <DialogHeader>
            <DialogTitle>
              {calendarDetailDate
                ? new Date(calendarDetailDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
                : "Day Detail"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div>
              <div className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Team Members On</div>
              {popupTeamMembers.length > 0 ? (
                <div className="space-y-1">
                  {popupTeamMembers.map((name) => (
                    <div key={name} className="text-sm text-slate-800">{name}</div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-500">No team members listed yet.</div>
              )}
            </div>

            <div>
              <div className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Day Totals</div>
              <div className="grid grid-cols-3 gap-3">
                <Card className="p-3">
                  <div className="text-xs text-slate-500 mb-1">BrainWave</div>
                  <div className="text-xl font-semibold text-slate-900">{popupBrainwaveCount}</div>
                </Card>
                <Card className="p-3">
                  <div className="text-xs text-slate-500 mb-1">VitalWave</div>
                  <div className="text-xl font-semibold text-slate-900">{popupVitalwaveCount}</div>
                </Card>
                <Card className="p-3">
                  <div className="text-xs text-slate-500 mb-1">Ultrasound</div>
                  <div className="text-xl font-semibold text-slate-900">{popupUltrasoundCount}</div>
                </Card>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">
                Patients Scheduled ({selectedMonthCell?.patients?.length ?? 0})
              </div>
              {(selectedMonthCell?.patients?.length ?? 0) > 0 ? (
                <div className="space-y-2">
                  {(selectedMonthCell?.patients ?? []).map((patient) => (
                    <Card key={patient.id} className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{patient.name}</div>
                          <div className="text-xs text-slate-500">{formatTime12(patient.time)}</div>
                        </div>
                        <div className="flex flex-wrap gap-1 justify-end">
                          {(patient.ancillaries ?? []).length > 0 ? (
                            patient.ancillaries.map((ancillary, idx) => (
                              <span
                                key={`${patient.id}-${ancillary}-${idx}`}
                                className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700"
                              >
                                {ancillary}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-slate-400">No ancillaries</span>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-500">No patients scheduled for this day.</div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
