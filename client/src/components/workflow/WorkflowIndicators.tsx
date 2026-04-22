import React from "react";
import type { VisitWorkflowCard } from "../../../../shared/clinicWorkflow";
import {
  getWorkflowChecklist,
  getWorkflowDisplayLabel,
  getWorkflowTone,
  getWorkflowWarnings,
  getScheduleLaterReasonLabel,
} from "../../lib/clinicWorkflowSelectors";

function toneClasses(tone: string) {
  switch (tone) {
    case "success":
      return "border-green-200 bg-green-50 text-green-800";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "danger":
      return "border-red-200 bg-red-50 text-red-800";
    case "info":
      return "border-blue-200 bg-blue-50 text-blue-800";
    default:
      return "border-slate-200 bg-white text-slate-800";
  }
}

export default function WorkflowIndicators({ card }: { card: VisitWorkflowCard }) {
  const checklist = getWorkflowChecklist(card.indicators);
  const tone = getWorkflowTone(card.status);
  const warnings = getWorkflowWarnings(card);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-500">Workflow Status</div>
          <div className="text-lg font-semibold text-slate-900">
            {getWorkflowDisplayLabel(card.status)}
          </div>
        </div>
        <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${toneClasses(tone)}`}>
          {getWorkflowDisplayLabel(card.status)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {checklist.map((item) => (
          <div
            key={item.key}
            className={`rounded-xl border px-3 py-2 text-sm ${
              item.done ? "border-green-200 bg-green-50 text-green-800" : "border-slate-200 bg-slate-50 text-slate-600"
            }`}
          >
            {item.label}
          </div>
        ))}
      </div>

      {(card.assignment.scheduleLaterReason || card.assignment.remoteSchedulerAssignedTo || card.assignment.callbackWindow) && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div><span className="font-semibold">Schedule Later Reason:</span> {getScheduleLaterReasonLabel(card.assignment.scheduleLaterReason)}</div>
          <div><span className="font-semibold">Remote Scheduler:</span> {card.assignment.remoteSchedulerAssignedTo ?? "Unassigned"}</div>
          <div><span className="font-semibold">Callback Window:</span> {card.assignment.callbackWindow ?? "Not set"}</div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="mb-1 text-sm font-semibold text-amber-900">Automation Attention</div>
          <ul className="space-y-1 text-sm text-amber-800">
            {warnings.map((warning) => (
              <li key={warning}>• {warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
