import React from "react";
import { CalendarDays } from "lucide-react";
import { PanelPopupCard } from "../components/PanelPopupCard";
import { useCommandCenter } from "../context/CommandCenterContext";

export function CalendarDockPopup() {
  const { profile } = useCommandCenter();
  const selectedDate = new Date().toISOString().slice(0, 10);

  const context = {
    sourceSurface: profile.surface,
    componentType: "calendarDate" as const,
    selectedDate,
    facilityId: "all",
    title: "Calendar Date",
    metadata: {
      totalPatientCount: 18,
      brainWaveCount: 6,
      vitalWaveCount: 4,
      ultrasoundCount: 8,
      procedureCompleteCount: 3,
    },
  };

  return (
    <PanelPopupCard title="Calendar" eyebrow="Date preview" icon={<CalendarDays className="h-5 w-5" />} context={context}>
      <div className="space-y-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-sm font-semibold text-slate-900">Today</div>
          <div className="text-xs text-slate-500">18 qualifying patients</div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-2xl bg-violet-50 p-3 text-violet-700">BrainWave 6</div>
          <div className="rounded-2xl bg-rose-50 p-3 text-rose-700">VitalWave 4</div>
          <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">Ultrasound 8</div>
        </div>
        <div className="rounded-2xl bg-green-50 p-3 text-xs font-semibold text-green-700">3 procedure-complete signals</div>
      </div>
    </PanelPopupCard>
  );
}
