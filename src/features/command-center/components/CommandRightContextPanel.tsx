import React from "react";
import { useCommandCenter } from "../context/CommandCenterContext";

export function CommandRightContextPanel() {
  const { selectedContext, selectedPatient, setSelectedPatient } = useCommandCenter();

  return (
    <aside className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Selected Context</div>
        <h2 className="text-xl font-bold text-slate-950">
          {selectedContext.type === "none" ? "None selected" : selectedContext.type}
        </h2>
      </div>

      <button
        type="button"
        onClick={() =>
          setSelectedPatient({
            patientUuid: "demo-patient-001",
            patientName: "Demo Patient",
            phone: "555-0100",
            email: "patient@example.com",
            facilityId: "demo-facility",
          })
        }
        className="mb-4 w-full rounded-2xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white"
      >
        Load demo patient context
      </button>

      {selectedPatient ? (
        <section className="mb-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-bold text-slate-950">{selectedPatient.patientName}</div>
          <div className="mt-1 text-xs text-slate-500">{selectedPatient.phone}</div>
          <div className="text-xs text-slate-500">{selectedPatient.email}</div>
        </section>
      ) : (
        <section className="mb-4 rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          No patient selected.
        </section>
      )}

      <section className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
        <div className="text-sm font-bold text-slate-950">Mini Timeline</div>
        <div className="mt-3 grid gap-2 text-xs text-slate-500">
          <div className="rounded-2xl bg-white p-3">Calls</div>
          <div className="rounded-2xl bg-white p-3">Messages</div>
          <div className="rounded-2xl bg-white p-3">Documents</div>
          <div className="rounded-2xl bg-white p-3">Billing readiness</div>
        </div>
      </section>
    </aside>
  );
}
