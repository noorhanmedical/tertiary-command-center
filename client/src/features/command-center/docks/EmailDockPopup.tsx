import React from "react";
import { Mail } from "lucide-react";
import { PanelPopupCard } from "../components/PanelPopupCard";
import { useCommandCenter } from "../context/CommandCenterContext";

export function EmailDockPopup() {
  const { profile, selectedPatient } = useCommandCenter();

  const context = {
    sourceSurface: profile.surface,
    componentType: "email" as const,
    patientUuid: selectedPatient?.patientUuid,
    patientName: selectedPatient?.patientName,
    title: "Email Composer",
    metadata: {
      mode: "patientAware",
      recipient: selectedPatient?.email,
    },
  };

  return (
    <PanelPopupCard title="Email" eyebrow="Composer" icon={<Mail className="h-5 w-5" />} context={context}>
      <div className="space-y-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          Recipient: {selectedPatient?.email ?? "Select patient"}
        </div>
        <select className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <option>Appointment reminder</option>
          <option>BrainWave education</option>
          <option>VitalWave education</option>
          <option>Ultrasound prep</option>
        </select>
        <textarea className="min-h-24 w-full rounded-2xl border border-slate-200 p-3 text-sm" placeholder="Message preview" />
        <button
          disabled={!selectedPatient?.email}
          className="w-full rounded-2xl bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
        >
          Send
        </button>
      </div>
    </PanelPopupCard>
  );
}
