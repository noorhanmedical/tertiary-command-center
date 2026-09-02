// Phase 2I — pure ACS canonical view body (rendered INSIDE the existing shell by
// CanonicalLifecycleSection; never a standalone page).
//
// One row per exact ancillaryCaseId (never merged). Read-only canonical stage
// vectors with a deterministic currentStage. No mock data, no mutations, no
// fabricated actions/priority. Exported for behavioral tests.

import { useMemo, useState } from "react";
import { StageVectorView } from "./StageVectorView";
import { OPERATIONAL_FILTERS, filterCases, bucketCounts, type OperationalFilterId } from "./caseStageOperational";
import type { AcsCanonicalView } from "@shared/acsCanonicalView";

export function CanonicalAcsView({ data }: { data: AcsCanonicalView }) {
  const [filterId, setFilterId] = useState<OperationalFilterId>("all");
  const counts = useMemo(() => bucketCounts(data.rows ?? []), [data.rows]);
  const visible = useMemo(() => filterCases(data.rows ?? [], filterId), [data.rows, filterId]);

  if (data.disabled) return <Note testId="acs-disabled">Canonical ACS view is disabled.</Note>;
  if (data.availability === "upstream_flag_off") return <Note testId="acs-upstream-off">Upstream canonical data is not enabled ({data.warnings.join(", ") || "upstream_flag_off"}).</Note>;
  if (data.availability !== "available") return <Note testId="acs-unavailable">The ACS canonical view is temporarily unavailable.</Note>;
  if (data.rows.length === 0) return <Note testId="acs-empty">No canonical ancillary cases in this view.</Note>;

  return (
    <div className="space-y-2">
      {/* Operational worklist filter — buckets are pure lenses over the SERVER-
          decided currentStage / integrity (see caseStageOperational). Filtering
          applies to the loaded page (pagination is server keyset). */}
      <div className="flex flex-wrap gap-1" data-testid="acs-operational-filters">
        {OPERATIONAL_FILTERS.filter((f) => f.id === "all" || counts[f.id] > 0).map((f) => (
          <button
            key={f.id}
            type="button"
            data-testid={`acs-filter-${f.id}`}
            aria-pressed={filterId === f.id}
            onClick={() => setFilterId(f.id)}
            className={`rounded border px-2 py-0.5 text-[11px] ${filterId === f.id ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
          >
            {f.label} <span className="tabular-nums text-slate-400">({counts[f.id]})</span>
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <Note testId="acs-filter-empty">No cases match this filter on the current page.</Note>
      ) : (
        <div className="space-y-2" data-testid="acs-rows">
          {visible.map((v) => <StageVectorView key={v.ancillaryCaseId} v={v} />)}
        </div>
      )}
    </div>
  );
}

function Note({ children, testId }: { children: React.ReactNode; testId: string }) {
  return <div data-testid={testId} className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">{children}</div>;
}
