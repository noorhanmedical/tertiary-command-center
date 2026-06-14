// Smoke — Phase 4 PR 4.2 invoice readiness chain.

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

check(
  "1. Schema exports INVOICE_READINESS_STATUSES + INVOICE_READINESS_BLOCKERS",
  "shared/schema/invoiceReadiness.ts",
  (s) => s.includes("INVOICE_READINESS_STATUSES") && s.includes("INVOICE_READINESS_BLOCKERS"),
);
check(
  "2. Engine reads policy bundle + emits structured evaluation",
  "server/services/billing/invoiceReadinessEngine.ts",
  (s) => s.includes("getEffectiveBillingPolicy(") && s.includes("readinessStatus"),
);
check(
  "3. Repo upserts by (execution_case_id, service_type)",
  "server/repositories/invoiceReadiness.repo.ts",
  (s) => s.includes("upsertInvoiceReadinessSnapshot") && s.includes("eq(invoiceReadinessSnapshots.executionCaseId"),
);
check(
  "4. Route exposes evaluate + facility sweep + list",
  "server/routes/invoiceReadiness.ts",
  (s) =>
    s.includes('"/api/invoice-readiness/evaluate"') &&
    s.includes('"/api/invoice-readiness/evaluate-facility"') &&
    s.includes('"/api/invoice-readiness"'),
);
check(
  "5. Page consumes /api/invoice-readiness + shows blocker chips",
  "client/src/pages/billing-readiness.tsx",
  (s) => s.includes("fetchInvoiceReadiness") && s.includes("readiness-blocker-"),
);
check(
  "6. App.tsx registers /billing/readiness under AdminGuard",
  "client/src/App.tsx",
  (s) => s.includes("/billing/readiness") && /AdminGuard[^<]*<BillingReadinessPage/.test(s),
);
check(
  "7. Migration adds the unique case-service index",
  "migrations/0034_phase4_invoice_readiness_snapshots.sql",
  (s) => s.includes("idx_invoice_readiness_case_service"),
);

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length > 0) {
  console.error(`Smoke failed: ${fails.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: invoice readiness chain intact.");
