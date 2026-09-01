import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { searchPatients, type PatientSearchRow } from "@/lib/portal/commandCenterApi";
import { SketchSurface, SketchInput, SketchBadge } from "@/components/playground/sketch/SketchPrimitives";

// Patient Search tab — name/dob/phone/insurance lookup constrained to
// the user's profile facilities.

export function PortalPatientSearchTab({
  onSelectPatient,
}: {
  onSelectPatient: (row: PatientSearchRow) => void;
}) {
  const [q, setQ] = useState("");

  const { data = [], isFetching, isError, error } = useQuery<PatientSearchRow[]>({
    queryKey: ["portal-patient-search", q],
    queryFn: () => (q.trim().length >= 2 ? searchPatients({ query: q.trim(), limit: 50 }) : Promise.resolve([])),
    enabled: q.trim().length >= 2,
  });

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-hidden bg-transparent p-4" data-testid="portal-patient-search">
      <SketchSurface seedId="patient-search-header">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-slate-400 shrink-0" />
          <SketchInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search patients by name, DOB, phone, insurance…"
            containerClassName="flex-1"
            data-testid="input-patient-search-query"
            autoFocus
          />
        </div>
        <div className="mt-1 text-[10px] text-slate-500">
          Search is constrained to your assigned facilities.
        </div>
      </SketchSurface>

      <SketchSurface seedId="patient-search-list" className="flex-1 min-h-0 overflow-hidden">
        {q.trim().length < 2 ? (
          <div className="text-xs text-slate-500 italic py-2">
            Type at least 2 characters to search.
          </div>
        ) : isFetching ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 italic py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Searching…
          </div>
        ) : isError ? (
          <div className="text-xs text-rose-700 py-2">
            {error instanceof Error ? error.message : "Search failed"}
          </div>
        ) : data.length === 0 ? (
          <div className="text-xs text-slate-500 italic py-2">
            No patients found for &ldquo;{q}&rdquo;.
          </div>
        ) : (
          <ul className="max-h-full divide-y divide-slate-200/60 overflow-y-auto" data-testid="portal-patient-search-list">
            {data.map((p) => (
              <li key={p.patientScreeningId}>
                <button
                  type="button"
                  onClick={() => onSelectPatient(p)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-slate-900/[0.04]"
                  data-testid={`portal-patient-search-row-${p.patientScreeningId}`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-900 truncate">
                      {p.name}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate tabular-nums">
                      {p.facility ?? "—"}
                      {p.dob ? ` · DOB ${p.dob}` : ""}
                      {p.phone ? ` · ${p.phone}` : ""}
                      {p.insurance ? ` · ${p.insurance}` : ""}
                    </div>
                  </div>
                  {p.appointmentStatus && (
                    <SketchBadge tone="blue">{p.appointmentStatus}</SketchBadge>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </SketchSurface>
    </div>
  );
}
