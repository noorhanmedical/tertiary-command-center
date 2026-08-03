// Phase 2I — pure ACS canonical view body (rendered INSIDE the existing shell by
// CanonicalLifecycleSection; never a standalone page).
//
// One row per exact ancillaryCaseId (never merged). Read-only canonical stage
// vectors with a deterministic currentStage. No mock data, no mutations, no
// fabricated actions/priority. Exported for behavioral tests.

import { StageVectorView } from "./StageVectorView";
import type { AcsCanonicalView } from "@shared/acsCanonicalView";

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

function Note({ children, testId }: { children: React.ReactNode; testId: string }) {
  return <div data-testid={testId} className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">{children}</div>;
}
