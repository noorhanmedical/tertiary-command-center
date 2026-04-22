import { PortalShell } from "@/components/portal/PortalShell";
import WorkflowInlinePanel from "../components/workflow/WorkflowInlinePanel";

export default function LiaisonPortalPage() {
  return (
    <>
      <WorkflowInlinePanel />
      <PortalShell role="liaison" />
    </>
  );
}
