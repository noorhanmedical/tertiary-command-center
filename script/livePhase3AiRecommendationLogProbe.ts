// Live probe — Phase 3 PR 3.4 ai_recommendation_logs table.
// Honest skip when DATABASE_URL is not set.

import { Pool } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[live-phase3-ai-recommendation-log] SKIP — DATABASE_URL not set");
    return;
  }
  const pool = new Pool({ connectionString: url });
  try {
    const { rows: tables } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema='public' and table_name='ai_recommendation_logs'`
    );
    if (tables.length === 0) {
      console.error("[live-phase3-ai-recommendation-log] FAIL — ai_recommendation_logs table missing");
      process.exit(1);
    }
    const { rows: cols } = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='ai_recommendation_logs'`
    );
    const required = [
      "id", "recommendation_key", "exception_snapshot_id",
      "recommendation_type", "recommended_action", "title", "body",
      "model_provider", "model_name", "confidence_label",
      "rule_ids", "rationale", "inputs",
      "status", "requires_human_review",
      "accepted_at", "accepted_by_user_id",
      "rejected_at", "rejected_by_user_id", "rejection_reason",
      "superseded_at",
      "policy_snapshot", "source_snapshot", "detector_version", "metadata",
      "created_at", "updated_at",
    ];
    const present = new Set(cols.map((c) => c.column_name));
    const missing = required.filter((c) => !present.has(c));
    if (missing.length) {
      console.error("[live-phase3-ai-recommendation-log] FAIL — missing columns:", missing.join(", "));
      process.exit(1);
    }
    const { rows: idxs } = await pool.query<{ indexname: string }>(
      `select indexname from pg_indexes where tablename='ai_recommendation_logs'`
    );
    if (!idxs.some((i) => i.indexname === "idx_ai_recommendation_logs_key")) {
      console.error("[live-phase3-ai-recommendation-log] FAIL — recommendation_key unique index missing");
      process.exit(1);
    }
    console.log("[live-phase3-ai-recommendation-log] PASS — table, columns, indexes present");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[live-phase3-ai-recommendation-log] ERROR", err);
  process.exit(1);
});
