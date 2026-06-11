import { Card } from "@/components/ui/card";
import { FileText } from "lucide-react";

// Phase 1 Segment G Batch 5 — invoice surface scaffold. Renders only
// when the client-side flag is truthy; until the server-side draft
// endpoint lands, this is a placeholder "no invoice yet" surface so
// the slot is visible to designers/QA without reading any data.
// Read-only. No mutations. No fetch.

const INVOICE_UI_ENABLED = (() => {
  const v = (import.meta as { env?: Record<string, unknown> }).env
    ?.VITE_USE_INVOICE_UI;
  return v === "1" || v === "true" || v === "yes";
})();

export function InvoiceDraftPanel({
  patientScreeningId,
}: {
  patientScreeningId: number;
}) {
  if (!INVOICE_UI_ENABLED) return null;
  return (
    <Card className="p-4 bg-white" data-testid="invoice-draft-panel">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900">Invoice draft</div>
        <FileText className="h-4 w-4 text-slate-400" />
      </div>
      <div
        className="text-xs text-slate-500"
        data-testid={`invoice-draft-placeholder-${patientScreeningId}`}
      >
        Invoice surface placeholder. The draft and line items will appear here once
        billing readiness is reached and the invoicing endpoint is wired.
      </div>
    </Card>
  );
}
