import { useQuery } from "@tanstack/react-query";
import { Calendar } from "lucide-react";
import type { AncillaryAppointment } from "@shared/schema";

export function ScheduleTile() {
  const fmt12 = (time24: string) => {
    const [h, m] = time24.split(":").map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  };

  const { data: appts = [], isLoading } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments/schedule-tile"],
    queryFn: async () => {
      const apiKey = import.meta.env.VITE_API_KEY as string | undefined;
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch("/api/appointments?upcoming=true", { headers });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 60000,
  });

  const grouped: Record<string, AncillaryAppointment[]> = {};
  for (const a of appts) {
    if (!grouped[a.scheduledDate]) grouped[a.scheduledDate] = [];
    grouped[a.scheduledDate].push(a);
  }
  const sortedDates = Object.keys(grouped).sort();

  function testTypeBadge(testType: string) {
    if (testType === "BrainWave") return { label: "BrainWave", cls: "bg-violet-100 text-violet-700" };
    if (testType === "VitalWave") return { label: "VitalWave", cls: "bg-red-100 text-red-600" };
    return { label: testType, cls: "bg-emerald-100 text-emerald-700" };
  }

  function formatDateHeader(dateStr: string) {
    const d = new Date(dateStr + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    if (d.getTime() === today.getTime()) return "Today";
    if (d.getTime() === tomorrow.getTime()) return "Tomorrow";
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  if (isLoading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-8 bg-slate-100 rounded-lg" />
        ))}
      </div>
    );
  }

  if (appts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center" data-testid="schedule-tile-empty">
        <Calendar className="w-10 h-10 text-slate-300 mb-3" strokeWidth={1.5} />
        <p className="text-sm font-medium text-slate-500 mb-1">No appointments scheduled</p>
        <span className="text-xs text-primary font-medium hover:underline cursor-pointer" data-testid="link-schedule-go">
          Go to Schedule →
        </span>
      </div>
    );
  }

  return (
    <div data-testid="schedule-tile-list" className="max-h-[400px] overflow-y-auto pr-1">
      <div className="space-y-4">
        {sortedDates.map((dateStr) => (
          <div key={dateStr}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                {formatDateHeader(dateStr)}
              </span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>
            <div className="space-y-1">
              {grouped[dateStr].map((a) => {
                const badge = testTypeBadge(a.testType);
                return (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-50/80 border border-slate-100 hover:bg-slate-100/70 transition-colors"
                    data-testid={`schedule-tile-row-${a.id}`}
                  >
                    <span className="text-xs font-semibold text-primary w-16 shrink-0 tabular-nums">{fmt12(a.scheduledTime)}</span>
                    <span className="text-xs font-medium text-slate-800 flex-1 truncate">{a.patientName}</span>
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                    <span className="text-[10px] text-slate-400 shrink-0 truncate max-w-[120px]">{a.facility}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
