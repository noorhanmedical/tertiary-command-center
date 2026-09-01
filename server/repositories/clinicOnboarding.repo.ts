import { db } from "../db";
import { eq, and, asc, desc } from "drizzle-orm";
import { clinics, type Clinic } from "@shared/schema/clinics";
import {
  onboardingSectionTemplates,
  onboardingChecklistItems,
  onboardingSignoffs,
  type OnboardingSectionTemplate,
  type OnboardingChecklistItem,
  type InsertOnboardingChecklistItem,
  type UpdateOnboardingChecklistItem,
  type OnboardingSignoff,
  type InsertOnboardingSignoff,
  type OnboardingMetrics,
  type OnboardingPhase,
} from "@shared/schema/clinicOnboarding";

/* ─── Go-live gate constants ──────────────────────────────────────────────── */

const GO_LIVE_MIN_PROGRESS_PCT = 90;
const SALES_SECTION_ORDINALS = new Set<number>([1, 4, 11]);

function phaseForOrdinal(ordinal: number): OnboardingPhase {
  return SALES_SECTION_ORDINALS.has(ordinal) ? "Sales" : "Implementation";
}

/* ─── Clinics (for the onboarding selector) ───────────────────────────────── */

export async function listClinics(): Promise<Clinic[]> {
  return db.select().from(clinics).orderBy(asc(clinics.name));
}

/* ─── Section templates (catalog) ─────────────────────────────────────────── */

/**
 * Canonical 25-section onboarding catalog. Mirrors `SECTION_DEFS` in
 * `client/src/pages/clinic-onboarding.tsx`. Phase is derived from ordinal
 * (sections 1, 4, 11 are Sales; the rest Implementation).
 */
export const SECTION_CATALOG: { ordinal: number; name: string; items: string[] }[] = [
  { ordinal: 1, name: "Ownership & Governance", items: ["Ownership structure", "Decision makers", "Operating agreement", "Admin contacts", "Escalation pathway", "Reporting expectations"] },
  { ordinal: 2, name: "Systems & Logins", items: ["EMR credentials", "Clearinghouse logins", "Fax portal access", "Email accounts", "Shared drive access", "Password vault entries"] },
  { ordinal: 3, name: "Scheduling & Access", items: ["Scheduling templates", "Appointment types", "Provider calendars", "Block scheduling rules", "Online booking", "Access hours"] },
  { ordinal: 4, name: "Insurance & Payor Mix", items: ["Payor contracts", "Eligibility workflow", "Fee schedules", "Out-of-network policy", "Payor mix profile", "Verification process"] },
  { ordinal: 5, name: "Front Desk & Check-In", items: ["Check-in workflow", "Co-pay collection", "Intake forms", "Patient registration", "Insurance card scanning", "Wait-time process"] },
  { ordinal: 6, name: "Documents & Faxes", items: ["Fax routing", "Document indexing", "Record retention", "Release of information", "e-Signature setup", "Inbound triage"] },
  { ordinal: 7, name: "Referrals", items: ["Referral intake", "Referral tracking", "Outbound referrals", "Specialist network", "Referral SLAs", "Loop closure"] },
  { ordinal: 8, name: "Prior Authorizations", items: ["Auth workflow", "Payer requirements", "Auth tracking board", "Denial handling", "Peer-to-peer process", "Turnaround targets"] },
  { ordinal: 9, name: "Medical Assistants", items: ["MA roster", "Rooming workflow", "Vitals capture", "Standing orders", "Scope of duties", "Training status"] },
  { ordinal: 10, name: "Providers", items: ["Provider roster", "Provider schedules", "Documentation habits", "Productivity targets", "Supervision agreements", "Onboarding packet"] },
  { ordinal: 11, name: "Ancillary Services", items: ["BrainWave readiness", "VitalWave readiness", "Ultrasound readiness", "Imaging Central readiness", "Equipment placement", "Staff training"] },
  { ordinal: 12, name: "Remote Teams", items: ["Remote staff roster", "Access provisioning", "Communication cadence", "Task assignment", "Performance tracking", "Coverage hours"] },
  { ordinal: 13, name: "Communication", items: ["Phone tree", "Patient messaging", "Internal channels", "Escalation contacts", "After-hours coverage", "Notification settings"] },
  { ordinal: 14, name: "EMR Administration", items: ["User management", "Template library", "Order sets", "Interface mapping", "Reporting setup", "Backup configuration"] },
  { ordinal: 15, name: "Automations", items: ["Reminder automations", "Recall campaigns", "Task automations", "Intake automations", "Billing triggers", "Workflow rules"] },
  { ordinal: 16, name: "Inventory & Equipment", items: ["Equipment inventory", "Supply par levels", "Vendor list", "Maintenance log", "Calibration schedule", "Reorder workflow"] },
  { ordinal: 17, name: "Billing & Clearinghouse", items: ["Clearinghouse setup", "Charge capture", "Claim scrubbing", "Payment posting", "Denial workflow", "AR follow-up"] },
  { ordinal: 18, name: "Credentialing", items: ["Provider credentialing", "Payer enrollment", "CAQH profiles", "Revalidation tracking", "License monitoring", "NPI registry"] },
  { ordinal: 19, name: "HR & Training", items: ["Staff onboarding", "Training curriculum", "Competency checks", "Policy acknowledgments", "Performance reviews", "PTO policy"] },
  { ordinal: 20, name: "Infection Control & OSHA", items: ["OSHA plan", "PPE supply", "Sharps disposal", "Exposure control", "Sterilization process", "Safety training"] },
  { ordinal: 21, name: "Emergency & Downtime", items: ["Downtime procedures", "Emergency contacts", "Backup systems", "Crash cart check", "Evacuation plan", "Incident reporting"] },
  { ordinal: 22, name: "Telehealth & Virtual Care", items: ["Telehealth platform", "Virtual workflow", "Consent process", "Tech support", "Billing rules", "Patient instructions"] },
  { ordinal: 23, name: "Patient Experience & Access", items: ["Satisfaction surveys", "Complaint workflow", "Wait-time monitoring", "Accessibility", "Language services", "Portal adoption"] },
  { ordinal: 24, name: "Clinical Quality & Care Management", items: ["Quality measures", "Care gap tracking", "Chronic care management", "Population health", "Outcome tracking", "Care plans"] },
  { ordinal: 25, name: "Compliance & Risk", items: ["HIPAA compliance", "Risk assessment", "BAAs on file", "Audit log review", "Incident response", "Policy library"] },
];

/**
 * Seed the section-template catalog. Idempotent — existing ordinals are left
 * untouched via onConflictDoNothing on the unique ordinal index.
 * Returns counts of created vs skipped rows.
 */
export async function seedSectionTemplates(): Promise<{ created: number; skipped: number }> {
  const values = SECTION_CATALOG.map((s) => ({
    ordinal: s.ordinal,
    name: s.name,
    phase: phaseForOrdinal(s.ordinal),
    itemLabels: s.items,
    active: true,
  }));

  const created = await db
    .insert(onboardingSectionTemplates)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: onboardingSectionTemplates.id });

  return { created: created.length, skipped: values.length - created.length };
}

export async function listSectionTemplates(): Promise<OnboardingSectionTemplate[]> {
  return db
    .select()
    .from(onboardingSectionTemplates)
    .where(eq(onboardingSectionTemplates.active, true))
    .orderBy(asc(onboardingSectionTemplates.ordinal));
}

/* ─── Checklist items ─────────────────────────────────────────────────────── */

export type ListChecklistItemsFilters = {
  clinicId?: number;
  sectionOrdinal?: number;
  status?: string;
  phase?: string;
  blockedOnly?: boolean;
};

export async function listChecklistItems(
  filters: ListChecklistItemsFilters = {},
  limit = 500,
): Promise<OnboardingChecklistItem[]> {
  const safeLimit = Math.min(Math.max(1, limit), 1000);
  const conditions = [];

  if (filters.clinicId != null) conditions.push(eq(onboardingChecklistItems.clinicId, filters.clinicId));
  if (filters.sectionOrdinal != null) conditions.push(eq(onboardingChecklistItems.sectionOrdinal, filters.sectionOrdinal));
  if (filters.status) conditions.push(eq(onboardingChecklistItems.status, filters.status));
  if (filters.phase) conditions.push(eq(onboardingChecklistItems.phase, filters.phase));
  if (filters.blockedOnly) conditions.push(eq(onboardingChecklistItems.blocked, true));

  const query = db.select().from(onboardingChecklistItems).$dynamic();

  return conditions.length > 0
    ? query
        .where(and(...conditions))
        .orderBy(asc(onboardingChecklistItems.sectionOrdinal), asc(onboardingChecklistItems.id))
        .limit(safeLimit)
    : query
        .orderBy(asc(onboardingChecklistItems.sectionOrdinal), asc(onboardingChecklistItems.id))
        .limit(safeLimit);
}

export async function getChecklistItemById(id: number): Promise<OnboardingChecklistItem | undefined> {
  const [row] = await db
    .select()
    .from(onboardingChecklistItems)
    .where(eq(onboardingChecklistItems.id, id))
    .limit(1);
  return row;
}

export async function updateChecklistItem(
  id: number,
  updates: UpdateOnboardingChecklistItem,
): Promise<OnboardingChecklistItem | undefined> {
  const [row] = await db
    .update(onboardingChecklistItems)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(onboardingChecklistItems.id, id))
    .returning();
  return row;
}

/**
 * Seed a clinic's checklist from the section-template catalog. Idempotent:
 * items already present (clinic + section + label) are skipped via the unique
 * index / onConflictDoNothing. Returns the number of rows inserted.
 */
export async function seedChecklistForClinic(clinicId: number): Promise<number> {
  const templates = await listSectionTemplates();
  const rows: InsertOnboardingChecklistItem[] = [];

  for (const section of templates) {
    const labels = Array.isArray(section.itemLabels) ? (section.itemLabels as string[]) : [];
    for (const label of labels) {
      rows.push({
        clinicId,
        sectionOrdinal: section.ordinal,
        sectionName: section.name,
        phase: phaseForOrdinal(section.ordinal),
        label,
        status: "not_started",
        maturityScore: 0,
        blocked: false,
        evidence: [],
      });
    }
  }

  if (rows.length === 0) return 0;

  const inserted = await db
    .insert(onboardingChecklistItems)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: onboardingChecklistItems.id });

  return inserted.length;
}

/* ─── Evidence ────────────────────────────────────────────────────────────── */

export type EvidenceRef = {
  key: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy?: string;
};

export async function addEvidenceToItem(
  id: number,
  evidence: EvidenceRef,
): Promise<OnboardingChecklistItem | undefined> {
  const existing = await getChecklistItemById(id);
  if (!existing) return undefined;
  const current = Array.isArray(existing.evidence) ? (existing.evidence as EvidenceRef[]) : [];
  const [row] = await db
    .update(onboardingChecklistItems)
    .set({ evidence: [...current, evidence], updatedAt: new Date() })
    .where(eq(onboardingChecklistItems.id, id))
    .returning();
  return row;
}

/* ─── Metrics + go-live gate ──────────────────────────────────────────────── */

export function computeMetrics(items: OnboardingChecklistItem[]): OnboardingMetrics {
  const total = items.length;
  const completed = items.filter((i) => i.status === "completed").length;
  const inProgress = items.filter((i) => i.status === "in_progress").length;
  const notStarted = items.filter((i) => i.status === "not_started").length;
  const blockers = items.filter((i) => i.blocked).length;
  const criticalBlockers = items.filter((i) => i.blocked && i.maturityScore <= 1).length;
  const avgMaturity = total === 0 ? 0 : items.reduce((s, i) => s + i.maturityScore, 0) / total;
  const progressPct = total === 0 ? 0 : Math.round((completed / total) * 100);

  const salesItems = items.filter((i) => i.phase === "Sales");
  const implItems = items.filter((i) => i.phase === "Implementation");
  const pctComplete = (arr: OnboardingChecklistItem[]) =>
    arr.length === 0 ? 0 : Math.round((arr.filter((i) => i.status === "completed").length / arr.length) * 100);

  const goLiveReady = progressPct >= GO_LIVE_MIN_PROGRESS_PCT && blockers === 0;

  return {
    total,
    completed,
    inProgress,
    notStarted,
    blockers,
    criticalBlockers,
    avgMaturity: Number(avgMaturity.toFixed(2)),
    progressPct,
    salesPct: pctComplete(salesItems),
    implPct: pctComplete(implItems),
    goLiveReady,
  };
}

export async function getClinicMetrics(clinicId: number): Promise<OnboardingMetrics> {
  const items = await listChecklistItems({ clinicId }, 1000);
  return computeMetrics(items);
}

/* ─── Signoffs ────────────────────────────────────────────────────────────── */

export async function listSignoffs(clinicId: number): Promise<OnboardingSignoff[]> {
  return db
    .select()
    .from(onboardingSignoffs)
    .where(eq(onboardingSignoffs.clinicId, clinicId))
    .orderBy(desc(onboardingSignoffs.createdAt));
}

export class GoLiveGateError extends Error {
  constructor(public metrics: OnboardingMetrics) {
    super("Clinic is not go-live ready: requires >= 90% progress and zero open blockers.");
    this.name = "GoLiveGateError";
  }
}

/**
 * Record an admin or owner go-live signoff. Enforces the go-live gate
 * authoritatively: throws GoLiveGateError if the clinic is not ready.
 * Upserts on (clinicId, role) so a role can re-sign without duplicates.
 */
export async function recordSignoff(
  input: InsertOnboardingSignoff & { clinicId: number },
): Promise<{ signoff: OnboardingSignoff; metrics: OnboardingMetrics }> {
  const metrics = await getClinicMetrics(input.clinicId);
  if (!metrics.goLiveReady) {
    throw new GoLiveGateError(metrics);
  }

  const [signoff] = await db
    .insert(onboardingSignoffs)
    .values(input)
    .onConflictDoUpdate({
      target: [onboardingSignoffs.clinicId, onboardingSignoffs.role],
      set: {
        signedByUserId: input.signedByUserId ?? null,
        signedByName: input.signedByName ?? null,
        notes: input.notes ?? null,
        createdAt: new Date(),
      },
    })
    .returning();

  return { signoff, metrics };
}
