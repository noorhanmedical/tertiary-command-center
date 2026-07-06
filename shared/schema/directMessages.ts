// Direct (1:1) messages between team members — Team Portal messaging tray.
//
// A real, person-to-person message store (iMessage-style). Distinct from the
// Plexus task-message threads used for group/task conversations. Attribution
// is trustworthy: `senderUserId` is always taken from the server session, so
// admin "view-as" can never fabricate a sender.
import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  index,
  createInsertSchema,
  z,
} from "./_common";
import { users } from "./users";

export const directMessages = pgTable(
  "direct_messages",
  {
    id: serial("id").primaryKey(),
    senderUserId: varchar("sender_user_id")
      .notNull()
      .references(() => users.id),
    recipientUserId: varchar("recipient_user_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    pairIdx: index("direct_messages_pair_idx").on(t.senderUserId, t.recipientUserId),
    recipientIdx: index("direct_messages_recipient_idx").on(t.recipientUserId),
  }),
);

// `senderUserId` is set from the session server-side, never from the client.
export const insertDirectMessageSchema = createInsertSchema(directMessages)
  .omit({ id: true, createdAt: true, readAt: true, senderUserId: true })
  .extend({
    recipientUserId: z.string().min(1),
    body: z.string().trim().min(1).max(5000),
  });

export type DirectMessage = typeof directMessages.$inferSelect;
export type InsertDirectMessage = z.infer<typeof insertDirectMessageSchema>;
