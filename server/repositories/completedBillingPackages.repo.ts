import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  completedBillingPackages,
  type CompletedBillingPackage,
  type InsertCompletedBillingPackage,
} from "@shared/schema/completedBillingPackages";
import { invoices, invoiceLineItems, type InvoiceLineItem } from "@shared/schema/invoices";

export type ListCompletedBillingPackagesFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  procedureEventId?: number;
  billingReadinessCheckId?: number;
  billingDocumentRequestId?: number;
  facilityId?: string;
  serviceType?: string;
  packageStatus?: string;
  paymentStatus?: string;
};

export async function createCompletedBillingPackage(
  input: InsertCompletedBillingPackage,
): Promise<CompletedBillingPackage> {
  const [result] = await db.insert(completedBillingPackages).values(input).returning();
  return result;
}

export async function updateCompletedBillingPackage(
  id: number,
  updates: Partial<InsertCompletedBillingPackage>,
): Promise<CompletedBillingPackage | undefined> {
  const [result] = await db
    .update(completedBillingPackages)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(completedBillingPackages.id, id))
    .returning();
  return result;
}

export async function getCompletedBillingPackageById(id: number): Promise<CompletedBillingPackage | undefined> {
  const [result] = await db
    .select()
    .from(completedBillingPackages)
    .where(eq(completedBillingPackages.id, id))
    .limit(1);
  return result;
}

export type UpdatePaymentInput = {
  fullAmountPaid: string;
  paymentDate?: string | null;
  paymentStatus?: string;
  note?: string | null;
  metadata?: Record<string, unknown>;
  paymentUpdatedByUserId?: string | null;
};

export async function updateCompletedBillingPackagePayment(
  id: number,
  input: UpdatePaymentInput,
): Promise<CompletedBillingPackage | undefined> {
  const existing = await getCompletedBillingPackageById(id);
  if (!existing) return undefined;

  const now = new Date();
  const mergedMetadata: Record<string, unknown> = {
    ...(typeof existing.metadata === "object" && existing.metadata !== null ? existing.metadata as Record<string, unknown> : {}),
    ...(input.metadata ?? {}),
    ...(input.note != null ? { paymentNote: input.note } : {}),
  };

  const [result] = await db
    .update(completedBillingPackages)
    .set({
      fullAmountPaid: input.fullAmountPaid,
      paymentDate: input.paymentDate ?? undefined,
      paymentStatus: input.paymentStatus ?? "updated",
      packageStatus: "completed_package",
      paymentUpdatedAt: now,
      paymentUpdatedByUserId: input.paymentUpdatedByUserId ?? undefined,
      metadata: mergedMetadata,
      updatedAt: now,
    })
    .where(eq(completedBillingPackages.id, id))
    .returning();

  if (result) {
    void addCompletedPackageToInvoice(result).catch((err) => {
      console.error("[completedBillingPackages.repo] addCompletedPackageToInvoice failed:", err);
    });
  }

  return result;
}

const OUR_PORTION_PERCENTAGE = 50;

/** Add the completed billing package as an invoice line item on the most recent
 *  Draft invoice for the same facility. Idempotent — tracks the created
 *  invoiceLineItemId in the package metadata to avoid duplicate rows.
 *  Exported so callers that need to await the line-item insert (rather than
 *  rely on the fire-and-forget call in updateCompletedBillingPackagePayment)
 *  can do so directly. */
export async function addCompletedPackageToInvoice(
  pkg: CompletedBillingPackage,
): Promise<{ lineItem: InvoiceLineItem; invoiceId: number } | null> {
  if (!pkg.facilityId || !pkg.fullAmountPaid) return null;

  const meta = (typeof pkg.metadata === "object" && pkg.metadata !== null
    ? pkg.metadata as Record<string, unknown>
    : {});

  const totalAmount = parseFloat(pkg.fullAmountPaid);
  if (isNaN(totalAmount) || totalAmount <= 0) return null;

  const ourPortion = (totalAmount * OUR_PORTION_PERCENTAGE) / 100;
  const remaining = totalAmount - ourPortion;

  // If already linked to a line item, update it in place
  const existingLineItemId = typeof meta.invoiceLineItemId === "number" ? meta.invoiceLineItemId : null;
  if (existingLineItemId !== null) {
    const [updated] = await db
      .update(invoiceLineItems)
      .set({
        patientName: pkg.patientInitials ?? pkg.patientName ?? "",
        dateOfService: pkg.dos ?? undefined,
        service: pkg.serviceType,
        totalCharges: totalAmount.toFixed(2),
        paidAmount: ourPortion.toFixed(2),
        balanceRemaining: remaining.toFixed(2),
      })
      .where(eq(invoiceLineItems.id, existingLineItemId))
      .returning();
    if (updated) {
      const [inv] = await db.select({ id: invoices.id }).from(invoices)
        .where(eq(invoices.id, updated.invoiceId)).limit(1);
      const resolvedInvoiceId = inv?.id ?? updated.invoiceId;
      await recomputeInvoiceTotalsFromLineItems(resolvedInvoiceId);
      return { lineItem: updated, invoiceId: resolvedInvoiceId };
    }
  }

  // Find the most recent Draft invoice for this facility
  const [draftInvoice] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.facility, pkg.facilityId), eq(invoices.status, "Draft")))
    .orderBy(desc(invoices.createdAt))
    .limit(1);

  if (!draftInvoice) return null;

  const [lineItem] = await db
    .insert(invoiceLineItems)
    .values({
      invoiceId: draftInvoice.id,
      patientName: pkg.patientInitials ?? pkg.patientName ?? "",
      dateOfService: pkg.dos ?? undefined,
      service: pkg.serviceType,
      totalCharges: totalAmount.toFixed(2),
      paidAmount: ourPortion.toFixed(2),
      balanceRemaining: remaining.toFixed(2),
    })
    .returning();

  // Store idempotency key and mark package as added_to_invoice
  await db
    .update(completedBillingPackages)
    .set({
      packageStatus: "added_to_invoice",
      metadata: { ...meta, invoiceLineItemId: lineItem.id, invoiceId: draftInvoice.id },
      updatedAt: new Date(),
    })
    .where(eq(completedBillingPackages.id, pkg.id));

  // Refresh parent invoice's totalCharges + totalBalance now that a line item
  // has been added. We deliberately do NOT touch totalPaid — that field is
  // driven by invoice_payments via the existing recompute helper, and the
  // canonical package flow doesn't write payments here.
  await recomputeInvoiceTotalsFromLineItems(draftInvoice.id);

  return { lineItem, invoiceId: draftInvoice.id };
}

/** Recompute invoice.totalCharges = sum(line_items.totalCharges) and
 *  invoice.totalBalance = totalCharges - current totalPaid. Idempotent —
 *  safe to call after every line-item insert/update. Leaves totalPaid alone
 *  (driven separately by invoice_payments + initialPaid via the existing
 *  recompute path on the invoices repository). */
async function recomputeInvoiceTotalsFromLineItems(invoiceId: number): Promise<void> {
  const lines = await db
    .select({ totalCharges: invoiceLineItems.totalCharges })
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId));

  let totalCharges = 0;
  for (const li of lines) {
    if (li.totalCharges == null) continue;
    const v = parseFloat(li.totalCharges);
    if (Number.isFinite(v)) totalCharges += v;
  }

  const [inv] = await db
    .select({ totalPaid: invoices.totalPaid })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv) return;

  const totalPaid = parseFloat(inv.totalPaid) || 0;
  const totalBalance = totalCharges - totalPaid;

  await db
    .update(invoices)
    .set({
      totalCharges: totalCharges.toFixed(2),
      totalBalance: totalBalance.toFixed(2),
    })
    .where(eq(invoices.id, invoiceId));
}

export async function listCompletedBillingPackages(
  filters: ListCompletedBillingPackagesFilters = {},
  limit = 100,
): Promise<CompletedBillingPackage[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.executionCaseId != null) conditions.push(eq(completedBillingPackages.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(completedBillingPackages.patientScreeningId, filters.patientScreeningId));
  if (filters.procedureEventId != null) conditions.push(eq(completedBillingPackages.procedureEventId, filters.procedureEventId));
  if (filters.billingReadinessCheckId != null) conditions.push(eq(completedBillingPackages.billingReadinessCheckId, filters.billingReadinessCheckId));
  if (filters.billingDocumentRequestId != null) conditions.push(eq(completedBillingPackages.billingDocumentRequestId, filters.billingDocumentRequestId));
  if (filters.facilityId) conditions.push(eq(completedBillingPackages.facilityId, filters.facilityId));
  if (filters.serviceType) conditions.push(eq(completedBillingPackages.serviceType, filters.serviceType));
  if (filters.packageStatus) conditions.push(eq(completedBillingPackages.packageStatus, filters.packageStatus));
  if (filters.paymentStatus) conditions.push(eq(completedBillingPackages.paymentStatus, filters.paymentStatus));

  const query = db.select().from(completedBillingPackages).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(completedBillingPackages.createdAt)).limit(safeLimit)
    : query.orderBy(desc(completedBillingPackages.createdAt)).limit(safeLimit);
}
