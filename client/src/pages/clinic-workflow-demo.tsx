import React from "react";
import WorkflowSandbox from "../components/workflow/WorkflowSandbox";

export default function ClinicWorkflowDemoPage() {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Clinic Workflow Demo</h1>
          <p className="text-sm text-slate-600">
            Safe local demo for liaison, technician, and remote scheduler workflow indicators.
          </p>
        </div>
        <WorkflowSandbox />
      </div>
    </div>
  );
}
