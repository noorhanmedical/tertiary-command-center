// Phase 4A backfill — seed canonical teams + memberships from existing sources.
// Conservative: role (liaison→PCS, technician→ACS) is the base signal; a
// workspace_profile.workspaceType or engagement_call_settings.team that
// CONFLICTS with the role is reported, not silently applied. Idempotent.
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { teamsRepository } from "../server/repositories/teams.repo";

const DRY = process.argv.includes("--dry");

async function ensureTeam(name: string, slug: string, type: "PCS" | "ACS" | "management" | "custom") {
  const existing = await teamsRepository.getTeamBySlug(slug);
  if (existing) return existing;
  if (DRY) { console.log(`[dry] would create team ${slug} (${type})`); return { id: -1, name, slug, type } as any; }
  return teamsRepository.createTeam({ name, slug, type });
}

async function main() {
  console.log(`=== Phase 4A backfill ${DRY ? "(DRY RUN)" : ""} ===`);

  // 1) Canonical teams.
  const pcs = await ensureTeam("Patient Care Specialists", "pcs", "PCS");
  const acs = await ensureTeam("Ancillary Care Specialists", "acs", "ACS");
  const mgmt = await ensureTeam("Management", "management", "management");
  console.log(`Teams: PCS#${pcs.id} ACS#${acs.id} Management#${mgmt.id}`);

  // 2) Read existing signals.
  const usersRes: any = await db.execute(sql`SELECT id, username, role, active FROM users`);
  const wpRes: any = await db.execute(sql`
    SELECT user_id, setting_value FROM admin_settings
    WHERE setting_domain='team_member' AND setting_key='workspace_profile' AND user_id IS NOT NULL`);
  const ecsRes: any = await db.execute(sql`
    SELECT s.user_id, e.team FROM engagement_call_settings e
    JOIN outreach_schedulers s ON s.id = e.scheduler_id WHERE s.user_id IS NOT NULL`);
  const wpByUser = new Map<string, string>();
  for (const r of wpRes.rows) {
    const wt = (r.setting_value as any)?.workspaceType;
    if (typeof wt === "string") wpByUser.set(r.user_id, wt);
  }
  const ecsByUser = new Map<string, string>();
  for (const r of ecsRes.rows) if (r.team) ecsByUser.set(r.user_id, r.team);

  // 3) Derive intended team per user.
  const conflicts: string[] = [];
  const assignments: { userId: string; username: string; team: "PCS" | "ACS"; teamId: number; basis: string }[] = [];
  for (const u of usersRes.rows) {
    const role = u.role as string;
    // Base signal from role. Only liaison/technician map to a call team.
    let team: "PCS" | "ACS" | null = null;
    let basis = "";
    if (role === "liaison") { team = "PCS"; basis = "role=liaison"; }
    else if (role === "technician") { team = "ACS"; basis = "role=technician"; }
    // workspace_profile.workspaceType refinement.
    const wt = wpByUser.get(u.id);
    if (wt === "patientCareSpecialist") { if (team && team !== "PCS") conflicts.push(`${u.username}: role→${team} vs workspace_profile→PCS`); team = "PCS"; basis = "workspace_profile"; }
    if (wt === "ancillaryCareSpecialist") { if (team && team !== "ACS") conflicts.push(`${u.username}: role→${team} vs workspace_profile→ACS`); team = "ACS"; basis = "workspace_profile"; }
    // engagement_call_settings.team conflict check (report only).
    const ecs = ecsByUser.get(u.id);
    if (ecs && team && ecs !== team) conflicts.push(`${u.username}: derived→${team} vs engagement_call_settings.team→${ecs}`);
    if (team) assignments.push({ userId: u.id, username: u.username, team, teamId: team === "PCS" ? pcs.id : acs.id, basis });
  }

  console.log("\nIntended memberships:");
  for (const a of assignments) console.log(`  ${a.username} → ${a.team} (${a.basis})`);
  console.log("\nConflicts (reported, NOT auto-resolved):", conflicts.length ? conflicts : "none");

  // 4) Apply memberships (idempotent, primaryTeam=true for the derived team).
  if (!DRY) {
    for (const a of assignments) {
      await teamsRepository.addMembership({ teamId: a.teamId, userId: a.userId, membershipRole: "member", primaryTeam: true });
      await teamsRepository.recordEvent({
        eventType: "membership_added", actorUserId: null, subjectUserId: a.userId, teamId: a.teamId,
        summary: `Backfill: ${a.username} → ${a.team} (${a.basis})`, metadata: { backfill: true, basis: a.basis },
      });
    }
    console.log(`\nApplied ${assignments.length} memberships.`);
  }

  console.log("\n=== BACKFILL REPORT ===");
  console.log(`teams: 3 (pcs, acs, management)`);
  console.log(`memberships: ${assignments.length}`);
  console.log(`conflicts: ${conflicts.length}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
