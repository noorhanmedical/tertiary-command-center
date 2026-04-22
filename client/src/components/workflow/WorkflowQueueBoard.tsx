import React from "react";
import type { VisitWorkflowCard } from "../../../../shared/clinicWorkflow";
import { getWorkflowDisplayLabel } from "../../lib/clinicWorkflowSelectors";

function Column({
  title,
  cards,
}: {
  title: string;
  cards: VisitWorkflowCard[];
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-base font-semibold text-slate-900">{title}</div>
      <div className="space-y-3">
        {cards.length === 0 && <div className="text-sm text-slate-500">No patients in this queue.</div>}
        {cards.map((card) => (
          <div key={card.visitId} className="rounded-xl border border-slate-200 p-3">
            <div className="text-sm font-semibold text-slate-900">{card.patientId}</div>
            <div className="text-sm text-slate-600">{getWorkflowDisplayLabel(card.status)}</div>
            <div className="mt-1 text-xs text-slate-500">
              {card.facility} • {card.clinicDate} • {card.appointmentTime ?? "No appointment time"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WorkflowQueueBoard({
  liaison,
  technician,
  remoteScheduler,
}: {
  liaison: VisitWorkflowCard[];
  technician: VisitWorkflowCard[];
  remoteScheduler: VisitWorkflowCard[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Column title="Liaison Queue" cards={liaison} />
      <Column title="Technician Queue" cards={technician} />
      <Column title="Remote Scheduler Queue" cards={remoteScheduler} />
    </div>
  );
}
