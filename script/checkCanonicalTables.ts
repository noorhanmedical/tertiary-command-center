// Standalone DB readiness check for the canonical operational tables.
// Run with `npm run check:canonical-tables`. Exits 0 when all expected
// tables exist, 1 when DATABASE_URL is missing or any table is absent.

const CANONICAL_TABLES = [
  "patient_execution_cases",
  "patient_journey_events",
  "global_schedule_events",
  "scheduling_triage_cases",
  "insurance_eligibility_reviews",
  "cooldown_records",
  "document_requirements",
  "case_document_readiness",
  "procedure_events",
  "procedure_notes",
  "billing_readiness_checks",
  "billing_document_requests",
  "completed_billing_packages",
  "cash_price_settings",
  "projected_invoice_rows",
  "ancillary_document_templates",
  "admin_settings",
] as const;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[check:canonical-tables] DATABASE_URL is not set");
    process.exit(1);
  }

  // Lazy-import the pool so the missing-DATABASE_URL path above can fail fast
  // without triggering pool construction in server/db.ts.
  const { pool } = await import("../server/db");

  let exitCode = 0;
  try {
    const placeholders = CANONICAL_TABLES.map((_, i) => `$${i + 1}`).join(", ");
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (${placeholders})`,
      [...CANONICAL_TABLES],
    );

    const present = new Set(result.rows.map((r) => r.table_name));
    const missing: string[] = [];

    console.log(`[check:canonical-tables] checking ${CANONICAL_TABLES.length} tables`);
    for (const name of CANONICAL_TABLES) {
      if (present.has(name)) {
        console.log(`  ✓ ${name}`);
      } else {
        console.log(`  ✗ ${name} (MISSING)`);
        missing.push(name);
      }
    }

    console.log(
      `[check:canonical-tables] present=${present.size} missing=${missing.length}`,
    );
    if (missing.length > 0) {
      console.error(
        `[check:canonical-tables] FAIL: run \`npm run db:push\` to create: ${missing.join(", ")}`,
      );
      exitCode = 1;
    } else {
      console.log("[check:canonical-tables] OK: all canonical tables present");
    }
  } catch (err: any) {
    console.error("[check:canonical-tables] query failed:", err.message ?? err);
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

main().catch(async (err) => {
  console.error("[check:canonical-tables] unexpected failure:", err);
  process.exit(1);
});
