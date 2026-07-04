import React, { useState } from "react";
import { Phone } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PanelPopupCard } from "../components/PanelPopupCard";
import { useCommandCenter } from "../context/CommandCenterContext";

type CallListItem = {
  patientScreeningId: number;
  name: string;
  phoneNumber: string | null;
  insurance: string | null;
  qualifyingTests: string[];
  facility: string;
  appointmentStatus: string;
};

type CallListResponse = {
  facility: string;
  cap: number;
  totalPool: number;
  patients: CallListItem[];
};

export function PhoneDockPopup() {
  const { profile } = useCommandCenter();
  const [dialValue, setDialValue] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);

  const { data, isLoading, isError } = useQuery<CallListResponse>({
    queryKey: ["/api/portal/outreach-call-list"],
    queryFn: async () => {
      const res = await fetch("/api/portal/outreach-call-list", { credentials: "include" });
      if (!res.ok) throw new Error(`Call list fetch failed (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const patients = data?.patients ?? [];

  const context = {
    sourceSurface: profile.surface,
    componentType: "callList" as const,
    title: "Phone Workspace",
  };

  return (
    <PanelPopupCard title="Phone" eyebrow="Call list" icon={<Phone className="h-5 w-5" />} context={context}>
      <div className="space-y-3" data-testid="command-left-rail-phone-panel">
        <input
          value={dialValue}
          onChange={(event) => setDialValue(event.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-300"
          placeholder="Dial number"
          data-testid="phone-dial-input"
        />

        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-semibold text-slate-700">Outreach call list</span>
          <span className="text-[11px] text-slate-400" data-testid="phone-call-count">
            {isLoading ? "…" : `${patients.length} to call`}
          </span>
        </div>

        <div className="max-h-[44vh] space-y-2 overflow-y-auto">
          {isLoading ? (
            <div className="px-1 py-3 text-xs text-slate-400">Loading call list…</div>
          ) : isError ? (
            <div className="rounded-2xl bg-rose-50 p-3 text-xs text-rose-700">Could not load the call list.</div>
          ) : patients.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
              No patients need calls right now.
            </div>
          ) : (
            patients.map((p) => (
              <button
                key={p.patientScreeningId}
                type="button"
                onClick={() => {
                  setActiveId(p.patientScreeningId);
                  if (p.phoneNumber) setDialValue(p.phoneNumber);
                }}
                className={`w-full rounded-2xl border p-3 text-left transition ${
                  activeId === p.patientScreeningId
                    ? "border-blue-300 bg-blue-50"
                    : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/40"
                }`}
                data-testid={`phone-call-item-${p.patientScreeningId}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">{p.name}</span>
                  {p.facility ? (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">{p.facility}</span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {p.phoneNumber ?? "No phone on file"}
                  {p.insurance ? ` · ${p.insurance}` : ""}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </PanelPopupCard>
  );
}
