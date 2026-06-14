// livePhase4InvoiceReadinessProbe — Phase 4 PR 4.2.

import type { Pool } from "pg";

let pool: Pool | null = null;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[probe:phase4-invoice-readiness] DATABASE_URL unavailable — skipped live DB probe.");
    return;
  }
  pool = (await import("../server/db")).pool;

  const tbl = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'invoice_readiness_snapshots'`,
  );
  if (tbl.rows.length === 0) {
    throw new Error("invoice_readiness_snapshots table missing — apply migration 0034");
  }
  const cols = await pool.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'invoice_readiness_snapshots'`,
  );
  const cnames = new Set(cols.rows.map((r) => r.column_name));
  const REQUIRED = ["readiness_status", "blockers", "policy_snapshot", "price_snapshot", "service_type", "execution_case_id"];
  const missing = REQUIRED.filter((c) => !cnames.has(c));
  if (missing.length > 0) throw new Error(`invoice_readiness_snapshots missing columns: ${missing.join(", ")}`);

  const idx = await pool.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'invoice_readiness_snapshots'
        AND indexname = 'idx_invoice_readiness_case_service'`,
  );
  if (idx.rows.length === 0) throw new Error("idx_invoice_readiness_case_service not present — re-apply migration 0034");

  console.log("[probe:phase4-invoice-readiness] schema + unique index OK ✓");
}

async function closePool() { if (!pool) return; try { await pool.end(); } catch { /* */ } }

main()
  .then(async () => { await closePool(); process.exit(0); })
  .catch(async (err) => {
    console.error("[probe:phase4-invoice-readiness] failed:", err instanceof Error ? err.message : err);
    await closePool();
    process.exit(1);
  });
