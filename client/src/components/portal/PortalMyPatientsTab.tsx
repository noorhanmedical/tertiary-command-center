import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";
import { fetchMyPatients, type MyPatientsRow } from "@/lib/portal/commandCenterApi";

// "My Patients" tab — patients the session user has touched recently.
// Sourced from patient_journey_events / outreach_calls / plexus_tasks
// where actor or assignee is the session user.

export function PortalMyPatientsTab({
  onSelectPatient,
}: {
  onSelectPatient: (row: MyPatientsRow) => void;
}) {
  const [q, setQ] = useState("");
  const { data = [], isLoading, isError, error } = useQuery<MyPatientsRow[]>({
    queryKey: ["portal-my-patients", q],
    queryFn: () => fetchMyPatients({ query: q, limit: 100 }),
    refetchInterval: 60_000,
  });

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-hidden p-4" data-testid="portal-my-patients">
      <Card className="p-3 bg-white">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter my patients by name or DOB…"
            className="h-8 text-xs"
            data-testid="input-my-patients-filter"
          />
        </div>
      </Card>

      <Card className="flex-1 min-h-0 p-3 bg-white overflow-hidden">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 italic py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : isError ? (
          <div className="text-xs text-rose-700 py-2">
            {error instanceof Error ? error.message : "Failed to load"}
          </div>
        ) : data.length === 0 ? (
          <div className="text-xs text-slate-500 italic py-2">
            No patients yet. Once you log a call, create a task, or schedule a
            patient, they will appear here, newest first.
          </div>
        ) : (
          <ul className="space-y-1.5 max-h-full overflow-y-auto" data-testid="portal-my-patients-list">
            {data.map((p) => (
              <li
                key={p.patientScreeningId}
                className="rounded-lg border border-slate-100 bg-slate-50/40 hover:bg-slate-50 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => onSelectPatient(p)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                  data-testid={`portal-my-patients-row-${p.patientScreeningId}`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-900 truncate">
                      {p.name}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {p.facility ?? "—"}
                      {p.dob ? ` · DOB ${p.dob}` : ""}
                      {p.lastActivityType ? ` · ${p.lastActivityType}` : ""}
                      {p.lastActivityAt ? ` · ${new Date(p.lastActivityAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
                    </div>
                  </div>
                  {p.appointmentStatus && (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                      {p.appointmentStatus}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
