// Phase 2I — canonical PCS (Patient Care Specialist) page (flag-ON replacement).
//
// Patient-centric, episode-preserving canonical stage vectors. Read-only; no mock
// data, no mutations, no fabricated actions. Bounded pagination. Truthful loading /
// migration / disabled / upstream-off / empty / populated states.

import { useState } from "react";
import { usePcsCanonicalView } from "./useCanonicalViews";
import { StageVectorView } from "./StageVectorView";
import type { PcsCanonicalView } from "@shared/pcsCanonicalView";

/** Pure presentational body — exported for behavioral tests (crafted DTO in). */
export function CanonicalPcsView({ data }: { data: PcsCanonicalView }) {
  if (data.disabled) return <Note testId="pcs-disabled">Canonical PCS view is disabled.</Note>;
  if (data.availability === "upstream_flag_off") return <Note testId="pcs-upstream-off">Upstream canonical data is not enabled ({data.warnings.join(", ") || "upstream_flag_off"}).</Note>;
  if (data.availability !== "available") return <Note testId="pcs-unavailable">The PCS canonical view is temporarily unavailable.</Note>;
  if (data.rows.length === 0) return <Note testId="pcs-empty">No canonical patients in this view.</Note>;
  return (
    <div className="space-y-4" data-testid="pcs-groups">
      {data.rows.map((g, i) => (
        <section key={`${g.globalPlexusPatientId ?? "u"}-${g.patientClinicMembershipId ?? i}`} data-testid={`pcs-group-${g.globalPlexusPatientId ?? "unresolved"}-${g.patientClinicMembershipId ?? i}`} className="rounded-lg border border-slate-200 bg-white p-3">
          <header className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">{g.patientDisplay ?? (g.identityAvailable ? `Patient ${g.globalPlexusPatientId}` : "Identity unavailable")}</span>
            {g.clinicMrn && <span className="text-xs text-slate-500">MRN {g.clinicMrn}</span>}
            {!g.identityAvailable && <span data-testid="pcs-identity-unavailable" className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">identity unavailable</span>}
            <span className="ml-auto text-[11px] text-slate-400">{g.episodes.length} episode(s)</span>
          </header>
          <div className="space-y-2">
            {g.episodes.map((v) => <StageVectorView key={v.ancillaryCaseId} v={v} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

export function CanonicalPcsPage() {
  const [cursor, setCursor] = useState<string | null>(null);
  const { enabled, data, isLoading, isError, isMigrationMissing } = usePcsCanonicalView(cursor);
  if (!enabled) return null;

  return (
    <div className="min-h-screen bg-slate-100 p-6" data-testid="canonical-pcs-page">
      <div className="mx-auto max-w-5xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Patient Care Specialist — canonical view</h1>
          <p className="text-sm text-slate-500">Patient-grouped canonical lifecycle stage vectors (read-only).</p>
        </div>
        {isLoading && <Note testId="pcs-loading">Loading canonical data…</Note>}
        {!isLoading && isError && isMigrationMissing && <Note testId="pcs-migration-error">Canonical storage is not yet available (migration pending).</Note>}
        {!isLoading && isError && !isMigrationMissing && <Note testId="pcs-error">Could not load canonical data.</Note>}
        {!isLoading && !isError && data && <CanonicalPcsView data={data} />}
        {!isLoading && !isError && data && (data.pageInfo.nextCursor || cursor) && (
          <div className="flex gap-2">
            <button type="button" disabled={!cursor} onClick={() => setCursor(null)} data-testid="pcs-first" className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-40">First</button>
            <button type="button" disabled={!data.pageInfo.nextCursor} onClick={() => setCursor(data.pageInfo.nextCursor)} data-testid="pcs-next" className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-40">Next</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Note({ children, testId }: { children: React.ReactNode; testId: string }) {
  return <div data-testid={testId} className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">{children}</div>;
}
