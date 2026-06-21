import React, { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PanelPopupCard } from "../components/PanelPopupCard";
import { useCommandCenter } from "../context/CommandCenterContext";
import { searchPatientDirectory, type SearchHit } from "@/lib/patientDirectoryApi";

export function SearchDockPopup() {
  const { profile } = useCommandCenter();
  const [q, setQ] = useState("");

  const trimmed = q.trim();
  const enabled = trimmed.length >= 2;

  const { data: hits = [], isFetching, isError } = useQuery<ReadonlyArray<SearchHit>>({
    queryKey: ["command-search", trimmed],
    queryFn: () => searchPatientDirectory(trimmed),
    enabled,
    staleTime: 10_000,
  });

  const context = {
    sourceSurface: profile.surface,
    componentType: "searchResult" as const,
    title: "Command Search",
  };

  return (
    <PanelPopupCard title="Search" eyebrow="Command" icon={<Search className="h-5 w-5" />} context={context}>
      <div className="space-y-3" data-testid="command-left-rail-search-panel">
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search patient by name, MRN, phone"
            className="w-full bg-transparent text-sm outline-none"
            data-testid="search-input"
          />
        </div>

        {enabled ? (
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-slate-700">Patients</span>
            <span className="text-[11px] text-slate-400" data-testid="search-result-count">
              {isFetching ? "…" : `${hits.length} result${hits.length === 1 ? "" : "s"}`}
            </span>
          </div>
        ) : null}

        <div className="max-h-[44vh] space-y-2 overflow-y-auto">
          {!enabled ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
              Type at least 2 characters to search.
            </div>
          ) : isFetching ? (
            <div className="flex items-center gap-1.5 px-1 py-3 text-xs text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" /> Searching…
            </div>
          ) : isError ? (
            <div className="rounded-2xl bg-rose-50 p-3 text-xs text-rose-700">Could not run the search.</div>
          ) : hits.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
              No matches for “{trimmed}”.
            </div>
          ) : (
            hits.map((h) => (
              <div
                key={h.patientScreeningId}
                className="rounded-2xl border border-slate-200 bg-white p-3"
                data-testid={`search-result-${h.patientScreeningId}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">{h.name}</span>
                  {h.facility ? (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">{h.facility}</span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {[h.dob ? `DOB ${h.dob}` : null, h.mrn ? `MRN ${h.mrn}` : null, h.phoneNumber]
                    .filter(Boolean)
                    .join(" · ") || "No additional details"}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </PanelPopupCard>
  );
}
