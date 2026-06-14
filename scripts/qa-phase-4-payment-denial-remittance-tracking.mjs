// QA — Phase 4 PR 4.6 payment/denial/remittance tracking.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "shared/schema/invoiceFinancialEvents.ts",
  "migrations/0038_phase4_invoice_financial_events.sql",
  "server/services/billing/invoiceFinancialService.ts",
  "server/routes/invoiceFinancialEvents.ts",
  "client/src/lib/invoiceFinancialApi.ts",
  "client/src/components/billing/InvoiceFinancialPanel.tsx",
  "client/src/pages/remittance-audit.tsx",
  "docs/architecture/phase-4-payment-denial-remittance-tracking.md",
];
for (const r of REQUIRED) {
  if (!fs.existsSync(path.join(root, r))) failures.push(`missing ${r}`);
}

const schema = fs.readFileSync(path.join(root, "shared/schema/invoiceFinancialEvents.ts"), "utf8");
const REQUIRED_TYPES = ["write_off", "contractual", "correction", "dispute_hold"];
for (const t of REQUIRED_TYPES) {
  if (!schema.includes(`"${t}"`)) failures.push(`INVOICE_ADJUSTMENT_TYPES must include "${t}"`);
}
const REQUIRED_DENIAL = ["open", "appealed", "overturned", "upheld", "closed"];
for (const s of REQUIRED_DENIAL) {
  if (!schema.includes(`"${s}"`)) failures.push(`INVOICE_DENIAL_STATUSES must include "${s}"`);
}
const REQUIRED_REMIT = ["remittance_received", "denial_received", "payment_posted", "adjustment_posted"];
for (const e of REQUIRED_REMIT) {
  if (!schema.includes(`"${e}"`)) failures.push(`REMITTANCE_EVENT_TYPES must include "${e}"`);
}

const service = fs.readFileSync(path.join(root, "server/services/billing/invoiceFinancialService.ts"), "utf8");
const REQUIRED_FN = ["postPayment", "postAdjustment", "postDenial", "postRemittanceEvent", "recomputeInvoiceTotals", "patchDenialStatus"];
for (const f of REQUIRED_FN) {
  if (!service.includes(`export async function ${f}`)) failures.push(`service must export ${f}`);
}
// "Paid" only when balance <= 0.
if (!/totalBalance <= 0\) return "Paid"/.test(service)) {
  failures.push("status must only become 'Paid' when totalBalance <= 0");
}
// Denials do not change balance: postDenial must not call recompute.
if (/postDenial[\s\S]*recomputeInvoiceTotals/.test(service)) {
  failures.push("postDenial must NOT call recomputeInvoiceTotals (denials do not change balance)");
}

const route = fs.readFileSync(path.join(root, "server/routes/invoiceFinancialEvents.ts"), "utf8");
const REQUIRED_ROUTES = [
  'app.post("/api/invoices/:id/payments"',
  'app.post("/api/invoices/:id/adjustments"',
  'app.post("/api/invoices/:id/denials"',
  'app.post("/api/invoices/:id/remittance-events"',
  'app.get("/api/invoices/:id/financial-events"',
  'app.patch("/api/denials/:id/status"',
];
for (const r of REQUIRED_ROUTES) {
  if (!route.includes(r)) failures.push(`route must register ${r}`);
}

if (failures.length > 0) {
  console.error("Phase-4 payment-denial-remittance-tracking QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-4 payment-denial-remittance-tracking QA passed.");
