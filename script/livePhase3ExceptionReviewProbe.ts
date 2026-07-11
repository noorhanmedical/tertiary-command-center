// Live probe — Phase 3 PR 3.3 exception human review workflow.
// Honest skip when DATABASE_URL is not set. Validates table presence and
// FK wiring without writing data.

import { Pool } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[live-phase3-exception-review] SKIP — DATABASE_URL not set");
    return;
  }
  const pool = new Pool({ connectionString: url });
  try {
    const { rows: tables } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema='public' and table_name='exception_review_events'`
    );
    if (tables.length === 0) {
      console.error("[live-phase3-exception-review] FAIL — exception_review_events table missing");
      process.exit(1);
    }
    const { rows: cols } = await pool.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
       where table_schema='public' and table_name='exception_review_events'`
    );
    const required = [
      "id", "exception_snapshot_id", "event_type", "actor_user_id",
      "assigned_to_user_id", "assigned_role", "reason", "note", "metadata", "created_at",
    ];
    const present = new Set(cols.map((c) => c.column_name));
    const missing = required.filter((c) => !present.has(c));
    if (missing.length) {
      console.error("[live-phase3-exception-review] FAIL — missing columns:", missing.join(", "));
      process.exit(1);
    }
    const { rows: fks } = await pool.query<{ constraint_name: string }>(
      `select constraint_name from information_schema.table_constraints
       where table_schema='public' and table_name='exception_review_events' and constraint_type='FOREIGN KEY'`
    );
    if (fks.length < 1) {
      console.error("[live-phase3-exception-review] FAIL — exception_review_events has no FK constraints");
      process.exit(1);
    }
    const { rows: snapCols } = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='exception_snapshots'`
    );
    const snapPresent = new Set(snapCols.map((c) => c.column_name));
    const snapRequired = [
      "assigned_to_user_id", "assigned_role", "acknowledged_at",
      "acknowledged_by_user_id", "resolution_reason", "dismissed_reason",
    ];
    const snapMissing = snapRequired.filter((c) => !snapPresent.has(c));
    if (snapMissing.length) {
      console.error("[live-phase3-exception-review] FAIL — exception_snapshots missing review columns:", snapMissing.join(", "));
      process.exit(1);
    }
    console.log("[live-phase3-exception-review] PASS — table and columns present");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[live-phase3-exception-review] ERROR", err);
  process.exit(1);
});
