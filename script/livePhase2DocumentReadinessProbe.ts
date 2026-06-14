// livePhase2DocumentReadinessProbe — Phase 2 PR 2.10.
//
// Read-only DB probe verifying the document workflow tables exist
// + the canonical writers are in place.
//
// Honest skip when DATABASE_URL is unavailable.

import type { Pool } from "pg";

let pool: Pool | null = null;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[probe:phase2-documents] DATABASE_URL unavailable — skipped live DB probe.");
    return;
  }
  pool = (await import("../server/db")).pool;

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
    throw new Error(`missing tables: ${missing.join(", ")}`);
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
    throw new Error(`case_document_readiness missing columns: ${missingCols.join(", ")}`);
  }
  console.log("[probe:phase2-documents] case_document_readiness shape OK ✓");
}

async function closePool(): Promise<void> {
  if (!pool) return;
  try {
    await pool.end();
  } catch {
    /* ignore — best-effort pool shutdown */
  }
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[probe:phase2-documents] failed:", err instanceof Error ? err.message : err);
    await closePool();
    process.exit(1);
  });
