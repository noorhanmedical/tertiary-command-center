// Phase 2I — canonical ACS (Ancillary Care Specialist) page (flag-ON replacement).
//
// One row per exact ancillaryCaseId (never merged). Read-only canonical stage
// vectors with a deterministic currentStage. No mock data, no mutations, no
// fabricated actions/priority. Bounded pagination. Truthful states.

import { useState } from "react";
import { useAcsCanonicalView } from "./useCanonicalViews";
import { StageVectorView } from "./StageVectorView";
import type { AcsCanonicalView } from "@shared/acsCanonicalView";

/** Pure presentational body — exported for behavioral tests (crafted DTO in). */
export function CanonicalAcsView({ data }: { data: AcsCanonicalView }) {
  if (data.disabled) return <Note testId="acs-disabled">Canonical ACS view is disabled.</Note>;
  if (data.availability === "upstream_flag_off") return <Note testId="acs-upstream-off">Upstream canonical data is not enabled ({data.warnings.join(", ") || "upstream_flag_off"}).</Note>;
  if (data.availability !== "available") return <Note testId="acs-unavailable">The ACS canonical view is temporarily unavailable.</Note>;
  if (data.rows.length === 0) return <Note testId="acs-empty">No canonical ancillary cases in this view.</Note>;
  return (
    <div className="space-y-2" data-testid="acs-rows">
      {data.rows.map((v) => <StageVectorView key={v.ancillaryCaseId} v={v} />)}
    </div>
  );
}

export function CanonicalAcsPage() {
  const [cursor, setCursor] = useState<string | null>(null);
  const { enabled, data, isLoading, isError, isMigrationMissing } = useAcsCanonicalView(cursor);
  if (!enabled) return null;

  return (
    <div className="min-h-screen bg-slate-100 p-6" data-testid="canonical-acs-page">
      <div className="mx-auto max-w-5xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Ancillary Care Specialist — canonical view</h1>
          <p className="text-sm text-slate-500">One row per ancillary case with its canonical lifecycle stage vector (read-only).</p>
        </div>
        {isLoading && <Note testId="acs-loading">Loading canonical data…</Note>}
        {!isLoading && isError && isMigrationMissing && <Note testId="acs-migration-error">Canonical storage is not yet available (migration pending).</Note>}
        {!isLoading && isError && !isMigrationMissing && <Note testId="acs-error">Could not load canonical data.</Note>}
        {!isLoading && !isError && data && <CanonicalAcsView data={data} />}
        {!isLoading && !isError && data && (data.pageInfo.nextCursor || cursor) && (
          <div className="flex gap-2">
            <button type="button" disabled={!cursor} onClick={() => setCursor(null)} data-testid="acs-first" className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-40">First</button>
            <button type="button" disabled={!data.pageInfo.nextCursor} onClick={() => setCursor(data.pageInfo.nextCursor)} data-testid="acs-next" className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-40">Next</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Note({ children, testId }: { children: React.ReactNode; testId: string }) {
  return <div data-testid={testId} className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">{children}</div>;
}
