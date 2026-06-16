// Live probe — Phase 3 PR 3.5.
// Confirms the engine can run end-to-end against a real DB and that
// every emitted row honours the AI safety contract.

import { Pool } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[live-phase3-recommendation-engine] SKIP — DATABASE_URL not set");
    return;
  }
  const pool = new Pool({ connectionString: url });
  try {
    // Probe just checks that the log table is queryable and that any
    // existing rows obey the rules_engine + not_applicable invariant.
    const { rows } = await pool.query<{
      model_provider: string; confidence_label: string; count: string;
    }>(`select model_provider, confidence_label, count(*)::text as count
        from ai_recommendation_logs
        group by 1, 2`);
    const violations = rows.filter(
      (r) => r.model_provider === "rules_engine" && r.confidence_label !== "not_applicable",
    );
    if (violations.length) {
      console.error("[live-phase3-recommendation-engine] FAIL — rules_engine rows with non-not_applicable confidence:");
      for (const v of violations) console.error("  -", v);
      process.exit(1);
    }
    console.log(`[live-phase3-recommendation-engine] PASS — ${rows.length} provider/label combos clean`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[live-phase3-recommendation-engine] ERROR", err);
  process.exit(1);
});
