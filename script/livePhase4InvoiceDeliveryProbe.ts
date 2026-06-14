// livePhase4InvoiceDeliveryProbe — Phase 4 PR 4.5.

import type { Pool } from "pg";

let pool: Pool | null = null;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[probe:phase4-invoice-delivery] DATABASE_URL unavailable — skipped live DB probe.");
    return;
  }
  pool = (await import("../server/db")).pool;
  const tbl = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'invoice_delivery_events'`,
  );
  if (tbl.rows.length === 0) throw new Error("invoice_delivery_events missing — apply migration 0037");
  console.log("[probe:phase4-invoice-delivery] invoice_delivery_events present ✓");
}

async function closePool() { if (!pool) return; try { await pool.end(); } catch { /* */ } }

main()
  .then(async () => { await closePool(); process.exit(0); })
  .catch(async (err) => {
    console.error("[probe:phase4-invoice-delivery] failed:", err instanceof Error ? err.message : err);
    await closePool();
    process.exit(1);
  });
