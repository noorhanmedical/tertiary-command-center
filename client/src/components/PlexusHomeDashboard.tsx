import React from "react";
import {
  Brain,
  Building2,
  CalendarDays,
  CheckSquare,
  CircleDollarSign,
  CreditCard,
  HeartPulse,
  Phone,
  Sparkles,
  Users,
  WalletCards,
  Waves,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { WorldTimeCard } from "@/components/world-time/WorldTimeCard";
import { slugify } from "@/lib/worldTime/locations";
import type { WorldTimeImagePublicMap } from "@/lib/worldTime/types";

/*
|--------------------------------------------------------------------------
| TYPES — WIRE THESE TO YOUR REAL BACKEND DATA
|--------------------------------------------------------------------------
*/
export type PulseMetric = {
  label: string;
  value: string | number;
  delta?: string;
  helper?: string;
};

export type ClinicRow = {
  id: string | number;
  name: string;
  patients: number | string;
  studies: number | string;
  calls: number | string;
  revenue: string;
  // Optional: only rendered when a real clinic-health source backs it.
  status?: "On Track" | "Needs Review" | "At Risk";
};

export type ClockItem = {
  city: string;
  time: string;
  timezone: string;
  date: string;
  /** Real local time in the zone, for the analog clock hands. */
  hours: number;
  minutes: number;
};

export type TaskItem = {
  label: string;
  count: number;
  due: string;
  tone?: "red" | "amber" | "blue";
};

export type ScheduleItem = {
  time: string;
  label: string;
  count: number;
  tone?: "blue" | "green" | "amber";
};

export type HomeDashboardData = {
  userName: string;
  dateLabel: string;
  pulse: {
    patients: PulseMetric;
    calls: PulseMetric;
    revenue: PulseMetric;
    collections: PulseMetric;
    outstandingAR: PulseMetric;
    brainWave: PulseMetric;
    vitalWave: PulseMetric;
    ultrasound: PulseMetric;
  };
  clinics: ClinicRow[];
  today: {
    newPatients: PulseMetric;
    completedStudies: PulseMetric;
    revenue: PulseMetric;
  };
  tasks: TaskItem[];
  schedule: ScheduleItem[];
  clocks: ClockItem[];
};

export type PlexusHomeDashboardProps = {
  data: HomeDashboardData;
  onOpenPlexusIq?: () => void;
  onNewPatient?: () => void;
};

/*
|--------------------------------------------------------------------------
| HOME  — main content only. The app-level left rail/sidebar is unchanged.
|--------------------------------------------------------------------------
*/
export function PlexusHomeDashboard({ data, onOpenPlexusIq, onNewPatient }: PlexusHomeDashboardProps) {
  return (
    <div className="min-h-full bg-[#e2e8f0] text-[#172033]">
      {/* pb-28 keeps content clear of the floating GlobalDock. */}
      <div className="mx-auto w-full max-w-[1600px] px-6 pt-6 pb-28">
        {/* PAGE HEADER */}
        <section className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="text-[31px] font-normal tracking-[-0.025em] text-[#172033]">
              Good morning, {data.userName}
              <span className="ml-2 text-[#5775df]">❄</span>
            </h1>
            <p className="mt-1 text-[13px] text-[#77859a]">
              Here&apos;s what&apos;s happening across your practice today.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              className="h-10 rounded-[9px] bg-[#101b3e] px-4 text-[13px] font-semibold text-white shadow-sm"
              onClick={onNewPatient}
              data-testid="home-new-patient"
            >
              + New Patient
            </button>
          </div>
        </section>

        {/* PRACTICE PULSE */}
        <section className="mb-4 rounded-[13px] border border-[#e1e7ef] bg-white/85 backdrop-blur-sm px-6 py-6 shadow-[0_5px_20px_rgba(23,32,51,0.04)]">
          <div className="grid grid-cols-2 divide-x divide-[#e4eaf1] md:grid-cols-4 xl:grid-cols-8">
            <PulseCell icon={<Users />} metric={data.pulse.patients} />
            <PulseCell icon={<Phone />} metric={data.pulse.calls} />
            <PulseCell icon={<CircleDollarSign />} metric={data.pulse.revenue} />
            <PulseCell icon={<WalletCards />} metric={data.pulse.collections} />
            <PulseCell icon={<CreditCard />} metric={data.pulse.outstandingAR} />
            <PulseCell icon={<Brain />} metric={data.pulse.brainWave} />
            <PulseCell icon={<HeartPulse />} metric={data.pulse.vitalWave} />
            <PulseCell icon={<Waves />} metric={data.pulse.ultrasound} />
          </div>
        </section>

        {/* WORLD TIME */}
        <WorldTimeClocksRow clocks={data.clocks} />

        {/* MAIN DASHBOARD GRID */}
        <section className="mb-4 grid gap-4 xl:grid-cols-[1.55fr_1fr]">
          {/* LEFT */}
          <div className="space-y-4">
            {/* NETWORK OVERVIEW */}
            <DashboardPanel>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-[#415578]" />
                  <h2 className="text-[18px] font-semibold text-[#101a2e]">Network Overview</h2>
                </div>
                <button className="text-[12px] font-medium text-[#365fd5]">View all clinics</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse">
                  <thead>
                    <tr className="border-b border-[#e4eaf1] text-left text-[11px] text-[#617089]">
                      <th className="pb-3 font-medium">Clinic</th>
                      <th className="pb-3 text-center font-medium">Patients</th>
                      <th className="pb-3 text-center font-medium">Studies</th>
                      <th className="pb-3 text-center font-medium">Calls</th>
                      <th className="pb-3 text-right font-medium">Revenue</th>
                      <th className="pb-3 text-center font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.clinics.slice(0, 5).map((clinic) => (
                      <tr key={clinic.id} className="border-b border-[#edf1f5] text-[12px] last:border-b-0">
                        <td className="py-3 font-medium text-[#1e2a3f]">{clinic.name}</td>
                        <td className="py-3 text-center">{clinic.patients}</td>
                        <td className="py-3 text-center">{clinic.studies}</td>
                        <td className="py-3 text-center">{clinic.calls}</td>
                        <td className="py-3 text-right font-medium">{clinic.revenue}</td>
                        <td className="py-3 text-center">
                          {clinic.status ? <ClinicStatus status={clinic.status} /> : <span className="text-[#a9b3c2]">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-[#edf1f5] pt-3">
                <span className="text-[11px] text-[#8390a4]">
                  Showing 1–{Math.min(5, data.clinics.length)} of {data.clinics.length} clinics
                </span>
                <div className="flex items-center gap-1">
                  <PaginationButton>‹</PaginationButton>
                  <PaginationButton active>1</PaginationButton>
                  <PaginationButton>2</PaginationButton>
                  <PaginationButton>›</PaginationButton>
                </div>
              </div>
            </DashboardPanel>

            {/* PLEXUS IQ — full-card dark ethereal hero button (whole thing clickable) */}
            <button
              type="button"
              onClick={onOpenPlexusIq}
              data-testid="home-open-plexus-iq"
              className="group relative flex min-h-[180px] w-full items-center justify-center overflow-hidden rounded-[14px] text-white shadow-lg ring-1 ring-white/10 transition hover:ring-white/20"
              style={{
                background:
                  "radial-gradient(120% 140% at 50% 0%, rgba(92,88,220,0.30) 0%, rgba(10,15,36,0) 55%), linear-gradient(160deg, #0c1230 0%, #070a1a 60%, #05070f 100%)",
              }}
            >
              {/* Soft ethereal glow that lifts on hover */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-80 transition-opacity duration-300 group-hover:opacity-100"
                style={{ background: "radial-gradient(65% 90% at 50% 50%, rgba(120,150,255,0.26) 0%, transparent 70%)" }}
              />
              {/* Brighter core bloom behind the wordmark */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 h-32 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
                style={{ background: "radial-gradient(circle, rgba(150,175,255,0.45) 0%, transparent 70%)" }}
              />
              {/* Shining stars */}
              <span aria-hidden="true" className="pointer-events-none absolute inset-0">
                {[
                  { l: "12%", t: "30%", s: 2, d: "0s" },
                  { l: "20%", t: "66%", s: 1, d: "0.6s" },
                  { l: "31%", t: "42%", s: 1, d: "1.2s" },
                  { l: "42%", t: "22%", s: 2, d: "0.3s" },
                  { l: "57%", t: "72%", s: 1, d: "0.9s" },
                  { l: "66%", t: "32%", s: 2, d: "1.5s" },
                  { l: "76%", t: "60%", s: 1, d: "0.4s" },
                  { l: "85%", t: "26%", s: 2, d: "1.1s" },
                  { l: "90%", t: "64%", s: 1, d: "0.7s" },
                  { l: "16%", t: "50%", s: 1, d: "1.8s" },
                  { l: "62%", t: "52%", s: 1, d: "2.1s" },
                  { l: "48%", t: "78%", s: 2, d: "1.4s" },
                ].map((st, i) => (
                  <span
                    key={i}
                    className="absolute rounded-full bg-white animate-pulse"
                    style={{
                      left: st.l,
                      top: st.t,
                      width: `${st.s}px`,
                      height: `${st.s}px`,
                      boxShadow: "0 0 6px rgba(200,215,255,0.95), 0 0 12px rgba(120,150,255,0.65)",
                      animationDelay: st.d,
                      animationDuration: "2.4s",
                    }}
                  />
                ))}
              </span>
              <span
                className="relative text-[26px] font-light tracking-[0.05em] text-white"
                style={{ textShadow: "0 2px 18px rgba(120,150,255,0.55)" }}
              >
                Plexus IQ
              </span>
            </button>
          </div>

          {/* RIGHT */}
          <div className="space-y-4">
            {/* TODAY SUMMARY */}
            <DashboardPanel>
              <div className="mb-5 flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[#435ee2]" />
                <h2 className="text-[18px] font-semibold text-[#101a2e]">Today&apos;s Summary</h2>
              </div>
              <div className="grid grid-cols-3 divide-x divide-[#e4eaf1]">
                <SummaryMetric metric={data.today.newPatients} />
                <SummaryMetric metric={data.today.completedStudies} />
                <SummaryMetric metric={data.today.revenue} />
              </div>
            </DashboardPanel>

            {/* TASKS */}
            <DashboardPanel>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckSquare className="h-5 w-5 text-[#405ed9]" />
                  <h2 className="text-[18px] font-semibold text-[#101a2e]">Tasks</h2>
                </div>
                <button className="text-[12px] font-medium text-[#365fd5]">View all</button>
              </div>
              <div>
                {data.tasks.map((task) => (
                  <div
                    key={task.label}
                    className="flex min-h-[38px] items-center border-b border-[#edf1f5] last:border-b-0"
                  >
                    <TaskCount count={task.count} tone={task.tone} />
                    <span className="ml-3 flex-1 text-[12px]">{task.label}</span>
                    <span className="text-[11px] text-[#8b97a9]">{task.due}</span>
                  </div>
                ))}
              </div>
            </DashboardPanel>

            {/* SCHEDULE */}
            <DashboardPanel>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-[#405ed9]" />
                  <h2 className="text-[18px] font-semibold text-[#101a2e]">Schedule Snapshot</h2>
                </div>
                <button className="text-[12px] font-medium text-[#365fd5]">View calendar</button>
              </div>
              <div>
                {data.schedule.map((item) => (
                  <div
                    key={`${item.time}-${item.label}`}
                    className="grid min-h-[38px] grid-cols-[72px_1fr_auto] items-center text-[12px]"
                  >
                    <span className="font-medium text-[#23304a]">{item.time}</span>
                    <span className="flex items-center gap-2">
                      <span
                        className={[
                          "h-2 w-2 rounded-full",
                          item.tone === "green"
                            ? "bg-emerald-500"
                            : item.tone === "amber"
                              ? "bg-amber-500"
                              : "bg-[#526fe7]",
                        ].join(" ")}
                      />
                      {item.label}
                    </span>
                    <span className="text-[#8793a7]">{item.count} scheduled</span>
                  </div>
                ))}
              </div>
            </DashboardPanel>
          </div>
        </section>
      </div>
    </div>
  );
}

/*
|--------------------------------------------------------------------------
| COMPONENTS
|--------------------------------------------------------------------------
*/
function PulseCell({ icon, metric }: { icon: React.ReactElement; metric: PulseMetric }) {
  return (
    <div className="min-w-0 px-4 py-1 text-center">
      <div className="mb-2 flex items-center justify-center gap-2">
        {cloneIcon(icon, "h-5 w-5 text-[#263b86]")}
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#3a4a66]">{metric.label}</span>
      </div>
      <div className="flex items-baseline justify-center gap-2">
        <span className="text-[28px] font-bold tracking-[-0.03em] text-[#0f1a2e]">{metric.value}</span>
        {metric.delta && (
          <span className="text-[11px] font-semibold text-emerald-600">{metric.delta}</span>
        )}
      </div>
      {metric.helper && <div className="mt-1 text-[10px] text-[#8490a3]">{metric.helper}</div>}
    </div>
  );
}

function SummaryMetric({ metric }: { metric: PulseMetric }) {
  return (
    <div className="px-4">
      <div className="text-[11px] text-[#66758d]">{metric.label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[24px] font-medium">{metric.value}</span>
        {metric.delta && (
          <span className="text-[10px] font-semibold text-emerald-600">{metric.delta}</span>
        )}
      </div>
      {metric.helper && <div className="mt-1 text-[10px] text-[#8a96a9]">{metric.helper}</div>}
    </div>
  );
}

function DashboardPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[13px] border border-[#e0e6ee] bg-white/85 backdrop-blur-sm p-5 shadow-[0_4px_16px_rgba(23,32,51,0.035)]">
      {children}
    </div>
  );
}

function ClinicStatus({ status }: { status: ClinicRow["status"] }) {
  const styles =
    status === "On Track"
      ? "bg-emerald-50 text-emerald-700"
      : status === "At Risk"
        ? "bg-orange-50 text-orange-700"
        : "bg-amber-50 text-amber-700";
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${styles}`}>{status}</span>
  );
}

function TaskCount({ count, tone = "blue" }: { count: number; tone?: TaskItem["tone"] }) {
  const styles =
    tone === "red"
      ? "border-red-300 text-red-500"
      : tone === "amber"
        ? "border-amber-300 text-amber-600"
        : "border-blue-300 text-blue-600";
  return (
    <span
      className={`flex h-[24px] min-w-[24px] items-center justify-center rounded-full border px-1 text-[10px] font-medium ${styles}`}
    >
      {count}
    </span>
  );
}

function PaginationButton({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <button
      className={[
        "flex h-7 min-w-7 items-center justify-center rounded-[6px] px-2 text-[11px]",
        active
          ? "border border-[#697fe4] bg-[#f4f6ff] text-[#3454c6]"
          : "text-[#708098] hover:bg-[#f5f7fa]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// World Time row — premium, location-aware image cards. Reads the approved
// image registry (approved-only asset URLs) and matches each clock to its
// landmark image by city slug; anything not approved renders the Plexus navy
// fallback via WorldTimeCard.
function WorldTimeClocksRow({ clocks }: { clocks: ClockItem[] }) {
  const { data } = useQuery<{ images: WorldTimeImagePublicMap }>({
    queryKey: ["/api/settings/world-time/images"],
  });
  const images = data?.images ?? {};

  return (
    <section
      className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:flex-nowrap"
      data-testid="row-world-time"
    >
      {clocks.map((clock) => {
        const rec = images[slugify(clock.city)];
        const image =
          rec?.status === "approved" && rec.assetUrl
            ? { assetUrl: rec.assetUrl, imagePosition: rec.imagePosition, landmarkName: rec.landmarkName }
            : null;
        return (
          <WorldTimeCard
            key={clock.city}
            label={clock.city}
            time={clock.time}
            abbr={clock.timezone}
            date={clock.date}
            image={image}
            localHour={clock.hours}
            data-testid={`world-time-${slugify(clock.city)}`}
          />
        );
      })}
    </section>
  );
}

function cloneIcon(icon: React.ReactElement, className: string) {
  const existing = (icon.props as { strokeWidth?: number }).strokeWidth;
  return React.cloneElement(icon as React.ReactElement<{ className?: string; strokeWidth?: number }>, {
    className,
    strokeWidth: existing ?? 1.7,
  });
}
