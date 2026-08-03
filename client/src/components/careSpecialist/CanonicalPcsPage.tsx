// Phase 2I — pure PCS canonical view body (rendered INSIDE the existing shell by
// CanonicalLifecycleSection; never a standalone page).
//
// Patient-grouped, episode-preserving canonical stage vectors. Read-only; no mock
// data, no mutations, no fabricated actions. Exported for behavioral tests.

import { StageVectorView } from "./StageVectorView";
import type { PcsCanonicalView } from "@shared/pcsCanonicalView";

type EpisodeContinue = (membershipId: number, cursor: string) => void;

export function CanonicalPcsView({ data, onEpisodeContinue }: { data: PcsCanonicalView; onEpisodeContinue?: EpisodeContinue }) {
  if (data.disabled) return <Note testId="pcs-disabled">Canonical PCS view is disabled.</Note>;
  if (data.availability === "upstream_flag_off") return <Note testId="pcs-upstream-off">Upstream canonical data is not enabled ({data.warnings.join(", ") || "upstream_flag_off"}).</Note>;
  if (data.availability !== "available") return <Note testId="pcs-unavailable">The PCS canonical view is temporarily unavailable.</Note>;
  const unresolved = data.unresolved?.rows ?? [];
  if (data.rows.length === 0 && unresolved.length === 0) return <Note testId="pcs-empty">No canonical patients in this view.</Note>;
  return (
    <div className="space-y-4">
      <div className="space-y-3" data-testid="pcs-groups">
        {data.rows.map((g, i) => <PatientGroup key={`v-${g.globalPlexusPatientId ?? "u"}-${g.patientClinicMembershipId ?? i}`} g={g} idx={i} onEpisodeContinue={onEpisodeContinue} />)}
      </div>
      {unresolved.length > 0 && (
        <div className="space-y-2" data-testid="pcs-unresolved">
          {/* `returned` = unresolved rows actually shown (never the scanned count). */}
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Identity unavailable ({data.unresolved.pageInfo.returned})</div>
          {unresolved.map((g, i) => <PatientGroup key={`u-${g.episodes[0]?.ancillaryCaseId ?? i}`} g={g} idx={i} onEpisodeContinue={onEpisodeContinue} />)}
        </div>
      )}
    </div>
  );
}

function PatientGroup({ g, idx, onEpisodeContinue }: { g: PcsCanonicalView["rows"][number]; idx: number; onEpisodeContinue?: EpisodeContinue }) {
  return (
    <section data-testid={`pcs-group-${g.globalPlexusPatientId ?? "unresolved"}-${g.patientClinicMembershipId ?? (g.episodes[0]?.ancillaryCaseId ?? idx)}`} className="rounded-lg border border-slate-200 bg-white p-2">
      <header className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-800">{g.patientDisplay ?? (g.identityAvailable ? `Patient ${g.globalPlexusPatientId}` : "Identity unavailable")}</span>
        {g.clinicMrn && <span className="text-xs text-slate-500">MRN {g.clinicMrn}</span>}
        {!g.identityAvailable && <span data-testid="pcs-identity-unavailable" className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">identity unavailable{g.identityWarnings.length ? ` (${g.identityWarnings.join(", ")})` : ""}</span>}
        <span className="ml-auto text-[11px] text-slate-400">{g.episodes.length} episode(s)</span>
      </header>
      <div className="space-y-2">
        {g.episodes.map((v) => <StageVectorView key={v.ancillaryCaseId} v={v} />)}
      </div>
      {g.episodesNextCursor && g.patientClinicMembershipId != null && (
        <button
          type="button"
          data-testid={`pcs-episodes-next-${g.patientClinicMembershipId}`}
          onClick={() => onEpisodeContinue?.(g.patientClinicMembershipId!, g.episodesNextCursor!)}
          disabled={!onEpisodeContinue}
          className="mt-1 rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 disabled:opacity-40"
        >
          Load next episodes
        </button>
      )}
    </section>
  );
}

function Note({ children, testId }: { children: React.ReactNode; testId: string }) {
  return <div data-testid={testId} className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">{children}</div>;
}
