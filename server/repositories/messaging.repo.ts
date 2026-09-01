// First-class messaging repository (Phase 1).
//
// Owns conversation + membership + team_messages persistence. Tenancy +
// authorization are enforced at the SERVICE layer; the repo trusts its inputs
// and only guarantees membership-scoped reads via explicit conditions. All
// reads are bounded.

import { db } from "../db";
import { and, desc, eq, inArray, isNull, sql, or, gt } from "drizzle-orm";
import {
  messageConversations,
  messageConversationMembers,
  teamMessages,
  directKeyFor,
  type MessageConversation,
  type TeamMessage,
} from "@shared/schema/messaging";
import { users } from "@shared/schema/users";

export type ConversationSummary = {
  id: number;
  type: string;
  title: string | null;
  facilityId: string | null;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  taskId: number | null;
  status: string;
  lastMessageAt: string | null;
  createdAt: string;
  // Per-viewer:
  unreadCount: number;
  // Other participants (for direct: the single counterpart).
  members: Array<{ userId: string; username: string; role: string | null }>;
};

/** Find (or create) the 1:1 direct conversation for a clinic + user pair. */
export async function findOrCreateDirectConversation(args: {
  clinicId: number;
  meUserId: string;
  otherUserId: string;
}): Promise<MessageConversation> {
  const dkey = directKeyFor(args.meUserId, args.otherUserId);
  const [existing] = await db
    .select()
    .from(messageConversations)
    .where(
      and(
        eq(messageConversations.clinicId, args.clinicId),
        eq(messageConversations.directKey, dkey),
      ),
    )
    .limit(1);
  if (existing) return existing;

  // Create conversation + both members in a transaction. Handle the race on
  // the partial unique index (uq_msg_conv_direct_key) by resolving the winner.
  try {
    return await db.transaction(async (tx) => {
      const [conv] = await tx
        .insert(messageConversations)
        .values({
          clinicId: args.clinicId,
          type: "direct",
          directKey: dkey,
          createdByUserId: args.meUserId,
        })
        .returning();
      await tx
        .insert(messageConversationMembers)
        .values([
          { conversationId: conv.id, userId: args.meUserId },
          { conversationId: conv.id, userId: args.otherUserId },
        ])
        .onConflictDoNothing();
      return conv;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const [winner] = await db
        .select()
        .from(messageConversations)
        .where(
          and(
            eq(messageConversations.clinicId, args.clinicId),
            eq(messageConversations.directKey, dkey),
          ),
        )
        .limit(1);
      if (winner) return winner;
    }
    throw err;
  }
}

/** Conversations the user is an active member of, newest activity first, with
 *  per-viewer unread counts. Bounded. */
export async function listConversationsForUser(args: {
  clinicId: number;
  userId: string;
  limit?: number;
}): Promise<ConversationSummary[]> {
  const limit = Math.min(Math.max(1, args.limit ?? 100), 200);

  const memberRows = await db
    .select({
      conversationId: messageConversationMembers.conversationId,
      lastReadAt: messageConversationMembers.lastReadAt,
    })
    .from(messageConversationMembers)
    .where(
      and(
        eq(messageConversationMembers.userId, args.userId),
        eq(messageConversationMembers.active, true),
      ),
    );
  if (memberRows.length === 0) return [];

  const convIds = memberRows.map((m) => m.conversationId);
  const lastReadByConv = new Map(memberRows.map((m) => [m.conversationId, m.lastReadAt]));

  const convs = await db
    .select()
    .from(messageConversations)
    .where(
      and(
        inArray(messageConversations.id, convIds),
        eq(messageConversations.clinicId, args.clinicId),
        eq(messageConversations.status, "active"),
      ),
    )
    .orderBy(desc(messageConversations.lastMessageAt), desc(messageConversations.id))
    .limit(limit);
  if (convs.length === 0) return [];

  const visibleIds = convs.map((c) => c.id);

  // Unread counts: messages from OTHER senders created after my lastReadAt.
  const unreadByConv = new Map<number, number>();
  const unreadRows = await db
    .select({
      conversationId: teamMessages.conversationId,
      createdAt: teamMessages.createdAt,
      senderUserId: teamMessages.senderUserId,
    })
    .from(teamMessages)
    .where(
      and(
        inArray(teamMessages.conversationId, visibleIds),
        isNull(teamMessages.deletedAt),
      ),
    );
  for (const m of unreadRows) {
    if (m.senderUserId === args.userId) continue;
    const lr = lastReadByConv.get(m.conversationId) ?? null;
    const isUnread = lr == null || new Date(m.createdAt as unknown as string) > new Date(lr as unknown as string);
    if (isUnread) unreadByConv.set(m.conversationId, (unreadByConv.get(m.conversationId) ?? 0) + 1);
  }

  // Members (with usernames) for the visible conversations.
  const membersByConv = new Map<number, ConversationSummary["members"]>();
  const memberDetail = await db
    .select({
      conversationId: messageConversationMembers.conversationId,
      userId: messageConversationMembers.userId,
      memberRole: messageConversationMembers.memberRole,
      username: users.username,
    })
    .from(messageConversationMembers)
    .leftJoin(users, eq(users.id, messageConversationMembers.userId))
    .where(
      and(
        inArray(messageConversationMembers.conversationId, visibleIds),
        eq(messageConversationMembers.active, true),
      ),
    );
  for (const m of memberDetail) {
    const arr = membersByConv.get(m.conversationId) ?? [];
    arr.push({ userId: m.userId, username: m.username ?? m.userId, role: m.memberRole });
    membersByConv.set(m.conversationId, arr);
  }

  return convs.map((c) => ({
    id: c.id,
    type: c.type,
    title: c.title,
    facilityId: c.facilityId,
    patientScreeningId: c.patientScreeningId,
    executionCaseId: c.executionCaseId,
    taskId: c.taskId,
    status: c.status,
    lastMessageAt: c.lastMessageAt ? new Date(c.lastMessageAt as unknown as string).toISOString() : null,
    createdAt: new Date(c.createdAt as unknown as string).toISOString(),
    unreadCount: unreadByConv.get(c.id) ?? 0,
    members: (membersByConv.get(c.id) ?? []).filter((m) => m.userId !== args.userId),
  }));
}

/** Is the user an active member of the conversation? (authorization helper) */
export async function isConversationMember(conversationId: number, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: messageConversationMembers.id })
    .from(messageConversationMembers)
    .where(
      and(
        eq(messageConversationMembers.conversationId, conversationId),
        eq(messageConversationMembers.userId, userId),
        eq(messageConversationMembers.active, true),
      ),
    )
    .limit(1);
  return !!row;
}

export async function getConversationById(conversationId: number): Promise<MessageConversation | undefined> {
  const [row] = await db
    .select()
    .from(messageConversations)
    .where(eq(messageConversations.id, conversationId))
    .limit(1);
  return row;
}

/** Messages in a conversation, oldest-first (chat order), bounded. */
export async function listMessages(args: {
  conversationId: number;
  limit?: number;
}): Promise<TeamMessage[]> {
  const limit = Math.min(Math.max(1, args.limit ?? 200), 500);
  const rows = await db
    .select()
    .from(teamMessages)
    .where(
      and(
        eq(teamMessages.conversationId, args.conversationId),
        isNull(teamMessages.deletedAt),
      ),
    )
    .orderBy(desc(teamMessages.createdAt))
    .limit(limit);
  return rows.reverse();
}

export async function createMessage(args: {
  conversationId: number;
  senderUserId: string | null;
  body: string;
  messageType?: "user" | "system";
  metadata?: Record<string, unknown>;
}): Promise<TeamMessage> {
  const now = new Date();
  const [row] = await db
    .insert(teamMessages)
    .values({
      conversationId: args.conversationId,
      senderUserId: args.senderUserId,
      body: args.body,
      messageType: args.messageType ?? "user",
      metadata: args.metadata ?? {},
    })
    .returning();
  await db
    .update(messageConversations)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(messageConversations.id, args.conversationId));
  return row;
}

/** Mark a conversation read for a user (advance lastReadAt to now). */
export async function markConversationRead(args: {
  conversationId: number;
  userId: string;
}): Promise<void> {
  await db
    .update(messageConversationMembers)
    .set({ lastReadAt: new Date() })
    .where(
      and(
        eq(messageConversationMembers.conversationId, args.conversationId),
        eq(messageConversationMembers.userId, args.userId),
      ),
    );
}

/** Total unread messages across all of the user's active conversations. */
export async function countTotalUnread(args: {
  clinicId: number;
  userId: string;
}): Promise<number> {
  const summaries = await listConversationsForUser({
    clinicId: args.clinicId,
    userId: args.userId,
    limit: 200,
  });
  return summaries.reduce((sum, c) => sum + c.unreadCount, 0);
}

/** Roster of other internal users in the clinic (for the direct-message
 *  recipient picker), with per-pair unread counts for the caller. */
export async function listRoster(args: {
  clinicId: number;
  meUserId: string;
}): Promise<Array<{ id: string; username: string; role: string | null; unread: number }>> {
  const roster = await db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.clinicId, args.clinicId),
        eq(users.active, true),
      ),
    )
    .orderBy(users.username);

  const summaries = await listConversationsForUser({
    clinicId: args.clinicId,
    userId: args.meUserId,
    limit: 200,
  });
  const unreadByOther = new Map<string, number>();
  for (const s of summaries) {
    if (s.type !== "direct") continue;
    const other = s.members[0]?.userId;
    if (other) unreadByOther.set(other, (unreadByOther.get(other) ?? 0) + s.unreadCount);
  }

  return roster
    .filter((u) => u.id !== args.meUserId)
    .map((u) => ({ id: u.id, username: u.username, role: u.role, unread: unreadByOther.get(u.id) ?? 0 }));
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  if (code === "23505") return true;
  const msg = (err as { message?: string })?.message ?? "";
  return /duplicate key value|unique constraint/i.test(msg);
}
