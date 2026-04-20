import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Phone,
  Users2,
  CalendarCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type OutreachSchedulerCard = {
  id: string;
  name: string;
  facility: string;
  capacityPercent: number;
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
  uncoveredFacilities: string[];
};

function shellClass() {
  return "rounded-3xl border border-white/60 bg-white/75 backdrop-blur-xl shadow-[0_18px_60px_rgba(15,23,42,0.10)]";
}

function formatDisplayDate(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "Unscheduled";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function OutreachPage() {
  const { data, isLoading } = useQuery<OutreachDashboard>({
    queryKey: ["/api/outreach/dashboard"],
    refetchInterval: 60_000,
  });

  const schedulerCards = data?.schedulerCards ?? [];
  const metrics = data?.metrics ?? { schedulerCount: 0, totalCalls: 0, totalScheduled: 0, totalPending: 0, avgConversion: 0, totalBooked: 0 };
  const uncoveredFacilities = data?.uncoveredFacilities ?? [];

  const METRIC_CARDS = [
    { label: "Schedulers",     value: metrics.schedulerCount,      Icon: Users2,        color: "bg-slate-900/5 text-slate-700"   },
    { label: "Calls Worked",   value: metrics.totalCalls,          Icon: Phone,         color: "bg-blue-600/10 text-blue-700"    },
    { label: "Scheduled",      value: metrics.totalScheduled,      Icon: CheckCircle2,  color: "bg-green-600/10 text-green-700"  },
    { label: "Booked Today",   value: metrics.totalBooked,         Icon: CalendarCheck, color: "bg-emerald-600/10 text-emerald-700" },
    { label: "Pending",        value: metrics.totalPending,        Icon: Clock3,        color: "bg-amber-500/10 text-amber-700"  },
    { label: "Avg Conversion", value: `${metrics.avgConversion}%`, Icon: CalendarDays,  color: "bg-violet-600/10 text-violet-700" },
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
                Pick a scheduler to open their portal.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="rounded-full border-blue-200 bg-blue-50 px-3 py-1 text-blue-700">
            {formatDisplayDate(data?.today)}
          </Badge>
        </div>

        {/* Metrics */}
        <Card className={`${shellClass()} px-4 py-2`}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:flex-nowrap sm:divide-x sm:divide-slate-200/70">
            {METRIC_CARDS.map(({ label, value, Icon, color }) => (
              <div
                key={label}
                className="flex flex-1 items-center gap-2 px-2 py-1 sm:first:pl-0 sm:last:pr-0"
                data-testid={`metric-${label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className={`rounded-lg p-1.5 ${color}`}><Icon className="h-4 w-4" /></div>
                <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</span>
                <span className="ml-auto text-base font-semibold text-slate-900">{value}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Uncovered clinic warning */}
        {uncoveredFacilities.length > 0 && (
          <div
            className="flex flex-wrap items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3"
            data-testid="uncovered-clinics-warning"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="flex-1 text-sm text-amber-800">
              <span className="font-semibold">No scheduler assigned</span> for{" "}
              {uncoveredFacilities.length === 1
                ? <span className="font-medium">{uncoveredFacilities[0]}</span>
                : (
                  <>
                    {uncoveredFacilities.slice(0, -1).map((f, i) => (
                      <span key={f}>
                        <span className="font-medium">{f}</span>
                        {i < uncoveredFacilities.length - 2 ? ", " : ""}
                      </span>
                    ))}
                    {" "}and{" "}
                    <span className="font-medium">{uncoveredFacilities[uncoveredFacilities.length - 1]}</span>
                  </>
                )
              }
              {". "}Patients from {uncoveredFacilities.length === 1 ? "this clinic" : "these clinics"} will appear under an Unassigned card.{" "}
              <Link href="/settings" className="font-medium underline underline-offset-2 hover:text-amber-900" data-testid="uncovered-clinics-settings-link">
                Add a scheduler in Settings
              </Link>
              .
            </div>
          </div>
        )}

        {/* Compact scheduler card grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-white/60" />
            ))}
          </div>
        ) : schedulerCards.length === 0 ? (
          <div className={`${shellClass()} px-6 py-12 text-center text-sm text-slate-500`}>
            No schedule data for today. Add schedulers in{" "}
            <Link href="/settings" className="text-blue-600 underline underline-offset-2">Settings</Link>.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {schedulerCards.map((card) => (
              <SchedulerTileCard key={card.id} card={card} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SchedulerTileCard({ card }: { card: OutreachSchedulerCard }) {
  const open = card.pendingCount;
  const scheduled = card.scheduledCount;
  return (
    <Card
      className="group flex h-40 flex-col justify-between rounded-2xl border border-white/60 bg-white/90 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)] backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(15,23,42,0.10)]"
      data-testid={`outreach-scheduler-card-${card.id}`}
    >
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400" data-testid={`scheduler-facility-${card.id}`}>
          {card.facility}
        </p>
        <h2 className="mt-1 truncate text-base font-semibold leading-snug text-slate-900" data-testid={`scheduler-name-${card.id}`}>
          {card.name}
        </h2>
        <p className="mt-1 text-[11px] text-slate-500" data-testid={`scheduler-metric-${card.id}`}>
          {open} open · {scheduled} scheduled
        </p>
      </div>
      <Button
        asChild
        size="sm"
        className="group/btn mt-3 h-9 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 px-3 text-xs font-semibold text-white shadow-[0_6px_16px_rgba(67,56,202,0.35)] transition hover:from-indigo-700 hover:to-indigo-800 hover:shadow-[0_8px_22px_rgba(67,56,202,0.45)]"
        data-testid={`outreach-open-portal-${card.id}`}
      >
        <Link href={`/outreach/scheduler/${encodeURIComponent(card.id)}`}>
          <span>Open Portal</span>
          <ChevronRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-0.5" />
        </Link>
      </Button>
    </Card>
  );
}
