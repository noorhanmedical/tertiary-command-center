import React from "react";
import { Megaphone } from "lucide-react";
import { PanelPopupCard } from "../components/PanelPopupCard";
import { useCommandCenter } from "../context/CommandCenterContext";

export function MarketingDockPopup() {
  const { profile, selectedPatient } = useCommandCenter();

  const context = {
    sourceSurface: profile.surface,
    componentType: "marketing" as const,
    patientUuid: selectedPatient?.patientUuid,
    patientName: selectedPatient?.patientName,
    materialId: "sample-brainwave-brochure",
    title: "Marketing Library",
    metadata: {
      category: "BrainWave",
      patientAware: Boolean(selectedPatient),
    },
  };

  return (
    <PanelPopupCard title="Marketing" eyebrow="Library" icon={<Megaphone className="h-5 w-5" />} context={context}>
      <div className="space-y-3">
        <input
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-300"
          placeholder="Search brochures"
        />
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-violet-50 px-3 py-1 font-semibold text-violet-700">BrainWave</span>
          <span className="rounded-full bg-rose-50 px-3 py-1 font-semibold text-rose-700">VitalWave</span>
          <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">Ultrasound</span>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-sm font-semibold text-slate-900">BrainWave Patient Brochure</div>
          <div className="text-xs text-slate-500">Preview, attach, or send</div>
        </div>
        <button
          disabled={!selectedPatient}
          className="w-full rounded-2xl bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
        >
          {selectedPatient ? "Send to selected patient" : "Select patient to send"}
        </button>
      </div>
    </PanelPopupCard>
  );
}
