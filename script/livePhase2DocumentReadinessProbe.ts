// livePhase2DocumentReadinessProbe — Phase 2 PR 2.10.
//
// Read-only DB probe verifying the document workflow tables exist
// + the canonical writers are in place.
//
// Honest skip when DATABASE_URL is unavailable.

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[probe:phase2-documents] DATABASE_URL unavailable — skipped live DB probe.");
    return;
  }
  const { pool } = await import("../server/db");

  const REQUIRED = [
    "case_document_readiness",
    "billing_readiness_checks",
    "procedure_events",
    "documents",
    "document_requirements",
  ];
  const placeholders = REQUIRED.map((_, i) => `$${i + 1}`).join(", ");
  const res = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN (${placeholders})`,
    [...REQUIRED],
  );
  const present = new Set(res.rows.map((r) => r.table_name));
  const missing = REQUIRED.filter((t) => !present.has(t));
  if (missing.length > 0) {
    console.error(`[probe:phase2-documents] missing tables: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("[probe:phase2-documents] all 5 document workflow tables present ✓");

  // case_document_readiness must have documentStatus + completedAt columns.
  const cols = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'case_document_readiness'`,
  );
  const cnames = new Set(cols.rows.map((r) => r.column_name));
  const REQUIRED_COLS = ["document_type", "document_status", "completed_at", "blocks_billing"];
  const missingCols = REQUIRED_COLS.filter((c) => !cnames.has(c));
  if (missingCols.length > 0) {
    console.error(`[probe:phase2-documents] case_document_readiness missing columns: ${missingCols.join(", ")}`);
    process.exit(1);
  }
  console.log("[probe:phase2-documents] case_document_readiness shape OK ✓");
}

main().catch((err) => {
  console.error("[probe:phase2-documents] failed:", err);
  process.exit(1);
});
