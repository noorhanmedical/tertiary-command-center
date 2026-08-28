// Canonical facility-coverage repository (Phase 4B). ONE source for "which
// facilities can this user serve". Concurrency-safe (partial unique active
// index); deactivate-then-insert keeps history.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  teamMemberFacilityCoverage,
  type TeamMemberFacilityCoverage,
  type InsertTeamMemberFacilityCoverage,
} from "@shared/schema";

export const facilityCoverageRepository = {
  /** Add or reactivate an active coverage row for (user,facility). */
  async addCoverage(input: InsertTeamMemberFacilityCoverage): Promise<TeamMemberFacilityCoverage> {
    const [existing] = await db.select().from(teamMemberFacilityCoverage).where(
      and(
        eq(teamMemberFacilityCoverage.userId, input.userId),
        eq(teamMemberFacilityCoverage.facilityId, input.facilityId),
        eq(teamMemberFacilityCoverage.active, true),
      ),
    ).limit(1);
    if (existing) {
      const [row] = await db.update(teamMemberFacilityCoverage)
        .set({
          coverageType: input.coverageType ?? existing.coverageType,
          primaryCoverage: input.primaryCoverage ?? existing.primaryCoverage,
          source: input.source ?? existing.source,
          updatedAt: new Date(),
        })
        .where(eq(teamMemberFacilityCoverage.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(teamMemberFacilityCoverage).values({ ...input, active: true }).returning();
    return row;
  },

  async removeCoverage(userId: string, facilityId: string): Promise<number> {
    const rows = await db.update(teamMemberFacilityCoverage)
      .set({ active: false, updatedAt: new Date() })
      .where(and(
        eq(teamMemberFacilityCoverage.userId, userId),
        eq(teamMemberFacilityCoverage.facilityId, facilityId),
        eq(teamMemberFacilityCoverage.active, true),
      ))
      .returning({ id: teamMemberFacilityCoverage.id });
    return rows.length;
  },

  async listForUser(userId: string): Promise<TeamMemberFacilityCoverage[]> {
    return db.select().from(teamMemberFacilityCoverage).where(
      and(eq(teamMemberFacilityCoverage.userId, userId), eq(teamMemberFacilityCoverage.active, true)),
    );
  },

  /** Covered facility ids for a user (active rows). */
  async coveredFacilityIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.listForUser(userId);
    return rows.map((r) => r.facilityId);
  },

  /** Bulk: Map<userId, facilityId[]> for a set of users (active rows). */
  async coveredFacilitiesForUsers(userIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (userIds.length === 0) return map;
    const rows = await db.select().from(teamMemberFacilityCoverage).where(
      and(inArray(teamMemberFacilityCoverage.userId, userIds), eq(teamMemberFacilityCoverage.active, true)),
    );
    for (const r of rows) {
      const list = map.get(r.userId) ?? [];
      list.push(r.facilityId);
      map.set(r.userId, list);
    }
    return map;
  },
};
