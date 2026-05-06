// Read-only QA for the Billing page's staff-visibility surfaces.
//
// Run with `npm run test:billing-visibility-read-model`. Requires
// DATABASE_URL.
//
// Assertions (TestVisit Patient, is_test=true):
//   1. billing_readiness_checks readable by the same filter contract
//      the Billing page uses (patientScreeningId + serviceType).
//   2. completed_billing_packages readable by the same filter contract.
//   3. payment status field is readable on the package.
//   4. invoice line / invoice linkage readable when present
//      (metadata.invoiceLineItemId → invoice_line_items row).
//   5. Two reads in a row return the same id sets — read model has
//      no duplicate side effects.
//   6. Prints PASS/FAIL and IDs.
//
// What this script does NOT do:
//   - Mutate data.
//   - Touch real patients.
//   - Hit the HTTP layer (the Billing page selectors flow through the
//     listBillingReadinessChecks / listCompletedBillingPackages
//     repositories, which we call directly here).

import { and, eq, inArray } from "drizzle-orm";

const TEST_VISIT_NAME = "TestVisit Patient";
const TEST_VISIT_DOB = "02/02/1950";
const TEST_SERVICE = "BrainWave";

type Assertion = { name: string; pass: boolean; detail: string };

function record(list: Assertion[], name: string, pass: boolean, detail: string): void {
  list.push({ name, pass, detail });
  const symbol = pass ? "✓ PASS" : "✗ FAIL";
  console.log(`  ${symbol}  ${name} — ${detail}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[test:billing-visibility-read-model] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { invoiceLineItems, invoices } = await import("@shared/schema/invoices");
  const { listBillingReadinessChecks } = await import(
    "../server/repositories/billingReadiness.repo"
  );
  const { listCompletedBillingPackages } = await import(
    "../server/repositories/completedBillingPackages.repo"
  );

  const assertions: Assertion[] = [];
  let exitCode = 0;

  try {
    // ── 1. Resolve seed (discover ids by name+dob+is_test) ───────────────
    const [seed] = await db
      .select()
      .from(patientScreenings)
      .where(
        and(
          eq(patientScreenings.name, TEST_VISIT_NAME),
          eq(patientScreenings.dob, TEST_VISIT_DOB),
          eq(patientScreenings.isTest, true),
        ),
      )
      .limit(1);
    if (!seed) {
      console.error(
        "[test:billing-visibility-read-model] seed missing — run `npm run seed:visit-flow` first",
      );
      process.exit(1);
    }
    const psid = seed.id;
    console.log(`[test:billing-visibility-read-model] psid=${psid}`);

    // ── 2. First read pass (Billing page filter shape) ──────────────────
    const readiness1 = await listBillingReadinessChecks(
      { patientScreeningId: psid, serviceType: TEST_SERVICE },
      50,
    );
    const packages1 = await listCompletedBillingPackages(
      { patientScreeningId: psid, serviceType: TEST_SERVICE },
      50,
    );

    const readinessIds1 = readiness1.map((r) => r.id).sort((a, b) => a - b);
    const packageIds1 = packages1.map((p) => p.id).sort((a, b) => a - b);

    console.log(
      `[read-1] readiness=${readinessIds1.length} packages=${packageIds1.length}`,
    );

    // ── 3. Assertion 1 — readiness readable ─────────────────────────────
    const readiness = readiness1[0] ?? null;
    record(
      assertions,
      "1 · billing readiness row readable by Billing-page selector",
      readiness !== null,
      readiness
        ? `id=${readiness.id} status=${readiness.readinessStatus} missing=${readiness.missingRequirements.length}`
        : "no readiness row found for TestVisit",
    );

    // ── 4. Assertion 2 — package readable ───────────────────────────────
    const pkg = packages1[0] ?? null;
    record(
      assertions,
      "2 · completed billing package readable by Billing-page selector",
      pkg !== null,
      pkg
        ? `id=${pkg.id} packageStatus=${pkg.packageStatus} paymentStatus=${pkg.paymentStatus}`
        : "no completed billing package found for TestVisit",
    );

    // ── 5. Assertion 3 — payment status readable ────────────────────────
    const validPaymentStatuses = new Set([
      "not_received",
      "updated",
      "paid",
      "partial",
      "pending",
    ]);
    record(
      assertions,
      "3 · payment status readable and recognized",
      pkg !== null && validPaymentStatuses.has(pkg.paymentStatus),
      pkg ? `paymentStatus=${pkg.paymentStatus}` : "no package",
    );

    // ── 6. Assertion 4 — invoice linkage readable when present ──────────
    let lineItemReadOk = true;
    let lineItemDetail = "no invoice linkage in metadata (acceptable)";
    if (pkg) {
      const meta = (pkg.metadata && typeof pkg.metadata === "object"
        ? (pkg.metadata as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      const liId = typeof meta.invoiceLineItemId === "number" ? meta.invoiceLineItemId : null;
      const invId = typeof meta.invoiceId === "number" ? meta.invoiceId : null;
      if (liId !== null) {
        const lineRows = await db
          .select()
          .from(invoiceLineItems)
          .where(eq(invoiceLineItems.id, liId))
          .limit(1);
        const line = lineRows[0] ?? null;
        if (!line) {
          lineItemReadOk = false;
          lineItemDetail = `metadata.invoiceLineItemId=${liId} but no invoice_line_items row found`;
        } else {
          let invoiceFound = invId === null;
          let invoiceTotalCharges: string | null = null;
          if (invId !== null) {
            const invRows = await db
              .select()
              .from(invoices)
              .where(eq(invoices.id, invId))
              .limit(1);
            const inv = invRows[0] ?? null;
            invoiceFound = inv !== null;
            invoiceTotalCharges = inv?.totalCharges ?? null;
          }
          lineItemReadOk = invoiceFound;
          lineItemDetail =
            `lineItemId=${line.id} invoiceId=${invId ?? "—"} ` +
            `lineCharges=${line.totalCharges} invCharges=${invoiceTotalCharges ?? "—"}`;
        }
      }
    }
    record(
      assertions,
      "4 · invoice line / invoice linkage readable when present",
      lineItemReadOk,
      lineItemDetail,
    );

    // ── 7. Second read pass to prove no duplicate side effects ──────────
    const readiness2 = await listBillingReadinessChecks(
      { patientScreeningId: psid, serviceType: TEST_SERVICE },
      50,
    );
    const packages2 = await listCompletedBillingPackages(
      { patientScreeningId: psid, serviceType: TEST_SERVICE },
      50,
    );
    const readinessIds2 = readiness2.map((r) => r.id).sort((a, b) => a - b);
    const packageIds2 = packages2.map((p) => p.id).sort((a, b) => a - b);

    const sameReadiness =
      readinessIds1.length === readinessIds2.length &&
      readinessIds1.every((id, i) => id === readinessIds2[i]);
    const samePackages =
      packageIds1.length === packageIds2.length &&
      packageIds1.every((id, i) => id === packageIds2[i]);

    record(
      assertions,
      "5 · two reads return the same id sets (read model is idempotent)",
      sameReadiness && samePackages,
      `readiness ${readinessIds1.length}→${readinessIds2.length} ` +
        `packages ${packageIds1.length}→${packageIds2.length}`,
    );

    // ── 8. Cross-check that line item id list also unchanged ────────────
    const liIds1: number[] = [];
    for (const p of packages1) {
      const meta = (p.metadata && typeof p.metadata === "object"
        ? (p.metadata as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      if (typeof meta.invoiceLineItemId === "number") liIds1.push(meta.invoiceLineItemId);
    }
    const liIds2: number[] = [];
    for (const p of packages2) {
      const meta = (p.metadata && typeof p.metadata === "object"
        ? (p.metadata as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      if (typeof meta.invoiceLineItemId === "number") liIds2.push(meta.invoiceLineItemId);
    }
    let lineItemRowsExist = true;
    if (liIds1.length > 0) {
      const rows = await db
        .select({ id: invoiceLineItems.id })
        .from(invoiceLineItems)
        .where(inArray(invoiceLineItems.id, liIds1));
      lineItemRowsExist = rows.length === liIds1.length;
    }
    record(
      assertions,
      "6 · invoice line item rows referenced by metadata still exist (no read-side delete)",
      lineItemRowsExist && liIds1.length === liIds2.length,
      `referencedLineItems=${liIds1.length} reReadCount=${liIds2.length}`,
    );

    // ── Summary ─────────────────────────────────────────────────────────
    const passed = assertions.filter((a) => a.pass).length;
    const failed = assertions.length - passed;
    console.log("\n════════════════════════════════════════════════════════════");
    console.log(
      `  IDs: psid=${psid} readinessId=${readiness?.id ?? "—"} ` +
        `packageId=${pkg?.id ?? "—"}`,
    );
    console.log(`  assertions  passed ${passed}/${assertions.length}, failed ${failed}`);
    console.log("════════════════════════════════════════════════════════════");

    if (failed > 0) {
      console.error("[test:billing-visibility-read-model] FAIL");
      exitCode = 1;
    } else {
      console.log("[test:billing-visibility-read-model] OK");
    }
  } catch (err: any) {
    console.error("[test:billing-visibility-read-model] unexpected failure:", err);
    exitCode = 1;
  } finally {
    // Mirror the established 750ms grace pattern before pool.end() to
    // protect any fire-and-forget tails — even though this is a read-
    // only script, the import chain may include modules that schedule
    // background work.
    await new Promise<void>((resolve) => setTimeout(resolve, 750));
    try {
      await pool.end();
    } catch {
      /* noop */
    }
  }

  process.exit(exitCode);
}

main();
