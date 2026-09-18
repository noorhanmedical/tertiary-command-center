// Day-click procedure view for the Plexus IQ global calendar.
//
// Reads the canonical /api/global-schedule-events feed for a single day
// (optionally scoped to a facility by the gear filter) and lists the
// procedures scheduled at any facility that day. Read-only; no writes.

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { GlobalScheduleEvent } from "@shared/schema/globalSchedule";

// Event types that represent an actual scheduled procedure/appointment we want
// to surface in the day view (vs. availability/PTO blocks).
const PROCEDURE_EVENT_TYPES = new Set([
  "ancillary_appointment",
  "same_day_add",
  "doctor_visit",
  "procedure_complete",
]);

const EVENT_TONE: Record<string, string> = {
  ancillary_appointment: "bg-emerald-500",
  same_day_add: "bg-sky-500",
  doctor_visit: "bg-indigo-500",
  procedure_complete: "bg-slate-400",
};

export function GlobalCalendarDayProcedures({
  isoDate,
  facility,
}: {
  isoDate: string;
  facility?: string | null;
}) {
  const startsAt = `${isoDate}T00:00:00.000Z`;
  const endsAt = `${isoDate}T23:59:59.999Z`;

  const { data = [], isFetching } = useQuery<GlobalScheduleEvent[]>({
    queryKey: ["global-cal-day-events", isoDate, facility ?? null],
    staleTime: 15_000,
    queryFn: async () => {
      const qs = new URLSearchParams();
      qs.set("startDate", startsAt);
      qs.set("endDate", endsAt);
      if (facility?.trim()) qs.set("facilityId", facility.trim());
      qs.set("limit", "200");
      const res = await fetch(`/api/global-schedule-events?${qs}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Day events fetch failed (${res.status})`);
      return res.json();
    },
  });

  const procedures = data
    .filter((e) => PROCEDURE_EVENT_TYPES.has(e.eventType))
    .sort(
      (a, b) =>
        new Date(a.startsAt as unknown as string).getTime() -
        new Date(b.startsAt as unknown as string).getTime(),
    );

  return (
    <div className="w-72" data-testid="global-cal-day-procedures">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-slate-900">
          {prettyDay(isoDate)}
        </span>
        {facility && (
          <span className="truncate text-[11px] text-slate-400">{facility}</span>
        )}
      </div>

      {isFetching ? (
        <div className="flex items-center justify-center py-4 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : procedures.length === 0 ? (
        <div className="py-4 text-center text-[12px] text-slate-400">
          No procedures scheduled
        </div>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {procedures.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${EVENT_TONE[e.eventType] ?? "bg-slate-300"}`}
              />
              <span className="w-14 shrink-0 text-[11px] tabular-nums text-slate-500">
                {prettyClock(e.startsAt as unknown as string)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-slate-800">
                {e.patientName ?? "—"}
              </span>
              {e.serviceType && (
                <span className="shrink-0 text-[11px] text-slate-400">{e.serviceType}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function prettyDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function prettyClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
