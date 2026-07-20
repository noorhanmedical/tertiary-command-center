// Internal direct-messages repository.
//
// Every read/write here enforces the tenancy invariant: sender and
// recipient must both be members of `clinicId`. That check lives at
// the service layer (auth boundary) — the repo will never look up
// membership on its own. All statements are bounded + indexed.

import { db } from "../db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { directMessages, type DirectMessage } from "@shared/schema/directMessages";

export type ListInboxArgs = {
  clinicId: number;
  recipientUserId: string;
  limit?: number;
  cursorCreatedAt?: Date | null;
};

/**
 * Recipient inbox, newest first. Bounded by `limit` (default 50, max
 * 200). Optional cursor by created_at for pagination.
 */
export async function listInbox(args: ListInboxArgs): Promise<DirectMessage[]> {
  const limit = Math.min(Math.max(1, args.limit ?? 50), 200);
  const conds = [
    eq(directMessages.recipientUserId, args.recipientUserId),
    eq(directMessages.clinicId, args.clinicId),
  ];
  if (args.cursorCreatedAt) {
    conds.push(sql`${directMessages.createdAt} < ${args.cursorCreatedAt}`);
  }
  return db
    .select()
    .from(directMessages)
    .where(and(...conds))
    .orderBy(desc(directMessages.createdAt))
    .limit(limit);
}

export type ListConversationArgs = {
  clinicId: number;
  meUserId: string;
  otherUserId: string;
  limit?: number;
};

/**
 * Bidirectional conversation between me and one other user, within a
 * clinic. Newest-first, bounded.
 */
export async function listConversation(
  args: ListConversationArgs,
): Promise<DirectMessage[]> {
  const limit = Math.min(Math.max(1, args.limit ?? 100), 500);
  return db
    .select()
    .from(directMessages)
    .where(
      and(
        eq(directMessages.clinicId, args.clinicId),
        sql`(
          (${directMessages.senderUserId} = ${args.meUserId} AND ${directMessages.recipientUserId} = ${args.otherUserId})
          OR
          (${directMessages.senderUserId} = ${args.otherUserId} AND ${directMessages.recipientUserId} = ${args.meUserId})
        )`,
      ),
    )
    .orderBy(desc(directMessages.createdAt))
    .limit(limit);
}

export type CreateMessageArgs = {
  clinicId: number;
  senderUserId: string;
  recipientUserId: string;
  body: string;
};

export async function createMessage(args: CreateMessageArgs): Promise<DirectMessage> {
  const [row] = await db
    .insert(directMessages)
    .values({
      clinicId: args.clinicId,
      senderUserId: args.senderUserId,
      recipientUserId: args.recipientUserId,
      body: args.body,
    })
    .returning();
  return row;
}

export async function markConversationRead(args: {
  clinicId: number;
  meUserId: string;
  otherUserId: string;
}): Promise<number> {
  const now = new Date();
  const rows = await db
    .update(directMessages)
    .set({ readAt: now })
    .where(
      and(
        eq(directMessages.clinicId, args.clinicId),
        eq(directMessages.recipientUserId, args.meUserId),
        eq(directMessages.senderUserId, args.otherUserId),
        isNull(directMessages.readAt),
      ),
    )
    .returning({ id: directMessages.id });
  return rows.length;
}

export async function countUnreadForRecipient(args: {
  clinicId: number;
  recipientUserId: string;
}): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(directMessages)
    .where(
      and(
        eq(directMessages.clinicId, args.clinicId),
        eq(directMessages.recipientUserId, args.recipientUserId),
        isNull(directMessages.readAt),
      ),
    );
  return row?.n ?? 0;
}
