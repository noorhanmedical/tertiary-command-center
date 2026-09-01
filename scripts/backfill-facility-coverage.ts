// Phase 4B backfill — seed canonical team_member_facility_coverage from the
// three legacy sources, conservatively. Idempotent. Keyed by users.id.
//   • outreach_schedulers.facility (roster home) → coverageType 'primary'
//   • engagement_call_settings.facilitiesCovered[] → coverageType 'regular'
//   • workspace_profile.assignedFacilityIds → coverageType 'regular' (view→serve)
// Conflicts are additive (union), never a permission REDUCTION.
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { facilityCoverageRepository } from "../server/repositories/facilityCoverage.repo";

const DRY = process.argv.includes("--dry");

async function main() {
  console.log(`=== Phase 4B facility-coverage backfill ${DRY ? "(DRY RUN)" : ""} ===`);

  // roster home facility per linked user.
  const rosterRes: any = await db.execute(sql`
    SELECT s.user_id, s.facility FROM outreach_schedulers s WHERE s.user_id IS NOT NULL`);
  // additive facilitiesCovered per linked user.
  const ecsRes: any = await db.execute(sql`
    SELECT s.user_id, e.facilities_covered FROM engagement_call_settings e
    JOIN outreach_schedulers s ON s.id = e.scheduler_id WHERE s.user_id IS NOT NULL`);
  // workspace_profile assignedFacilityIds per user.
  const wpRes: any = await db.execute(sql`
    SELECT user_id, setting_value FROM admin_settings
    WHERE setting_domain='team_member' AND setting_key='workspace_profile' AND user_id IS NOT NULL`);

  // Build union of {userId -> {facilityId -> coverageType}} (primary wins).
  const plan = new Map<string, Map<string, "primary" | "regular">>();
  const add = (userId: string, facilityId: string | null | undefined, type: "primary" | "regular", src: string) => {
    const f = (facilityId ?? "").trim();
    if (!userId || !f) return;
    const m = plan.get(userId) ?? new Map();
    // primary beats regular.
    if (!m.has(f) || type === "primary") m.set(f, type);
    plan.set(userId, m);
    sources.push(`${userId.slice(0, 8)}… ${f} (${type}, ${src})`);
  };
  const sources: string[] = [];

  for (const r of rosterRes.rows) add(r.user_id, r.facility, "primary", "roster_home");
  for (const r of ecsRes.rows) {
    const arr = Array.isArray(r.facilities_covered) ? r.facilities_covered : [];
    for (const f of arr) add(r.user_id, f, "regular", "facilitiesCovered");
  }
  for (const r of wpRes.rows) {
    const ids = (r.setting_value as any)?.assignedFacilityIds;
    if (Array.isArray(ids)) for (const f of ids) add(r.user_id, f, "regular", "assignedFacilityIds");
  }

  let applied = 0;
  for (const [userId, facs] of plan) {
    for (const [facilityId, type] of facs) {
      if (DRY) { console.log(`[dry] ${userId.slice(0, 8)}… ${facilityId} (${type})`); continue; }
      await facilityCoverageRepository.addCoverage({
        userId, facilityId, coverageType: type, primaryCoverage: type === "primary", source: "backfill",
      });
      applied += 1;
    }
  }

  console.log("\nsources:", sources);
  console.log("\n=== COVERAGE BACKFILL REPORT ===");
  console.log(`users with coverage: ${plan.size}`);
  console.log(`coverage rows ${DRY ? "would apply" : "applied"}: ${DRY ? [...plan.values()].reduce((n, m) => n + m.size, 0) : applied}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
