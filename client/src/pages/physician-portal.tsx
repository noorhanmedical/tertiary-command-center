// Physician Portal — Phase A: signatures only.
//
// Renders the SignaturesTab against the live
// /api/physician-portal/signature-items endpoints. Finance / Reports /
// Ancillary Metrics tabs are intentionally NOT mounted here — they were
// mock-backed in the archive shape and land only after their own
// repository-layered service endpoints exist.

import { PageHeader } from "@/components/PageHeader";
import { SignaturesTab } from "@/components/physician/SignaturesTab";

export default function PhysicianPortalPage() {
  return (
    <div className="flex h-full w-full flex-col">
      <PageHeader
        title="Physician Portal"
        subtitle="Signature worklist for procedure notes"
      />
      <div className="flex-1 overflow-auto p-6">
        <SignaturesTab />
      </div>
    </div>
  );
}
