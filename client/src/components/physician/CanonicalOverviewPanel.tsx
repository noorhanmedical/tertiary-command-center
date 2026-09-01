// Phase 2H — canonical live-data panel for the Clinician Portal tiles.
//
// Renders the server-computed DTO for one section (finance / ordersNotes /
// engagement) TRUTHFULLY as BOUNDED ROWS (not counts alone): loading /
// migration-503 error / generic error / disabled / section-unavailable /
// upstream-flag-off / empty / populated. It NEVER recomputes canonical status,
// NEVER renders a failed/unavailable section as a zero count, and NEVER renders
// any mock/prototype operational data. Read-only; no mutations; one request.

import { useCanonicalOverview } from "./useCanonicalOverview";
import type {
  ClinicianPortalCanonicalOverview, SectionAvailability, CodeCount,
  FinanceOverview, OrdersNotesOverview, EngagementOverview,
} from "@shared/clinicianPortalOverview";

type SectionKey = "finance" | "ordersNotes" | "engagement";

const TITLES: Record<SectionKey, string> = {
  finance: "Canonical billing readiness (operational)",
  ordersNotes: "Canonical documents",
  engagement: "Canonical engagement",
};

function fmt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

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

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-1.5 text-left font-medium text-slate-500">{children}</th>;
}
function Td({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return <td data-testid={testId} className="px-2 py-1.5 text-slate-700">{children}</td>;
}

// ─── Finance rows — operational readiness ONLY (no financial totals) ──────────
function FinanceRows({ finance }: { finance: FinanceOverview }) {
  return (
    <table data-testid="canonical-finance-rows" className="w-full text-xs">
      <thead>
        <tr className="border-b border-slate-200">
          <Th>Case</Th><Th>Service</Th><Th>Readiness</Th><Th>Billing Doc</Th><Th>Billing blockers</Th><Th>Claim blockers</Th><Th>Evaluated</Th>
        </tr>
      </thead>
      <tbody>
        {finance.rows.map((r) => (
          <tr key={r.ancillaryCaseId} data-testid={`canonical-finance-row-${r.ancillaryCaseId}`} className="border-b border-slate-100 last:border-0">
            <Td testId={`finance-case-${r.ancillaryCaseId}`}>#{r.ancillaryCaseId}</Td>
            <Td>{r.serviceType}</Td>
            <Td>{r.readinessStatus ?? "—"}</Td>
            <Td>{r.billingDocumentStatus ?? "—"}</Td>
            <Td>{r.billingBlockerCount}</Td>
            <Td>{r.claimBlockerCount}</Td>
            <Td>{fmt(r.evaluatedAt)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Orders & Notes rows — Unified Documents (exact status) ───────────────────
function OrdersNotesRows({ orders }: { orders: OrdersNotesOverview }) {
  return (
    <table data-testid="canonical-orders-rows" className="w-full text-xs">
      <thead>
        <tr className="border-b border-slate-200">
          <Th>Case</Th><Th>Service</Th><Th>Kind</Th><Th>Status</Th><Th>Signed</Th><Th>Clinical date</Th><Th>Created</Th>
        </tr>
      </thead>
      <tbody>
        {orders.rows.map((r, i) => (
          <tr key={`${r.ancillaryCaseId}-${r.documentKind}-${i}`} data-testid={`canonical-orders-row-${r.ancillaryCaseId}-${r.documentKind}`} className="border-b border-slate-100 last:border-0">
            <Td>#{r.ancillaryCaseId}</Td>
            <Td>{r.serviceType ?? "—"}</Td>
            <Td>{r.documentKind}</Td>
            <Td>{r.documentStatus}</Td>
            <Td>{fmt(r.signedAt)}</Td>
            <Td>{fmt(r.effectiveClinicalDate)}</Td>
            <Td>{fmt(r.actualCreatedAt)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Engagement rows — only canonically persisted fields ──────────────────────
function EngagementRows({ engagement }: { engagement: EngagementOverview }) {
  return (
    <table data-testid="canonical-engagement-rows" className="w-full text-xs">
      <thead>
        <tr className="border-b border-slate-200">
          <Th>Case</Th><Th>Service</Th><Th>Admin review</Th><Th>Lifecycle</Th><Th>Engagement list</Th><Th>Last sent</Th>
        </tr>
      </thead>
      <tbody>
        {engagement.rows.map((r) => (
          <tr key={r.ancillaryCaseId} data-testid={`canonical-engagement-row-${r.ancillaryCaseId}`} className="border-b border-slate-100 last:border-0">
            <Td>#{r.ancillaryCaseId}</Td>
            <Td>{r.serviceType}</Td>
            <Td>{r.adminReviewStatus ?? "—"}</Td>
            <Td>{r.lifecycleStatus ?? "—"}</Td>
            <Td testId={`engagement-list-${r.ancillaryCaseId}`}>
              {r.memberships.length === 0
                ? "—"
                : r.memberships.map((m) => (
                    <span key={m.engagementMembershipId} data-testid={`engagement-membership-${m.engagementMembershipId}`} className="mr-2 inline-block">
                      {m.engagementListDisplayName ?? `list ${m.engagementListId}`}
                      <span className="text-slate-400"> ({m.engagementListSourceType ?? "?"})</span>
                    </span>
                  ))}
            </Td>
            <Td testId={`engagement-last-sent-${r.ancillaryCaseId}`}>{fmt(r.lastSentAt)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Pure section renderer over the server DTO — states + bounded rows only. No
 *  data fetching, no context, no mock/prototype data. Exported for behavioral
 *  component tests (rendered directly with a crafted DTO). */
export function CanonicalSectionView({ data, section }: { data: ClinicianPortalCanonicalOverview; section: SectionKey }) {
  if (data.disabled) {
    return <AvailabilityNote availability="disabled_flag_off" warnings={[]} />;
  }
  if (section === "finance") {
    const f = data.finance;
    if (f.availability !== "available") return <AvailabilityNote availability={f.availability} warnings={f.warnings} />;
    if (f.rows.length === 0 && f.counts.evaluated === 0) return <div data-testid="canonical-empty" className="text-xs text-slate-500">No evaluated cases yet.</div>;
    return (
      <div className="space-y-3">
        <CountGrid counts={f.counts as unknown as Record<string, number>} />
        <FinanceRows finance={f} />
        <CodeCounts label="Billing blockers" items={f.billingBlockersByCode} />
        <CodeCounts label="Claim blockers (carried to billing/claims later)" items={f.claimBlockersByCode} />
        {f.lastEvaluatedAt && <div className="text-[11px] text-slate-400">Last evaluated {fmt(f.lastEvaluatedAt)}</div>}
      </div>
    );
  }
  if (section === "ordersNotes") {
    const o = data.ordersNotes;
    if (o.availability !== "available") return <AvailabilityNote availability={o.availability} warnings={o.warnings} />;
    if (o.rows.length === 0) return <div data-testid="canonical-empty" className="text-xs text-slate-500">No current documents.</div>;
    return (
      <div className="space-y-3">
        <CountGrid counts={o.counts as unknown as Record<string, number>} />
        <OrdersNotesRows orders={o} />
      </div>
    );
  }
  const e = data.engagement;
  if (e.availability !== "available") return <AvailabilityNote availability={e.availability} warnings={e.warnings} />;
  if (e.rows.length === 0 && e.counts.activeCases === 0) return <div data-testid="canonical-empty" className="text-xs text-slate-500">No active cases.</div>;
  return (
    <div className="space-y-3">
      <CountGrid counts={e.counts as unknown as Record<string, number>} />
      <EngagementRows engagement={e} />
    </div>
  );
}

/** Render one canonical section for a tile. Returns null when the flag is OFF so
 *  the existing tile content renders unchanged. Owns the loading/error states. */
export function CanonicalOverviewPanel({ section }: { section: SectionKey }) {
  const { enabled, data, isLoading, isError, isMigrationMissing } = useCanonicalOverview();
  if (!enabled) return null;

  return (
    <section data-testid={`canonical-panel-${section}`} className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{TITLES[section]}</h3>
      {isLoading && <div data-testid="canonical-loading" className="text-xs text-slate-500">Loading canonical data…</div>}
      {!isLoading && isError && isMigrationMissing && (
        <div data-testid="canonical-migration-error" className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Canonical storage is not yet available (migration pending).
        </div>
      )}
      {!isLoading && isError && !isMigrationMissing && (
        <div data-testid="canonical-error" className="text-xs text-rose-600">Could not load canonical data.</div>
      )}
      {!isLoading && !isError && data && <CanonicalSectionView data={data} section={section} />}
    </section>
  );
}
