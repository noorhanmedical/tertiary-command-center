// livePhase4FinancialEventsProbe — Phase 4 PR 4.6.

import type { Pool } from "pg";

let pool: Pool | null = null;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[probe:phase4-financial-events] DATABASE_URL unavailable — skipped live DB probe.");
    return;
  }
  pool = (await import("../server/db")).pool;
  const REQUIRED = ["invoice_adjustments", "invoice_denials", "remittance_events"];
  const placeholders = REQUIRED.map((_, i) => `$${i + 1}`).join(", ");
  const res = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN (${placeholders})`,
    [...REQUIRED],
  );
  const present = new Set(res.rows.map((r) => r.table_name));
  const missing = REQUIRED.filter((t) => !present.has(t));
  if (missing.length > 0) throw new Error(`missing tables: ${missing.join(", ")} — apply migration 0038`);
  console.log("[probe:phase4-financial-events] all 3 tables present ✓");
}

async function closePool() { if (!pool) return; try { await pool.end(); } catch { /* */ } }

main()
  .then(async () => { await closePool(); process.exit(0); })
  .catch(async (err) => {
    console.error("[probe:phase4-financial-events] failed:", err instanceof Error ? err.message : err);
    await closePool();
    process.exit(1);
  });
