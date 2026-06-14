// QA — Phase 4 PR 4.2 invoice readiness engine.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "shared/schema/invoiceReadiness.ts",
  "migrations/0034_phase4_invoice_readiness_snapshots.sql",
  "server/services/billing/invoiceReadinessEngine.ts",
  "server/repositories/invoiceReadiness.repo.ts",
  "server/routes/invoiceReadiness.ts",
  "client/src/lib/invoiceReadinessApi.ts",
  "client/src/pages/billing-readiness.tsx",
  "docs/architecture/phase-4-invoice-readiness-engine.md",
];
for (const r of REQUIRED) {
  if (!fs.existsSync(path.join(root, r))) failures.push(`missing ${r}`);
}

const schema = fs.readFileSync(path.join(root, "shared/schema/invoiceReadiness.ts"), "utf8");
const REQUIRED_STATUSES = ["not_ready", "blocked", "ready_to_invoice", "invoice_draft_created", "invoiced", "excluded"];
for (const s of REQUIRED_STATUSES) {
  if (!schema.includes(`"${s}"`)) failures.push(`INVOICE_READINESS_STATUSES must include "${s}"`);
}
const REQUIRED_BLOCKERS = [
  "missing_report", "missing_consent", "missing_screening", "missing_order_note",
  "missing_procedure_note", "physician_signature_pending", "billing_readiness_pending",
  "missing_price", "missing_recipient", "already_invoiced", "procedure_not_complete",
];
for (const b of REQUIRED_BLOCKERS) {
  if (!schema.includes(`"${b}"`)) failures.push(`INVOICE_READINESS_BLOCKERS must include "${b}"`);
}
if (!schema.includes("idx_invoice_readiness_case_service")) {
  failures.push("schema must declare the unique (execution_case_id, service_type) index");
}

const engine = fs.readFileSync(path.join(root, "server/services/billing/invoiceReadinessEngine.ts"), "utf8");
if (!engine.includes("export async function evaluateInvoiceReadiness")) {
  failures.push("engine must export evaluateInvoiceReadiness");
}
if (!engine.includes("getEffectiveBillingPolicy")) {
  failures.push("engine must read the policy bundle");
}
// Engine must not write to invoices/line items.
if (/insert.*invoices|update.*invoices\b/.test(engine)) {
  failures.push("engine must not write to invoices");
}

const route = fs.readFileSync(path.join(root, "server/routes/invoiceReadiness.ts"), "utf8");
const REQUIRED_ROUTES = [
  'app.get("/api/invoice-readiness"',
  'app.get("/api/invoice-readiness/:id"',
  'app.post("/api/invoice-readiness/evaluate"',
  'app.post("/api/invoice-readiness/evaluate-facility"',
];
for (const r of REQUIRED_ROUTES) {
  if (!route.includes(r)) failures.push(`route must register ${r}`);
}
if (!route.includes("requireAdminOrBiller")) {
  failures.push("evaluate routes must be admin-or-biller gated");
}

const app = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
if (!app.includes("/billing/readiness")) failures.push("App.tsx must register /billing/readiness");

const routes = fs.readFileSync(path.join(root, "server/routes.ts"), "utf8");
if (!routes.includes("registerInvoiceReadinessRoutes")) {
  failures.push("server/routes.ts must register invoice readiness routes");
}

if (failures.length > 0) {
  console.error("Phase-4 invoice-readiness-engine QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-4 invoice-readiness-engine QA passed.");
