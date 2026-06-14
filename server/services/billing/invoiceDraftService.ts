// invoiceDraftService — Phase 4 PR 4.4.
//
// Creates invoice drafts from an approved/ready invoice batch.
// One invoice per (facility, batch); line items mirror the
// included batch items.

import { db } from "../../db";
import { and, eq } from "drizzle-orm";
import { invoices, invoiceLineItems } from "@shared/schema/invoices";
import { invoiceBatches, invoiceBatchItems } from "@shared/schema/invoiceBatches";
import { invoiceReadinessSnapshots } from "@shared/schema/invoiceReadiness";

export type CreateDraftsFromBatchResult = {
  invoiceId: number | null;
  invoiceNumber: string | null;
  lineCount: number;
  totalCharges: number;
  reason?: string;
};

function computeInvoiceNumber(facilityId: string, periodStart: string, batchId: number, prefix: string | null, includePeriodCode: boolean): string {
  const period = includePeriodCode ? periodStart.replace(/-/g, "").slice(0, 6) : "";
  const head = prefix ?? facilityId.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
  return [head, period, `B${batchId}`].filter(Boolean).join("-");
}

function computeDueDateIso(periodEnd: string, paymentTerms: string | null, customDays: number | null): string {
  const days = (() => {
    if (paymentTerms === "due_on_receipt") return 0;
    if (paymentTerms === "net_7") return 7;
    if (paymentTerms === "net_15") return 15;
    if (paymentTerms === "net_30") return 30;
    if (paymentTerms === "custom" && customDays != null) return customDays;
    return 15;
  })();
  const start = new Date(periodEnd);
  if (Number.isNaN(start.getTime())) return periodEnd;
  start.setUTCDate(start.getUTCDate() + days);
  return start.toISOString().slice(0, 10);
}

export async function createDraftsFromBatch(
  batchId: number,
  actorUserId: string | null,
): Promise<CreateDraftsFromBatchResult> {
  const [batch] = await db.select().from(invoiceBatches).where(eq(invoiceBatches.id, batchId)).limit(1);
  if (!batch) return { invoiceId: null, invoiceNumber: null, lineCount: 0, totalCharges: 0, reason: "batch_not_found" };
  if (batch.batchStatus === "invoice_drafts_created") {
    return { invoiceId: null, invoiceNumber: null, lineCount: 0, totalCharges: 0, reason: "already_drafted" };
  }
  if (batch.batchStatus === "voided") {
    return { invoiceId: null, invoiceNumber: null, lineCount: 0, totalCharges: 0, reason: "batch_voided" };
  }

  const items = await db
    .select()
    .from(invoiceBatchItems)
    .where(and(eq(invoiceBatchItems.batchId, batchId), eq(invoiceBatchItems.lineStatus, "included")));
  if (items.length === 0) {
    return { invoiceId: null, invoiceNumber: null, lineCount: 0, totalCharges: 0, reason: "no_included_items" };
  }

  const policy = (batch.policySnapshot ?? {}) as Record<string, any>;
  const numbering = {
    prefix: (policy.numbering?.facilityPrefix ?? null) as string | null,
    includePeriodCode: (policy.numbering?.includePeriodCode ?? true) as boolean,
  };
  const paymentTerms = (policy.paymentTerms?.term ?? "net_15") as string;
  const customDays = (policy.paymentTerms?.customDays ?? null) as number | null;
  const dueDate = computeDueDateIso(batch.invoicePeriodEnd, paymentTerms, customDays);

  const invoiceNumber = computeInvoiceNumber(batch.facilityId, batch.invoicePeriodStart, batchId, numbering.prefix, numbering.includePeriodCode);
  let totalCharges = 0;
  for (const it of items) totalCharges += Number(it.price ?? 0);

  const [invoice] = await db
    .insert(invoices)
    .values({
      invoiceNumber,
      facility: batch.facilityId,
      invoiceDate: new Date().toISOString().slice(0, 10),
      fromDate: batch.invoicePeriodStart,
      toDate: batch.invoicePeriodEnd,
      status: "Draft",
      notes: null,
      totalCharges: String(totalCharges.toFixed(2)),
      initialPaid: "0",
      totalPaid: "0",
      totalBalance: String(totalCharges.toFixed(2)),
      createdByUserId: actorUserId,
      invoiceBatchId: batchId,
      approvalStatus: "pending_review",
      approvedByUserId: null,
      approvedAt: null,
      voidedAt: null,
      voidReason: null,
      policySnapshot: policy,
      recipientSnapshot: batch.recipientSnapshot as Record<string, unknown>,
      deliveryStatus: "pending",
      dueDate,
      paymentTerms,
    } as any)
    .returning();

  for (const it of items) {
    await db.insert(invoiceLineItems).values({
      invoiceId: invoice.id,
      billingRecordId: null,
      patientName: it.patientName ?? "—",
      dateOfService: it.dateOfService,
      service: it.testType,
      mrn: null,
      clinician: null,
      totalCharges: it.price ?? "0",
      paidAmount: "0",
      balanceRemaining: it.price ?? "0",
    });

    // Mark the readiness snapshot as draft-linked.
    if (it.invoiceReadinessSnapshotId != null) {
      await db
        .update(invoiceReadinessSnapshots)
        .set({
          readinessStatus: "invoice_draft_created",
          invoiceId: invoice.id,
          updatedAt: new Date(),
        })
        .where(eq(invoiceReadinessSnapshots.id, it.invoiceReadinessSnapshotId));
    }
  }

  await db.update(invoiceBatches)
    .set({ batchStatus: "invoice_drafts_created", updatedAt: new Date() })
    .where(eq(invoiceBatches.id, batchId));

  return { invoiceId: invoice.id, invoiceNumber, lineCount: items.length, totalCharges };
}
