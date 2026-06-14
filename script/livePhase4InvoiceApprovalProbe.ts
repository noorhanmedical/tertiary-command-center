// livePhase4InvoiceApprovalProbe — Phase 4 PR 4.4.

import type { Pool } from "pg";

let pool: Pool | null = null;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[probe:phase4-invoice-approval] DATABASE_URL unavailable — skipped live DB probe.");
    return;
  }
  pool = (await import("../server/db")).pool;
  const cols = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'invoices'`,
  );
  const cnames = new Set(cols.rows.map((r) => r.column_name));
  const REQUIRED = [
    "approval_status", "approved_by_user_id", "approved_at",
    "voided_at", "void_reason", "policy_snapshot", "recipient_snapshot",
    "delivery_status", "invoice_batch_id", "due_date", "payment_terms",
  ];
  const missing = REQUIRED.filter((c) => !cnames.has(c));
  if (missing.length > 0) throw new Error(`invoices missing columns: ${missing.join(", ")} — apply migration 0036`);
  console.log("[probe:phase4-invoice-approval] approval columns present ✓");
}

async function closePool() { if (!pool) return; try { await pool.end(); } catch { /* */ } }

main()
  .then(async () => { await closePool(); process.exit(0); })
  .catch(async (err) => {
    console.error("[probe:phase4-invoice-approval] failed:", err instanceof Error ? err.message : err);
    await closePool();
    process.exit(1);
  });
