// invoiceReadiness.repo — Phase 4 PR 4.2.
//
// Upsert snapshot by (execution_case_id, service_type). List with
// filters.

import { db } from "../db";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import {
  invoiceReadinessSnapshots,
  type InvoiceReadinessSnapshot,
  type InsertInvoiceReadinessSnapshot,
} from "@shared/schema/invoiceReadiness";

export type ListInvoiceReadinessFilters = {
  facilityId?: string;
  serviceType?: string;
  readinessStatus?: string;
  blockersIncludeAny?: string[];
  executionCaseId?: number;
  patientScreeningId?: number;
};

export async function listInvoiceReadiness(
  filters: ListInvoiceReadinessFilters = {},
  limit = 200,
): Promise<InvoiceReadinessSnapshot[]> {
  const conditions = [];
  if (filters.facilityId) conditions.push(eq(invoiceReadinessSnapshots.facilityId, filters.facilityId));
  if (filters.serviceType) conditions.push(eq(invoiceReadinessSnapshots.serviceType, filters.serviceType));
  if (filters.readinessStatus) conditions.push(eq(invoiceReadinessSnapshots.readinessStatus, filters.readinessStatus));
  if (filters.executionCaseId != null) conditions.push(eq(invoiceReadinessSnapshots.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(invoiceReadinessSnapshots.patientScreeningId, filters.patientScreeningId));

  let query = db.select().from(invoiceReadinessSnapshots).$dynamic();
  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }
  const rows = await query.orderBy(desc(invoiceReadinessSnapshots.evaluatedAt)).limit(Math.min(Math.max(1, limit), 500));

  if (filters.blockersIncludeAny && filters.blockersIncludeAny.length > 0) {
    const set = new Set(filters.blockersIncludeAny);
    return rows.filter((r) => Array.isArray(r.blockers) && (r.blockers as unknown[]).some((b) => typeof b === "string" && set.has(b)));
  }
  return rows;
}

export async function upsertInvoiceReadinessSnapshot(
  input: InsertInvoiceReadinessSnapshot & { executionCaseId: number; serviceType: string },
): Promise<InvoiceReadinessSnapshot> {
  const existing = await db
    .select()
    .from(invoiceReadinessSnapshots)
    .where(and(
      eq(invoiceReadinessSnapshots.executionCaseId, input.executionCaseId),
      eq(invoiceReadinessSnapshots.serviceType, input.serviceType),
    ))
    .limit(1);
  if (existing.length > 0) {
    const [row] = await db
      .update(invoiceReadinessSnapshots)
      .set({
        patientScreeningId: input.patientScreeningId ?? null,
        procedureEventId: input.procedureEventId ?? null,
        facilityId: input.facilityId ?? null,
        patientName: input.patientName ?? null,
        patientDob: input.patientDob ?? null,
        readinessStatus: input.readinessStatus,
        blockers: input.blockers ?? [],
        priceSnapshot: input.priceSnapshot ?? {},
        policySnapshot: input.policySnapshot ?? {},
        unitPrice: input.unitPrice ?? null,
        invoiceId: input.invoiceId ?? null,
        metadata: input.metadata ?? {},
        evaluatedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(invoiceReadinessSnapshots.id, existing[0].id))
      .returning();
    return row;
  }
  const [row] = await db.insert(invoiceReadinessSnapshots).values(input).returning();
  return row;
}

export async function listEligibleExecutionCasesForFacility(
  facilityId: string,
  limit = 500,
): Promise<Array<{ id: number; service: string | null }>> {
  // Pull execution cases in this facility that have a procedure event
  // (so there is something to potentially invoice). The engine itself
  // will filter further.
  const result = await db.execute<{ id: number; service: string }>(sql`
    SELECT DISTINCT pec.id as id, pe.service_type as service
      FROM patient_execution_cases pec
      INNER JOIN procedure_events pe ON pe.execution_case_id = pec.id
     WHERE pec.facility_id = ${facilityId}
     LIMIT ${Math.min(Math.max(1, limit), 1000)}
  `);
  return result.rows.map((r) => ({ id: r.id, service: r.service }));
}
