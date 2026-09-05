// Phase 2I — pure presentational renderer for a canonical CaseStageVector.
//
// Renders the SERVER-computed stage truth directly (never recomputes canonical
// status). No data fetching, no context, no mock/portalData source. Exported for
// behavioral component tests (rendered with a crafted DTO). Read-only; no actions.

import { Link } from "wouter";
import {
  CANONICAL_STAGE_ORDER, CANONICAL_FINANCIAL_STAGE_KEYS,
  type CaseStageVector, type StageStatus, type CanonicalStageKey,
} from "@shared/canonicalStageVector";
import { serviceRequiresStructuredScreening } from "@shared/canonicalService";
import { STAGE_LABELS, nextActionForCase, caseBlockers, type OperationalTone } from "./caseStageOperational";

// Phase 2J financial stages render only when their 2J flag is ON. While
// `upstream_flag_off` they are hidden, so with 2J OFF this surface is unchanged.
const FINANCIAL_STAGES = new Set<CanonicalStageKey>(CANONICAL_FINANCIAL_STAGE_KEYS);

// Tone → tailwind classes for the NEXT ACTION badge.
const ACTION_TONE: Record<OperationalTone, string> = {
  green: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-800",
  blue: "bg-blue-100 text-blue-700",
  red: "bg-rose-100 text-rose-700",
  gray: "bg-slate-100 text-slate-600",
};

function fmt(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

function stageText(s: StageStatus): string {
  if (s.availability === "upstream_flag_off") return "not enabled";
  if (s.availability === "unavailable") return "unavailable";
  if (s.availability === "migration_missing") return "migration pending";
  return s.status ?? "—";
}

function StageCell({ label, s, testId }: { label: string; s: StageStatus; testId: string }) {
  const tone =
    s.availability !== "available" ? "border-amber-300 bg-amber-50 text-amber-800"
    : s.status == null ? "border-slate-200 bg-white text-slate-400"
    : "border-slate-200 bg-white text-slate-700";
  return (
    <div data-testid={testId} className={`rounded-md border px-2 py-1 ${tone}`}>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xs font-medium tabular-nums">{stageText(s)}{s.at ? <span className="ml-1 text-[10px] text-slate-400">{fmt(s.at)}</span> : null}</div>
    </div>
  );
}

/** Render one episode's 10-stage vector + its deterministic currentStage, the
 *  explicit server-derived NEXT ACTION, and any canonical blockers. */
export function StageVectorView({ v }: { v: CaseStageVector }) {
  const action = nextActionForCase(v);
  const blockers = caseBlockers(v);
  // Screening deep-link decision uses the canonical alias-resolved service
  // identity (never a service-name substring/regex).
  const showScreeningLink = serviceRequiresStructuredScreening(v.serviceType);
  return (
    <div data-testid={`stage-vector-${v.ancillaryCaseId}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span data-testid={`episode-case-${v.ancillaryCaseId}`} className="font-semibold text-slate-700">Case #{v.ancillaryCaseId}</span>
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-700">{v.serviceType}</span>
        {v.lifecycleStatus && <span className="text-slate-500">{v.lifecycleStatus}</span>}
        {showScreeningLink && (
          <Link
            href={`/ancillary-screening/${v.ancillaryCaseId}`}
            data-testid={`screening-link-${v.ancillaryCaseId}`}
            className="rounded bg-indigo-600 px-1.5 py-0.5 text-white hover:bg-indigo-700"
          >
            Screening
          </Link>
        )}
        <span data-testid={`current-stage-${v.ancillaryCaseId}`} className="ml-auto rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-700">
          {v.currentStage ? `current: ${STAGE_LABELS[v.currentStage]}` : v.currentStageIntegrity === "conflicting" ? "current: (integrity)" : "current: —"}
        </span>
      </div>

      {/* Explicit NEXT ACTION — the server-decided currentStage rendered as a
          human instruction (never a client-recomputed lifecycle decision). */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Next action</span>
        <span data-testid={`next-action-${v.ancillaryCaseId}`} className={`rounded px-1.5 py-0.5 text-xs font-medium ${ACTION_TONE[action.tone]}`}>
          {action.label}
        </span>
      </div>

      {blockers.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1" data-testid={`blockers-${v.ancillaryCaseId}`}>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Blockers</span>
          {blockers.map((b, i) => (
            <span
              key={`${b.source}-${b.code}-${i}`}
              data-testid={`blocker-${v.ancillaryCaseId}-${b.code}`}
              className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] text-rose-700"
              title={`${b.source} blocker`}
            >
              {b.code.replace(/_/g, " ")}{b.count > 1 ? ` ×${b.count}` : ""}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        {CANONICAL_STAGE_ORDER.filter((k) => {
          if (!FINANCIAL_STAGES.has(k)) return true;                 // core stages always render
          const s = v[k] as StageStatus | undefined;                 // financial: render only when enabled
          return s != null && s.availability !== "upstream_flag_off";
        }).map((k) => (
          <StageCell key={k} label={STAGE_LABELS[k]} s={v[k]} testId={`stage-${k}-${v.ancillaryCaseId}`} />
        ))}
      </div>
    </div>
  );
}
