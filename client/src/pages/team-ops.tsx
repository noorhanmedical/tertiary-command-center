import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Users2,
  Clock,
  Building2,
  Brain,
  Activity,
  CheckCircle2,
  Phone,
  CalendarCheck,
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  X,
  UserCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { OutreachScheduler, AncillaryAppointment } from "@shared/schema";
import { VALID_FACILITIES } from "@shared/plexus";
import { isBrainWave, formatTime12, toDateKey } from "@/components/clinic-calendar";

type OutreachSchedulerCard = {
  id: string;
  name: string;
  facility: string;
  totalPatients: number;
  touchedCount: number;
  scheduledCount: number;
  pendingCount: number;
  conversionRate: number;
};

type OutreachDashboard = {
  today: string;
  metrics: {
    schedulerCount: number;
    totalCalls: number;
    totalScheduled: number;
    totalPending: number;
    avgConversion: number;
    totalBooked: number;
  };
  schedulerCards: OutreachSchedulerCard[];
};

function shellClass() {
  return "rounded-3xl border border-white/60 bg-white/75 backdrop-blur-xl shadow-[0_18px_60px_rgba(15,23,42,0.10)]";
}

function facilityColor(facility: string) {
  if (facility.includes("Taylor")) return "bg-blue-600/10 text-blue-700 border-blue-200";
  if (facility.includes("Spring")) return "bg-emerald-600/10 text-emerald-700 border-emerald-200";
  if (facility.includes("Veteran")) return "bg-violet-600/10 text-violet-700 border-violet-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function facilityAccent(facility: string) {
  if (facility.includes("Taylor")) return "bg-blue-600";
  if (facility.includes("Spring")) return "bg-emerald-600";
  if (facility.includes("Veteran")) return "bg-violet-600";
  return "bg-slate-500";
}

type Tab = "staffing" | "technician";

export default function TeamOpsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>("staffing");
  const [assignDialog, setAssignDialog] = useState<{ open: boolean; editing: OutreachScheduler | null }>({
    open: false,
    editing: null,
  });
  const [formName, setFormName] = useState("");
  const [formFacility, setFormFacility] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<OutreachScheduler | null>(null);

  const { data: dashboard, isLoading: dashLoading } = useQuery<OutreachDashboard>({
    queryKey: ["/api/outreach/dashboard"],
    refetchInterval: 60_000,
  });

  const { data: schedulers = [], isLoading: schedulersLoading } = useQuery<OutreachScheduler[]>({
    queryKey: ["/api/outreach/schedulers"],
    refetchInterval: 60_000,
  });

  const { data: apptsTaylor = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments", "Taylor Family Practice"],
    queryFn: async () => {
      const res = await fetch(`/api/appointments?facility=${encodeURIComponent("Taylor Family Practice")}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const { data: apptsSpring = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments", "NWPG - Spring"],
    queryFn: async () => {
      const res = await fetch(`/api/appointments?facility=${encodeURIComponent("NWPG - Spring")}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const { data: apptsVets = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments", "NWPG - Veterans"],
    queryFn: async () => {
      const res = await fetch(`/api/appointments?facility=${encodeURIComponent("NWPG - Veterans")}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const allAppointments: Record<string, AncillaryAppointment[]> = {
    "Taylor Family Practice": apptsTaylor,
    "NWPG - Spring": apptsSpring,
    "NWPG - Veterans": apptsVets,
  };

  const _now = new Date();
  const todayStr = toDateKey(_now.getFullYear(), _now.getMonth(), _now.getDate());

  function todayAppts(facility: string) {
    return (allAppointments[facility] ?? []).filter(
      (a) => a.scheduledDate === todayStr && a.status === "scheduled"
    );
  }

  const createMutation = useMutation({
    mutationFn: (data: { name: string; facility: string }) =>
      apiRequest("POST", "/api/outreach/schedulers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/schedulers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
      toast({ title: "Scheduler assigned", description: `${formName} has been assigned to ${formFacility}.` });
      closeAssignDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Could not save scheduler assignment.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name: string; facility: string } }) =>
      apiRequest("PATCH", `/api/outreach/schedulers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/schedulers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
      toast({ title: "Assignment updated" });
      closeAssignDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Could not update assignment.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/outreach/schedulers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/schedulers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
      toast({ title: "Assignment removed" });
      setDeleteTarget(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Could not remove assignment.", variant: "destructive" });
    },
  });

  function openAddDialog() {
    setFormName("");
    setFormFacility("");
    setAssignDialog({ open: true, editing: null });
  }

  function openEditDialog(sc: OutreachScheduler) {
    setFormName(sc.name);
    setFormFacility(sc.facility);
    setAssignDialog({ open: true, editing: sc });
  }

  function closeAssignDialog() {
    setAssignDialog({ open: false, editing: null });
    setFormName("");
    setFormFacility("");
  }

  function handleSave() {
    if (!formName.trim() || !formFacility) return;
    if (assignDialog.editing) {
      updateMutation.mutate({ id: assignDialog.editing.id, data: { name: formName.trim(), facility: formFacility } });
    } else {
      createMutation.mutate({ name: formName.trim(), facility: formFacility });
    }
  }

  const schedulerCards = dashboard?.schedulerCards ?? [];
  const metrics = dashboard?.metrics ?? {
    schedulerCount: 0,
    totalCalls: 0,
    totalScheduled: 0,
    totalPending: 0,
    avgConversion: 0,
    totalBooked: 0,
  };

  function getSchedulerForFacility(facility: string) {
    return schedulers.find((s) => s.facility === facility) ?? null;
  }

  function getCardForFacility(facility: string): OutreachSchedulerCard | null {
    return schedulerCards.find((c) => c.facility === facility) ?? null;
  }

  const isLoading = dashLoading || schedulersLoading;

  return (
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-6">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-violet-600/10 p-3 text-violet-700">
              <Users2 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Team Ops</h1>
              <p className="text-sm text-slate-600">
                Staffing authority, coverage coordination, and technician scheduling.
              </p>
            </div>
          </div>
          {activeTab === "staffing" && (
            <Button
              data-testid="button-add-scheduler"
              onClick={openAddDialog}
              className="rounded-2xl bg-violet-600 hover:bg-violet-700 text-white gap-2"
            >
              <Plus className="h-4 w-4" />
              Assign Scheduler
            </Button>
          )}
        </div>

        {/* Metrics strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Schedulers", value: metrics.schedulerCount, Icon: Users2, color: "bg-violet-600/10 text-violet-700" },
            { label: "Calls Worked", value: metrics.totalCalls, Icon: Phone, color: "bg-blue-600/10 text-blue-700" },
            { label: "Scheduled Today", value: metrics.totalScheduled, Icon: CheckCircle2, color: "bg-green-600/10 text-green-700" },
            { label: "Pending Outreach", value: metrics.totalPending, Icon: Clock, color: "bg-amber-500/10 text-amber-700" },
          ].map(({ label, value, Icon, color }) => (
            <Card key={label} className={`${shellClass()} flex items-center gap-3 px-4 py-3`}>
              <div className={`rounded-xl p-2 ${color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</p>
                <p className="text-xl font-bold text-slate-900 leading-none mt-0.5" data-testid={`metric-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</p>
              </div>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-2xl bg-white/60 border border-white/60 backdrop-blur p-1 w-fit">
          {([
            { id: "staffing" as Tab, label: "Staffing & Coverage", Icon: Building2 },
            { id: "technician" as Tab, label: "Technician Schedule", Icon: Clock },
          ]).map(({ id, label, Icon }) => (
            <button
              key={id}
              data-testid={`tab-${id}`}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                activeTab === id
                  ? "bg-white shadow-sm text-slate-900"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "staffing" && (
          <div className="flex flex-col gap-5">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-600 border-t-transparent" />
              </div>
            ) : (
              <>
                {/* Facility coverage cards */}
                <div className="grid gap-4 md:grid-cols-3">
                  {VALID_FACILITIES.map((facility) => {
                    const sc = getSchedulerForFacility(facility);
                    const card = getCardForFacility(facility);
                    const techToday = todayAppts(facility);
                    return (
                      <Card
                        key={facility}
                        data-testid={`coverage-card-${facility.toLowerCase().replace(/\s+/g, "-")}`}
                        className={`${shellClass()} p-5 flex flex-col gap-4`}
                      >
                        {/* Facility header */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${facilityAccent(facility)}`} />
                            <span className="text-sm font-semibold text-slate-800 truncate">{facility}</span>
                          </div>
                          <Badge
                            className={`text-[10px] px-2 py-0.5 border ${facilityColor(facility)} flex-shrink-0`}
                          >
                            {sc ? "Covered" : "Unassigned"}
                          </Badge>
                        </div>

                        {/* Scheduler info */}
                        <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2.5">
                          <div className={`rounded-xl p-1.5 ${sc ? "bg-violet-100 text-violet-600" : "bg-slate-200 text-slate-400"}`}>
                            <UserCheck className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-wide font-medium text-slate-400">Scheduler</p>
                            <p className={`text-sm font-semibold truncate ${sc ? "text-slate-800" : "text-slate-400 italic"}`}>
                              {sc ? sc.name : "Unassigned"}
                            </p>
                          </div>
                          {sc && (
                            <div className="ml-auto flex gap-1">
                              <button
                                data-testid={`button-edit-scheduler-${sc.id}`}
                                onClick={() => openEditDialog(sc)}
                                className="rounded-lg p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                data-testid={`button-delete-scheduler-${sc.id}`}
                                onClick={() => setDeleteTarget(sc)}
                                className="rounded-lg p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Today's metrics */}
                        {card ? (
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-xl bg-slate-50 py-2">
                              <p className="text-lg font-bold text-slate-800 leading-none">{card.totalPatients}</p>
                              <p className="text-[9px] uppercase tracking-wide text-slate-400 mt-0.5">Total</p>
                            </div>
                            <div className="rounded-xl bg-green-50 py-2">
                              <p className="text-lg font-bold text-green-700 leading-none">{card.scheduledCount}</p>
                              <p className="text-[9px] uppercase tracking-wide text-green-500 mt-0.5">Scheduled</p>
                            </div>
                            <div className="rounded-xl bg-amber-50 py-2">
                              <p className="text-lg font-bold text-amber-700 leading-none">{card.pendingCount}</p>
                              <p className="text-[9px] uppercase tracking-wide text-amber-500 mt-0.5">Pending</p>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-center">
                            <p className="text-xs text-slate-400 italic">No outreach activity today</p>
                          </div>
                        )}

                        {/* Conversion rate */}
                        {card && card.totalPatients > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-green-500 transition-all"
                                style={{ width: `${card.conversionRate}%` }}
                              />
                            </div>
                            <span className="text-xs font-semibold text-slate-500">{card.conversionRate}%</span>
                          </div>
                        )}

                        {/* Tech appointments today */}
                        {techToday.length > 0 && (
                          <div className="rounded-xl bg-violet-50 px-3 py-2 flex items-center gap-2">
                            <CalendarCheck className="h-3.5 w-3.5 text-violet-600 flex-shrink-0" />
                            <span className="text-xs text-violet-700 font-medium">
                              {techToday.length} tech appt{techToday.length !== 1 ? "s" : ""} today
                            </span>
                          </div>
                        )}

                        {/* No scheduler warning */}
                        {!sc && (
                          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2">
                            <AlertCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                            <span className="text-xs text-amber-700">No scheduler assigned</span>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>

                {/* Scheduler roster table */}
                {schedulers.length > 0 && (
                  <Card className={`${shellClass()} p-5`}>
                    <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                      <Users2 className="h-4 w-4 text-violet-600" />
                      Scheduler Roster
                    </h2>
                    <div className="divide-y divide-slate-100">
                      {schedulers.map((sc) => {
                        const card = getCardForFacility(sc.facility);
                        return (
                          <div
                            key={sc.id}
                            data-testid={`roster-row-${sc.id}`}
                            className="flex flex-wrap items-center gap-3 py-3"
                          >
                            <div className={`h-2 w-2 rounded-full flex-shrink-0 ${facilityAccent(sc.facility)}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-800">{sc.name}</p>
                              <p className="text-xs text-slate-400">{sc.facility}</p>
                            </div>
                            {card && (
                              <div className="flex items-center gap-3 text-xs">
                                <span className="text-slate-500">{card.totalPatients} patients</span>
                                <span className="text-green-600 font-medium">{card.scheduledCount} scheduled</span>
                                <span className="text-slate-400">{card.conversionRate}% conv.</span>
                              </div>
                            )}
                            <div className="flex gap-1">
                              <Button
                                data-testid={`button-edit-roster-${sc.id}`}
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 rounded-lg text-slate-500 hover:text-slate-700"
                                onClick={() => openEditDialog(sc)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                data-testid={`button-delete-roster-${sc.id}`}
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 rounded-lg text-slate-500 hover:text-red-600"
                                onClick={() => setDeleteTarget(sc)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === "technician" && (
          <div className="flex flex-col gap-5">
            <div className="grid gap-5 md:grid-cols-3">
              {VALID_FACILITIES.map((facility) => {
                const appts = allAppointments[facility] ?? [];
                const todayList = todayAppts(facility);
                const bwCount = todayList.filter((a) => isBrainWave(a.testType)).length;
                const vwCount = todayList.filter((a) => !isBrainWave(a.testType)).length;
                const sc = getSchedulerForFacility(facility);

                return (
                  <Card
                    key={facility}
                    data-testid={`tech-card-${facility.toLowerCase().replace(/\s+/g, "-")}`}
                    className={`${shellClass()} p-5 flex flex-col gap-4`}
                  >
                    {/* Facility header */}
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${facilityAccent(facility)}`} />
                      <span className="text-sm font-semibold text-slate-800">{facility}</span>
                    </div>

                    {/* Counts */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-2xl bg-violet-50 px-3 py-2.5 flex items-center gap-2">
                        <Brain className="h-4 w-4 text-violet-600 flex-shrink-0" />
                        <div>
                          <p className="text-lg font-bold text-violet-700 leading-none">{bwCount}</p>
                          <p className="text-[9px] uppercase tracking-wide text-violet-400 mt-0.5">BrainWave</p>
                        </div>
                      </div>
                      <div className="rounded-2xl bg-red-50 px-3 py-2.5 flex items-center gap-2">
                        <Activity className="h-4 w-4 text-red-500 flex-shrink-0" />
                        <div>
                          <p className="text-lg font-bold text-red-600 leading-none">{vwCount}</p>
                          <p className="text-[9px] uppercase tracking-wide text-red-400 mt-0.5">VitalWave</p>
                        </div>
                      </div>
                    </div>

                    {/* Scheduler coverage */}
                    <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                      <UserCheck className={`h-3.5 w-3.5 flex-shrink-0 ${sc ? "text-violet-500" : "text-slate-300"}`} />
                      <span className={`text-xs font-medium ${sc ? "text-slate-700" : "text-slate-400 italic"}`}>
                        {sc ? `Scheduler: ${sc.name}` : "No scheduler assigned"}
                      </span>
                    </div>

                    {/* Today's appointment list */}
                    {todayList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-5 text-slate-400 gap-2">
                        <CalendarCheck className="h-7 w-7 opacity-30" />
                        <p className="text-xs">No appointments today</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                        {todayList
                          .slice()
                          .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))
                          .map((appt) => (
                            <div
                              key={appt.id}
                              data-testid={`appt-row-${appt.id}`}
                              className="flex items-center justify-between rounded-xl bg-white border border-slate-100 px-3 py-2 gap-2"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-700 truncate">{appt.patientName}</p>
                                <p className="text-[10px] text-slate-400">{formatTime12(appt.scheduledTime)}</p>
                              </div>
                              <Badge
                                className={`text-[9px] px-1.5 py-0 flex-shrink-0 ${isBrainWave(appt.testType) ? "bg-violet-100 text-violet-700 border-violet-200" : "bg-red-100 text-red-600 border-red-200"}`}
                              >
                                {isBrainWave(appt.testType) ? "BW" : "VW"}
                              </Badge>
                            </div>
                          ))}
                      </div>
                    )}

                    {/* All appointments count */}
                    <p className="text-[10px] text-slate-400 text-right">
                      {appts.filter((a) => a.status === "scheduled").length} total scheduled (all dates)
                    </p>
                  </Card>
                );
              })}
            </div>

            {/* Summary footer */}
            <Card className={`${shellClass()} px-5 py-4 flex flex-wrap gap-6 items-center`}>
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-violet-600" />
                <span className="text-sm font-semibold text-slate-700">
                  {VALID_FACILITIES.reduce((sum, f) => sum + todayAppts(f).filter((a) => isBrainWave(a.testType)).length, 0)} BrainWave today
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-red-500" />
                <span className="text-sm font-semibold text-slate-700">
                  {VALID_FACILITIES.reduce((sum, f) => sum + todayAppts(f).filter((a) => !isBrainWave(a.testType)).length, 0)} VitalWave today
                </span>
              </div>
              <div className="ml-auto text-xs text-slate-400">
                Showing appointments for {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Assign / Edit Dialog */}
      <Dialog open={assignDialog.open} onOpenChange={(open) => { if (!open) closeAssignDialog(); }}>
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{assignDialog.editing ? "Edit Scheduler Assignment" : "Assign Scheduler"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="scheduler-name">Scheduler Name</Label>
              <Input
                id="scheduler-name"
                data-testid="input-scheduler-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="scheduler-facility">Facility</Label>
              <Select value={formFacility} onValueChange={setFormFacility}>
                <SelectTrigger id="scheduler-facility" data-testid="select-facility">
                  <SelectValue placeholder="Select a facility" />
                </SelectTrigger>
                <SelectContent>
                  {VALID_FACILITIES.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-2xl" onClick={closeAssignDialog}>
              Cancel
            </Button>
            <Button
              data-testid="button-save-assignment"
              className="rounded-2xl bg-violet-600 hover:bg-violet-700 text-white"
              disabled={!formName.trim() || !formFacility || createMutation.isPending || updateMutation.isPending}
              onClick={handleSave}
            >
              {assignDialog.editing ? "Save Changes" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="rounded-3xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Assignment?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500 py-1">
            This will remove <span className="font-semibold text-slate-700">{deleteTarget?.name}</span> from{" "}
            <span className="font-semibold text-slate-700">{deleteTarget?.facility}</span>. The facility will show as unassigned.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-2xl" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              data-testid="button-confirm-delete"
              variant="destructive"
              className="rounded-2xl"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
