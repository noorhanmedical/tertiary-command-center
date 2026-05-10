import { useMemo } from "react";
import {
  Brain,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  HeartPulse,
  Scan,
  Users,
} from "lucide-react";
import type { ScreeningBatch, PatientScreening } from "@shared/schema";
import type { CalendarSummaryRow } from "@/components/plexus-iq/PlexusIQCalendar";
import { getAncillaryCategory } from "@/features/schedule/ancillaryMeta";

// Top-of-page dashboard row for /plexus-iq.
//
// Aggregates the calendar-summary feed (counts + categories) + lazily
// hydrated batch details (per-patient status). All data is read-only and
// already loaded in the page; this component does no fetching of its own.

type BatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

export function PlexusIQDashboardRow({
  summary,
  batchDetails,
}: {
  summary: CalendarSummaryRow[];
  batchDetails: Record<number, BatchWithPatients>;
}) {
  const stats = useMemo(() => {
    let total = 0;
    let pending = 0;
    let final = 0;
    const facilities = new Set<string>();
    const dates = new Set<string>();
    const bwPatients = new Set<number>();
    const vwPatients = new Set<number>();
    const usPatients = new Set<number>();

    for (const row of summary) {
      total += row.patientCount;
      if (row.facility) facilities.add(row.facility);
      if (row.scheduleDate) dates.add(row.scheduleDate);

      const detail = batchDetails[row.id];
      if (detail?.patients) {
        for (const p of detail.patients) {
          if (p.status === "completed") final += 1;
          else pending += 1;
          for (const t of p.qualifyingTests || []) {
            const c = getAncillaryCategory(t);
            if (c === "brainwave") bwPatients.add(p.id);
            else if (c === "vitalwave") vwPatients.add(p.id);
            else if (c === "ultrasound") usPatients.add(p.id);
          }
        }
      } else {
        // Detail not loaded yet — fall back to the categories signal in the
        // summary feed so the tile shows non-zero while detail hydrates.
        if (row.categories?.includes("brainwave")) bwPatients.add(-row.id);
        if (row.categories?.includes("vitalwave")) vwPatients.add(-row.id);
        if (row.categories?.includes("ultrasound")) usPatients.add(-row.id);
      }
    }

    return {
      total,
      pending,
      final,
      bw: bwPatients.size,
      vw: vwPatients.size,
      us: usPatients.size,
      facilities: facilities.size,
      dates: dates.size,
    };
  }, [summary, batchDetails]);

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3"
      data-testid="plexus-iq-dashboard-row"
    >
      <Stat icon={<Users className="w-4 h-4" />} label="Total" value={stats.total} accent="bg-slate-900/5 text-slate-700" testId="stat-total" />
      <Stat icon={<Clock className="w-4 h-4" />} label="Pending" value={stats.pending} accent="bg-sky-100 text-sky-700" testId="stat-pending" />
      <Stat icon={<CheckCircle2 className="w-4 h-4" />} label="Final" value={stats.final} accent="bg-plexus-navy-800/10 text-plexus-navy-800" testId="stat-final" />
      <Stat icon={<Brain className="w-4 h-4" />} label="BrainWave" value={stats.bw} accent="bg-violet-100 text-violet-700" testId="stat-brainwave" />
      <Stat icon={<HeartPulse className="w-4 h-4" />} label="VitalWave" value={stats.vw} accent="bg-red-100 text-red-700" testId="stat-vitalwave" />
      <Stat icon={<Scan className="w-4 h-4" />} label="Ultrasound" value={stats.us} accent="bg-emerald-100 text-emerald-700" testId="stat-ultrasound" />
      <Stat icon={<Building2 className="w-4 h-4" />} label="Facilities" value={stats.facilities} accent="bg-indigo-100 text-indigo-700" testId="stat-facilities" />
      <Stat icon={<CalendarDays className="w-4 h-4" />} label="Dates" value={stats.dates} accent="bg-amber-100 text-amber-700" testId="stat-dates" />
    </div>
  );
}

function Stat({
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
      className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5"
      data-testid={`plexus-iq-${testId}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={`inline-flex items-center justify-center h-6 w-6 rounded-md ${accent}`}>
          {icon}
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 truncate">
          {label}
        </span>
      </div>
      <div className="mt-1.5 text-xl font-semibold text-slate-900 tabular-nums leading-none">
        {value}
      </div>
    </div>
  );
}

