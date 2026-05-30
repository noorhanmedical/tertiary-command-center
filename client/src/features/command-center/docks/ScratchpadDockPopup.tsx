import React from "react";
import { NotebookPen } from "lucide-react";
import { PanelPopupCard } from "../components/PanelPopupCard";
import { useCommandCenter } from "../context/CommandCenterContext";

export function ScratchpadDockPopup() {
  const { profile, selectedPatient } = useCommandCenter();

  const context = {
    sourceSurface: profile.surface,
    componentType: "scratchpad" as const,
    patientUuid: selectedPatient?.patientUuid,
    patientName: selectedPatient?.patientName,
    title: "Scratchpad",
    metadata: {
      patientAware: Boolean(selectedPatient),
    },
  };

  return (
    <PanelPopupCard title="Scratchpad" eyebrow="Notes" icon={<NotebookPen className="h-5 w-5" />} context={context}>
      <div className="space-y-3">
        <textarea className="min-h-28 w-full rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm" placeholder="Temporary note..." />
        <div className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-500">
          {selectedPatient ? `Can attach to ${selectedPatient.patientName}` : "Temporary until patient is selected"}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Attach</button>
          <button className="rounded-2xl bg-blue-700 px-3 py-2 text-sm font-semibold text-white">Callback</button>
        </div>
      </div>
    </PanelPopupCard>
  );
}
