// Read-only canonical-table integrity audit. Run with
// `npm run audit:canonical-integrity`. Requires DATABASE_URL.
//
// Issues a series of GROUP BY / HAVING queries against the canonical-spine
// tables to surface duplicate rows that should never coexist. The script
// never INSERTs/UPDATEs/DELETEs anything.
//
// Severity model:
//   PASS — no duplicate keys found.
//   WARN — duplicates that may be legitimate (e.g. test-data leftovers,
//          re-opened workflow rows) but warrant a look.
//   FAIL — duplicates that violate an upsert/dedup contract or unique
//          intent (e.g. two billing readiness checks for the same
//          (screening, service, procedure_event) triple).
//   SKIP — query failed because the relation does not exist (db:push not
//          yet applied for that domain). Treated as informational.
//
// Exit 0 if 0 FAILs, exit 1 otherwise. WARNs alone do not fail the run.

import type { QueryResult } from "pg";

type Severity = "PASS" | "WARN" | "FAIL" | "SKIP";

type CheckResult = {
  category: string;
  label: string;
  severity: Severity;
  rowCount: number;
  preview: string[];
  note?: string;
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[audit:canonical-integrity] DATABASE_URL is not set");
    process.exit(1);
  }

  const { pool } = await import("../server/db");

  const tally = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
  const results: CheckResult[] = [];

  async function runCheck(
    category: string,
    label: string,
    failureSeverity: "WARN" | "FAIL",
    query: string,
  ): Promise<void> {
    let res: QueryResult;
    try {
      res = await pool.query(query);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/does not exist/i.test(msg)) {
        const result: CheckResult = {
          category,
          label,
          severity: "SKIP",
          rowCount: 0,
          preview: [],
          note: `relation missing: ${msg.split("\n")[0]}`,
        };
        results.push(result);
        tally.SKIP++;
        return;
      }
      const result: CheckResult = {
        category,
        label,
        severity: "FAIL",
        rowCount: 0,
        preview: [`query error: ${msg.split("\n")[0]}`],
      };
      results.push(result);
      tally.FAIL++;
      return;
    }

    if (res.rows.length === 0) {
      results.push({ category, label, severity: "PASS", rowCount: 0, preview: [] });
      tally.PASS++;
      return;
    }

    const preview = res.rows.slice(0, 8).map((r) => JSON.stringify(r));
    const result: CheckResult = {
      category,
      label,
      severity: failureSeverity,
      rowCount: res.rows.length,
      preview,
    };
    results.push(result);
    tally[failureSeverity]++;
  }

  // ─────────────────────────────────────────────────────────────────────
  // 1. patient_screenings
  // ─────────────────────────────────────────────────────────────────────
  await runCheck(
    "patient_screenings",
    "duplicate is_test rows by (name, dob, facility)",
    "WARN",
    `SELECT name, dob, facility, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM patient_screenings
      WHERE is_test = true
      GROUP BY name, dob, facility
     HAVING COUNT(*) > 1`,
  );
  await runCheck(
    "patient_screenings",
    "duplicate by (name, dob, facility, batch_id, schedule_date)",
    "WARN",
    `SELECT ps.name, ps.dob, ps.facility, ps.batch_id, sb.schedule_date,
            COUNT(*) AS n, ARRAY_AGG(ps.id ORDER BY ps.id) AS ids
       FROM patient_screenings ps
       JOIN screening_batches sb ON sb.id = ps.batch_id
      GROUP BY ps.name, ps.dob, ps.facility, ps.batch_id, sb.schedule_date
     HAVING COUNT(*) > 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // 2. patient_execution_cases
  // ─────────────────────────────────────────────────────────────────────
  await runCheck(
    "patient_execution_cases",
    "duplicate cases per patient_screening_id (upsert dedup contract)",
    "FAIL",
    `SELECT patient_screening_id, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM patient_execution_cases
      WHERE patient_screening_id IS NOT NULL
      GROUP BY patient_screening_id
     HAVING COUNT(*) > 1`,
  );
  await runCheck(
    "patient_execution_cases",
    "orphan cases (patient_screening_id IS NULL)",
    "WARN",
    `SELECT id, patient_name, patient_dob, facility_id, lifecycle_status, engagement_status, created_at
       FROM patient_execution_cases
      WHERE patient_screening_id IS NULL`,
  );
  await runCheck(
    "patient_execution_cases",
    "multiple active cases for same (patient_name, patient_dob, facility_id, engagement_bucket)",
    "WARN",
    `SELECT patient_name, patient_dob, facility_id, engagement_bucket,
            COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids,
            ARRAY_AGG(patient_screening_id ORDER BY id) AS patient_screening_ids
       FROM patient_execution_cases
      WHERE lifecycle_status NOT IN ('closed', 'archived')
      GROUP BY patient_name, patient_dob, facility_id, engagement_bucket
     HAVING COUNT(*) > 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // 3. patient_journey_events
  // ─────────────────────────────────────────────────────────────────────
  await runCheck(
    "patient_journey_events",
    "duplicate idempotent event_type per execution_case_id (screening_committed / execution_case_created / procedure_complete)",
    "WARN",
    `SELECT execution_case_id, event_type, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM patient_journey_events
      WHERE event_type IN ('screening_committed', 'execution_case_created', 'procedure_complete')
        AND execution_case_id IS NOT NULL
      GROUP BY execution_case_id, event_type
     HAVING COUNT(*) > 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // 4. global_schedule_events
  // ─────────────────────────────────────────────────────────────────────
  await runCheck(
    "global_schedule_events",
    "duplicate doctor_visit per patient_screening_id (commit-from-screening dedup)",
    "FAIL",
    `SELECT patient_screening_id, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM global_schedule_events
      WHERE event_type = 'doctor_visit' AND patient_screening_id IS NOT NULL
      GROUP BY patient_screening_id
     HAVING COUNT(*) > 1`,
  );
  await runCheck(
    "global_schedule_events",
    "duplicate ancillary_appointment per (patient_screening_id, service_type, starts_at)",
    "WARN",
    `SELECT patient_screening_id, service_type, starts_at, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM global_schedule_events
      WHERE event_type = 'ancillary_appointment' AND patient_screening_id IS NOT NULL
      GROUP BY patient_screening_id, service_type, starts_at
     HAVING COUNT(*) > 1`,
  );
  await runCheck(
    "global_schedule_events",
    "duplicate same_day_add per (patient_screening_id, service_type, starts_at)",
    "WARN",
    `SELECT patient_screening_id, service_type, starts_at, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM global_schedule_events
      WHERE event_type = 'same_day_add' AND patient_screening_id IS NOT NULL
      GROUP BY patient_screening_id, service_type, starts_at
     HAVING COUNT(*) > 1`,
  );
  await runCheck(
    "global_schedule_events",
    "duplicate pto_block by metadata.ptoId (PTO sync dedup)",
    "FAIL",
    `SELECT (metadata->>'ptoId')::int AS pto_id, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM global_schedule_events
      WHERE event_type = 'pto_block' AND metadata ? 'ptoId'
      GROUP BY (metadata->>'ptoId')::int
     HAVING COUNT(*) > 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // 5. scheduling_triage_cases
  // ─────────────────────────────────────────────────────────────────────
  await runCheck(
    "scheduling_triage_cases",
    "duplicate open triage per (global_schedule_event_id, main_type)",
    "WARN",
    `SELECT global_schedule_event_id, main_type, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM scheduling_triage_cases
      WHERE status NOT IN ('resolved', 'closed', 'cancelled')
        AND global_schedule_event_id IS NOT NULL
      GROUP BY global_schedule_event_id, main_type
     HAVING COUNT(*) > 1`,
  );
  await runCheck(
    "scheduling_triage_cases",
    "duplicate open triage per (patient_screening_id, main_type, subtype)",
    "WARN",
    `SELECT patient_screening_id, main_type, subtype, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM scheduling_triage_cases
      WHERE status NOT IN ('resolved', 'closed', 'cancelled')
        AND patient_screening_id IS NOT NULL
      GROUP BY patient_screening_id, main_type, subtype
     HAVING COUNT(*) > 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // 6. insurance_eligibility_reviews
  // ─────────────────────────────────────────────────────────────────────
  await runCheck(
    "insurance_eligibility_reviews",
    "duplicate review per patient_screening_id (upsert dedup)",
    "FAIL",
    `SELECT patient_screening_id, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM insurance_eligibility_reviews
      WHERE patient_screening_id IS NOT NULL
      GROUP BY patient_screening_id
     HAVING COUNT(*) > 1`,
  );
  await runCheck(
    "insurance_eligibility_reviews",
    "duplicate review per execution_case_id (commit hook dedup)",
    "FAIL",
    `SELECT execution_case_id, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM insurance_eligibility_reviews
      WHERE execution_case_id IS NOT NULL
      GROUP BY execution_case_id
     HAVING COUNT(*) > 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // 7. cooldown_records
  // ─────────────────────────────────────────────────────────────────────
  await runCheck(
    "cooldown_records",
    "duplicate cooldown per (patient_screening_id, service_type)",
    "FAIL",
    `SELECT patient_screening_id, service_type, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM cooldown_records
      WHERE patient_screening_id IS NOT NULL
      GROUP BY patient_screening_id, service_type
     HAVING COUNT(*) > 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // 8. case_document_readiness
  // ─────────────────────────────────────────────────────────────────────
  await runCheck(
    "case_document_readiness",
    "duplicate per (patient_screening_id, service_type, document_type)",
    "FAIL",
    `SELECT patient_screening_id, service_type, document_type, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM case_document_readiness
      WHERE patient_screening_id IS NOT NULL
      GROUP BY patient_screening_id, service_type, document_type
     HAVING COUNT(*) > 1`,
  );
  await runCheck(
    "case_document_readiness",
    "duplicate billing_document rows per (patient_screening_id, service_type)",
    "FAIL",
    `SELECT patient_screening_id, service_type, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM case_document_readiness
      WHERE document_type = 'billing_document' AND patient_screening_id IS NOT NULL
      GROUP BY patient_screening_id, service_type
     HAVING COUNT(*) > 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // 9. procedure_events
  // ─────────────────────────────────────────────────────────────────────
  await runCheck(
    "procedure_events",
    "duplicate complete per (patient_screening_id, service_type) sharing the same global_schedule_event_id (or both null)",
    "FAIL",
    `SELECT patient_screening_id, service_type,
            COUNT(*) AS n,
            COUNT(DISTINCT COALESCE(global_schedule_event_id, 0)) AS distinct_schedule_events,
            ARRAY_AGG(id ORDER BY id) AS ids,
            ARRAY_AGG(global_schedule_event_id ORDER BY id) AS schedule_event_ids
       FROM procedure_events
      WHERE procedure_status = 'complete' AND patient_screening_id IS NOT NULL
      GROUP BY patient_screening_id, service_type
     HAVING COUNT(*) > 1
        AND COUNT(DISTINCT COALESCE(global_schedule_event_id, 0)) = 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // 10. procedure_notes
  // ─────────────────────────────────────────────────────────────────────
  await runCheck(
    "procedure_notes",
    "duplicate per (patient_screening_id, service_type, note_type)",
    "FAIL",
    `SELECT patient_screening_id, service_type, note_type, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM procedure_notes
      WHERE patient_screening_id IS NOT NULL
      GROUP BY patient_screening_id, service_type, note_type
     HAVING COUNT(*) > 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // 11. billing_readiness_checks
  // ─────────────────────────────────────────────────────────────────────
  await runCheck(
    "billing_readiness_checks",
    "duplicate per (patient_screening_id, service_type, procedure_event_id)",
    "FAIL",
    `SELECT patient_screening_id, service_type, procedure_event_id, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM billing_readiness_checks
      WHERE patient_screening_id IS NOT NULL
      GROUP BY patient_screening_id, service_type, procedure_event_id
     HAVING COUNT(*) > 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // 12. billing_document_requests
  // ─────────────────────────────────────────────────────────────────────
  await runCheck(
    "billing_document_requests",
    "duplicate per billing_readiness_check_id (primary dedup contract)",
    "FAIL",
    `SELECT billing_readiness_check_id, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM billing_document_requests
      WHERE billing_readiness_check_id IS NOT NULL
      GROUP BY billing_readiness_check_id
     HAVING COUNT(*) > 1`,
  );
  await runCheck(
    "billing_document_requests",
    "duplicate per (procedure_event_id, service_type) (fallback dedup)",
    "FAIL",
    `SELECT procedure_event_id, service_type, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM billing_document_requests
      WHERE procedure_event_id IS NOT NULL
      GROUP BY procedure_event_id, service_type
     HAVING COUNT(*) > 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // 13. completed_billing_packages
  // ─────────────────────────────────────────────────────────────────────
  await runCheck(
    "completed_billing_packages",
    "duplicate package per (patient_screening_id, service_type)",
    "FAIL",
    `SELECT patient_screening_id, service_type, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM completed_billing_packages
      WHERE patient_screening_id IS NOT NULL
      GROUP BY patient_screening_id, service_type
     HAVING COUNT(*) > 1`,
  );
  await runCheck(
    "completed_billing_packages",
    "duplicate package per billing_document_request_id (when present)",
    "WARN",
    `SELECT billing_document_request_id, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM completed_billing_packages
      WHERE billing_document_request_id IS NOT NULL
      GROUP BY billing_document_request_id
     HAVING COUNT(*) > 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // 14. invoice_line_items (linked through completed_billing_packages.metadata)
  // ─────────────────────────────────────────────────────────────────────
  await runCheck(
    "invoice_line_items",
    "two completed packages pointing at the same invoiceLineItemId (metadata link)",
    "FAIL",
    `SELECT (metadata->>'invoiceLineItemId')::int AS invoice_line_item_id,
            COUNT(*) AS n, ARRAY_AGG(id ORDER BY id) AS package_ids
       FROM completed_billing_packages
      WHERE metadata ? 'invoiceLineItemId'
      GROUP BY (metadata->>'invoiceLineItemId')::int
     HAVING COUNT(*) > 1`,
  );
  await runCheck(
    "invoice_line_items",
    "duplicate line items per (patient_name, date_of_service, service)",
    "WARN",
    `SELECT patient_name, date_of_service, service, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM invoice_line_items
      WHERE date_of_service IS NOT NULL
      GROUP BY patient_name, date_of_service, service
     HAVING COUNT(*) > 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // 15. projected_invoice_rows
  // ─────────────────────────────────────────────────────────────────────
  await runCheck(
    "projected_invoice_rows",
    "duplicate projected per (patient_screening_id, service_type, dos)",
    "WARN",
    `SELECT patient_screening_id, service_type, dos, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM projected_invoice_rows
      WHERE patient_screening_id IS NOT NULL
      GROUP BY patient_screening_id, service_type, dos
     HAVING COUNT(*) > 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // 16. ancillary_document_templates
  // ─────────────────────────────────────────────────────────────────────
  await runCheck(
    "ancillary_document_templates",
    "duplicate active default template per (facility_id, service_type, document_type)",
    "WARN",
    `SELECT facility_id, service_type, document_type, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM ancillary_document_templates
      WHERE active = true AND is_default = true
      GROUP BY facility_id, service_type, document_type
     HAVING COUNT(*) > 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // 17. admin_settings
  // ─────────────────────────────────────────────────────────────────────
  // Postgres unique indexes treat NULL as distinct; this query catches the
  // case where two rows share the exact same (domain, key, NULL, NULL)
  // because the unique constraint can't enforce that combination.
  await runCheck(
    "admin_settings",
    "duplicate active rows per (setting_domain, setting_key, facility_id, user_id)",
    "FAIL",
    `SELECT setting_domain, setting_key, facility_id, user_id, COUNT(*) AS n,
            ARRAY_AGG(id ORDER BY id) AS ids
       FROM admin_settings
      WHERE active = true
      GROUP BY setting_domain, setting_key, facility_id, user_id
     HAVING COUNT(*) > 1`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // Print results
  // ─────────────────────────────────────────────────────────────────────
  let lastCategory = "";
  for (const r of results) {
    if (r.category !== lastCategory) {
      console.log("");
      console.log(`── ${r.category} `.padEnd(72, "─"));
      lastCategory = r.category;
    }
    const symbol =
      r.severity === "PASS" ? "✓ PASS"
      : r.severity === "WARN" ? "⚠ WARN"
      : r.severity === "FAIL" ? "✗ FAIL"
      : "· SKIP";
    const tail =
      r.severity === "PASS" ? ""
      : r.severity === "SKIP" ? ` — ${r.note ?? "skipped"}`
      : ` — ${r.rowCount} duplicate group(s)`;
    console.log(`  ${symbol}  ${r.label}${tail}`);
    for (const detail of r.preview) {
      console.log(`         ${detail}`);
    }
  }

  console.log("");
  console.log("════════════════════════════════════════════════════════════════════════");
  console.log(`  Summary: PASS=${tally.PASS}  WARN=${tally.WARN}  FAIL=${tally.FAIL}  SKIP=${tally.SKIP}`);
  console.log("════════════════════════════════════════════════════════════════════════");

  try {
    await pool.end();
  } catch {
    /* noop */
  }

  process.exit(tally.FAIL > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[audit:canonical-integrity] unexpected failure:", err);
  process.exit(1);
});
