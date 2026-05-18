// QA for the document → billing → invoice canonical spine.
//
// Run with: npm run qa:document-billing-invoice-spine
//
// Smoke-reads every canonical table in the post-procedure spine so we
// can detect a missing table / repo wiring before exercising real
// product UX. Never writes outside `isTest=true` rows. Skips cleanly
// when DATABASE_URL is missing.

if (!process.env.DATABASE_URL) {
  console.log(
    "[qa-document-billing-invoice-spine] DATABASE_URL missing — skipping.",
  );
  process.exit(0);
}

let passes = 0;
let failures = 0;
function assert(cond: unknown, label: string) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

async function main() {
  const dbMod = await import("../server/db");
  const schemaMod = await import("@shared/schema");
  const { db } = dbMod;

  console.log("\n--- document spine ---");
  const docTables: Array<[string, any]> = [
    ["procedure_events", schemaMod.procedureEvents],
    ["procedure_notes / generated_notes", (schemaMod as any).procedureNotes ?? (schemaMod as any).generatedNotes],
    ["documents", schemaMod.documents],
    ["document_blobs", (schemaMod as any).documentBlobs],
    ["document_surface_assignments", (schemaMod as any).documentSurfaceAssignments],
    ["ancillary_document_templates", (schemaMod as any).ancillaryDocumentTemplates],
    ["case_document_readiness", (schemaMod as any).caseDocumentReadiness],
  ];
  for (const [name, table] of docTables) {
    if (!table) {
      assert(false, `${name}: schema export missing`);
      continue;
    }
    try {
      const rows = await db.select().from(table).limit(1);
      assert(Array.isArray(rows), `${name}: select returns array`);
    } catch (err) {
      assert(
        false,
        `${name}: select threw — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log("\n--- billing readiness spine ---");
  const billingTables: Array<[string, any]> = [
    ["billing_readiness_checks", (schemaMod as any).billingReadinessChecks],
    ["billing_document_requests", (schemaMod as any).billingDocumentRequests],
    ["completed_billing_packages", (schemaMod as any).completedBillingPackages],
  ];
  for (const [name, table] of billingTables) {
    if (!table) {
      assert(false, `${name}: schema export missing`);
      continue;
    }
    try {
      const rows = await db.select().from(table).limit(1);
      assert(Array.isArray(rows), `${name}: select returns array`);
    } catch (err) {
      assert(
        false,
        `${name}: select threw — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log("\n--- invoice spine ---");
  const invoiceTables: Array<[string, any]> = [
    ["invoices", (schemaMod as any).invoices],
    ["invoice_line_items", (schemaMod as any).invoiceLineItems],
    ["invoice_payments", (schemaMod as any).invoicePayments],
    ["projected_invoice_rows", (schemaMod as any).projectedInvoiceRows],
    ["cash_price_settings", (schemaMod as any).cashPriceSettings],
  ];
  for (const [name, table] of invoiceTables) {
    if (!table) {
      assert(false, `${name}: schema export missing`);
      continue;
    }
    try {
      const rows = await db.select().from(table).limit(1);
      assert(Array.isArray(rows), `${name}: select returns array`);
    } catch (err) {
      assert(
        false,
        `${name}: select threw — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log("\n--- team ops spine ---");
  const opsTables: Array<[string, any]> = [
    ["pto_requests", (schemaMod as any).ptoRequests],
    ["outreach_schedulers", schemaMod.outreachSchedulers],
    ["admin_settings", (schemaMod as any).adminSettings],
  ];
  for (const [name, table] of opsTables) {
    if (!table) {
      assert(false, `${name}: schema export missing`);
      continue;
    }
    try {
      const rows = await db.select().from(table).limit(1);
      assert(Array.isArray(rows), `${name}: select returns array`);
    } catch (err) {
      assert(
        false,
        `${name}: select threw — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(`\n=========================`);
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log(`=========================`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
