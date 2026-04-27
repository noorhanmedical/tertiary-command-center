import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  documentRequirements,
  caseDocumentReadiness,
  type DocumentRequirement,
  type InsertDocumentRequirement,
  type CaseDocumentReadiness,
  type InsertCaseDocumentReadiness,
} from "@shared/schema/documentReadiness";

// ─── Document Requirements ────────────────────────────────────────────────────

export type ListDocumentRequirementsFilters = {
  serviceType?: string;
  documentType?: string;
  facilityId?: string;
  trigger?: string;
  active?: boolean;
};

export async function createDocumentRequirement(
  input: InsertDocumentRequirement,
): Promise<DocumentRequirement> {
  const [result] = await db
    .insert(documentRequirements)
    .values(input)
    .returning();
  return result;
}

export async function updateDocumentRequirement(
  id: number,
  updates: Partial<InsertDocumentRequirement>,
): Promise<DocumentRequirement | undefined> {
  const [result] = await db
    .update(documentRequirements)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(documentRequirements.id, id))
    .returning();
  return result;
}

export async function getDocumentRequirementById(id: number): Promise<DocumentRequirement | undefined> {
  const [result] = await db
    .select()
    .from(documentRequirements)
    .where(eq(documentRequirements.id, id))
    .limit(1);
  return result;
}

export async function listDocumentRequirements(
  filters: ListDocumentRequirementsFilters = {},
  limit = 100,
): Promise<DocumentRequirement[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.serviceType) conditions.push(eq(documentRequirements.serviceType, filters.serviceType));
  if (filters.documentType) conditions.push(eq(documentRequirements.documentType, filters.documentType));
  if (filters.facilityId) conditions.push(eq(documentRequirements.facilityId, filters.facilityId));
  if (filters.trigger) conditions.push(eq(documentRequirements.trigger, filters.trigger));
  if (filters.active !== undefined) conditions.push(eq(documentRequirements.active, filters.active));

  const query = db.select().from(documentRequirements).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(documentRequirements.createdAt)).limit(safeLimit)
    : query.orderBy(desc(documentRequirements.createdAt)).limit(safeLimit);
}

// ─── Case Document Readiness ──────────────────────────────────────────────────

export type ListCaseDocumentReadinessFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  facilityId?: string;
  serviceType?: string;
  documentType?: string;
  documentStatus?: string;
  blocksBilling?: boolean;
};

export async function createCaseDocumentReadiness(
  input: InsertCaseDocumentReadiness,
): Promise<CaseDocumentReadiness> {
  const [result] = await db
    .insert(caseDocumentReadiness)
    .values(input)
    .returning();
  return result;
}

export async function updateCaseDocumentReadiness(
  id: number,
  updates: Partial<InsertCaseDocumentReadiness>,
): Promise<CaseDocumentReadiness | undefined> {
  const [result] = await db
    .update(caseDocumentReadiness)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(caseDocumentReadiness.id, id))
    .returning();
  return result;
}

export async function getCaseDocumentReadinessById(id: number): Promise<CaseDocumentReadiness | undefined> {
  const [result] = await db
    .select()
    .from(caseDocumentReadiness)
    .where(eq(caseDocumentReadiness.id, id))
    .limit(1);
  return result;
}

export async function listCaseDocumentReadiness(
  filters: ListCaseDocumentReadinessFilters = {},
  limit = 100,
): Promise<CaseDocumentReadiness[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.executionCaseId != null) conditions.push(eq(caseDocumentReadiness.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(caseDocumentReadiness.patientScreeningId, filters.patientScreeningId));
  if (filters.facilityId) conditions.push(eq(caseDocumentReadiness.facilityId, filters.facilityId));
  if (filters.serviceType) conditions.push(eq(caseDocumentReadiness.serviceType, filters.serviceType));
  if (filters.documentType) conditions.push(eq(caseDocumentReadiness.documentType, filters.documentType));
  if (filters.documentStatus) conditions.push(eq(caseDocumentReadiness.documentStatus, filters.documentStatus));
  if (filters.blocksBilling !== undefined) conditions.push(eq(caseDocumentReadiness.blocksBilling, filters.blocksBilling));

  const query = db.select().from(caseDocumentReadiness).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(caseDocumentReadiness.createdAt)).limit(safeLimit)
    : query.orderBy(desc(caseDocumentReadiness.createdAt)).limit(safeLimit);
}

// documentType → { documentStatus, blocksBilling } defaults on procedure complete
const PROCEDURE_COMPLETE_DOCUMENT_DEFAULTS: Array<{
  documentType: string;
  documentStatus: string;
  blocksBilling: boolean;
}> = [
  { documentType: "order_note",           documentStatus: "pending",  blocksBilling: false },
  { documentType: "post_procedure_note",  documentStatus: "pending",  blocksBilling: false },
  { documentType: "report",               documentStatus: "missing",  blocksBilling: false },
  { documentType: "informed_consent",     documentStatus: "missing",  blocksBilling: false },
  { documentType: "screening_form",       documentStatus: "missing",  blocksBilling: false },
  { documentType: "billing_document",     documentStatus: "blocked",  blocksBilling: true  },
];

export type UpsertDocumentReadinessForProcedureInput = {
  executionCaseId: number | null;
  patientScreeningId: number | null;
  patientName: string | null;
  patientDob: string | null;
  facilityId: string | null;
  serviceType: string;
};

/** Create or update the standard document readiness rows triggered by procedure completion.
 *  Deduplicates by (patientScreeningId, serviceType, documentType). */
export async function upsertCaseDocumentReadinessForProcedureComplete(
  input: UpsertDocumentReadinessForProcedureInput,
): Promise<CaseDocumentReadiness[]> {
  const results: CaseDocumentReadiness[] = [];

  for (const def of PROCEDURE_COMPLETE_DOCUMENT_DEFAULTS) {
    const conditions = [
      eq(caseDocumentReadiness.serviceType, input.serviceType),
      eq(caseDocumentReadiness.documentType, def.documentType),
    ];
    if (input.patientScreeningId != null) {
      conditions.push(eq(caseDocumentReadiness.patientScreeningId, input.patientScreeningId));
    }

    const [existing] = await db
      .select()
      .from(caseDocumentReadiness)
      .where(and(...conditions))
      .limit(1);

    const payload = {
      executionCaseId: input.executionCaseId ?? undefined,
      patientName: input.patientName ?? undefined,
      patientDob: input.patientDob ?? undefined,
      facilityId: input.facilityId ?? undefined,
      serviceType: input.serviceType,
      documentType: def.documentType,
      documentStatus: def.documentStatus,
      blocksBilling: def.blocksBilling,
    };

    if (existing) {
      const [updated] = await db
        .update(caseDocumentReadiness)
        .set({ ...payload, updatedAt: new Date() })
        .where(eq(caseDocumentReadiness.id, existing.id))
        .returning();
      results.push(updated);
    } else {
      const [created] = await db
        .insert(caseDocumentReadiness)
        .values({
          ...payload,
          patientScreeningId: input.patientScreeningId ?? undefined,
        })
        .returning();
      results.push(created);
    }
  }

  return results;
}
