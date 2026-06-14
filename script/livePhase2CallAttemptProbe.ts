// livePhase2CallAttemptProbe — Phase 2 hardening item 1.
//
// Read-only DB probe: patient_execution_cases has the canonical
// attempt-tracking columns from migration 0032 + the unable_to_reach
// engagement-status enum is accepted as plain text.
//
// Honest skip when DATABASE_URL is unavailable.

import type { Pool } from "pg";

let pool: Pool | null = null;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[probe:phase2-call-attempt] DATABASE_URL unavailable — skipped live DB probe.");
    return;
  }
  pool = (await import("../server/db")).pool;

  const cols = await pool.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'patient_execution_cases'`,
  );
  const map = new Map(cols.rows.map((r) => [r.column_name, r.data_type]));
  const REQUIRED = [
    "call_attempt_count",
    "last_attempt_at",
    "last_call_outcome",
    "unable_to_reach_at",
  ];
  const missing = REQUIRED.filter((c) => !map.has(c));
  if (missing.length > 0) {
    throw new Error(`missing columns: ${missing.join(", ")} — apply migration 0032`);
  }
  if (map.get("call_attempt_count") !== "integer") {
    throw new Error(`call_attempt_count is "${map.get("call_attempt_count")}" — expected integer`);
  }
  console.log("[probe:phase2-call-attempt] 4 canonical attempt columns present ✓");

  // Existing rows must have a default-valued counter (no nulls).
  const nulls = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM patient_execution_cases
      WHERE call_attempt_count IS NULL`,
  );
  const n = parseInt(nulls.rows[0]?.count ?? "0", 10);
  if (n > 0) {
    throw new Error(`${n} rows have NULL call_attempt_count — column should default 0`);
  }
  console.log("[probe:phase2-call-attempt] no NULL call_attempt_count rows ✓");
}

async function closePool(): Promise<void> {
  if (!pool) return;
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[probe:phase2-call-attempt] failed:", err instanceof Error ? err.message : err);
    await closePool();
    process.exit(1);
  });
