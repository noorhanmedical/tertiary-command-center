// Canonical teams / memberships / manager relationships repository (Phase 4A).
// Concurrency-safe: active-row uniqueness enforced by partial unique indexes;
// mutations "deactivate then insert" rather than hard-delete (history kept).

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  teams,
  teamMemberships,
  managerRelationships,
  teamRelationshipEvents,
  type Team,
  type InsertTeam,
  type TeamMembership,
  type InsertTeamMembership,
  type ManagerRelationship,
  type InsertManagerRelationship,
  type InsertTeamRelationshipEvent,
} from "@shared/schema";

export const teamsRepository = {
  // ─── Teams ───────────────────────────────────────────────
  async createTeam(input: InsertTeam): Promise<Team> {
    const [row] = await db.insert(teams).values(input).returning();
    return row;
  },
  async updateTeam(id: number, patch: Partial<InsertTeam>): Promise<Team | undefined> {
    const [row] = await db.update(teams).set({ ...patch, updatedAt: new Date() }).where(eq(teams.id, id)).returning();
    return row;
  },
  async getTeam(id: number): Promise<Team | undefined> {
    const [row] = await db.select().from(teams).where(eq(teams.id, id)).limit(1);
    return row;
  },
  async getTeamBySlug(slug: string): Promise<Team | undefined> {
    const [row] = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1);
    return row;
  },
  async listTeams(opts: { activeOnly?: boolean } = {}): Promise<Team[]> {
    const q = db.select().from(teams).$dynamic();
    const rows = opts.activeOnly
      ? await q.where(eq(teams.active, true)).orderBy(teams.name)
      : await q.orderBy(teams.name);
    return rows;
  },

  // ─── Memberships ─────────────────────────────────────────
  /** Add (or reactivate) an active membership. Idempotent per (team,user):
   *  reuses an existing active row, else deactivates any stale row and inserts. */
  async addMembership(input: InsertTeamMembership): Promise<TeamMembership> {
    const [existing] = await db.select().from(teamMemberships).where(
      and(eq(teamMemberships.teamId, input.teamId), eq(teamMemberships.userId, input.userId), eq(teamMemberships.active, true)),
    ).limit(1);
    if (existing) {
      const [row] = await db.update(teamMemberships)
        .set({ membershipRole: input.membershipRole ?? existing.membershipRole, primaryTeam: input.primaryTeam ?? existing.primaryTeam, updatedAt: new Date() })
        .where(eq(teamMemberships.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(teamMemberships).values({ ...input, active: true }).returning();
    return row;
  },
  /** End an active membership (mark inactive + endAt). History preserved. */
  async endMembership(teamId: number, userId: string): Promise<number> {
    const rows = await db.update(teamMemberships)
      .set({ active: false, endAt: new Date(), updatedAt: new Date() })
      .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId), eq(teamMemberships.active, true)))
      .returning({ id: teamMemberships.id });
    return rows.length;
  },
  async listMembershipsForTeam(teamId: number, activeOnly = true): Promise<TeamMembership[]> {
    const conds = [eq(teamMemberships.teamId, teamId)];
    if (activeOnly) conds.push(eq(teamMemberships.active, true));
    return db.select().from(teamMemberships).where(and(...conds)).orderBy(desc(teamMemberships.startAt));
  },
  async listMembershipsForUser(userId: string, activeOnly = true): Promise<TeamMembership[]> {
    const conds = [eq(teamMemberships.userId, userId)];
    if (activeOnly) conds.push(eq(teamMemberships.active, true));
    return db.select().from(teamMemberships).where(and(...conds)).orderBy(desc(teamMemberships.startAt));
  },
  async listActiveMembershipsForUsers(userIds: string[]): Promise<TeamMembership[]> {
    if (userIds.length === 0) return [];
    return db.select().from(teamMemberships).where(
      and(inArray(teamMemberships.userId, userIds), eq(teamMemberships.active, true)),
    );
  },

  // ─── Manager relationships ───────────────────────────────
  async addTeamManager(managerUserId: string, teamId: number, facilityId: string | null = null): Promise<ManagerRelationship> {
    const [existing] = await db.select().from(managerRelationships).where(
      and(eq(managerRelationships.managerUserId, managerUserId), eq(managerRelationships.teamId, teamId), eq(managerRelationships.scopeType, "team"), eq(managerRelationships.active, true)),
    ).limit(1);
    if (existing) return existing;
    const [row] = await db.insert(managerRelationships).values({ managerUserId, scopeType: "team", teamId, facilityId, active: true }).returning();
    return row;
  },
  async removeTeamManager(managerUserId: string, teamId: number): Promise<number> {
    const rows = await db.update(managerRelationships)
      .set({ active: false, endAt: new Date(), updatedAt: new Date() })
      .where(and(eq(managerRelationships.managerUserId, managerUserId), eq(managerRelationships.teamId, teamId), eq(managerRelationships.scopeType, "team"), eq(managerRelationships.active, true)))
      .returning({ id: managerRelationships.id });
    return rows.length;
  },
  async listManagerRelationships(managerUserId: string, activeOnly = true): Promise<ManagerRelationship[]> {
    const conds = [eq(managerRelationships.managerUserId, managerUserId)];
    if (activeOnly) conds.push(eq(managerRelationships.active, true));
    return db.select().from(managerRelationships).where(and(...conds));
  },
  async listManagersForTeam(teamId: number): Promise<ManagerRelationship[]> {
    return db.select().from(managerRelationships).where(
      and(eq(managerRelationships.teamId, teamId), eq(managerRelationships.active, true)),
    );
  },

  // ─── Audit ───────────────────────────────────────────────
  async recordEvent(input: InsertTeamRelationshipEvent): Promise<void> {
    try {
      await db.insert(teamRelationshipEvents).values(input);
    } catch (err) {
      // Best-effort audit — never blocks the mutation.
      console.error("[teams.repo] audit event failed:", err instanceof Error ? err.message : err);
    }
  },
  async listEvents(filters: { subjectUserId?: string; teamId?: number } = {}, limit = 200) {
    const conds = [];
    if (filters.subjectUserId) conds.push(eq(teamRelationshipEvents.subjectUserId, filters.subjectUserId));
    if (filters.teamId != null) conds.push(eq(teamRelationshipEvents.teamId, filters.teamId));
    const q = db.select().from(teamRelationshipEvents).$dynamic();
    return conds.length
      ? q.where(and(...conds)).orderBy(desc(teamRelationshipEvents.createdAt)).limit(limit)
      : q.orderBy(desc(teamRelationshipEvents.createdAt)).limit(limit);
  },
};
