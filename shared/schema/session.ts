// Express session storage table managed by `connect-pg-simple` at runtime
// (see `server/index.ts` — `tableName: "session", createTableIfMissing: true`).
// Declared here so that `drizzle-kit push` recognizes the table as part of the
// expected schema and does NOT propose to drop it. The shape mirrors
// connect-pg-simple's default DDL exactly:
//
//   CREATE TABLE "session" (
//     "sid"    varchar         NOT NULL PRIMARY KEY,
//     "sess"   json            NOT NULL,
//     "expire" timestamp(6)    NOT NULL
//   );
//   CREATE INDEX "IDX_session_expire" ON "session" ("expire");
import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

export const sessions = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
}, (table) => [
  index("IDX_session_expire").on(table.expire),
]);

export type Session = typeof sessions.$inferSelect;
