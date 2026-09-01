import {
  sql, pgTable, serial, text, varchar, boolean, timestamp,
  uniqueIndex, index, createInsertSchema, z,
} from "./_common";
import { users } from "./users";

// ─── Canonical facility coverage (Phase 4B / decision K6-coverage) ───────────
//
// ONE relationship answering "which facilities can this team member serve".
// Converges three legacy sources:
//   • outreach_schedulers.facility          → coverageType "primary"
//   • engagement_call_settings.facilitiesCovered[] → coverageType "regular"
//   • workspace_profile.assignedFacilityIds → view-scope (kept as a distinct
//     access layer; NOT collapsed here, see report)
//
// Keyed by users.id (login), NOT the roster id, so it spans any workspace.
// One ACTIVE row per (user,facility) via a partial unique index (K26).

export const FACILITY_COVERAGE_TYPES = ["primary", "regular", "temporary"] as const;
export type FacilityCoverageType = (typeof FACILITY_COVERAGE_TYPES)[number];

export const teamMemberFacilityCoverage = pgTable("team_member_facility_coverage", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  facilityId: text("facility_id").notNull(),
  coverageType: text("coverage_type").notNull().default("regular"),
  primaryCoverage: boolean("primary_coverage").notNull().default(false),
  active: boolean("active").notNull().default(true),
  // Temporary coverage window (nullable — set only for coverageType=temporary).
  temporaryStart: timestamp("temporary_start"),
  temporaryEnd: timestamp("temporary_end"),
  // Provenance of the row (which legacy source or admin action created it).
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_tmfc_user").on(table.userId),
  index("idx_tmfc_facility").on(table.facilityId),
  index("idx_tmfc_active").on(table.active),
]);

export const insertTeamMemberFacilityCoverageSchema = createInsertSchema(teamMemberFacilityCoverage)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    coverageType: z.enum(FACILITY_COVERAGE_TYPES).optional(),
    primaryCoverage: z.boolean().optional(),
    active: z.boolean().optional(),
  });
export type TeamMemberFacilityCoverage = typeof teamMemberFacilityCoverage.$inferSelect;
export type InsertTeamMemberFacilityCoverage = z.infer<typeof insertTeamMemberFacilityCoverageSchema>;
