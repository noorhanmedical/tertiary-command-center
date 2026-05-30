import React from "react";
import { Search } from "lucide-react";
import { PanelPopupCard } from "../components/PanelPopupCard";
import { useCommandCenter } from "../context/CommandCenterContext";

export function SearchDockPopup() {
  const { profile } = useCommandCenter();

  const context = {
    sourceSurface: profile.surface,
    componentType: "searchResult" as const,
    title: "Command Search",
  };

  return (
    <PanelPopupCard title="Search" eyebrow="Command" icon={<Search className="h-5 w-5" />} context={context}>
      <div className="space-y-3">
        <input className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm" placeholder="Search patient, doc, invoice, phone" />
        <div className="grid gap-2 text-sm">
          <div className="rounded-2xl bg-slate-50 p-3 text-slate-600">Patients</div>
          <div className="rounded-2xl bg-slate-50 p-3 text-slate-600">Documents</div>
          <div className="rounded-2xl bg-slate-50 p-3 text-slate-600">Billing</div>
        </div>
      </div>
    </PanelPopupCard>
  );
}
