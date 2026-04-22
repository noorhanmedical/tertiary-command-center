import React from "react";
import { PortalShell } from "@/components/portal/PortalShell";

type ClinicWorkflowPortalRole = "liaison" | "technician";

export default function ClinicWorkflowPortal({
  role,
}: {
  role: ClinicWorkflowPortalRole;
}) {
  return <PortalShell role={role} />;
}
