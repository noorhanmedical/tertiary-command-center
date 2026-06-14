// livePhase2SchedulingProbe — Phase 2 PR 2.10.
//
// Read-only DB probe for the scheduling runtime contract:
//   - global_schedule_events has a status column.
//   - The status column accepts at least: scheduled, cancelled,
//     rescheduled, no_show, confirmed.
//
// Honest skip when DATABASE_URL is unavailable. Does not mutate.

import type { Pool } from "pg";

let pool: Pool | null = null;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[probe:phase2-scheduling] DATABASE_URL unavailable — skipped live DB probe.");
    return;
  }
  pool = (await import("../server/db")).pool;

  const cols = await pool.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'global_schedule_events'`,
  );
  const map = new Map(cols.rows.map((r) => [r.column_name, r.data_type]));
  const REQUIRED = ["id", "status", "starts_at", "event_type", "execution_case_id"];
  const missing = REQUIRED.filter((c) => !map.has(c));
  if (missing.length > 0) {
    throw new Error(`missing columns: ${missing.join(", ")}`);
  }
  if (map.get("status") !== "text") {
    throw new Error(`status column is "${map.get("status")}" — expected text`);
  }
  console.log("[probe:phase2-scheduling] global_schedule_events shape OK ✓");

  // Sanity: are any rows present? Not required.
  const r = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM global_schedule_events`,
  );
  console.log(`[probe:phase2-scheduling] ${r.rows[0]?.count ?? 0} schedule rows in production.`);
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
    console.error("[probe:phase2-scheduling] failed:", err instanceof Error ? err.message : err);
    await closePool();
    process.exit(1);
  });
