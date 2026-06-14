// Remittance audit — Phase 4 PR 4.6.
//
// Operator picks an invoice ID and posts payments / adjustments /
// denials / remittances through the canonical financial panel.

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InvoiceFinancialPanel } from "@/components/billing/InvoiceFinancialPanel";

export default function RemittanceAuditPage() {
  const [invoiceId, setInvoiceId] = useState("");
  const id = parseInt(invoiceId, 10);
  const valid = !isNaN(id) && id > 0;

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-6" data-testid="remittance-audit-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Remittance audit</h1>
          <p className="text-xs text-slate-500">
            Post payments, adjustments, denials, and remittance notes.
            Totals recompute automatically. "Paid" is honest — only
            set when balance reaches zero.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Input value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} placeholder="invoice id" className="h-8 w-[140px] text-xs" data-testid="remittance-invoice-id-input" />
        </div>
      </header>
      {valid ? (
        <InvoiceFinancialPanel invoiceId={id} />
      ) : (
        <Card className="p-3 bg-white"><div className="text-xs text-slate-500 italic">Enter an invoice id above.</div></Card>
      )}
    </div>
  );
}
