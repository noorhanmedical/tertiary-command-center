// Phase 2H — canonical live-data panel for the Clinician Portal tiles.
//
// Renders the server-computed DTO for one section (finance / ordersNotes /
// engagement) TRUTHFULLY: loading / error / disabled / section-unavailable /
// empty / populated. It NEVER recomputes canonical status and NEVER shows a
// failed/unavailable section as a zero count. Read-only; no mutations.

import { useCanonicalOverview } from "./useCanonicalOverview";
import type {
  ClinicianPortalCanonicalOverview, SectionAvailability, CodeCount,
} from "@shared/clinicianPortalOverview";

type SectionKey = "finance" | "ordersNotes" | "engagement";

const TITLES: Record<SectionKey, string> = {
  finance: "Canonical billing readiness (operational)",
  ordersNotes: "Canonical documents",
  engagement: "Canonical engagement",
};

function AvailabilityNote({ availability, warnings }: { availability: SectionAvailability; warnings: string[] }) {
  const msg =
    availability === "upstream_flag_off" ? "Upstream canonical data is not enabled for this section."
    : availability === "migration_missing" ? "Canonical storage is not yet available (migration pending)."
    : availability === "unavailable" ? "This section is temporarily unavailable."
    : availability === "disabled_flag_off" ? "Canonical live data is disabled."
    : null;
  if (!msg) return null;
  return (
    <div data-testid="canonical-section-unavailable" className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      {msg}{warnings.length ? ` (${warnings.join(", ")})` : ""}
    </div>
  );
}

function CountGrid({ counts }: { counts: Record<string, number> }) {
  return (
    <div data-testid="canonical-counts" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {Object.entries(counts).map(([k, v]) => (
        <div key={k} className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <div className="text-lg font-semibold tabular-nums">{v}</div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">{k.replace(/([A-Z])/g, " $1").trim()}</div>
        </div>
      ))}
    </div>
  );
}

function CodeCounts({ label, items }: { label: string; items: CodeCount[] }) {
  if (!items.length) return null;
  return (
    <div className="text-xs text-slate-600">
      <span className="font-medium">{label}:</span>{" "}
      {items.map((i) => `${i.code} (${i.count})`).join(", ")}
    </div>
  );
}

/** Render one canonical section for a tile. Returns null when the flag is OFF so
 *  the existing tile content renders unchanged. */
export function CanonicalOverviewPanel({ section }: { section: SectionKey }) {
  const { enabled, data, isLoading, isError } = useCanonicalOverview();
  if (!enabled) return null;

  return (
    <section data-testid={`canonical-panel-${section}`} className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{TITLES[section]}</h3>
      {isLoading && <div data-testid="canonical-loading" className="text-xs text-slate-500">Loading canonical data…</div>}
      {isError && <div data-testid="canonical-error" className="text-xs text-rose-600">Could not load canonical data.</div>}
      {!isLoading && !isError && data && <SectionBody data={data} section={section} />}
    </section>
  );
}

function SectionBody({ data, section }: { data: ClinicianPortalCanonicalOverview; section: SectionKey }) {
  if (data.disabled) {
    return <AvailabilityNote availability="disabled_flag_off" warnings={[]} />;
  }
  if (section === "finance") {
    const f = data.finance;
    if (f.availability !== "available") return <AvailabilityNote availability={f.availability} warnings={f.warnings} />;
    if (f.counts.evaluated === 0) return <div data-testid="canonical-empty" className="text-xs text-slate-500">No evaluated cases yet.</div>;
    return (
      <div className="space-y-3">
        <CountGrid counts={f.counts as unknown as Record<string, number>} />
        <CodeCounts label="Billing blockers" items={f.billingBlockersByCode} />
        <CodeCounts label="Claim blockers (carried to billing/claims later)" items={f.claimBlockersByCode} />
        {f.lastEvaluatedAt && <div className="text-[11px] text-slate-400">Last evaluated {new Date(f.lastEvaluatedAt).toLocaleString()}</div>}
      </div>
    );
  }
  if (section === "ordersNotes") {
    const o = data.ordersNotes;
    if (o.availability !== "available") return <AvailabilityNote availability={o.availability} warnings={o.warnings} />;
    if (o.counts.currentOrderNotes + o.counts.currentProcedureNotes + o.counts.currentReports === 0) return <div data-testid="canonical-empty" className="text-xs text-slate-500">No current documents.</div>;
    return <CountGrid counts={o.counts as unknown as Record<string, number>} />;
  }
  const e = data.engagement;
  if (e.availability !== "available") return <AvailabilityNote availability={e.availability} warnings={e.warnings} />;
  if (e.counts.activeCases === 0) return <div data-testid="canonical-empty" className="text-xs text-slate-500">No active cases.</div>;
  return <CountGrid counts={e.counts as unknown as Record<string, number>} />;
}
