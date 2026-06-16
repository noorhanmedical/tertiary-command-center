// Live probe — Phase 3 PR 3.7 call priority service.
// Confirms the read path runs end-to-end against the real DB.

import { Pool } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[live-phase3-call-priority] SKIP — DATABASE_URL not set");
    return;
  }
  const pool = new Pool({ connectionString: url });
  try {
    // We can't import the drizzle service in a probe (different DB pool),
    // so we replicate the canonical query and check it executes.
    const { rows } = await pool.query<{ exception_type: string; severity: string; detected_at: string }>(
      `select exception_type, severity, detected_at
       from exception_snapshots
       where status in ('open','acknowledged','in_review')
         and exception_type in (
           'callback_overdue','lvm_followup_overdue','no_answer_followup_overdue',
           'unable_to_reach_threshold_met','ready_to_schedule_stale','stale_queue_item',
           'missing_patient_contact'
         )
       limit 50`
    );
    // Empty result is fine — what matters is the query is valid.
    console.log(`[live-phase3-call-priority] PASS — read path OK (${rows.length} candidate rows)`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[live-phase3-call-priority] ERROR", err);
  process.exit(1);
});
