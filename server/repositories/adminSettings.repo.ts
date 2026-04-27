import { db } from "../db";
import { eq, and, desc, isNull } from "drizzle-orm";
import {
  adminSettings,
  type AdminSetting,
  type InsertAdminSetting,
} from "@shared/schema/adminSettings";

export type ListAdminSettingsFilters = {
  settingDomain?: string;
  settingKey?: string;
  facilityId?: string;
  userId?: string;
  active?: boolean;
};

export async function createAdminSetting(
  input: InsertAdminSetting,
): Promise<AdminSetting> {
  const [result] = await db
    .insert(adminSettings)
    .values(input)
    .returning();
  return result;
}

export async function updateAdminSetting(
  id: number,
  updates: Partial<InsertAdminSetting>,
): Promise<AdminSetting | undefined> {
  const [result] = await db
    .update(adminSettings)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(adminSettings.id, id))
    .returning();
  return result;
}

export async function getAdminSettingById(id: number): Promise<AdminSetting | undefined> {
  const [result] = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.id, id))
    .limit(1);
  return result;
}

// ─── Default seed ──────────────────────────────────────────────────────────

type DefaultAdminSetting = {
  settingDomain: string;
  settingKey: string;
  settingValue: Record<string, unknown>;
  description: string;
};

const DEFAULT_ADMIN_SETTINGS: DefaultAdminSetting[] = [
  // insurance
  { settingDomain: "insurance", settingKey: "straight_medicare_policy", settingValue: { allowed: true, preferred: true }, description: "Straight Medicare is allowed and preferred." },
  { settingDomain: "insurance", settingKey: "ppo_policy", settingValue: { allowed: true }, description: "PPO insurance is allowed." },
  { settingDomain: "insurance", settingKey: "other_payer_policy", settingValue: { allowed: true, requires_admin_approval: true }, description: "Other payers require admin approval." },
  { settingDomain: "insurance", settingKey: "outreach_mix", settingValue: { medicare: 75, ppo: 25 }, description: "Default outreach mix: 75% Medicare / 25% PPO." },

  // cooldown
  { settingDomain: "cooldown", settingKey: "enabled", settingValue: { enabled: true }, description: "Cooldown enforcement is enabled." },
  { settingDomain: "cooldown", settingKey: "blocks_automatic_qualification", settingValue: { blocks: true }, description: "Active cooldown blocks automatic qualification." },
  { settingDomain: "cooldown", settingKey: "override_requires_reason", settingValue: { required: true }, description: "Cooldown override requires a reason." },

  // engagement_center
  { settingDomain: "engagement_center", settingKey: "enabled", settingValue: { enabled: true }, description: "Engagement Center is enabled." },
  { settingDomain: "engagement_center", settingKey: "default_priority_window_minutes", settingValue: { minutes: 60 }, description: "Default look-ahead window for next-action prioritization (minutes)." },

  // global_schedule
  { settingDomain: "global_schedule", settingKey: "source_of_truth", settingValue: { enabled: true }, description: "Global Schedule is the source of truth for assignments." },
  { settingDomain: "global_schedule", settingKey: "pto_blocks_assignment", settingValue: { enabled: true }, description: "Approved PTO blocks new assignments to that team member." },
  { settingDomain: "global_schedule", settingKey: "same_day_add_allowed_if_capacity", settingValue: { enabled: true }, description: "Same-day adds are allowed when capacity is available." },

  // document_library
  { settingDomain: "document_library", settingKey: "template_approval_required", settingValue: { required: true }, description: "Ancillary document templates require admin approval before use." },
  { settingDomain: "document_library", settingKey: "default_signature_requirement", settingValue: { default: "none" }, description: "Default signature requirement for new uploads." },

  // billing
  { settingDomain: "billing", settingKey: "required_for_billing", settingValue: { requirements: ["qualification", "procedure_complete", "informed_consent", "screening_form", "report", "order_note", "post_procedure_note"] }, description: "Documents/states that must be present before a case can be billed." },

  // invoice
  { settingDomain: "invoice", settingKey: "our_portion_percentage", settingValue: { percentage: 50 }, description: "Default our-portion percentage on invoice line items." },
  { settingDomain: "invoice", settingKey: "admin_approval_required", settingValue: { required: true }, description: "Invoices require admin approval before sending." },
  { settingDomain: "invoice", settingKey: "default_frequency", settingValue: { frequency: "monthly" }, description: "Default invoicing cadence." },

  // projected_invoice
  { settingDomain: "projected_invoice", settingKey: "enabled", settingValue: { enabled: true }, description: "Projected invoice rows are tracked." },
  { settingDomain: "projected_invoice", settingKey: "default_our_portion_percentage", settingValue: { percentage: 50 }, description: "Default our-portion percentage on projected rows." },

  // cash_price
  { settingDomain: "cash_price", settingKey: "enabled", settingValue: { enabled: true }, description: "Cash price settings are honored when no insurance applies." },
  { settingDomain: "cash_price", settingKey: "default_pricing_model", settingValue: { model: "fixed" }, description: "Default pricing model for cash-pay services." },

  // ai
  { settingDomain: "ai", settingKey: "enabled", settingValue: { enabled: true }, description: "AI-driven workflows (screening, note generation) are enabled." },
  { settingDomain: "ai", settingKey: "note_generation_requires_review", settingValue: { required: true }, description: "AI-generated notes require human review before approval." },

  // audit
  { settingDomain: "audit", settingKey: "enabled", settingValue: { enabled: true }, description: "Audit logging is enabled across operational domains." },
  { settingDomain: "audit", settingKey: "retention_days", settingValue: { days: 365 }, description: "Default audit log retention window (days)." },
];

export type SeedDefaultAdminSettingsResult = {
  created: number;
  skipped: number;
  createdRows: AdminSetting[];
};

/** Idempotently insert default admin settings. Skips any default whose
 *  (settingDomain, settingKey) already exists at the global scope
 *  (facilityId IS NULL AND userId IS NULL). Never overwrites existing rows. */
export async function seedDefaultAdminSettings(): Promise<SeedDefaultAdminSettingsResult> {
  let created = 0;
  let skipped = 0;
  const createdRows: AdminSetting[] = [];

  for (const def of DEFAULT_ADMIN_SETTINGS) {
    const [existing] = await db
      .select({ id: adminSettings.id })
      .from(adminSettings)
      .where(
        and(
          eq(adminSettings.settingDomain, def.settingDomain),
          eq(adminSettings.settingKey, def.settingKey),
          isNull(adminSettings.facilityId),
          isNull(adminSettings.userId),
        ),
      )
      .limit(1);

    if (existing) {
      skipped++;
      continue;
    }

    const [row] = await db
      .insert(adminSettings)
      .values({
        settingDomain: def.settingDomain,
        settingKey: def.settingKey,
        settingValue: def.settingValue,
        description: def.description,
        active: true,
      })
      .returning();
    createdRows.push(row);
    created++;
  }

  return { created, skipped, createdRows };
}

export async function listAdminSettings(
  filters: ListAdminSettingsFilters = {},
  limit = 100,
): Promise<AdminSetting[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.settingDomain) conditions.push(eq(adminSettings.settingDomain, filters.settingDomain));
  if (filters.settingKey) conditions.push(eq(adminSettings.settingKey, filters.settingKey));
  if (filters.facilityId) conditions.push(eq(adminSettings.facilityId, filters.facilityId));
  if (filters.userId) conditions.push(eq(adminSettings.userId, filters.userId));
  if (filters.active !== undefined) conditions.push(eq(adminSettings.active, filters.active));

  const query = db.select().from(adminSettings).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(adminSettings.createdAt)).limit(safeLimit)
    : query.orderBy(desc(adminSettings.createdAt)).limit(safeLimit);
}
