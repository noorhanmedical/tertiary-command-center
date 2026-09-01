import {
  sql, pgTable, serial, text, integer, boolean, timestamp, jsonb, index, uniqueIndex,
  createInsertSchema, z,
} from "./_common";
import { clinics } from "./clinics";
import { users } from "./users";

/**
 * Clinic Onboarding — backend for the implementation / go-live readiness
 * console (`client/src/pages/clinic-onboarding.tsx`).
 *
 * Three tables:
 *   • `onboarding_section_templates` — the canonical catalog of onboarding
 *     sections (the "25 sections"). Seed/config data, tenant-agnostic.
 *   • `onboarding_checklist_items`   — per-clinic, per-item state (status,
 *     maturity, owner, due date, blocked, evidence). The source of truth for
 *     progress / maturity / go-live metrics.
 *   • `onboarding_signoffs`          — dual admin + owner go-live approvals.
 *
 * The go-live gate (progress ≥ 90% AND zero open blockers) is computed and
 * enforced server-side in the repository layer, not just in the UI.
 */

/* ─── Enum-like literals ──────────────────────────────────────────────────── */

export const ONBOARDING_PHASES = ["Sales", "Implementation"] as const;
export type OnboardingPhase = typeof ONBOARDING_PHASES[number];

export const ONBOARDING_CHECKLIST_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
] as const;
export type OnboardingChecklistStatus = typeof ONBOARDING_CHECKLIST_STATUSES[number];

// Maturity model: 0 Not Present · 1 Ad Hoc · 2 Consistent · 3 Optimized
export const ONBOARDING_MATURITY_SCORES = [0, 1, 2, 3] as const;
export type OnboardingMaturityScore = typeof ONBOARDING_MATURITY_SCORES[number];

export const ONBOARDING_SIGNOFF_ROLES = ["admin", "owner"] as const;
export type OnboardingSignoffRole = typeof ONBOARDING_SIGNOFF_ROLES[number];

/* ─── Section templates (canonical catalog) ───────────────────────────────── */

export const onboardingSectionTemplates = pgTable("onboarding_section_templates", {
  id: serial("id").primaryKey(),
  // Stable ordinal (1..25) used by the UI and for ordering.
  ordinal: integer("ordinal").notNull(),
  name: text("name").notNull(),
  phase: text("phase").notNull().default("Implementation"),
  // Ordered list of item labels that belong to this section.
  itemLabels: jsonb("item_labels").notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("idx_onboarding_section_ordinal").on(table.ordinal),
  index("idx_onboarding_section_phase").on(table.phase),
]);

export const insertOnboardingSectionTemplateSchema = createInsertSchema(onboardingSectionTemplates).omit({
  id: true,
  createdAt: true,
}).extend({
  ordinal: z.number().int().min(1),
  name: z.string().trim().min(1).max(200),
  phase: z.enum(ONBOARDING_PHASES),
  itemLabels: z.array(z.string().trim().min(1)).default([]),
});

export type OnboardingSectionTemplate = typeof onboardingSectionTemplates.$inferSelect;
export type InsertOnboardingSectionTemplate = z.infer<typeof insertOnboardingSectionTemplateSchema>;

/* ─── Checklist items (per-clinic state) ──────────────────────────────────── */

export const onboardingChecklistItems = pgTable("onboarding_checklist_items", {
  id: serial("id").primaryKey(),
  // Multi-tenancy: nullable during backfill; filter enforced in repo layer.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "cascade" }),
  sectionOrdinal: integer("section_ordinal").notNull(),
  sectionName: text("section_name").notNull(),
  phase: text("phase").notNull().default("Implementation"),
  label: text("label").notNull(),
  status: text("status").notNull().default("not_started"),
  maturityScore: integer("maturity_score").notNull().default(0),
  blocked: boolean("blocked").notNull().default(false),
  ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  ownerName: text("owner_name"),
  dueDate: text("due_date"),
  notes: text("notes"),
  // Evidence file references (object-storage keys + metadata).
  evidence: jsonb("evidence").notNull().default([]),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_onboarding_item_clinic").on(table.clinicId),
  index("idx_onboarding_item_section").on(table.sectionOrdinal),
  index("idx_onboarding_item_status").on(table.status),
  uniqueIndex("idx_onboarding_item_clinic_section_label").on(
    table.clinicId, table.sectionOrdinal, table.label,
  ),
]);

export const insertOnboardingChecklistItemSchema = createInsertSchema(onboardingChecklistItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  sectionOrdinal: z.number().int().min(1),
  sectionName: z.string().trim().min(1).max(200),
  phase: z.enum(ONBOARDING_PHASES),
  label: z.string().trim().min(1).max(300),
  status: z.enum(ONBOARDING_CHECKLIST_STATUSES).default("not_started"),
  maturityScore: z.number().int().min(0).max(3).default(0),
  blocked: z.boolean().default(false),
  dueDate: z.string().trim().max(40).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  evidence: z.array(z.object({
    key: z.string().min(1),
    fileName: z.string().min(1),
    uploadedAt: z.string(),
    uploadedBy: z.string().optional(),
  })).default([]),
});

// Partial update schema for status/maturity/owner transitions.
export const updateOnboardingChecklistItemSchema = z.object({
  status: z.enum(ONBOARDING_CHECKLIST_STATUSES).optional(),
  maturityScore: z.number().int().min(0).max(3).optional(),
  blocked: z.boolean().optional(),
  ownerUserId: z.string().nullable().optional(),
  ownerName: z.string().max(200).nullable().optional(),
  dueDate: z.string().max(40).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export type OnboardingChecklistItem = typeof onboardingChecklistItems.$inferSelect;
export type InsertOnboardingChecklistItem = z.infer<typeof insertOnboardingChecklistItemSchema>;
export type UpdateOnboardingChecklistItem = z.infer<typeof updateOnboardingChecklistItemSchema>;

/* ─── Go-live signoffs ────────────────────────────────────────────────────── */

export const onboardingSignoffs = pgTable("onboarding_signoffs", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  signedByUserId: text("signed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  signedByName: text("signed_by_name"),
  notes: text("notes"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_onboarding_signoff_clinic").on(table.clinicId),
  uniqueIndex("idx_onboarding_signoff_clinic_role").on(table.clinicId, table.role),
]);

export const insertOnboardingSignoffSchema = createInsertSchema(onboardingSignoffs).omit({
  id: true,
  createdAt: true,
}).extend({
  role: z.enum(ONBOARDING_SIGNOFF_ROLES),
  signedByName: z.string().trim().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type OnboardingSignoff = typeof onboardingSignoffs.$inferSelect;
export type InsertOnboardingSignoff = z.infer<typeof insertOnboardingSignoffSchema>;

/* ─── Derived metrics shape (computed server-side, not persisted) ─────────── */

export interface OnboardingMetrics {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  blockers: number;
  criticalBlockers: number;
  avgMaturity: number;
  progressPct: number;
  salesPct: number;
  implPct: number;
  goLiveReady: boolean;
}
