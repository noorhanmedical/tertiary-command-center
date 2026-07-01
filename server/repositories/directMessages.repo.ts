import { db } from "../db";
import { and, eq, or, asc, sql } from "drizzle-orm";
import { directMessages, type DirectMessage } from "@shared/schema/directMessages";

export interface IDirectMessagesRepository {
  /** Full conversation between two users, oldest-first. */
  listConversation(userA: string, userB: string): Promise<DirectMessage[]>;
  /** Persist a message. Sender always comes from the trusted session. */
  send(input: { senderUserId: string; recipientUserId: string; body: string }): Promise<DirectMessage>;
  /** Mark every message from `fromUserId` → `meUserId` as read. */
  markConversationRead(meUserId: string, fromUserId: string): Promise<void>;
  /** Unread counts for the current user, grouped by the other participant. */
  unreadBySender(meUserId: string): Promise<{ fromUserId: string; count: number }[]>;
}

export class DbDirectMessagesRepository implements IDirectMessagesRepository {
  async listConversation(userA: string, userB: string): Promise<DirectMessage[]> {
    return db
      .select()
      .from(directMessages)
      .where(
        or(
          and(eq(directMessages.senderUserId, userA), eq(directMessages.recipientUserId, userB)),
          and(eq(directMessages.senderUserId, userB), eq(directMessages.recipientUserId, userA)),
        ),
      )
      .orderBy(asc(directMessages.createdAt));
  }

  async send(input: { senderUserId: string; recipientUserId: string; body: string }): Promise<DirectMessage> {
    const [row] = await db
      .insert(directMessages)
      .values({
        senderUserId: input.senderUserId,
        recipientUserId: input.recipientUserId,
        body: input.body,
      })
      .returning();
    return row;
  }

  async markConversationRead(meUserId: string, fromUserId: string): Promise<void> {
    await db
      .update(directMessages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(directMessages.recipientUserId, meUserId),
          eq(directMessages.senderUserId, fromUserId),
          sql`${directMessages.readAt} IS NULL`,
        ),
      );
  }

  async unreadBySender(meUserId: string): Promise<{ fromUserId: string; count: number }[]> {
    const rows = await db
      .select({
        fromUserId: directMessages.senderUserId,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(directMessages)
      .where(and(eq(directMessages.recipientUserId, meUserId), sql`${directMessages.readAt} IS NULL`))
      .groupBy(directMessages.senderUserId);
    return rows.map((r) => ({ fromUserId: r.fromUserId, count: Number(r.count) }));
  }
}

export const directMessagesRepository: IDirectMessagesRepository = new DbDirectMessagesRepository();
