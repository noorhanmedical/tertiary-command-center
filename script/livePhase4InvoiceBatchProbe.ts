// livePhase4InvoiceBatchProbe — Phase 4 PR 4.3.

import type { Pool } from "pg";

let pool: Pool | null = null;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[probe:phase4-invoice-batches] DATABASE_URL unavailable — skipped live DB probe.");
    return;
  }
  pool = (await import("../server/db")).pool;
  const tables = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('invoice_batches', 'invoice_batch_items')`,
  );
  const present = new Set(tables.rows.map((r) => r.table_name));
  if (!present.has("invoice_batches")) throw new Error("invoice_batches missing — apply migration 0035");
  if (!present.has("invoice_batch_items")) throw new Error("invoice_batch_items missing — apply migration 0035");
  console.log("[probe:phase4-invoice-batches] both tables present ✓");
}

async function closePool() { if (!pool) return; try { await pool.end(); } catch { /* */ } }

main()
  .then(async () => { await closePool(); process.exit(0); })
  .catch(async (err) => {
    console.error("[probe:phase4-invoice-batches] failed:", err instanceof Error ? err.message : err);
    await closePool();
    process.exit(1);
  });
