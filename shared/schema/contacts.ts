// contacts — Phase 2 PR 2.7
//
// Canonical internal contacts directory. Replaces the hardcoded
// fallback list previously implied by the Internal Contacts tool.
//
// Each row is one contact. Categories:
//   - facility: clinic / facility staff contact
//   - physician: ordering / interpreting physician
//   - vendor_report: ancillary report / read vendor
//   - escalation: manager / supervisor / on-call
//   - team_member: an internal user (cross-references users.id)
//
// All fields except `name`, `category`, and `phone` are optional so
// admins can seed the directory incrementally.

import {
  sql, pgTable, serial, text, varchar, boolean, jsonb, timestamp,
  index, createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { clinics } from "./clinics";
import { integer } from "./_common";

export const CONTACT_CATEGORIES = [
  "facility",
  "physician",
  "vendor_report",
  "escalation",
  "team_member",
] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  // Multi-tenancy: nullable during backfill; filter enforced in repository layer.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  category: text("category").notNull(),
  name: text("name").notNull(),
  role: text("role"),
  organization: text("organization"),
  facilityId: text("facility_id"),
  phone: text("phone").notNull(),
  email: text("email"),
  notes: text("notes"),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  isOnCall: boolean("is_on_call").notNull().default(false),
  metadata: jsonb("metadata").notNull().default({}),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_contacts_category").on(table.category),
  index("idx_contacts_facility_id").on(table.facilityId),
  index("idx_contacts_user_id").on(table.userId),
  index("idx_contacts_archived").on(table.archivedAt),
]);

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Contact = typeof contacts.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
