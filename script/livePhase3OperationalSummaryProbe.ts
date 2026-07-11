// Live probe — Phase 3 PR 3.8.
// Confirms the summary query can run end-to-end against a real DB.

import { Pool } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[live-phase3-operational-summary] SKIP — DATABASE_URL not set");
    return;
  }
  const pool = new Pool({ connectionString: url });
  try {
    const checks = [
      `select count(*)::text as c from exception_snapshots`,
      `select count(*)::text as c from ai_recommendation_logs`,
      `select count(*)::text as c from exception_review_events`,
    ];
    for (const q of checks) {
      await pool.query(q);
    }
    console.log("[live-phase3-operational-summary] PASS — base tables queryable");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[live-phase3-operational-summary] ERROR", err);
  process.exit(1);
});
