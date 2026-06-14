// livePhase4BillingPolicyProbe — Phase 4 PR 4.9 (added in PR 4.8 to keep wiring tidy).

import type { Pool } from "pg";

let pool: Pool | null = null;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[probe:phase4-billing-policy] DATABASE_URL unavailable — skipped live DB probe.");
    return;
  }
  pool = (await import("../server/db")).pool;

  // admin_settings supports test_type scope.
  const cols = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'admin_settings'`,
  );
  const cnames = new Set(cols.rows.map((r) => r.column_name));
  if (!cnames.has("test_type")) throw new Error("admin_settings.test_type missing — apply Phase 2 hardening migration 0033");

  const seedKeys = [
    "schedule_frequency", "delivery_method", "approval_requirement",
    "payment_term", "hold_missing_report", "primary_email",
  ];
  const result = await pool.query<{ setting_key: string }>(
    `SELECT setting_key FROM admin_settings
      WHERE setting_domain = 'billing_policy'
        AND facility_id IS NULL AND user_id IS NULL AND test_type IS NULL
        AND setting_key = ANY($1::text[])`,
    [seedKeys],
  );
  const present = new Set(result.rows.map((r) => r.setting_key));
  const missing = seedKeys.filter((k) => !present.has(k));
  if (missing.length > 0) {
    console.warn(`[probe:phase4-billing-policy] missing global billing_policy seeds: ${missing.join(", ")} — run npm run seed:billing-policies`);
  } else {
    console.log("[probe:phase4-billing-policy] billing_policy seeds present ✓");
  }
}

async function closePool() { if (!pool) return; try { await pool.end(); } catch { /* */ } }

main()
  .then(async () => { await closePool(); process.exit(0); })
  .catch(async (err) => {
    console.error("[probe:phase4-billing-policy] failed:", err instanceof Error ? err.message : err);
    await closePool();
    process.exit(1);
  });
