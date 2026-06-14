// Smoke — Phase 4 PR 4.3 invoice batch builder chain.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fails = [];
const passes = [];

function check(label, file, predicate) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  if (predicate(src)) passes.push(label);
  else fails.push(`${label} — failed for ${file}`);
}

check("1. Schema exports both tables + status unions",
  "shared/schema/invoiceBatches.ts",
  (s) => s.includes("INVOICE_BATCH_STATUSES") && s.includes("INVOICE_BATCH_LINE_STATUSES") && s.includes("invoiceBatches") && s.includes("invoiceBatchItems"),
);
check("2. Migration creates both tables + FKs",
  "migrations/0035_phase4_invoice_batches.sql",
  (s) => s.includes('CREATE TABLE IF NOT EXISTS "invoice_batches"') && s.includes('CREATE TABLE IF NOT EXISTS "invoice_batch_items"') && s.includes("invoice_batch_items_batch_fk"),
);
check("3. Builder derives period from policy + snapshots",
  "server/services/billing/invoiceBatchBuilder.ts",
  (s) => s.includes("defaultPeriodFromPolicy") && s.includes("invoiceReadinessSnapshots"),
);
check("4. Route exposes all 6 endpoints",
  "server/routes/invoiceBatches.ts",
  (s) =>
    s.includes('"/api/invoice-batches/preview"') &&
    s.includes('"/api/invoice-batches/generate-due"') &&
    s.includes('"/api/invoice-batches/:id/refresh"') &&
    s.includes('"/api/invoice-batches/:id/void"'),
);
check("5. Page builds previews + shows item detail",
  "client/src/pages/invoice-batches.tsx",
  (s) => s.includes("postInvoiceBatchPreview") && s.includes("batch-detail-"),
);
check("6. App.tsx registers /billing/invoice-batches",
  "client/src/App.tsx",
  (s) => s.includes("/billing/invoice-batches"),
);

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length > 0) {
  console.error(`Smoke failed: ${fails.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: invoice batch builder chain intact.");
