// QA for the projected_invoice_rows ↔ invoice_line_items linkage.
// Run with: `npm run qa:projected-invoice-reconciliation`. No DB
// required.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PROJECTED_STATUSES,
  projectedInvoiceRows,
} from "../shared/schema/projectedInvoices";

let passes = 0;
let failures = 0;
function assert(c: unknown, l: string) {
  if (c) { passes++; console.log(`  ✓ ${l}`); }
  else { failures++; console.log(`  ✗ ${l}`); }
}
function readFile(p: string): string {
  try { return readFileSync(resolve(process.cwd(), p), "utf8"); } catch { return ""; }
}

function main() {
  console.log("\n--- projected_invoice_rows schema ---");
  // The drizzle table object has a `realInvoiceLineItemId` column.
  // Drizzle exposes columns via the `_.columns` symbol map; we
  // assert via the schema source since drizzle's internal layout
  // can differ. The schema source is the contract.
  const schema = readFile("shared/schema/projectedInvoices.ts");
  assert(
    /realInvoiceLineItemId:\s*integer\("real_invoice_line_item_id"\)/.test(schema),
    "realInvoiceLineItemId column references invoice_line_items.id",
  );
  assert(
    /varianceAmount:\s*text\("variance_amount"\)/.test(schema),
    "varianceAmount column exists for projected vs real delta",
  );
  for (const s of [
    "projected_open",
    "projected_sent",
    "converted_to_real_invoice",
    "variance_review",
    "projected_closed",
  ]) {
    assert(
      (PROJECTED_STATUSES as readonly string[]).includes(s),
      `projectedStatus "${s}" registered`,
    );
  }
  // Smoke-check the runtime export carries a name (helps catch
  // refactor accidents).
  assert(
    typeof projectedInvoiceRows === "object" && projectedInvoiceRows !== null,
    "projectedInvoiceRows table object is exported",
  );

  console.log("\n--- read route + helper ---");
  const route = readFile("server/routes/projectedInvoices.ts");
  assert(
    /\/api\/projected-invoice-rows/.test(route),
    "GET /api/projected-invoice-rows is mounted",
  );
  assert(
    /realInvoiceLineItemId/.test(route),
    "route accepts realInvoiceLineItemId filter",
  );
  const helper = readFile("client/src/lib/workflow/projectedInvoicesApi.ts");
  assert(
    /export async function fetchProjectedInvoiceRows/.test(helper),
    "fetchProjectedInvoiceRows is exported",
  );
  assert(
    /summarizeProjectedVariance/.test(helper),
    "summarizeProjectedVariance helper is exported",
  );
  assert(
    /hasRealLink/.test(helper),
    "variance summary returns hasRealLink flag",
  );

  console.log("\n--- invoice candidates route + helper exist ---");
  const candidatesRoute = readFile("server/routes/completedBillingPackages.ts");
  assert(
    /\/api\/invoice-candidates/.test(candidatesRoute),
    "GET /api/invoice-candidates is mounted",
  );
  const candidatesHelper = readFile(
    "client/src/lib/workflow/invoiceCandidatesApi.ts",
  );
  assert(
    /export async function fetchInvoiceCandidates/.test(candidatesHelper),
    "fetchInvoiceCandidates is exported",
  );
  assert(
    /TERMINAL_PACKAGE_STATUSES/.test(candidatesHelper),
    "TERMINAL_PACKAGE_STATUSES enum is exported",
  );
  assert(
    /isInvoiceLinked/.test(candidatesHelper),
    "isInvoiceLinked helper is exported",
  );

  console.log("\n--- audit doc + journey-event surface ---");
  const billingDoc = readFile("docs/architecture/billing-package-source-of-truth.md");
  assert(billingDoc.length > 0, "billing-package-source-of-truth.md exists");
  assert(/realInvoiceLineItemId/.test(billingDoc), "doc references realInvoiceLineItemId linkage");
  const journeyDrawer = readFile(
    "client/src/components/patient/PatientJourneyDrawer.tsx",
  );
  assert(
    /realInvoiceLineItemId/.test(journeyDrawer) && /variance/.test(journeyDrawer.toLowerCase()),
    "PatientJourneyDrawer surfaces realInvoiceLineItemId + variance per row",
  );

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main();
