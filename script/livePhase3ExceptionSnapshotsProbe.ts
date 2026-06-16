// livePhase3ExceptionSnapshotsProbe.

import type { Pool } from "pg";

let pool: Pool | null = null;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[probe:phase3-exception-snapshots] DATABASE_URL unavailable — skipped live DB probe.");
    return;
  }
  pool = (await import("../server/db")).pool;
  const tbl = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'exception_snapshots'`,
  );
  if (tbl.rows.length === 0) throw new Error("exception_snapshots missing — apply migration 0039");
  const cols = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'exception_snapshots'`,
  );
  const cnames = new Set(cols.rows.map((r) => r.column_name));
  const REQUIRED = ["exception_key", "exception_type", "severity", "status", "title", "explanation", "source_snapshot", "policy_snapshot", "superseded_by_engine"];
  const missing = REQUIRED.filter((c) => !cnames.has(c));
  if (missing.length > 0) throw new Error(`exception_snapshots missing columns: ${missing.join(", ")}`);
  const idx = await pool.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'exception_snapshots' AND indexname = 'idx_exception_snapshots_key'`);
  if (idx.rows.length === 0) throw new Error("idx_exception_snapshots_key not present");
  console.log("[probe:phase3-exception-snapshots] schema + unique key index OK ✓");
}

async function closePool() { if (!pool) return; try { await pool.end(); } catch { /* */ } }

main().then(async () => { await closePool(); process.exit(0); }).catch(async (err) => {
  console.error("[probe:phase3-exception-snapshots] failed:", err instanceof Error ? err.message : err);
  await closePool();
  process.exit(1);
});
