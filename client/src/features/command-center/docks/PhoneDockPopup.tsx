import React, { useState } from "react";
import { Phone } from "lucide-react";
import { PanelPopupCard } from "../components/PanelPopupCard";
import { useCommandCenter } from "../context/CommandCenterContext";

export function PhoneDockPopup() {
  const { profile, selectedPatient } = useCommandCenter();
  const [dialValue, setDialValue] = useState(selectedPatient?.phone ?? "");

  const context = {
    sourceSurface: profile.surface,
    componentType: "callList" as const,
    patientUuid: selectedPatient?.patientUuid,
    patientName: selectedPatient?.patientName,
    title: "Phone Workspace",
    metadata: {
      provider: "ringcentral",
      patientAware: Boolean(selectedPatient),
      dialValue,
    },
  };

  return (
    <PanelPopupCard title="Phone" eyebrow="RingCentral" icon={<Phone className="h-5 w-5" />} context={context}>
      <div className="space-y-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-sm font-semibold text-slate-900">RingCentral</div>
          <div className="text-xs text-green-600">Ready</div>
        </div>
        <input
          value={dialValue}
          onChange={(event) => setDialValue(event.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-300"
          placeholder="Dial or search patient"
        />
        <div className="rounded-2xl bg-blue-50 p-3 text-xs text-blue-700">
          {selectedPatient ? `Patient-aware: ${selectedPatient.patientName}` : "No patient selected. Call notes stay temporary until linked."}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="rounded-2xl bg-blue-700 px-3 py-2 text-sm font-semibold text-white">Call</button>
          <button className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Disposition</button>
        </div>
      </div>
    </PanelPopupCard>
  );
}
