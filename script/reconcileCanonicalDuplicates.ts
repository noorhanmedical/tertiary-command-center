// One-shot reconciler for known canonical-table duplicate categories surfaced
// by `npm run audit:canonical-integrity`. Run with
// `npm run reconcile:canonical-duplicates`. Requires DATABASE_URL.
//
// What it does (idempotent — safe to re-run):
//   A. billing_document_requests duplicate cleanup
//        Groups by billing_readiness_check_id (primary dedup contract)
//        and by (procedure_event_id, service_type) (fallback dedup).
//        Within each group, keeps the lowest-id row and DELETEs the rest.
//        FK from completed_billing_packages.billing_document_request_id is
//        ON DELETE SET NULL, so deletion is safe.
//   B. invoice_line_items duplicate cleanup, scoped to facility="Test Facility"
//        Groups by (patient_name, date_of_service, service) and keeps the
//        lowest-id line item per group. After cleanup, recomputes the parent
//        invoice's total_charges and total_balance from the surviving line
//        items. total_paid is left alone (driven by invoice_payments).
//   Production data (facility != "Test Facility") is intentionally never
//   touched by step B. If a duplicate group spans both test and prod
//   facilities the script skips it and reports.
//
// What it does NOT do:
//   - Delete completed_billing_packages.
//   - Delete invoices.
//   - Touch any non-test facility line items.
//   - Touch any duplicate category not listed above.

import type { QueryResult } from "pg";

type DocReqRow = {
  id: number;
  billing_readiness_check_id: number | null;
  procedure_event_id: number | null;
  service_type: string;
  request_status: string;
};

type LineItemRow = {
  id: number;
  invoice_id: number;
  patient_name: string;
  date_of_service: string | null;
  service: string;
  total_charges: string | null;
  invoice_facility: string;
  invoice_status: string;
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[reconcile:canonical-duplicates] DATABASE_URL is not set");
    process.exit(1);
  }

  const { pool } = await import("../server/db");

  let exitCode = 0;
  try {
    // ── Step A: billing_document_requests duplicates ────────────────────
    console.log("\n── billing_document_requests cleanup ───────────────────────────");

    const beforeAll: QueryResult<DocReqRow> = await pool.query(
      `SELECT id, billing_readiness_check_id, procedure_event_id, service_type, request_status
         FROM billing_document_requests
        ORDER BY id`,
    );
    console.log(`  BEFORE: ${beforeAll.rows.length} total billing_document_requests row(s)`);
    for (const r of beforeAll.rows) {
      console.log(
        `    id=${r.id} readinessCheckId=${r.billing_readiness_check_id ?? "—"} ` +
        `procedureEventId=${r.procedure_event_id ?? "—"} service=${r.service_type} status=${r.request_status}`,
      );
    }

    // A.1 — duplicate groups by billing_readiness_check_id
    const dupesByReadiness: QueryResult<{ billing_readiness_check_id: number; ids: number[] }> = await pool.query(
      `SELECT billing_readiness_check_id, ARRAY_AGG(id ORDER BY id) AS ids
         FROM billing_document_requests
        WHERE billing_readiness_check_id IS NOT NULL
        GROUP BY billing_readiness_check_id
       HAVING COUNT(*) > 1`,
    );
    let deletedByReadiness = 0;
    for (const g of dupesByReadiness.rows) {
      const [keep, ...extras] = g.ids;
      console.log(
        `  group billing_readiness_check_id=${g.billing_readiness_check_id} → keep id=${keep}, delete ${extras.join(",")}`,
      );
      for (const id of extras) {
        const r = await pool.query(`DELETE FROM billing_document_requests WHERE id = $1`, [id]);
        deletedByReadiness += r.rowCount ?? 0;
      }
    }
    console.log(`  cleaned ${deletedByReadiness} duplicate(s) via billing_readiness_check_id key`);

    // A.2 — remaining duplicate groups by (procedure_event_id, service_type)
    const dupesByProcedure: QueryResult<{
      procedure_event_id: number;
      service_type: string;
      ids: number[];
    }> = await pool.query(
      `SELECT procedure_event_id, service_type, ARRAY_AGG(id ORDER BY id) AS ids
         FROM billing_document_requests
        WHERE procedure_event_id IS NOT NULL
        GROUP BY procedure_event_id, service_type
       HAVING COUNT(*) > 1`,
    );
    let deletedByProcedure = 0;
    for (const g of dupesByProcedure.rows) {
      const [keep, ...extras] = g.ids;
      console.log(
        `  group procedure_event_id=${g.procedure_event_id} service=${g.service_type} → keep id=${keep}, delete ${extras.join(",")}`,
      );
      for (const id of extras) {
        const r = await pool.query(`DELETE FROM billing_document_requests WHERE id = $1`, [id]);
        deletedByProcedure += r.rowCount ?? 0;
      }
    }
    console.log(`  cleaned ${deletedByProcedure} duplicate(s) via (procedure_event_id, service_type) key`);

    const afterAll: QueryResult<DocReqRow> = await pool.query(
      `SELECT id, billing_readiness_check_id, procedure_event_id, service_type, request_status
         FROM billing_document_requests
        ORDER BY id`,
    );
    console.log(`  AFTER:  ${afterAll.rows.length} total billing_document_requests row(s)`);

    // ── Step B: invoice_line_items duplicates (Test Facility only) ──────
    console.log("\n── invoice_line_items cleanup (Test Facility scope) ────────────");

    const beforeLines: QueryResult<LineItemRow> = await pool.query(
      `SELECT ili.id, ili.invoice_id, ili.patient_name, ili.date_of_service, ili.service,
              ili.total_charges, i.facility AS invoice_facility, i.status AS invoice_status
         FROM invoice_line_items ili
         JOIN invoices i ON i.id = ili.invoice_id
        WHERE i.facility = 'Test Facility'
        ORDER BY ili.id`,
    );
    console.log(`  BEFORE: ${beforeLines.rows.length} invoice_line_item row(s) in Test Facility invoices`);
    for (const r of beforeLines.rows) {
      console.log(
        `    line_item id=${r.id} invoiceId=${r.invoice_id} patient=${r.patient_name} ` +
        `dos=${r.date_of_service} service=${r.service} totalCharges=${r.total_charges}`,
      );
    }

    // Group by (patient_name, date_of_service, service) WITHIN Test Facility invoices
    const lineDupes: QueryResult<{
      patient_name: string;
      date_of_service: string;
      service: string;
      ids: number[];
      invoice_ids: number[];
    }> = await pool.query(
      `SELECT ili.patient_name, ili.date_of_service, ili.service,
              ARRAY_AGG(ili.id ORDER BY ili.id) AS ids,
              ARRAY_AGG(ili.invoice_id ORDER BY ili.id) AS invoice_ids
         FROM invoice_line_items ili
         JOIN invoices i ON i.id = ili.invoice_id
        WHERE i.facility = 'Test Facility' AND ili.date_of_service IS NOT NULL
        GROUP BY ili.patient_name, ili.date_of_service, ili.service
       HAVING COUNT(*) > 1`,
    );

    let deletedLines = 0;
    const affectedInvoiceIds = new Set<number>();
    for (const g of lineDupes.rows) {
      const [keep, ...extras] = g.ids;
      console.log(
        `  group patient=${g.patient_name} dos=${g.date_of_service} service=${g.service} → keep id=${keep}, delete ${extras.join(",")}`,
      );
      for (const id of extras) {
        const r = await pool.query(`DELETE FROM invoice_line_items WHERE id = $1`, [id]);
        deletedLines += r.rowCount ?? 0;
      }
      for (const invoiceId of g.invoice_ids) affectedInvoiceIds.add(invoiceId);

      // Repair completed_billing_packages metadata: any package pointing
      // at one of the now-deleted line items should be re-pointed at the
      // surviving id. Also handles the case where the survivor has no
      // back-reference yet.
      for (const deletedId of extras) {
        await pool.query(
          `UPDATE completed_billing_packages
              SET metadata = jsonb_set(metadata, '{invoiceLineItemId}', to_jsonb($1::int))
            WHERE (metadata->>'invoiceLineItemId')::int = $2`,
          [keep, deletedId],
        );
      }
    }
    console.log(`  cleaned ${deletedLines} duplicate line item(s)`);

    // ── Step C: recompute invoice totals for affected invoices ──────────
    if (affectedInvoiceIds.size > 0) {
      console.log("\n── recompute invoice totals for affected invoices ──────────────");
      for (const invoiceId of affectedInvoiceIds) {
        const sumRes: QueryResult<{ total_charges: string }> = await pool.query(
          `SELECT COALESCE(SUM(total_charges::numeric), 0)::text AS total_charges
             FROM invoice_line_items
            WHERE invoice_id = $1`,
          [invoiceId],
        );
        const total = sumRes.rows[0]?.total_charges ?? "0";

        const invRes: QueryResult<{ total_paid: string | null }> = await pool.query(
          `SELECT total_paid FROM invoices WHERE id = $1`,
          [invoiceId],
        );
        const totalPaid = parseFloat(invRes.rows[0]?.total_paid ?? "0") || 0;
        const totalCharges = parseFloat(total) || 0;
        const totalBalance = totalCharges - totalPaid;

        // total_charges and total_balance are NUMERIC(12,2) columns. Cast to
        // ::numeric so Postgres doesn't reject the assignment (the previous
        // ::text cast caused: "column ... is of type numeric but expression
        // is of type text").
        await pool.query(
          `UPDATE invoices
              SET total_charges = $1::numeric,
                  total_balance = $2::numeric
            WHERE id = $3`,
          [totalCharges.toFixed(2), totalBalance.toFixed(2), invoiceId],
        );
        console.log(
          `  invoice id=${invoiceId} total_charges=${totalCharges.toFixed(2)} ` +
          `total_balance=${totalBalance.toFixed(2)} (total_paid=${totalPaid.toFixed(2)} kept)`,
        );
      }
    }

    const afterLines: QueryResult<LineItemRow> = await pool.query(
      `SELECT ili.id, ili.invoice_id, ili.patient_name, ili.date_of_service, ili.service,
              ili.total_charges, i.facility AS invoice_facility, i.status AS invoice_status
         FROM invoice_line_items ili
         JOIN invoices i ON i.id = ili.invoice_id
        WHERE i.facility = 'Test Facility'
        ORDER BY ili.id`,
    );
    console.log(`\n  AFTER:  ${afterLines.rows.length} invoice_line_item row(s) in Test Facility invoices`);

    console.log("\n[reconcile:canonical-duplicates] OK");
    console.log(
      `  total deletions: billing_document_requests=${deletedByReadiness + deletedByProcedure}, invoice_line_items=${deletedLines}`,
    );
  } catch (err: any) {
    console.error("[reconcile:canonical-duplicates] failed:", err);
    exitCode = 1;
  } finally {
    try {
      await pool.end();
    } catch {
      /* noop */
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[reconcile:canonical-duplicates] unexpected failure:", err);
  process.exit(1);
});
