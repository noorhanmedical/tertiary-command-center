// Team channel messaging (Phase 4D / decision K18).
//
// Wires canonical teams → a first-class team CONVERSATION (type='team',
// teamId set) whose membership is SYNCED from team_memberships. Joining a team
// grants channel access; leaving/deactivating a membership removes future
// access but message history remains (member row deactivated, not deleted).
//
// Task threads (plexus_task_messages) are NOT used as Team Chat anymore — a
// team channel is its own conversation.

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  messageConversations,
  messageConversationMembers,
  teams,
  teamMemberships,
} from "@shared/schema";
import { storage } from "../../storage";

/** Resolve the clinic id for a team: its members' clinic, else null. */
async function resolveTeamClinicId(teamId: number): Promise<number | null> {
  const members = await db.select({ userId: teamMemberships.userId })
    .from(teamMemberships)
    .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.active, true)));
  for (const m of members) {
    const u = await storage.getUser(m.userId);
    if (u?.clinicId != null) return u.clinicId;
  }
  return null;
}

/** Find (or create) the team conversation for a team. Idempotent. */
export async function ensureTeamConversation(teamId: number): Promise<number | null> {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) return null;

  const [existing] = await db.select().from(messageConversations)
    .where(and(eq(messageConversations.type, "team"), eq(messageConversations.teamId, teamId)))
    .limit(1);
  if (existing) return existing.id;

  const clinicId = await resolveTeamClinicId(teamId);
  const [conv] = await db.insert(messageConversations).values({
    clinicId,
    type: "team",
    teamId,
    title: team.name,
    facilityId: team.facilityId,
  }).returning();
  return conv.id;
}

/**
 * Sync the team conversation's membership to the team's ACTIVE memberships:
 *   - active team members who are not conversation members → added
 *   - conversation members who are no longer active team members → deactivated
 *     (history preserved; no new access)
 * Idempotent + safe to call after any membership change or team activation.
 */
export async function syncTeamConversationMembers(teamId: number): Promise<{
  conversationId: number | null;
  added: number;
  deactivated: number;
}> {
  const conversationId = await ensureTeamConversation(teamId);
  if (conversationId == null) return { conversationId: null, added: 0, deactivated: 0 };

  const activeMemberIds = new Set(
    (await db.select({ userId: teamMemberships.userId }).from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.active, true))))
      .map((r) => r.userId),
  );
  const convMembers = await db.select().from(messageConversationMembers)
    .where(eq(messageConversationMembers.conversationId, conversationId));
  const convMemberByUser = new Map(convMembers.map((m) => [m.userId, m]));

  let added = 0;
  let deactivated = 0;

  // Add / reactivate active team members.
  for (const userId of activeMemberIds) {
    const existing = convMemberByUser.get(userId);
    if (!existing) {
      await db.insert(messageConversationMembers)
        .values({ conversationId, userId, memberRole: "member", active: true })
        .onConflictDoNothing();
      added += 1;
    } else if (!existing.active) {
      await db.update(messageConversationMembers)
        .set({ active: true, leftAt: null })
        .where(eq(messageConversationMembers.id, existing.id));
      added += 1;
    }
  }

  // Deactivate conversation members no longer on the team (history kept).
  for (const m of convMembers) {
    if (m.active && !activeMemberIds.has(m.userId)) {
      await db.update(messageConversationMembers)
        .set({ active: false, leftAt: new Date() })
        .where(eq(messageConversationMembers.id, m.id));
      deactivated += 1;
    }
  }

  return { conversationId, added, deactivated };
}

/** Remove a single user's active team-channel access (history preserved). */
export async function removeUserFromTeamChannel(teamId: number, userId: string): Promise<void> {
  const [conv] = await db.select({ id: messageConversations.id }).from(messageConversations)
    .where(and(eq(messageConversations.type, "team"), eq(messageConversations.teamId, teamId)))
    .limit(1);
  if (!conv) return;
  await db.update(messageConversationMembers)
    .set({ active: false, leftAt: new Date() })
    .where(and(
      eq(messageConversationMembers.conversationId, conv.id),
      eq(messageConversationMembers.userId, userId),
      eq(messageConversationMembers.active, true),
    ));
}
