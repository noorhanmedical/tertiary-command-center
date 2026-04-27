import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  billingReadinessChecks,
  type BillingReadinessCheck,
  type InsertBillingReadinessCheck,
} from "@shared/schema/billingReadiness";
import { listCaseDocumentReadiness } from "./documentReadiness.repo";
import { createPendingBillingDocumentRequestFromReadiness } from "./billingDocuments.repo";

export type ListBillingReadinessChecksFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  procedureEventId?: number;
  serviceType?: string;
  readinessStatus?: string;
};

export async function createBillingReadinessCheck(
  input: InsertBillingReadinessCheck,
): Promise<BillingReadinessCheck> {
  const [result] = await db.insert(billingReadinessChecks).values(input).returning();
  return result;
}

export async function updateBillingReadinessCheck(
  id: number,
  updates: Partial<InsertBillingReadinessCheck>,
): Promise<BillingReadinessCheck | undefined> {
  const [result] = await db
    .update(billingReadinessChecks)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(billingReadinessChecks.id, id))
    .returning();
  return result;
}

export async function getBillingReadinessCheckById(id: number): Promise<BillingReadinessCheck | undefined> {
  const [result] = await db
    .select()
    .from(billingReadinessChecks)
    .where(eq(billingReadinessChecks.id, id))
    .limit(1);
  return result;
}

export async function listBillingReadinessChecks(
  filters: ListBillingReadinessChecksFilters = {},
  limit = 100,
): Promise<BillingReadinessCheck[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.executionCaseId != null) conditions.push(eq(billingReadinessChecks.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(billingReadinessChecks.patientScreeningId, filters.patientScreeningId));
  if (filters.procedureEventId != null) conditions.push(eq(billingReadinessChecks.procedureEventId, filters.procedureEventId));
  if (filters.serviceType) conditions.push(eq(billingReadinessChecks.serviceType, filters.serviceType));
  if (filters.readinessStatus) conditions.push(eq(billingReadinessChecks.readinessStatus, filters.readinessStatus));

  const query = db.select().from(billingReadinessChecks).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(billingReadinessChecks.createdAt)).limit(safeLimit)
    : query.orderBy(desc(billingReadinessChecks.createdAt)).limit(safeLimit);
}

// ─── Billing Readiness Evaluation ─────────────────────────────────────────────

type RequiredDocRule = {
  documentType: string;
  passingStatuses: string[];
};

const REQUIRED_DOC_RULES: RequiredDocRule[] = [
  { documentType: "informed_consent",    passingStatuses: ["completed", "uploaded", "approved"] },
  { documentType: "screening_form",      passingStatuses: ["completed", "uploaded", "approved"] },
  { documentType: "report",              passingStatuses: ["uploaded", "completed", "approved"] },
  { documentType: "order_note",          passingStatuses: ["generated", "completed", "approved"] },
  { documentType: "post_procedure_note", passingStatuses: ["generated", "completed", "approved"] },
];

export type EvaluateBillingReadinessInput = {
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  procedureEventId?: number | null;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  serviceType: string;
};

/** Evaluate billing readiness for a procedure and upsert a billing_readiness_checks row.
 *  Deduplicates by (patientScreeningId, serviceType). */
export async function evaluateBillingReadinessForProcedure(
  input: EvaluateBillingReadinessInput,
): Promise<BillingReadinessCheck> {
  const docRows = await listCaseDocumentReadiness(
    {
      ...(input.patientScreeningId != null ? { patientScreeningId: input.patientScreeningId } : {}),
      ...(input.executionCaseId != null && input.patientScreeningId == null ? { executionCaseId: input.executionCaseId } : {}),
      serviceType: input.serviceType,
    },
    50,
  );

  const docStatusByType = new Map<string, string>(
    docRows.map((r) => [r.documentType, r.documentStatus]),
  );

  const missing: string[] = [];
  const evaluatedDocs: Record<string, { status: string | null; passed: boolean }> = {};

  for (const rule of REQUIRED_DOC_RULES) {
    const status = docStatusByType.get(rule.documentType) ?? null;
    const passed = status !== null && rule.passingStatuses.includes(status);
    if (!passed) missing.push(rule.documentType);
    evaluatedDocs[rule.documentType] = { status, passed };
  }

  const now = new Date();
  const readinessStatus = missing.length === 0 ? "ready_to_generate" : "missing_requirements";

  const payload = {
    executionCaseId: input.executionCaseId ?? undefined,
    procedureEventId: input.procedureEventId ?? undefined,
    patientName: input.patientName ?? undefined,
    patientDob: input.patientDob ?? undefined,
    facilityId: input.facilityId ?? undefined,
    serviceType: input.serviceType,
    readinessStatus,
    missingRequirements: missing,
    readyAt: readinessStatus === "ready_to_generate" ? now : undefined,
    metadata: { evaluatedDocs, evaluatedAt: now.toISOString() },
  };

  // Deduplicate by (patientScreeningId, serviceType)
  let existing: BillingReadinessCheck | undefined;
  if (input.patientScreeningId != null) {
    const [row] = await db
      .select()
      .from(billingReadinessChecks)
      .where(
        and(
          eq(billingReadinessChecks.patientScreeningId, input.patientScreeningId),
          eq(billingReadinessChecks.serviceType, input.serviceType),
        ),
      )
      .limit(1);
    existing = row;
  }

  let result: BillingReadinessCheck;

  if (existing) {
    const [updated] = await db
      .update(billingReadinessChecks)
      .set({ ...payload, updatedAt: now })
      .where(eq(billingReadinessChecks.id, existing.id))
      .returning();
    result = updated;
  } else {
    const [created] = await db
      .insert(billingReadinessChecks)
      .values({
        ...payload,
        patientScreeningId: input.patientScreeningId ?? undefined,
      })
      .returning();
    result = created;
  }

  if (result.readinessStatus === "ready_to_generate") {
    void createPendingBillingDocumentRequestFromReadiness(result).catch((err) => {
      console.error("[billingReadiness.repo] createPendingBillingDocumentRequestFromReadiness failed:", err);
    });
  }

  return result;
}
