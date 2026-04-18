import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Phone,
  Search,
  Stethoscope,
  Users2,
  PhoneMissed,
  PhoneCall,
  CalendarCheck,
  XCircle,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type OutreachCallItem = {
  id: string;
  patientId: number;
  patientName: string;
  facility: string;
  phoneNumber: string;
  insurance: string;
  qualifyingTests: string[];
  appointmentStatus: string;
  patientType: string;
  batchId: number;
  scheduleDate: string;
  time: string;
  providerName: string;
};

type OutreachSchedulerCard = {
  id: string;
  name: string;
  facility: string;
  totalPatients: number;
  touchedCount: number;
  scheduledCount: number;
  pendingCount: number;
  conversionRate: number;
  callList: OutreachCallItem[];
};

type OutreachDashboard = {
  today: string;
  metrics: {
    schedulerCount: number;
    totalCalls: number;
    totalScheduled: number;
    totalPending: number;
    avgConversion: number;
  };
  schedulerCards: OutreachSchedulerCard[];
};

const CALL_OUTCOMES = [
  {
    value: "no_answer",
    label: "No Answer",
    Icon: PhoneMissed,
    color: "bg-slate-100 text-slate-600 hover:bg-slate-200 border-slate-200",
  },
  {
    value: "callback",
    label: "Callback",
    Icon: PhoneCall,
    color: "bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200",
  },
  {
    value: "scheduled",
    label: "Scheduled",
    Icon: CalendarCheck,
    color: "bg-green-50 text-green-700 hover:bg-green-100 border-green-200",
  },
  {
    value: "declined",
    label: "Declined",
    Icon: XCircle,
    color: "bg-red-50 text-red-600 hover:bg-red-100 border-red-200",
  },
] as const;

function shellClass(active = false) {
  return [
    "rounded-3xl border border-white/60 bg-white/75 backdrop-blur-xl shadow-[0_18px_60px_rgba(15,23,42,0.10)] transition-all",
    active
      ? "ring-2 ring-blue-200/80 shadow-[0_24px_80px_rgba(59,130,246,0.16)]"
      : "hover:shadow-[0_24px_80px_rgba(15,23,42,0.14)]",
  ].join(" ");
}

function statusBadgeClass(status?: string | null) {
  const n = String(status || "pending").toLowerCase();
  if (n.includes("scheduled") || n.includes("booked"))
    return "bg-green-100 text-green-700 border-green-200";
  if (n.includes("complete")) return "bg-blue-100 text-blue-700 border-blue-200";
  if (n.includes("cancel") || n.includes("declined")) return "bg-red-100 text-red-700 border-red-200";
  if (n === "no_answer") return "bg-slate-100 text-slate-600 border-slate-200";
  if (n === "callback") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-amber-100 text-amber-700 border-amber-200";
}

function statusLabel(status?: string | null) {
  const n = String(status || "pending").toLowerCase();
  if (n === "no_answer") return "No Answer";
  if (n === "callback") return "Callback";
  return status || "pending";
}

function formatDisplayDate(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "Unscheduled";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function OutreachPage() {
  const [selectedSchedulerId, setSelectedSchedulerId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pendingPatientId, setPendingPatientId] = useState<number | null>(null);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<OutreachDashboard>({
    queryKey: ["/api/outreach/dashboard"],
    refetchInterval: 60_000,
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ patientId, appointmentStatus }: { patientId: number; appointmentStatus: string }) =>
      apiRequest("PATCH", `/api/patients/${patientId}`, { appointmentStatus }),
    onMutate: ({ patientId }) => {
      setPendingPatientId(patientId);
    },
    onError: () => {
      toast({
        title: "Update failed",
        description: "Could not save the call outcome. Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setPendingPatientId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
    },
  });

  const schedulerCards = data?.schedulerCards ?? [];
  const metrics = data?.metrics ?? {
    schedulerCount: 0,
    totalCalls: 0,
    totalScheduled: 0,
    totalPending: 0,
    avgConversion: 0,
  };

  const selectedScheduler = useMemo(
    () =>
      schedulerCards.length
        ? (schedulerCards.find((c) => c.id === selectedSchedulerId) ?? schedulerCards[0])
        : null,
    [schedulerCards, selectedSchedulerId],
  );

  const filteredCallList = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = selectedScheduler?.callList ?? [];
    if (!q) return list;
    return list.filter(
      (item) =>
        item.patientName.toLowerCase().includes(q) ||
        item.facility.toLowerCase().includes(q) ||
        item.providerName.toLowerCase().includes(q) ||
        item.qualifyingTests.join(" ").toLowerCase().includes(q),
    );
  }, [search, selectedScheduler]);

  const METRIC_CARDS = [
    { label: "Schedulers",     value: metrics.schedulerCount,  Icon: Users2,       color: "bg-slate-900/5 text-slate-700"   },
    { label: "Calls Worked",   value: metrics.totalCalls,      Icon: Phone,        color: "bg-blue-600/10 text-blue-700"    },
    { label: "Scheduled",      value: metrics.totalScheduled,  Icon: CheckCircle2, color: "bg-green-600/10 text-green-700"  },
    { label: "Pending",        value: metrics.totalPending,    Icon: Clock3,       color: "bg-amber-500/10 text-amber-700"  },
    { label: "Avg Conversion", value: `${metrics.avgConversion}%`, Icon: CalendarDays, color: "bg-violet-600/10 text-violet-700" },
  ] as const;

  return (
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-6 py-6">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="outline" className="rounded-2xl border-white/60 bg-white/80 backdrop-blur">
              <Link href="/"><ArrowLeft className="mr-2 h-4 w-4" />Back</Link>
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <div className="rounded-2xl bg-blue-600/10 p-2 text-blue-700">
                  <Phone className="h-5 w-5" />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Outreach</h1>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                Scheduler team-member cards backed by today's canonical schedule.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="rounded-full border-blue-200 bg-blue-50 px-3 py-1 text-blue-700">
            {formatDisplayDate(data?.today)}
          </Badge>
        </div>

        {/* Metrics */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {METRIC_CARDS.map(({ label, value, Icon, color }) => (
            <Card key={label} className={`${shellClass()} p-5`}>
              <div className="flex items-center gap-3">
                <div className={`rounded-2xl p-2 ${color}`}><Icon className="h-5 w-5" /></div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">{label}</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Main grid */}
        <div className="grid gap-6 xl:grid-cols-[1.05fr_1.4fr]">

          {/* Scheduler cards */}
          <Card className={`${shellClass()} p-5`}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Scheduler Team Members</h2>
                <p className="text-sm text-slate-500">Each card owns the call list for their assigned clinic.</p>
              </div>
              <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                {schedulerCards.length} active
              </Badge>
            </div>

            {isLoading ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
                Loading outreach data…
              </div>
            ) : schedulerCards.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
                No schedule data for today. Add schedulers in{" "}
                <Link href="/settings" className="text-blue-600 underline underline-offset-2">Settings</Link>.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {schedulerCards.map((card) => {
                  const active = selectedScheduler?.id === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => setSelectedSchedulerId(card.id)}
                      className={`text-left ${shellClass(active)} p-5`}
                      data-testid={`outreach-scheduler-card-${card.id}`}
                    >
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">{card.name}</h3>
                        <p className="mt-0.5 text-xs text-slate-500">{card.facility}</p>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-3">
                        <div className="rounded-2xl bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Calls</p>
                          <p className="mt-1 text-xl font-semibold text-slate-900">{card.touchedCount}</p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Scheduled</p>
                          <p className="mt-1 text-xl font-semibold text-slate-900">{card.scheduledCount}</p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Conv.</p>
                          <p className="mt-1 text-xl font-semibold text-slate-900">{card.conversionRate}%</p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge className="rounded-full bg-blue-50 text-blue-700 hover:bg-blue-50">
                          {card.totalPatients} patients
                        </Badge>
                        <Badge className="rounded-full bg-amber-50 text-amber-700 hover:bg-amber-50">
                          {card.pendingCount} pending
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Call list */}
          <Card className={`${shellClass()} p-5`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {selectedScheduler ? `${selectedScheduler.name} — Call List` : "Call List"}
                </h2>
                <p className="text-sm text-slate-500">Provider shown for ancillary order context.</p>
              </div>
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search patient, clinic, provider, or test"
                  className="rounded-2xl border-white/60 bg-white/90 pl-9"
                  data-testid="outreach-search-input"
                />
              </div>
            </div>

            {!selectedScheduler ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
                Select a scheduler card to view the call list.
              </div>
            ) : filteredCallList.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
                No patients match this search.
              </div>
            ) : (
              <div className="max-h-[680px] space-y-3 overflow-y-auto pr-1">
                {filteredCallList.map((item) => {
                  const isBusy = pendingPatientId === item.patientId && updateStatusMutation.isPending;
                  const currentStatus = item.appointmentStatus.toLowerCase();
                  return (
                    <div
                      key={item.id}
                      className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:border-blue-200 hover:shadow-md"
                      data-testid={`outreach-call-item-${item.patientId}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-slate-900">{item.patientName}</h3>
                            <Badge
                              className={`rounded-full border text-xs ${statusBadgeClass(item.appointmentStatus)}`}
                              data-testid={`status-badge-${item.patientId}`}
                            >
                              {statusLabel(item.appointmentStatus)}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                            <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{item.time}</span>
                            <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{item.facility}</span>
                            <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{item.phoneNumber}</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 rounded-2xl bg-slate-50 p-3">
                        <div className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                          <Stethoscope className="h-3.5 w-3.5" />
                          Provider
                        </div>
                        <p className="mt-1 text-sm font-medium text-slate-800">{item.providerName}</p>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-600 text-xs">{item.patientType}</Badge>
                        <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-600 text-xs">{item.insurance}</Badge>
                        <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-600 text-xs">Batch {item.batchId}</Badge>
                      </div>

                      {item.qualifyingTests.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.qualifyingTests.map((test) => (
                            <Badge key={`${item.id}-${test}`} className="rounded-full bg-blue-50 text-blue-700 text-xs hover:bg-blue-50">
                              {test}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {/* Call outcome actions */}
                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Outcome</span>
                        {CALL_OUTCOMES.map(({ value, label, Icon, color }) => {
                          const isActive = currentStatus === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                updateStatusMutation.mutate({
                                  patientId: item.patientId,
                                  appointmentStatus: isActive ? "pending" : value,
                                })
                              }
                              className={[
                                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
                                color,
                                isActive
                                  ? "ring-2 ring-offset-1 ring-current opacity-100"
                                  : "opacity-80",
                                isBusy ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                              ].join(" ")}
                              data-testid={`outcome-btn-${value}-${item.patientId}`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              {label}
                            </button>
                          );
                        })}
                        {currentStatus !== "pending" && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              updateStatusMutation.mutate({
                                patientId: item.patientId,
                                appointmentStatus: "pending",
                              })
                            }
                            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500 opacity-70 transition hover:bg-slate-50 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                            data-testid={`outcome-reset-${item.patientId}`}
                          >
                            <RotateCcw className="h-3 w-3" />
                            Reset
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
