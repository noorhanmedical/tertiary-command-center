// Clinical Intelligence & Governance repository — server-backed replacement
// for the localStorage prototype store. All mutation semantics (audit
// entries, rule version bumps, evidence dedupe, learning→rule conversion)
// are preserved from the client prototype but now run transactionally in
// PostgreSQL so knowledge is shared across devices and team members.

import { db } from "../db";
import { desc, eq, sql, and } from "drizzle-orm";
import {
  ciLearningItems,
  ciRules,
  ciRuleVersions,
  ciEvidenceRecords,
  ciAuditEntries,
  type CiAuditEntry,
  type CiCreateLearningItemInput,
  type CiCreateRuleInput,
  type CiEvidenceRecord,
  type CiImportPayload,
  type CiLearningItem,
  type CiLearningStatus,
  type CiRecordEvidenceInput,
  type CiRule,
  type CiRuleStatus,
  type CiRuleVersion,
  type CiStoreState,
} from "@shared/schema/clinicalIntelligence";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function ciId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ───── Row → entity mappers (null → undefined for optional fields) ──────

function u<T>(v: T | null): T | undefined {
  return v === null ? undefined : v;
}

function mapLearningItem(row: typeof ciLearningItems.$inferSelect): CiLearningItem {
  return {
    id: row.id,
    instruction: row.instruction,
    ruleName: u(row.ruleName),
    triggerSource: u(row.triggerSource),
    scope: row.scope,
    affectedAncillary: row.affectedAncillary,
    affectedOutputs: row.affectedOutputs ?? [],
    evidenceRequirement: u(row.evidenceRequirement),
    approvalRequirement: u(row.approvalRequirement),
    status: row.status,
    sourcePatientId: row.sourcePatientId,
    sourcePatientName: u(row.sourcePatientName),
    sourceFacility: row.sourceFacility,
    sourceDate: row.sourceDate,
    sourceContext: row.sourceContext ?? undefined,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    convertedRuleId: row.convertedRuleId,
  };
}

function mapRule(row: typeof ciRules.$inferSelect, history: CiRuleVersion[]): CiRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    triggerSource: u(row.triggerSource),
    triggerCondition: u(row.triggerCondition),
    diagnosisTrigger: u(row.diagnosisTrigger),
    symptomTrigger: u(row.symptomTrigger),
    medicationTrigger: u(row.medicationTrigger),
    findingTrigger: u(row.findingTrigger),
    futureLabTrigger: u(row.futureLabTrigger),
    futureImagingTrigger: u(row.futureImagingTrigger),
    futureNoteTrigger: u(row.futureNoteTrigger),
    targetAncillary: row.targetAncillary,
    targetOutputs: row.targetOutputs ?? [],
    evidenceRequirement: u(row.evidenceRequirement),
    confidenceThreshold: u(row.confidenceThreshold),
    scope: row.scope,
    approvalRequirement: u(row.approvalRequirement),
    effectiveDate: row.effectiveDate,
    status: row.status,
    version: row.version,
    usageCount: row.usageCount,
    conflictFlags: row.conflictFlags ?? [],
    sourceLearningItemId: row.sourceLearningItemId,
    sourceEvidence: row.sourceEvidence ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    history,
    seeded: row.seeded || undefined,
  };
}

function mapEvidence(row: typeof ciEvidenceRecords.$inferSelect): CiEvidenceRecord {
  return {
    id: row.id,
    patientId: row.patientId,
    patientName: row.patientName,
    facility: row.facility,
    scheduleDate: row.scheduleDate,
    sourceType: row.sourceType,
    sourceText: row.sourceText,
    label: row.label,
    confidence: row.confidence,
    assignedAncillary: row.assignedAncillary,
    status: row.status,
    decidedBy: row.decidedBy,
    at: row.at,
    usedInRuleIds: row.usedInRuleIds ?? [],
  };
}

function mapAudit(row: typeof ciAuditEntries.$inferSelect): CiAuditEntry {
  return {
    id: row.id,
    at: row.at,
    by: row.by,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityName: row.entityName,
    detail: u(row.detail),
  };
}

async function insertAudit(
  tx: Tx,
  by: string,
  action: string,
  entityType: CiAuditEntry["entityType"],
  entityId: string,
  entityName: string,
  detail?: string,
): Promise<void> {
  await tx.insert(ciAuditEntries).values({
    id: ciId("aud"),
    at: new Date().toISOString(),
    by,
    action,
    entityType,
    entityId,
    entityName,
    detail: detail ?? null,
  });
}

// ───── Reads ─────────────────────────────────────────────────────────────

export async function getCiState(): Promise<CiStoreState> {
  const [learningRows, ruleRows, versionRows, evidenceRows, auditRows] = await Promise.all([
    db.select().from(ciLearningItems).orderBy(desc(ciLearningItems.createdAt)),
    db.select().from(ciRules).orderBy(desc(ciRules.createdAt)),
    db.select().from(ciRuleVersions).orderBy(ciRuleVersions.ruleId, ciRuleVersions.version),
    db.select().from(ciEvidenceRecords).orderBy(desc(ciEvidenceRecords.at)),
    db.select().from(ciAuditEntries).orderBy(desc(ciAuditEntries.at)).limit(1000),
  ]);
  const historyByRule = new Map<string, CiRuleVersion[]>();
  for (const v of versionRows) {
    const list = historyByRule.get(v.ruleId) ?? [];
    list.push({ version: v.version, at: v.at, by: v.by, summary: v.summary, status: v.status });
    historyByRule.set(v.ruleId, list);
  }
  return {
    learningItems: learningRows.map(mapLearningItem),
    rules: ruleRows.map((r) => mapRule(r, historyByRule.get(r.id) ?? [])),
    evidence: evidenceRows.map(mapEvidence),
    audit: auditRows.map(mapAudit),
  };
}

// ───── Learning items ────────────────────────────────────────────────────

const SCOPE_LABELS: Record<string, string> = {
  patient_only: "Patient only",
  clinic_draft: "Clinic draft",
  provider_draft: "Provider draft",
  global_draft: "Global draft",
};
const ANCILLARY_LABELS: Record<string, string> = {
  brainwave: "BrainWave",
  vitalwave: "VitalWave",
  ultrasound: "Ultrasound",
  multiple: "Multiple ancillaries",
  general_documentation: "General documentation logic",
};

export async function addLearningItem(input: CiCreateLearningItemInput): Promise<CiLearningItem> {
  return db.transaction(async (tx) => {
    const id = ciId("learn");
    const createdAt = new Date().toISOString();
    const [row] = await tx
      .insert(ciLearningItems)
      .values({
        id,
        instruction: input.instruction,
        ruleName: input.ruleName ?? null,
        triggerSource: input.triggerSource ?? null,
        scope: input.scope,
        affectedAncillary: input.affectedAncillary,
        affectedOutputs: input.affectedOutputs,
        evidenceRequirement: input.evidenceRequirement ?? null,
        approvalRequirement: input.approvalRequirement ?? null,
        status: input.status,
        sourcePatientId: input.sourcePatientId ?? null,
        sourcePatientName: input.sourcePatientName ?? null,
        sourceFacility: input.sourceFacility ?? null,
        sourceDate: input.sourceDate ?? null,
        sourceContext: input.sourceContext ?? null,
        createdAt,
        createdBy: input.createdBy,
        convertedRuleId: input.convertedRuleId ?? null,
      })
      .returning();
    await insertAudit(
      tx,
      input.createdBy,
      "learning_item_created",
      "learning_item",
      id,
      input.ruleName || input.instruction.slice(0, 60),
      `Scope: ${SCOPE_LABELS[input.scope] ?? input.scope} · Ancillary: ${ANCILLARY_LABELS[input.affectedAncillary] ?? input.affectedAncillary}`,
    );
    return mapLearningItem(row);
  });
}

export async function updateLearningItem(
  id: string,
  by: string,
  patch: Partial<CiCreateLearningItemInput>,
): Promise<CiLearningItem | null> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(ciLearningItems).where(eq(ciLearningItems.id, id));
    if (!existing) return null;
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) set[key] = value;
    }
    const [row] = Object.keys(set).length
      ? await tx.update(ciLearningItems).set(set).where(eq(ciLearningItems.id, id)).returning()
      : [existing];
    await insertAudit(
      tx,
      by,
      "learning_item_updated",
      "learning_item",
      id,
      existing.ruleName || existing.instruction.slice(0, 60),
    );
    return mapLearningItem(row);
  });
}

export async function setLearningStatus(
  id: string,
  by: string,
  status: CiLearningStatus,
): Promise<CiLearningItem | null> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(ciLearningItems).where(eq(ciLearningItems.id, id));
    if (!existing) return null;
    const [row] = await tx
      .update(ciLearningItems)
      .set({ status })
      .where(eq(ciLearningItems.id, id))
      .returning();
    await insertAudit(
      tx,
      by,
      `learning_item_${status}`,
      "learning_item",
      id,
      existing.ruleName || existing.instruction.slice(0, 60),
      `Status → ${status}`,
    );
    return mapLearningItem(row);
  });
}

// ───── Rules ─────────────────────────────────────────────────────────────

async function insertRuleTx(
  tx: Tx,
  input: CiCreateRuleInput,
  opts: { seeded?: boolean; auditAction?: string | null } = {},
): Promise<CiRule> {
  const id = ciId("rule");
  const now = new Date().toISOString();
  const [row] = await tx
    .insert(ciRules)
    .values({
      id,
      name: input.name,
      description: input.description,
      triggerSource: input.triggerSource ?? null,
      triggerCondition: input.triggerCondition ?? null,
      diagnosisTrigger: input.diagnosisTrigger ?? null,
      symptomTrigger: input.symptomTrigger ?? null,
      medicationTrigger: input.medicationTrigger ?? null,
      findingTrigger: input.findingTrigger ?? null,
      futureLabTrigger: input.futureLabTrigger ?? null,
      futureImagingTrigger: input.futureImagingTrigger ?? null,
      futureNoteTrigger: input.futureNoteTrigger ?? null,
      targetAncillary: input.targetAncillary,
      targetOutputs: input.targetOutputs,
      evidenceRequirement: input.evidenceRequirement ?? null,
      confidenceThreshold: input.confidenceThreshold ?? null,
      scope: input.scope,
      approvalRequirement: input.approvalRequirement ?? null,
      effectiveDate: input.effectiveDate ?? null,
      status: input.status,
      version: 1,
      usageCount: 0,
      conflictFlags: input.conflictFlags ?? [],
      sourceLearningItemId: input.sourceLearningItemId ?? null,
      sourceEvidence: input.sourceEvidence ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      seeded: opts.seeded ?? false,
    })
    .returning();
  const firstVersion: CiRuleVersion = {
    version: 1,
    at: now,
    by: input.createdBy,
    summary: opts.seeded ? "Seeded example rule" : "Rule created",
    status: input.status,
  };
  await tx.insert(ciRuleVersions).values({ ruleId: id, ...firstVersion });
  if (opts.auditAction !== null) {
    await insertAudit(tx, input.createdBy, opts.auditAction ?? "rule_created", "rule", id, input.name);
  }
  return mapRule(row, [firstVersion]);
}

export async function addRule(input: CiCreateRuleInput): Promise<CiRule> {
  return db.transaction(async (tx) => insertRuleTx(tx, input));
}

export async function updateRule(
  id: string,
  by: string,
  patch: Partial<CiCreateRuleInput>,
  changeSummary = "Rule updated",
): Promise<CiRule | null> {
  return db.transaction(async (tx) => {
    // Lock the rule row so concurrent updates can't produce duplicate
    // version numbers (same pattern as Document Library supersede).
    const [existing] = await tx
      .select()
      .from(ciRules)
      .where(eq(ciRules.id, id))
      .for("update");
    if (!existing) return null;
    const now = new Date().toISOString();
    const nextVersion = existing.version + 1;
    const nextStatus = (patch.status ?? existing.status) as CiRuleStatus;
    const set: Record<string, unknown> = { version: nextVersion, updatedAt: now };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) set[key] = value;
    }
    const [row] = await tx.update(ciRules).set(set).where(eq(ciRules.id, id)).returning();
    await tx.insert(ciRuleVersions).values({
      ruleId: id,
      version: nextVersion,
      at: now,
      by,
      summary: changeSummary,
      status: nextStatus,
    });
    await insertAudit(tx, by, "rule_updated", "rule", id, existing.name, changeSummary);
    const versions = await tx
      .select()
      .from(ciRuleVersions)
      .where(eq(ciRuleVersions.ruleId, id))
      .orderBy(ciRuleVersions.version);
    return mapRule(
      row,
      versions.map((v) => ({ version: v.version, at: v.at, by: v.by, summary: v.summary, status: v.status })),
    );
  });
}

export async function convertLearningToRule(
  learningId: string,
  by: string,
  overrides: Partial<CiCreateRuleInput> = {},
): Promise<CiRule | null> {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(ciLearningItems)
      .where(eq(ciLearningItems.id, learningId))
      .for("update");
    if (!item) return null;
    const rule = await insertRuleTx(tx, {
      name: item.ruleName || `Rule from learning: ${item.instruction.slice(0, 40)}`,
      description: item.instruction,
      triggerSource: item.triggerSource ?? undefined,
      targetAncillary: item.affectedAncillary,
      targetOutputs: item.affectedOutputs ?? [],
      evidenceRequirement: item.evidenceRequirement ?? undefined,
      scope: item.scope,
      approvalRequirement: item.approvalRequirement ?? undefined,
      status: "draft",
      conflictFlags: [],
      sourceLearningItemId: item.id,
      sourceEvidence: item.sourceContext?.evidenceLabels ?? [],
      createdBy: by,
      ...overrides,
    });
    await tx
      .update(ciLearningItems)
      .set({ status: "converted", convertedRuleId: rule.id })
      .where(eq(ciLearningItems.id, learningId));
    return rule;
  });
}

// ───── Evidence ──────────────────────────────────────────────────────────

export async function recordEvidence(input: CiRecordEvidenceInput): Promise<CiEvidenceRecord> {
  return db.transaction(async (tx) => {
    // Dedupe: same patient + label (case-insensitive) + sourceType keeps
    // the latest decision, but merges forward the prior assigned ancillary
    // and rule usage so an approve after an attach (or vice versa) never
    // loses traceability.
    const patientMatch =
      input.patientId === null
        ? sql`${ciEvidenceRecords.patientId} IS NULL`
        : eq(ciEvidenceRecords.patientId, input.patientId);
    const priorRows = await tx
      .select()
      .from(ciEvidenceRecords)
      .where(
        and(
          patientMatch,
          sql`LOWER(${ciEvidenceRecords.label}) = LOWER(${input.label})`,
          eq(ciEvidenceRecords.sourceType, input.sourceType),
        ),
      )
      .for("update");
    const prior = priorRows[0];
    const id = ciId("ev");
    const at = new Date().toISOString();
    const usedInRuleIds = prior ? prior.usedInRuleIds ?? [] : [];
    const assignedAncillary = input.assignedAncillary ?? prior?.assignedAncillary ?? null;
    if (priorRows.length > 0) {
      for (const p of priorRows) {
        await tx.delete(ciEvidenceRecords).where(eq(ciEvidenceRecords.id, p.id));
      }
    }
    const [row] = await tx
      .insert(ciEvidenceRecords)
      .values({
        id,
        patientId: input.patientId,
        patientName: input.patientName,
        facility: input.facility ?? null,
        scheduleDate: input.scheduleDate ?? null,
        sourceType: input.sourceType,
        sourceText: input.sourceText,
        label: input.label,
        confidence: input.confidence,
        assignedAncillary,
        status: input.status,
        decidedBy: input.decidedBy,
        at,
        usedInRuleIds,
      })
      .returning();
    await insertAudit(
      tx,
      input.decidedBy,
      input.status === "approved" ? "evidence_approved" : "evidence_rejected",
      "evidence",
      id,
      input.label,
      `${input.sourceType} · ${input.patientName}`,
    );
    return mapEvidence(row);
  });
}

export async function markEvidenceUsedInRule(evidenceId: string, ruleId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(ciEvidenceRecords)
      .where(eq(ciEvidenceRecords.id, evidenceId))
      .for("update");
    if (!row) return;
    const ids = row.usedInRuleIds ?? [];
    if (ids.includes(ruleId)) return;
    await tx
      .update(ciEvidenceRecords)
      .set({ usedInRuleIds: [...ids, ruleId] })
      .where(eq(ciEvidenceRecords.id, evidenceId));
  });
}

// ───── Seeding ───────────────────────────────────────────────────────────

// Server-side copy of the client prototype's seeded governance rules
// (formerly `seededRules()` in client/src/lib/clinicalIntelligence/seeds.ts).
// Inserted once when the rules table is empty so the governance page is
// workable out of the box; editable like any other rule, marked seeded.
const SEED_RULES: Omit<CiCreateRuleInput, "createdBy">[] = [
  {
    name: "Diabetic neuropathy → VitalWave support",
    description:
      "IF diagnosis includes diabetic neuropathy AND symptom includes burning feet or leg pain OR medication includes gabapentin THEN suggest VitalWave AND use approved source-linked evidence in downstream documentation AND require Admin Review before finalization.",
    triggerSource: "DX + HX + RX",
    triggerCondition: "diagnosis: diabetic neuropathy AND (symptom: burning feet | leg pain OR medication: gabapentin)",
    diagnosisTrigger: "Diabetic neuropathy (E11.42)",
    symptomTrigger: "Burning feet, leg pain",
    medicationTrigger: "Gabapentin",
    targetAncillary: "vitalwave",
    targetOutputs: ["ancillary_assignment", "medical_necessity", "order_note", "audit_support"],
    evidenceRequirement: "At least one source-linked HX/DX/RX item",
    confidenceThreshold: "medium",
    scope: "global_draft",
    approvalRequirement: "Admin Review before finalization",
    status: "active",
  },
  {
    name: "Cerebrovascular history → BrainWave support",
    description:
      "IF history includes stroke or TIA AND symptom includes dizziness, memory change, or falls THEN suggest BrainWave with source-linked evidence, requiring Admin Review.",
    triggerSource: "HX + DX",
    triggerCondition: "history: stroke | TIA AND symptom: dizziness | memory change | falls",
    diagnosisTrigger: "Stroke history (Z86.73)",
    symptomTrigger: "Dizziness, memory change, falls",
    targetAncillary: "brainwave",
    targetOutputs: ["ancillary_assignment", "medical_necessity", "order_note", "audit_support"],
    evidenceRequirement: "Documented cerebrovascular history",
    confidenceThreshold: "medium",
    scope: "global_draft",
    approvalRequirement: "Admin Review before finalization",
    status: "active",
  },
  {
    name: "Claudication → lower-extremity arterial duplex support",
    description:
      "IF symptom includes claudication or exertional leg pain THEN suggest Lower Extremity Arterial Doppler with documented symptom detail (distance, laterality) per LCD expectations.",
    triggerSource: "HX",
    triggerCondition: "symptom: claudication | exertional leg pain",
    symptomTrigger: "Claudication, exertional leg pain",
    targetAncillary: "ultrasound",
    targetOutputs: ["ancillary_assignment", "medical_necessity", "order_note", "evidence_traceability"],
    evidenceRequirement: "Symptom detail incl. distance/laterality",
    confidenceThreshold: "high",
    scope: "global_draft",
    approvalRequirement: "Physician review",
    status: "pending_physician_review",
  },
  {
    name: "Donepezil → cognitive assessment context",
    description:
      "IF medication includes donepezil or memantine THEN treat as memory/cognitive diagnosis clue supporting BrainWave context; requires corroborating HX/DX before assignment.",
    triggerSource: "RX",
    triggerCondition: "medication: donepezil | memantine",
    medicationTrigger: "Donepezil, memantine",
    targetAncillary: "brainwave",
    targetOutputs: ["diagnosis_mapping", "evidence_traceability"],
    evidenceRequirement: "Corroborating HX or DX required",
    confidenceThreshold: "medium",
    scope: "clinic_draft",
    approvalRequirement: "Compliance review",
    status: "pending_compliance_review",
  },
];

export async function seedCiRulesIfEmpty(): Promise<void> {
  await db.transaction(async (tx) => {
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(ciRules);
    if (count > 0) return;
    for (const seed of SEED_RULES) {
      await insertRuleTx(tx, { ...seed, createdBy: "System (seed)" }, { seeded: true, auditAction: null });
    }
  });
}

// ───── One-time localStorage import ──────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export async function importCiState(payload: CiImportPayload): Promise<{
  learningItems: number;
  rules: number;
  evidence: number;
  audit: number;
}> {
  const result = { learningItems: 0, rules: 0, evidence: 0, audit: 0 };
  await db.transaction(async (tx) => {
    const nowIso = new Date().toISOString();
    for (const raw of payload.learningItems ?? []) {
      const id = str(raw.id);
      const instruction = str(raw.instruction);
      if (!id || !instruction) continue;
      const inserted = await tx
        .insert(ciLearningItems)
        .values({
          id,
          instruction,
          ruleName: str(raw.ruleName),
          triggerSource: str(raw.triggerSource),
          scope: (str(raw.scope) as CiLearningItem["scope"]) ?? "patient_only",
          affectedAncillary:
            (str(raw.affectedAncillary) as CiLearningItem["affectedAncillary"]) ?? "general_documentation",
          affectedOutputs: strArr(raw.affectedOutputs) as CiLearningItem["affectedOutputs"],
          evidenceRequirement: str(raw.evidenceRequirement),
          approvalRequirement: str(raw.approvalRequirement),
          status: (str(raw.status) as CiLearningStatus) ?? "draft",
          sourcePatientId: num(raw.sourcePatientId),
          sourcePatientName: str(raw.sourcePatientName),
          sourceFacility: str(raw.sourceFacility),
          sourceDate: str(raw.sourceDate),
          sourceContext:
            raw.sourceContext && typeof raw.sourceContext === "object"
              ? (raw.sourceContext as CiLearningItem["sourceContext"])
              : null,
          createdAt: str(raw.createdAt) ?? nowIso,
          createdBy: str(raw.createdBy) ?? "Imported",
          convertedRuleId: str(raw.convertedRuleId),
        })
        .onConflictDoNothing()
        .returning({ id: ciLearningItems.id });
      result.learningItems += inserted.length;
    }
    for (const raw of payload.rules ?? []) {
      const id = str(raw.id);
      const name = str(raw.name);
      if (!id || !name) continue;
      // Skip browser-local seed copies — the server seeds its own set, so
      // importing per-browser seeded rules would just create duplicates.
      if (raw.seeded === true) continue;
      const status = (str(raw.status) as CiRuleStatus) ?? "draft";
      const createdAt = str(raw.createdAt) ?? nowIso;
      const inserted = await tx
        .insert(ciRules)
        .values({
          id,
          name,
          description: str(raw.description) ?? "",
          triggerSource: str(raw.triggerSource),
          triggerCondition: str(raw.triggerCondition),
          diagnosisTrigger: str(raw.diagnosisTrigger),
          symptomTrigger: str(raw.symptomTrigger),
          medicationTrigger: str(raw.medicationTrigger),
          findingTrigger: str(raw.findingTrigger),
          futureLabTrigger: str(raw.futureLabTrigger),
          futureImagingTrigger: str(raw.futureImagingTrigger),
          futureNoteTrigger: str(raw.futureNoteTrigger),
          targetAncillary:
            (str(raw.targetAncillary) as CiRule["targetAncillary"]) ?? "general_documentation",
          targetOutputs: strArr(raw.targetOutputs) as CiRule["targetOutputs"],
          evidenceRequirement: str(raw.evidenceRequirement),
          confidenceThreshold: str(raw.confidenceThreshold) as CiRule["confidenceThreshold"] ?? null,
          scope: (str(raw.scope) as CiRule["scope"]) ?? "clinic_draft",
          approvalRequirement: str(raw.approvalRequirement),
          effectiveDate: str(raw.effectiveDate),
          status,
          version: num(raw.version) ?? 1,
          usageCount: num(raw.usageCount) ?? 0,
          conflictFlags: strArr(raw.conflictFlags),
          sourceLearningItemId: str(raw.sourceLearningItemId),
          sourceEvidence: Array.isArray(raw.sourceEvidence) ? strArr(raw.sourceEvidence) : null,
          createdAt,
          updatedAt: str(raw.updatedAt) ?? createdAt,
          createdBy: str(raw.createdBy) ?? "Imported",
          seeded: false,
        })
        .onConflictDoNothing()
        .returning({ id: ciRules.id });
      if (inserted.length === 0) continue;
      result.rules += 1;
      const history = Array.isArray(raw.history) ? raw.history : [];
      const versionRows = history
        .map((h: unknown) => {
          if (!h || typeof h !== "object") return null;
          const v = h as Record<string, unknown>;
          const version = num(v.version);
          if (version === null) return null;
          return {
            ruleId: id,
            version,
            at: str(v.at) ?? createdAt,
            by: str(v.by) ?? "Imported",
            summary: str(v.summary) ?? "Imported version",
            status: (str(v.status) as CiRuleStatus) ?? status,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);
      if (versionRows.length === 0) {
        versionRows.push({
          ruleId: id,
          version: num(raw.version) ?? 1,
          at: createdAt,
          by: str(raw.createdBy) ?? "Imported",
          summary: "Imported rule",
          status,
        });
      }
      await tx.insert(ciRuleVersions).values(versionRows).onConflictDoNothing();
    }
    for (const raw of payload.evidence ?? []) {
      const id = str(raw.id);
      const label = str(raw.label);
      if (!id || !label) continue;
      const inserted = await tx
        .insert(ciEvidenceRecords)
        .values({
          id,
          patientId: num(raw.patientId),
          patientName: str(raw.patientName) ?? "Unknown patient",
          facility: str(raw.facility),
          scheduleDate: str(raw.scheduleDate),
          sourceType: (str(raw.sourceType) as CiEvidenceRecord["sourceType"]) ?? "HX",
          sourceText: str(raw.sourceText) ?? label,
          label,
          confidence: (str(raw.confidence) as CiEvidenceRecord["confidence"]) ?? "medium",
          assignedAncillary: str(raw.assignedAncillary),
          status: raw.status === "rejected" ? "rejected" : "approved",
          decidedBy: str(raw.decidedBy) ?? "Imported",
          at: str(raw.at) ?? nowIso,
          usedInRuleIds: strArr(raw.usedInRuleIds),
        })
        .onConflictDoNothing()
        .returning({ id: ciEvidenceRecords.id });
      result.evidence += inserted.length;
    }
    for (const raw of payload.audit ?? []) {
      const id = str(raw.id);
      const action = str(raw.action);
      if (!id || !action) continue;
      const entityType = str(raw.entityType);
      if (entityType !== "rule" && entityType !== "learning_item" && entityType !== "evidence") continue;
      const inserted = await tx
        .insert(ciAuditEntries)
        .values({
          id,
          at: str(raw.at) ?? nowIso,
          by: str(raw.by) ?? "Imported",
          action,
          entityType,
          entityId: str(raw.entityId) ?? "",
          entityName: str(raw.entityName) ?? "",
          detail: str(raw.detail),
        })
        .onConflictDoNothing()
        .returning({ id: ciAuditEntries.id });
      result.audit += inserted.length;
    }
  });
  return result;
}
