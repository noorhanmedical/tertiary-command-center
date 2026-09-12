// Retention purge runner for Engagement call-list packages.
//
// Purges frozen member PHI + PDF blobs for packages past their 90-day snapshot
// retention window (created_at + 90 days), preserving minimal non-PHI audit
// metadata. Idempotent + tenant-safe. Schedule this (e.g. daily cron / CI job).
//
// Run: DATABASE_URL=... npx tsx script/purgeCallListPackages.ts

import { purgeExpiredCallListPackages } from "../server/services/engagement/callListRetention";

async function main() {
  const summary = await purgeExpiredCallListPackages(new Date());
  console.log("[purgeCallListPackages]", JSON.stringify(summary));
  // Non-PHI summary only.
  process.exit(0);
}

main().catch((err) => {
  console.error("[purgeCallListPackages] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
