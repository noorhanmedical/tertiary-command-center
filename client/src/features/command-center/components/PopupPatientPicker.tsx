import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { searchPatients, type PatientSearchRow } from "@/lib/portal/commandCenterApi";

export type PickedPatient = {
  patientScreeningId: number;
  name: string;
  phoneNumber: string | null;
};

export function PopupPatientPicker({
  picked,
  onPick,
  onClear,
  placeholder = "Search patient by name…",
}: {
  picked: PickedPatient | null;
  onPick: (patient: PickedPatient) => void;
  onClear: () => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");

  const { data: hits = [], isFetching } = useQuery<ReadonlyArray<PatientSearchRow>>({
    queryKey: ["popup-patient-search", q],
    queryFn: () => searchPatients({ query: q.trim(), limit: 25 }),
    enabled: q.trim().length >= 2,
    staleTime: 10_000,
  });

  if (picked) {
    return (
      <div
        className="flex items-center justify-between rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2"
        data-testid="popup-picker-selected"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-blue-900">{picked.name}</div>
          {picked.phoneNumber ? (
            <div className="text-xs text-blue-700">{picked.phoneNumber}</div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-blue-500 hover:bg-blue-100"
          aria-label="Clear selected patient"
          data-testid="popup-picker-clear"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm outline-none"
          data-testid="popup-picker-search"
        />
      </div>
      {q.trim().length >= 2 ? (
        <div className="max-h-40 overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50">
          {isFetching ? (
            <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" /> Searching…
            </div>
          ) : hits.length === 0 ? (
            <div className="px-3 py-2 text-xs italic text-slate-500">No matches.</div>
          ) : (
            <ul>
              {hits.slice(0, 8).map((h) => (
                <li key={h.patientScreeningId}>
                  <button
                    type="button"
                    onClick={() =>
                      onPick({
                        patientScreeningId: h.patientScreeningId,
                        name: h.name,
                        phoneNumber: h.phone,
                      })
                    }
                    className="w-full px-3 py-1.5 text-left text-xs hover:bg-white"
                    data-testid={`popup-picker-pick-${h.patientScreeningId}`}
                  >
                    <span className="font-medium text-slate-800">{h.name}</span>
                    {h.dob ? <span className="text-slate-400"> · {h.dob}</span> : null}
                    {h.facility ? <span className="text-slate-400"> · {h.facility}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
