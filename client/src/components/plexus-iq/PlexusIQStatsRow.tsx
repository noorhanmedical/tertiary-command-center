import { Brain, HeartPulse, Scan, Users } from "lucide-react";
import type { CalendarSummaryRow } from "@/components/plexus-iq/PlexusIQCalendar";

// Top-of-page stats row for /plexus-iq. Aggregates the calendar-summary
// payload into four cards: BrainWave / VitalWave / Ultrasound / Total
// patients. Counts are per-patient (a patient with two BrainWave tests is
// still one BrainWave patient).

export function PlexusIQStatsRow({ summary }: { summary: CalendarSummaryRow[] }) {
  let bw = 0;
  let vw = 0;
  let us = 0;
  let total = 0;
  for (const row of summary) {
    total += row.patientCount;
    bw += row.byCategory?.brainwave ?? 0;
    vw += row.byCategory?.vitalwave ?? 0;
    us += row.byCategory?.ultrasound ?? 0;
  }

  return (
    <div
      className="grid grid-cols-2 lg:grid-cols-4 gap-3"
      data-testid="plexus-iq-stats-row"
    >
      <StatCard
        icon={<Brain className="w-4 h-4" />}
        label="BrainWave"
        value={bw}
        accent="bg-violet-100 text-violet-700"
        testId="plexus-iq-stat-brainwave"
      />
      <StatCard
        icon={<HeartPulse className="w-4 h-4" />}
        label="VitalWave"
        value={vw}
        accent="bg-red-100 text-red-700"
        testId="plexus-iq-stat-vitalwave"
      />
      <StatCard
        icon={<Scan className="w-4 h-4" />}
        label="Ultrasound"
        value={us}
        accent="bg-emerald-100 text-emerald-700"
        testId="plexus-iq-stat-ultrasound"
      />
      <StatCard
        icon={<Users className="w-4 h-4" />}
        label="Total Patients"
        value={total}
        accent="bg-slate-900/5 text-slate-700"
        testId="plexus-iq-stat-total"
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent: string;
  testId: string;
}) {
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
      data-testid={testId}
    >
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center justify-center h-7 w-7 rounded-lg ${accent}`}>
          {icon}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          {label}
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">
        {value}
      </div>
    </div>
  );
}
