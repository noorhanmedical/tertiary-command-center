// Phase 2J — canonical financial ledger panel (claims / invoices / payments).
//
// Renders the server-computed read model TRUTHFULLY as BOUNDED ROWS: loading /
// migration-503 / forbidden / generic error / disabled / per-section availability
// (upstream-flag-off, unavailable) / empty / populated. It NEVER recomputes claim
// or invoice status, NEVER derives balances client-side (the server's derived
// balance facets are shown as-is), NEVER renders a failed/unavailable section as a
// zero, and NEVER shows any mock/prototype financial data. Money is a fixed-precision
// string shown with its explicit currency. Read-only; no mutations; one request.

import * as React from "react";
import { useState } from "react";
import { useCanonicalFinancialView, type FinancialCursors } from "./useCanonicalFinancialView";
import type {
  CanonicalFinancialView, FinancialSection, FinancialAvailability,
  CanonicalClaimRow, CanonicalInvoiceRow, CanonicalPaymentRow, CodeCount, CanonicalBalance,
} from "@shared/canonicalFinancialView";

function money(amount: string | null, currency: string): string {
  if (amount == null) return "—";
  return `${currency} ${amount}`;
}
function fmt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
function IntegrityPill({ integrity }: { integrity: "resolved" | "missing" | "conflicting" }) {
  if (integrity === "resolved") return null;
  const tone = integrity === "conflicting" ? "bg-rose-50 text-rose-700 border-rose-300" : "bg-slate-50 text-slate-600 border-slate-300";
  return <span className={`ml-2 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>{integrity}</span>;
}
function Codes({ items }: { items: CodeCount[] }) {
  if (!items.length) return <span className="text-slate-400">—</span>;
  return <span className="text-xs text-amber-800">{items.map((i) => `${i.code} (${i.count})`).join(", ")}</span>;
}

const AVAIL_MSG: Partial<Record<FinancialAvailability, string>> = {
  upstream_flag_off: "Upstream canonical data is not enabled for this section.",
  migration_missing: "Canonical financial storage is not yet available (migration pending).",
  unavailable: "This section is temporarily unavailable.",
  disabled_flag_off: "Canonical financial data is disabled.",
};

function SectionShell<Row>({ title, section, onFirst, onNext, children }: { title: string; section: FinancialSection<Row>; onFirst?: () => void; onNext?: () => void; children: (rows: Row[]) => React.ReactNode }) {
  const msg = AVAIL_MSG[section.availability];
  const key = title.toLowerCase();
  return (
    <section className="space-y-2" data-testid={`canonical-financial-section-${key}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">{section.availability}</span>
          {/* Independent per-section pagination — advancing one never skips another. */}
          <button type="button" data-testid={`financial-first-${key}`} onClick={onFirst} className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50">First</button>
          <button type="button" data-testid={`financial-next-${key}`} disabled={!section.pageInfo.nextCursor} onClick={onNext} className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 disabled:opacity-40 hover:bg-slate-50">Next</button>
        </div>
      </div>
      {msg ? (
        <div data-testid="canonical-financial-unavailable" className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {msg}{section.warnings.length ? ` (${section.warnings.join(", ")})` : ""}
        </div>
      ) : section.rows.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">No records.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200">{children(section.rows)}</div>
      )}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) { return <th className="px-2 py-1.5 text-left font-medium text-slate-500">{children}</th>; }
function Td({ children }: { children: React.ReactNode }) { return <td className="px-2 py-1.5 align-top tabular-nums">{children}</td>; }

function Balance({ b }: { b: CanonicalBalance }) {
  return (
    <div className="text-[11px] text-slate-600">
      <span title="outstanding">Out {money(b.outstandingBalance, b.currency)}</span>
      {" · "}<span title="paid">Paid {b.paidAmount}</span>
      {b.refundedAmount !== "0.00" ? ` · Ref ${b.refundedAmount}` : ""}
      {b.reversedAmount !== "0.00" ? ` · Rev ${b.reversedAmount}` : ""}
      {b.overpayment !== "0.00" ? ` · Over ${b.overpayment}` : ""}
      {b.integrity === "conflicting" ? <span className="ml-1 text-rose-700">(conflict)</span> : null}
    </div>
  );
}

export function CanonicalFinancialLedgerPanel({ enabledOverride }: { enabledOverride?: boolean } = {}) {
  const [cursors, setCursors] = useState<FinancialCursors>({});
  const { enabled, data, isLoading, isError, isMigrationMissing, error } = useCanonicalFinancialView(cursors, enabledOverride);
  if (!enabled) return null; // flag OFF ⇒ no request, nothing rendered
  if (isLoading) return <div data-testid="canonical-financial-loading" className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">Loading canonical financial ledger…</div>;
  if (isMigrationMissing) return <div data-testid="canonical-financial-migration" className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">Canonical financial storage is not yet available (migration pending).</div>;
  if (isError) {
    const forbidden = /^403:/.test(error instanceof Error ? error.message : "");
    return <div data-testid="canonical-financial-error" className="rounded-md border border-dashed border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">{forbidden ? "You do not have access to the canonical financial ledger." : "Unable to load the canonical financial ledger."}</div>;
  }
  const view = data as CanonicalFinancialView | undefined;
  if (!view || view.disabled) return null;

  return (
    <div className="space-y-5 rounded-lg border border-slate-200 bg-slate-50/50 p-4" data-testid="canonical-financial-ledger">
      <div>
        <h2 className="text-base font-semibold text-slate-800">Canonical financial ledger</h2>
        <p className="text-[11px] text-slate-500">Clinic-scoped · evidence-versioned · read-only · {view.dataVersion} · generated {fmt(view.generatedAt)}</p>
      </div>

      <SectionShell<CanonicalClaimRow> title="Claims" section={view.claims}
        onFirst={() => setCursors((c) => ({ ...c, claims: null }))} onNext={() => setCursors((c) => ({ ...c, claims: view.claims.pageInfo.nextCursor }))}>
        {(rows) => (
          <table className="w-full text-xs"><thead className="bg-slate-100"><tr><Th>Case</Th><Th>Service</Th><Th>Status</Th><Th>Charge</Th><Th>Blockers</Th><Th>Submitted</Th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.claimId} className="border-t border-slate-100">
                <Td>#{r.ancillaryCaseId}<IntegrityPill integrity={r.integrity} /></Td>
                <Td>{r.serviceType}</Td>
                <Td>{r.status ?? "—"}{r.attemptNumber > 1 ? ` (attempt ${r.attemptNumber})` : ""}</Td>
                <Td>{money(r.chargeAmount, r.currency)}</Td>
                <Td><Codes items={r.submissionBlockers} /></Td>
                <Td>{r.submittedAt ? `${fmt(r.submittedAt)}${r.submissionSource ? ` · ${r.submissionSource}` : ""}` : "—"}</Td>
              </tr>
            ))}</tbody></table>
        )}
      </SectionShell>

      <SectionShell<CanonicalInvoiceRow> title="Invoices" section={view.invoices}
        onFirst={() => setCursors((c) => ({ ...c, invoices: null }))} onNext={() => setCursors((c) => ({ ...c, invoices: view.invoices.pageInfo.nextCursor }))}>
        {(rows) => (
          <table className="w-full text-xs"><thead className="bg-slate-100"><tr><Th>Invoice</Th><Th>Type</Th><Th>Status</Th><Th>Total</Th><Th>Balance</Th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.invoiceId} className="border-t border-slate-100">
                <Td>{r.invoiceNumber ?? `#${r.invoiceId}`}<IntegrityPill integrity={r.integrity} /></Td>
                <Td>{r.invoiceType}</Td>
                <Td>{r.status ?? "—"}</Td>
                <Td>{money(r.totalAmount, r.currency)}</Td>
                <Td><Balance b={r.balance} /></Td>
              </tr>
            ))}</tbody></table>
        )}
      </SectionShell>

      <SectionShell<CanonicalPaymentRow> title="Payments" section={view.payments}
        onFirst={() => setCursors((c) => ({ ...c, payments: null }))} onNext={() => setCursors((c) => ({ ...c, payments: view.payments.pageInfo.nextCursor }))}>
        {(rows) => (
          <table className="w-full text-xs"><thead className="bg-slate-100"><tr><Th>Event</Th><Th>Type</Th><Th>Status</Th><Th>Amount</Th><Th>Posted</Th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.paymentId} className="border-t border-slate-100">
                <Td>{r.eventType}{r.reversesPaymentId ? ` · reverses #${r.reversesPaymentId}` : ""}</Td>
                <Td>{r.paymentType}</Td>
                <Td>{r.status}</Td>
                <Td>{money(r.amount, r.currency)}</Td>
                <Td>{fmt(r.postedAt)}</Td>
              </tr>
            ))}</tbody></table>
        )}
      </SectionShell>
    </div>
  );
}
