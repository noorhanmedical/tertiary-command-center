// Home V2 — Replit UI restore preview.
//
// Renders HomeLiveDashboard + HomeWorldClocks on a parallel /home-v2
// route so the current production Home surface (/) with its
// HomeDashboard / schedule dashboard stays untouched.
//
// HomeLiveDashboard consumes /api/home-stats, which currently returns
// the full response shape with honest zeros — the panel renders in an
// empty state until scoped repository aggregates land server-side.

import { PageHeader } from "@/components/PageHeader";
import { HomeLiveDashboard } from "@/components/HomeLiveDashboard";
import { HomeWorldClocks } from "@/components/HomeWorldClocks";

export default function HomeV2Page() {
  return (
    <div className="flex h-full w-full flex-col">
      <PageHeader
        title="Home V2 Preview"
        subtitle="Restored Replit live dashboard + world clocks"
      />
      <div
        role="status"
        className="border-b border-amber-200/60 bg-amber-50 px-4 py-2 text-[13px] leading-snug text-amber-900"
        data-testid="home-v2-preview-banner"
      >
        <strong className="font-semibold">
          Home V2 Preview — Replit UI restored.
        </strong>{" "}
        This route is admin-only. The canonical production home at{" "}
        <code className="font-mono">/</code> is unchanged. The live
        dashboard consumes <code className="font-mono">/api/home-stats</code>,
        which currently returns honest zeros for every window until
        scoped repository aggregates land server-side.
      </div>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
        <HomeWorldClocks />
        <HomeLiveDashboard />
      </div>
    </div>
  );
}
