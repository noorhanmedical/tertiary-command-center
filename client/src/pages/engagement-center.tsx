// Outreach / Engagement Center is the command-center overview. It is
// separate from Patient Care Specialist Workspace.
//
// Renders the existing OutreachPage for now; legacy routes /outreach-center
// and /outreach redirect here so deep-links continue to work.

import OutreachPage from "@/pages/outreach";

export default function EngagementCenterPage() {
  return <OutreachPage />;
}
