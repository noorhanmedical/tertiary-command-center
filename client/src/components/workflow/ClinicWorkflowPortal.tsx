import React from "react";
import { PortalShell } from "@/components/portal/PortalShell";
import WorkflowInlinePanel from "./WorkflowInlinePanel";

type ClinicWorkflowPortalRole = "liaison" | "technician";

export default function ClinicWorkflowPortal({
  role,
}: {
  role: ClinicWorkflowPortalRole;
}) {
  return (
    <>
      <WorkflowInlinePanel />
      <PortalShell role={role} />
    </>
  );
}
