import React, { useState } from "react";
import { FileText, Loader2, Receipt, Search, User } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PanelPopupCard } from "../components/PanelPopupCard";
import { useCommandCenter } from "../context/CommandCenterContext";
import {
  searchBillingRecords,
  searchDocumentLibrary,
  searchPatientDirectory,
  type BillingSearchHit,
  type DocumentSearchHit,
  type SearchHit,
} from "@/lib/patientDirectoryApi";

function CategoryHeader({
  label,
  count,
  loading,
}: {
  label: string;
  count: number;
  loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-1">
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      <span className="text-[11px] text-slate-400" data-testid={`search-count-${label.toLowerCase()}`}>
        {loading ? "…" : `${count} result${count === 1 ? "" : "s"}`}
      </span>
    </div>
  );
}

export function SearchDockPopup() {
  const { profile } = useCommandCenter();
  const [q, setQ] = useState("");

  const trimmed = q.trim();
  const enabled = trimmed.length >= 2;

  const patients = useQuery<ReadonlyArray<SearchHit>>({
    queryKey: ["command-search", "patients", trimmed],
    queryFn: () => searchPatientDirectory(trimmed),
    enabled,
    staleTime: 10_000,
  });

  const documents = useQuery<ReadonlyArray<DocumentSearchHit>>({
    queryKey: ["command-search", "documents", trimmed],
    queryFn: () => searchDocumentLibrary(trimmed),
    enabled,
    staleTime: 10_000,
  });

  const billing = useQuery<ReadonlyArray<BillingSearchHit>>({
    queryKey: ["command-search", "billing", trimmed],
    queryFn: () => searchBillingRecords(trimmed),
    enabled,
    staleTime: 10_000,
  });

  const context = {
    sourceSurface: profile.surface,
    componentType: "searchResult" as const,
    title: "Command Search",
  };

  const patientHits = patients.data ?? [];
  const documentHits = documents.data ?? [];
  const billingHits = billing.data ?? [];

  const anyLoading = patients.isFetching || documents.isFetching || billing.isFetching;
  const allError = patients.isError && documents.isError && billing.isError;
  const totalResults = patientHits.length + documentHits.length + billingHits.length;
  const noResults =
    !anyLoading && !allError && totalResults === 0;

  return (
    <PanelPopupCard title="Search" eyebrow="Command" icon={<Search className="h-5 w-5" />} context={context}>
      <div className="space-y-3" data-testid="command-left-rail-search-panel">
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search patients, documents, billing"
            className="w-full bg-transparent text-sm outline-none"
            data-testid="search-input"
          />
        </div>

        <div className="max-h-[52vh] space-y-4 overflow-y-auto pr-0.5">
          {!enabled ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
              Type at least 2 characters to search.
            </div>
          ) : allError ? (
            <div className="rounded-2xl bg-rose-50 p-3 text-xs text-rose-700">Could not run the search.</div>
          ) : noResults ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
              No matches for “{trimmed}”.
            </div>
          ) : (
            <>
              {/* Patients */}
              <div className="space-y-2">
                <CategoryHeader label="Patients" count={patientHits.length} loading={patients.isFetching} />
                {patients.isFetching ? (
                  <div className="flex items-center gap-1.5 px-1 py-2 text-xs text-slate-500">
                    <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                  </div>
                ) : patients.isError ? (
                  <div className="rounded-2xl bg-rose-50 p-2 text-[11px] text-rose-700">Patient search failed.</div>
                ) : patientHits.length === 0 ? (
                  <div className="px-1 text-[11px] text-slate-400">No patient matches.</div>
                ) : (
                  <div className="max-h-[28vh] space-y-2 overflow-y-auto">
                    {patientHits.map((h) => (
                      <div
                        key={`patient-${h.patientScreeningId}`}
                        className="rounded-2xl border border-slate-200 bg-white p-3"
                        data-testid={`search-result-patient-${h.patientScreeningId}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <User className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="truncate text-sm font-semibold text-slate-900">{h.name}</span>
                          </span>
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
                    ))}
                  </div>
                )}
              </div>

              {/* Documents */}
              <div className="space-y-2">
                <CategoryHeader label="Documents" count={documentHits.length} loading={documents.isFetching} />
                {documents.isFetching ? (
                  <div className="flex items-center gap-1.5 px-1 py-2 text-xs text-slate-500">
                    <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                  </div>
                ) : documents.isError ? (
                  <div className="rounded-2xl bg-rose-50 p-2 text-[11px] text-rose-700">Document search failed.</div>
                ) : documentHits.length === 0 ? (
                  <div className="px-1 text-[11px] text-slate-400">No document matches.</div>
                ) : (
                  <div className="max-h-[28vh] space-y-2 overflow-y-auto">
                    {documentHits.map((d) => (
                      <a
                        key={`document-${d.id}`}
                        href={d.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-2xl border border-slate-200 bg-white p-3 hover:border-slate-300 hover:bg-slate-50"
                        data-testid={`search-result-document-${d.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="truncate text-sm font-semibold text-slate-900">{d.title}</span>
                          </span>
                          {d.facility ? (
                            <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">{d.facility}</span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-slate-500">
                          {[d.kind.replace(/_/g, " "), d.filename].filter(Boolean).join(" · ")}
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* Billing */}
              <div className="space-y-2">
                <CategoryHeader label="Billing" count={billingHits.length} loading={billing.isFetching} />
                {billing.isFetching ? (
                  <div className="flex items-center gap-1.5 px-1 py-2 text-xs text-slate-500">
                    <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                  </div>
                ) : billing.isError ? (
                  <div className="rounded-2xl bg-rose-50 p-2 text-[11px] text-rose-700">Billing search failed.</div>
                ) : billingHits.length === 0 ? (
                  <div className="px-1 text-[11px] text-slate-400">No billing matches.</div>
                ) : (
                  <div className="max-h-[28vh] space-y-2 overflow-y-auto">
                    {billingHits.map((b) => (
                      <div
                        key={`billing-${b.id}`}
                        className="rounded-2xl border border-slate-200 bg-white p-3"
                        data-testid={`search-result-billing-${b.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Receipt className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="truncate text-sm font-semibold text-slate-900">{b.patientName}</span>
                          </span>
                          {b.billingStatus ? (
                            <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">{b.billingStatus}</span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-slate-500">
                          {[b.service, b.facility, b.dateOfService ? `DOS ${b.dateOfService}` : null]
                            .filter(Boolean)
                            .join(" · ") || "No additional details"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </PanelPopupCard>
  );
}
