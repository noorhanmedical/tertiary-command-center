import { useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { usePortal, hasFinanceAccess } from "../portalContext";
import { BackToDashboard } from "../ClinicianPortalShell";
import {
  StatCard, ServiceChip, StatusPill, Section, SideDrawer, FilterBar, SearchInput, RestrictedAccessCard, PanelCard,
} from "../ui/primitives";
import { DataTable, type Column } from "../ui/DataTable";
import {
  SERVICE_COLORS, serviceLineOf,
  type Claim, type Invoice, type ClaimStatus, type ProviderFinancial,
} from "../mockData";
import { usePortalData } from "../usePortalData";
import { isClinicianPortalCanonicalDataEnabled } from "@/lib/clinicianPortalCanonicalFlag";
import { CanonicalFinancePage } from "../canonical/CanonicalFinancePage";

const CLAIM_TONE: Record<ClaimStatus, "green" | "amber" | "blue" | "gray"> = {
  Paid: "green", Pending: "amber", "In Review": "blue", Submitted: "gray",
};

export function FinancePage() {
  // Phase 2H — flag ON replaces the entire mock-backed body with the canonical
  // operational-readiness page (no revenue/claims/invoices/payments/splits, no
  // mock rows). Flag OFF renders the exact pre-Phase-2H legacy body below.
  if (isClinicianPortalCanonicalDataEnabled()) {
    return <CanonicalFinancePage />;
  }
  return <LegacyFinancePage />;
}

function LegacyFinancePage() {
  const { role } = usePortal();
  const { data, isLoading } = usePortalData();
  const [range, setRange] = useState("MTD");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [claimSearch, setClaimSearch] = useState("");
  const [activeClaim, setActiveClaim] = useState<Claim | null>(null);
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null);
  const [arBucket, setArBucket] = useState<string | null>(null);

  const fin = data?.finance;
  const CLAIMS = fin?.claims ?? [];
  const PAID_CLAIMS = fin?.paidClaims ?? [];
  const INVOICES = fin?.invoices ?? [];
  const PIPELINE = fin?.pipeline ?? [];
  const PRACTICE_OVERVIEW = fin?.practiceOverview ?? [];
  const AR_BUCKETS = fin?.arBuckets ?? [];
  const AR_ROWS = fin?.arRows ?? [];
  const PAYER_MIX = fin?.payerMix ?? [];
  const PROVIDER_FINANCIALS = fin?.providerFinancials ?? [];
  const REVENUE_SUMMARY = fin?.revenueSummary ?? [];
  const SERVICE_LINE_REVENUE = fin?.serviceLineRevenue ?? [];
  const FINANCE_KPIS = fin?.kpis;

  const filteredClaims = useMemo(() => {
    const q = claimSearch.trim().toLowerCase();
    return CLAIMS.filter((c) => {
      if (serviceFilter !== "all" && serviceLineOf(c.service) !== serviceFilter && c.service !== serviceFilter) return false;
      if (providerFilter !== "all" && c.provider !== providerFilter) return false;
      if (q && !c.patientName.toLowerCase().includes(q) && !c.id.toLowerCase().includes(q) && !c.service.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [CLAIMS, claimSearch, serviceFilter, providerFilter]);

  if (!hasFinanceAccess(role)) {
    return (
      <div className="space-y-6">
        <BackToDashboard />
        <RestrictedAccessCard />
      </div>
    );
  }

  if (isLoading || !fin || !FINANCE_KPIS) {
    return (
      <div className="space-y-6">
        <BackToDashboard />
        <div className="py-20 text-center text-sm text-finance-text-muted" data-testid="text-finance-loading">Loading financials…</div>
      </div>
    );
  }

  const arRows = arBucket ? AR_ROWS.filter((r) => r.bucket === arBucket) : AR_ROWS;
  const maxLineRev = Math.max(1, ...SERVICE_LINE_REVENUE.map((s) => s.revenue));

  const claimColumns: Column<Claim>[] = [
    { key: "id", header: "Claim", render: (c) => <span className="font-medium">{c.id}</span> },
    { key: "patient", header: "Patient", render: (c) => <div><div>{c.patientName}</div><div className="text-xs text-finance-text-muted">{c.mrn}</div></div> },
    { key: "service", header: "Service", render: (c) => <ServiceChip service={c.service} /> },
    { key: "payer", header: "Payer", render: (c) => c.payer },
    { key: "dos", header: "DOS", render: (c) => c.dos },
    { key: "amount", header: "Amount", align: "right", render: (c) => <span className="tabular-nums">{formatCurrency(c.amount)}</span> },
    { key: "status", header: "Status", render: (c) => <StatusPill label={c.status} tone={CLAIM_TONE[c.status]} /> },
  ];

  const paidColumns: Column<typeof PAID_CLAIMS[number]>[] = [
    { key: "id", header: "Claim", render: (c) => <span className="font-medium">{c.id}</span> },
    { key: "patient", header: "Patient", render: (c) => c.patientName },
    { key: "service", header: "Service", render: (c) => <ServiceChip service={c.service} /> },
    { key: "payer", header: "Payer", render: (c) => c.payer },
    { key: "paidDate", header: "Paid", render: (c) => c.paidDate },
    { key: "billed", header: "Billed", align: "right", render: (c) => <span className="tabular-nums">{formatCurrency(c.amount)}</span> },
    { key: "paid", header: "Paid Amt", align: "right", render: (c) => <span className="tabular-nums text-emerald-600">{formatCurrency(c.paidAmount)}</span> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <BackToDashboard />
        <span className="text-xs text-finance-text-muted">Role: {role} · Full financial access</span>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-finance-text">Finance</h1>
        <p className="text-sm text-finance-text-muted">Ancillary services financials and practice financial health.</p>
      </div>

      <FilterBar>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="h-9 w-[150px]" data-testid="select-finance-range"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["Today", "7d", "MTD", "Prior Month", "Custom"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={serviceFilter} onValueChange={setServiceFilter}>
          <SelectTrigger className="h-9 w-[160px]" data-testid="select-finance-service"><SelectValue placeholder="Service" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All services</SelectItem>
            <SelectItem value="BrainWave">BrainWave</SelectItem>
            <SelectItem value="VitalWave">VitalWave</SelectItem>
            <SelectItem value="Ultrasound">Ultrasound</SelectItem>
          </SelectContent>
        </Select>
        <Select value={providerFilter} onValueChange={setProviderFilter}>
          <SelectTrigger className="h-9 w-[170px]" data-testid="select-finance-provider"><SelectValue placeholder="Provider" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {PROVIDER_FINANCIALS.map((p) => <SelectItem key={p.provider} value={p.provider}>{p.provider}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9" data-testid="button-finance-export"><Download className="mr-1.5 h-4 w-4" /> Export</Button>
          <Button variant="outline" size="sm" className="h-9" data-testid="button-finance-refresh"><RefreshCw className="mr-1.5 h-4 w-4" /> Refresh</Button>
        </div>
      </FilterBar>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Ancillary Revenue" value={formatCurrency(FINANCE_KPIS.ancillaryRevenueMtd.value)} delta={FINANCE_KPIS.ancillaryRevenueMtd.delta} testId="kpi-ancillary-rev" />
        <StatCard label="Claims Paid MTD" value={String(FINANCE_KPIS.claimsPaidMtd.value)} delta={FINANCE_KPIS.claimsPaidMtd.delta} testId="kpi-claims-paid" />
        <StatCard label="Pending Claims" value={String(FINANCE_KPIS.pendingSubmittedClaims.value)} delta={FINANCE_KPIS.pendingSubmittedClaims.delta} testId="kpi-pending-claims" />
        <StatCard label="Clinic Net" value={formatCurrency(FINANCE_KPIS.clinicNet.value)} delta={FINANCE_KPIS.clinicNet.delta} testId="kpi-clinic-net" />
      </div>

      {/* ---- Ancillary Services Financials ---- */}
      <Section title="Ancillary Services Financials" description="Revenue and claim activity from Plexus ancillary studies." testId="section-ancillary-financials">
        <div className="grid gap-4 lg:grid-cols-2">
          <PanelCard testId="panel-revenue-summary">
            <div className="border-b border-finance-border px-4 py-3 text-sm font-semibold text-finance-text">Revenue Summary</div>
            <table className="w-full text-sm">
              <tbody>
                {REVENUE_SUMMARY.map((r) => (
                  <tr key={r.metric} className="border-b border-finance-border/60 last:border-0">
                    <td className="px-4 py-2.5 text-finance-text-secondary">{r.metric}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums text-finance-text">{formatCurrency(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PanelCard>

          <PanelCard testId="panel-service-line-revenue">
            <div className="border-b border-finance-border px-4 py-3 text-sm font-semibold text-finance-text">Revenue by Service Line</div>
            <div className="space-y-3 p-4">
              {SERVICE_LINE_REVENUE.map((s) => (
                <div key={s.line}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <ServiceChip service={s.line} />
                    <span className="tabular-nums font-medium text-finance-text">{formatCurrency(s.revenue)} <span className="text-finance-text-muted">· {s.studies} studies</span></span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-finance-bg-soft">
                    <div className="h-full rounded-full" style={{ width: `${(s.revenue / maxLineRev) * 100}%`, backgroundColor: SERVICE_COLORS[s.line] }} />
                  </div>
                </div>
              ))}
            </div>
          </PanelCard>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-finance-text">Claims Submitted</h3>
            <SearchInput value={claimSearch} onChange={setClaimSearch} placeholder="Search claims…" testId="input-claim-search" className="w-56" />
          </div>
          <DataTable columns={claimColumns} rows={filteredClaims} onRowClick={setActiveClaim} rowTestId={(c) => `row-claim-${c.id}`} emptyMessage="No claims match your filters." />
        </div>

        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold text-finance-text">Claims Paid</h3>
          <DataTable columns={paidColumns} rows={PAID_CLAIMS} rowTestId={(c) => `row-paid-${c.id}`} />
        </div>

        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold text-finance-text">Plexus Split / Invoices</h3>
          <DataTable
            columns={[
              { key: "id", header: "Invoice", render: (i: Invoice) => <span className="font-medium">{i.id}</span> },
              { key: "period", header: "Period", render: (i: Invoice) => i.period },
              { key: "studies", header: "Studies", align: "right", render: (i: Invoice) => <span className="tabular-nums">{i.studies}</span> },
              { key: "gross", header: "Gross", align: "right", render: (i: Invoice) => <span className="tabular-nums">{formatCurrency(i.gross)}</span> },
              { key: "clinic", header: "Clinic Split", align: "right", render: (i: Invoice) => <span className="tabular-nums text-emerald-600">{formatCurrency(i.clinicSplit)}</span> },
              { key: "plexus", header: "Plexus Split", align: "right", render: (i: Invoice) => <span className="tabular-nums">{formatCurrency(i.plexusSplit)}</span> },
              { key: "status", header: "Status", render: (i: Invoice) => <StatusPill label={i.status} tone={i.status === "Paid" ? "green" : i.status === "Sent" ? "blue" : "amber"} /> },
            ]}
            rows={INVOICES}
            onRowClick={setActiveInvoice}
            rowTestId={(i) => `row-invoice-${i.id}`}
          />
        </div>
      </Section>

      {/* ---- Ancillary Financial Pipeline ---- */}
      <Section title="Ancillary Financial Pipeline" description="Qualified → Called → Scheduled → Completed → Claim Submitted → Claim Paid." testId="section-ancillary-pipeline">
        <PipelineFunnel />
      </Section>

      {/* ---- Practice Financial Health ---- */}
      <Section title="Practice Financial Health" description="Whole-practice financial position across all service lines." testId="section-practice-health">
        <div className="grid gap-4 lg:grid-cols-2">
          <PanelCard testId="panel-practice-overview">
            <div className="border-b border-finance-border px-4 py-3 text-sm font-semibold text-finance-text">Practice Overview</div>
            <table className="w-full text-sm">
              <tbody>
                {PRACTICE_OVERVIEW.map((r) => (
                  <tr key={r.metric} className="border-b border-finance-border/60 last:border-0">
                    <td className="px-4 py-2.5 text-finance-text-secondary">{r.metric}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums text-finance-text">{formatCurrency(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PanelCard>

          <PanelCard testId="panel-payer-mix">
            <div className="border-b border-finance-border px-4 py-3 text-sm font-semibold text-finance-text">Payer Mix</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-finance-border bg-finance-bg-soft text-[11px] uppercase tracking-wide text-finance-text-secondary">
                  <th className="px-4 py-2 text-left">Payer</th>
                  <th className="px-4 py-2 text-right">Claims</th>
                  <th className="px-4 py-2 text-right">Paid</th>
                  <th className="px-4 py-2 text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {PAYER_MIX.map((p) => (
                  <tr key={p.payer} className="border-b border-finance-border/60 last:border-0" data-testid={`row-payer-${p.payer}`}>
                    <td className="px-4 py-2.5 text-finance-text">{p.payer}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{p.claims}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(p.paid)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-finance-text-muted">{p.share}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PanelCard>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-finance-text">All-Practice Claims Submitted</h3>
            <DataTable
              columns={[
                { key: "id", header: "Claim", render: (c: Claim) => c.id },
                { key: "patient", header: "Patient", render: (c: Claim) => c.patientName },
                { key: "amount", header: "Amount", align: "right", render: (c: Claim) => <span className="tabular-nums">{formatCurrency(c.amount)}</span> },
                { key: "status", header: "Status", render: (c: Claim) => <StatusPill label={c.status} tone={CLAIM_TONE[c.status]} /> },
              ]}
              rows={CLAIMS}
              rowTestId={(c) => `row-practice-submitted-${c.id}`}
            />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-finance-text">All-Practice Claims Paid</h3>
            <DataTable
              columns={[
                { key: "id", header: "Claim", render: (c: Claim) => c.id },
                { key: "patient", header: "Patient", render: (c) => c.patientName },
                { key: "paid", header: "Paid", align: "right", render: (c) => <span className="tabular-nums text-emerald-600">{formatCurrency(c.paidAmount)}</span> },
                { key: "date", header: "Date", render: (c) => c.paidDate },
              ]}
              rows={PAID_CLAIMS}
              rowTestId={(c) => `row-practice-paid-${c.id}`}
            />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold text-finance-text">A/R Snapshot</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {AR_BUCKETS.map((b) => {
              const active = arBucket === b.key;
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => setArBucket(active ? null : b.key)}
                  className={`rounded-[14px] border bg-white p-4 text-left transition-all ${active ? "border-finance-periwinkle ring-2 ring-finance-periwinkle/30" : "border-finance-border hover:border-finance-border-strong"}`}
                  data-testid={`ar-bucket-${b.key}`}
                >
                  <div className="text-[11px] uppercase tracking-wide text-finance-text-muted">{b.label}</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums text-finance-text">{formatCurrency(b.amount)}</div>
                  <div className="text-xs text-finance-text-muted">{b.count} claims</div>
                </button>
              );
            })}
          </div>
          <DataTable
            columns={[
              { key: "bucket", header: "Aging", render: (r) => AR_BUCKETS.find((b) => b.key === r.bucket)?.label ?? r.bucket },
              { key: "patient", header: "Patient", render: (r) => r.patientName },
              { key: "service", header: "Service", render: (r) => <ServiceChip service={r.service} /> },
              { key: "payer", header: "Payer", render: (r) => r.payer },
              { key: "dos", header: "DOS", render: (r) => r.dos },
              { key: "amount", header: "Outstanding", align: "right", render: (r) => <span className="tabular-nums">{formatCurrency(r.amount)}</span> },
            ]}
            rows={arRows.map((r, i) => ({ ...r, id: `${r.bucket}-${r.mrn}-${i}` }))}
            rowTestId={(r) => `row-ar-${r.mrn}-${r.bucket}`}
            emptyMessage="No outstanding A/R in this bucket."
          />
        </div>

        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold text-finance-text">Provider Financials</h3>
          <DataTable
            columns={[
              { key: "provider", header: "Provider", render: (p: typeof PROVIDER_FINANCIALS[number]) => <span className="font-medium">{p.provider}</span> },
              { key: "studies", header: "Studies", align: "right", render: (p) => <span className="tabular-nums">{p.studies}</span> },
              { key: "billed", header: "Billed", align: "right", render: (p) => <span className="tabular-nums">{formatCurrency(p.billed)}</span> },
              { key: "paid", header: "Paid", align: "right", render: (p) => <span className="tabular-nums text-emerald-600">{formatCurrency(p.paid)}</span> },
              { key: "net", header: "Clinic Net", align: "right", render: (p) => <span className="tabular-nums">{formatCurrency(p.net)}</span> },
            ]}
            rows={PROVIDER_FINANCIALS.map((p) => ({ ...p, id: p.provider }))}
            rowTestId={(p) => `row-provider-${p.provider}`}
          />
        </div>
      </Section>

      {/* ---- Claim drawer ---- */}
      <SideDrawer
        open={!!activeClaim}
        onOpenChange={(o) => !o && setActiveClaim(null)}
        title={activeClaim ? activeClaim.id : ""}
        subtitle={activeClaim ? `${activeClaim.patientName} · ${activeClaim.mrn}` : ""}
        testId="drawer-claim"
      >
        {activeClaim && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Service"><ServiceChip service={activeClaim.service} /></Field>
              <Field label="Status"><StatusPill label={activeClaim.status} tone={CLAIM_TONE[activeClaim.status]} /></Field>
              <Field label="Payer">{activeClaim.payer}</Field>
              <Field label="Provider">{activeClaim.provider}</Field>
              <Field label="Date of Service">{activeClaim.dos}</Field>
              <Field label="Submitted">{activeClaim.submittedDate}</Field>
              <Field label="Amount"><span className="tabular-nums">{formatCurrency(activeClaim.amount)}</span></Field>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-finance-text-muted">Claim Timeline</div>
              <ol className="space-y-3">
                {activeClaim.timeline.map((t, i) => (
                  <li key={i} className="flex gap-3">
                    <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-finance-periwinkle" />
                    <div>
                      <div className="text-sm text-finance-text">{t.label}</div>
                      <div className="text-xs text-finance-text-muted">{t.date}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </SideDrawer>

      {/* ---- Invoice drawer ---- */}
      <SideDrawer
        open={!!activeInvoice}
        onOpenChange={(o) => !o && setActiveInvoice(null)}
        title={activeInvoice ? activeInvoice.id : ""}
        subtitle={activeInvoice ? activeInvoice.period : ""}
        testId="drawer-invoice"
      >
        {activeInvoice && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Studies"><span className="tabular-nums">{activeInvoice.studies}</span></Field>
              <Field label="Status"><StatusPill label={activeInvoice.status} tone={activeInvoice.status === "Paid" ? "green" : activeInvoice.status === "Sent" ? "blue" : "amber"} /></Field>
              <Field label="Gross"><span className="tabular-nums">{formatCurrency(activeInvoice.gross)}</span></Field>
              <Field label="Issued">{activeInvoice.issuedDate}</Field>
              <Field label="Clinic Split"><span className="tabular-nums text-emerald-600">{formatCurrency(activeInvoice.clinicSplit)}</span></Field>
              <Field label="Plexus Split"><span className="tabular-nums">{formatCurrency(activeInvoice.plexusSplit)}</span></Field>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-finance-text-muted">Line Items</div>
              <table className="w-full text-sm">
                <tbody>
                  {activeInvoice.lines.map((l) => (
                    <tr key={l.service} className="border-b border-finance-border/60 last:border-0">
                      <td className="py-2 text-finance-text">{l.service}</td>
                      <td className="py-2 text-right tabular-nums text-finance-text-muted">{l.count}</td>
                      <td className="py-2 text-right tabular-nums">{formatCurrency(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SideDrawer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-finance-text-muted">{label}</div>
      <div className="mt-0.5 text-finance-text">{children}</div>
    </div>
  );
}

export function PipelineFunnel() {
  const { data } = usePortalData();
  const PIPELINE = data?.finance.pipeline ?? [];
  if (PIPELINE.length === 0) {
    return (
      <PanelCard testId="panel-pipeline">
        <div className="px-4 py-6 text-center text-sm text-finance-text-muted">No pipeline data yet.</div>
      </PanelCard>
    );
  }
  const max = Math.max(1, PIPELINE[0].count);
  return (
    <PanelCard testId="panel-pipeline">
      <div className="space-y-3 p-4">
        {PIPELINE.map((stage, i) => {
          const conv = i === 0 ? 100 : PIPELINE[i - 1].count ? Math.round((stage.count / PIPELINE[i - 1].count) * 100) : 0;
          return (
            <div key={stage.key} data-testid={`pipeline-stage-${stage.key}`}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium text-finance-text">{stage.label}</span>
                <span className="tabular-nums text-finance-text-secondary">
                  {stage.count} · {formatCurrency(stage.value)} <span className="text-finance-text-muted">· {conv}%</span>
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-finance-bg-soft">
                <div className="h-full rounded-full bg-finance-periwinkle" style={{ width: `${(stage.count / max) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </PanelCard>
  );
}
