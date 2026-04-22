import React from "react";
import type { ScheduleLaterReason, VisitWorkflowCard } from "../../../../shared/clinicWorkflow";

type MutationBody =
  | { type: "engage_liaison" }
  | { type: "mark_interested"; interested: boolean }
  | { type: "request_same_day" }
  | { type: "complete_screening_form" }
  | { type: "complete_informed_consent" }
  | { type: "schedule_later"; reason: ScheduleLaterReason; callbackWindow: string | null }
  | { type: "assign_remote_scheduler"; schedulerId: string }
  | { type: "book_future_appointment" }
  | { type: "complete_upcoming_appointment_confirmation" }
  | { type: "start_technician_work" }
  | { type: "complete_test" };

async function mutate(patientId: string, body: MutationBody) {
  const res = await fetch(`/api/clinic-workflow/${patientId}/mutate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Workflow mutation failed");
  return res.json();
}

export default function WorkflowActionBar({
  card,
  onUpdated,
}: {
  card: VisitWorkflowCard;
  onUpdated?: (next: VisitWorkflowCard) => void;
}) {
  const run = async (body: MutationBody) => {
    const next = await mutate(card.patientId, body);
    onUpdated?.(next);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm font-semibold text-slate-700">Workflow Actions</div>
      <div className="flex flex-wrap gap-2">
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => run({ type: "engage_liaison" })}>Engage Liaison</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => run({ type: "mark_interested", interested: true })}>Mark Interested</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => run({ type: "mark_interested", interested: false })}>Mark Declined</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => run({ type: "request_same_day" })}>Request Same-Day</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => run({ type: "complete_screening_form" })}>Screening Complete</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => run({ type: "complete_informed_consent" })}>Consent Complete</button>
        <button
          className="rounded-xl border px-3 py-2 text-sm"
          onClick={() =>
            run({
              type: "schedule_later",
              reason: "patient_requested_later",
              callbackWindow: "Later Today",
            })
          }
        >
          Schedule Later
        </button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => run({ type: "assign_remote_scheduler", schedulerId: "auto-assigned" })}>
          Assign Scheduler
        </button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => run({ type: "book_future_appointment" })}>Book Future Appointment</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => run({ type: "complete_upcoming_appointment_confirmation" })}>
          Complete Upcoming Confirmation
        </button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => run({ type: "start_technician_work" })}>Start Technician Work</button>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => run({ type: "complete_test" })}>Complete Test</button>
      </div>
    </div>
  );
}
