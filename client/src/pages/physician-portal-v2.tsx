// Physician Portal V2 — Replit UI restore preview.
//
// Renders the alternate physician / clinician command-center shell
// (Dashboard, Finance, Orders/Notes, Engagement) that was built in
// Replit. Mounted on the parallel /physician-portal-v2 route so the
// canonical physician portal at /physician-portal (delivered by PRs
// #301 and #307 with live signatures + reports + ancillary metrics +
// honest finance disabled state) keeps working unchanged.
//
// This shell is currently backed by client-local mock data
// (components/physician/mockData.ts) — that is what the Replit build
// used. Real endpoint wiring for signatures / reports / ancillary
// metrics is available and will be adopted incrementally after review.
// Finance stays disabled (mirrors PR #307's FinanceTabDisabled stance).

import { PageHeader } from "@/components/PageHeader";
import { PhysicianPortalShell } from "@/components/physician/PhysicianPortalShell";

export default function PhysicianPortalV2Page() {
  return (
    <div className="flex h-full w-full flex-col">
      <PageHeader
        title="Physician Portal V2 Preview"
        subtitle="Restored Replit physician / clinician shell — admin only"
      />
      <div
        role="status"
        className="border-b border-amber-200/60 bg-amber-50 px-4 py-2 text-[13px] leading-snug text-amber-900"
        data-testid="physician-portal-v2-preview-banner"
      >
        <strong className="font-semibold">
          Physician Portal V2 Preview — Replit UI restored.
        </strong>{" "}
        The canonical production physician portal at{" "}
        <code className="font-mono">/physician-portal</code> is
        unchanged and remains the live surface (signatures, reports,
        ancillary metrics, honest finance disabled state — PRs #301 and
        #307). This preview shell is backed by client-local mock data;
        real endpoint adoption for each tab is a follow-up.
      </div>
      <div className="flex-1 overflow-hidden">
        <PhysicianPortalShell />
      </div>
    </div>
  );
}
