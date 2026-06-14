// QA — Phase 4 PR 4.3 invoice batch builder.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "shared/schema/invoiceBatches.ts",
  "migrations/0035_phase4_invoice_batches.sql",
  "server/services/billing/invoiceBatchBuilder.ts",
  "server/repositories/invoiceBatches.repo.ts",
  "server/routes/invoiceBatches.ts",
  "client/src/lib/invoiceBatchesApi.ts",
  "client/src/pages/invoice-batches.tsx",
  "docs/architecture/phase-4-invoice-batch-builder.md",
];
for (const r of REQUIRED) {
  if (!fs.existsSync(path.join(root, r))) failures.push(`missing ${r}`);
}

const schema = fs.readFileSync(path.join(root, "shared/schema/invoiceBatches.ts"), "utf8");
const REQUIRED_STATUSES = ["draft_preview", "ready_for_review", "invoice_drafts_created", "voided"];
for (const s of REQUIRED_STATUSES) {
  if (!schema.includes(`"${s}"`)) failures.push(`INVOICE_BATCH_STATUSES must include "${s}"`);
}
const REQUIRED_LINE_STATUSES = ["included", "excluded", "blocked", "duplicate"];
for (const s of REQUIRED_LINE_STATUSES) {
  if (!schema.includes(`"${s}"`)) failures.push(`INVOICE_BATCH_LINE_STATUSES must include "${s}"`);
}

const builder = fs.readFileSync(path.join(root, "server/services/billing/invoiceBatchBuilder.ts"), "utf8");
if (!builder.includes("export async function buildInvoiceBatchPreview")) {
  failures.push("builder must export buildInvoiceBatchPreview");
}
if (!builder.includes("getEffectiveBillingPolicy")) {
  failures.push("builder must pull the policy bundle");
}
// Forbid the builder from inserting into invoices.
if (/insert\([^)]*invoices\b/.test(builder)) {
  failures.push("builder must not insert into invoices");
}

const route = fs.readFileSync(path.join(root, "server/routes/invoiceBatches.ts"), "utf8");
const REQUIRED_ROUTES = [
  'app.get("/api/invoice-batches"',
  'app.get("/api/invoice-batches/:id"',
  'app.post("/api/invoice-batches/preview"',
  'app.post("/api/invoice-batches/generate-due"',
  'app.post("/api/invoice-batches/:id/refresh"',
  'app.post("/api/invoice-batches/:id/void"',
];
for (const r of REQUIRED_ROUTES) {
  if (!route.includes(r)) failures.push(`route must register ${r}`);
}

const app = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
if (!app.includes("/billing/invoice-batches")) failures.push("App.tsx must register /billing/invoice-batches");

const routes = fs.readFileSync(path.join(root, "server/routes.ts"), "utf8");
if (!routes.includes("registerInvoiceBatchRoutes")) failures.push("server/routes.ts must register invoice batch routes");

if (failures.length > 0) {
  console.error("Phase-4 invoice-batch-builder QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-4 invoice-batch-builder QA passed.");
