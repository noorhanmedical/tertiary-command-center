// billingAuditorWorklistService — Phase 4 PR 4.7.
//
// Read-only aggregation over canonical Phase 4 tables. No new
// writes; the worklist is a structured view across:
//   - invoice_readiness_snapshots
//   - invoice_batches
//   - invoices (approval + delivery)
//   - invoice_denials
//   - invoice_delivery_events
//
// Each queue maps to a stable id so the UI can render tabs.

import { db } from "../../db";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { invoiceReadinessSnapshots } from "@shared/schema/invoiceReadiness";
import { invoices } from "@shared/schema/invoices";
import { invoiceDenials } from "@shared/schema/invoiceFinancialEvents";
import { invoiceDeliveryEvents } from "@shared/schema/invoiceDelivery";

export const WORKLIST_QUEUE_IDS = [
  "ready_to_invoice",
  "blocked_missing_report",
  "blocked_missing_order_note",
  "blocked_missing_procedure_note",
  "physician_signature_pending",
  "insurance_verification_pending",
  "missing_price",
  "missing_recipient",
  "invoice_draft_needs_review",
  "invoice_approved_ready_to_send",
  "invoice_delivery_failed",
  "payment_overdue",
  "denial_open",
  "reminder_due",
] as const;
export type WorklistQueueId = (typeof WORKLIST_QUEUE_IDS)[number];

export type WorklistItem = {
  queueId: WorklistQueueId;
  itemId: number;
  invoiceId?: number | null;
  patientName?: string | null;
  facilityId?: string | null;
  testType?: string | null;
  label: string;
  reason?: string;
  detail?: string;
  createdAt?: string | null;
};

export type WorklistSummary = Record<WorklistQueueId, number>;

const READINESS_BLOCKER_TO_QUEUE: Partial<Record<string, WorklistQueueId>> = {
  missing_report: "blocked_missing_report",
  missing_order_note: "blocked_missing_order_note",
  missing_procedure_note: "blocked_missing_procedure_note",
  physician_signature_pending: "physician_signature_pending",
  insurance_verification_pending: "insurance_verification_pending",
  missing_price: "missing_price",
  missing_recipient: "missing_recipient",
};

export async function getWorklistSummary(facilityId?: string | null): Promise<WorklistSummary> {
  const sum: WorklistSummary = WORKLIST_QUEUE_IDS.reduce((acc, k) => ({ ...acc, [k]: 0 }), {} as WorklistSummary);

  const readyConditions = [eq(invoiceReadinessSnapshots.readinessStatus, "ready_to_invoice")];
  const blockedConditions = [eq(invoiceReadinessSnapshots.readinessStatus, "blocked")];
  if (facilityId) {
    readyConditions.push(eq(invoiceReadinessSnapshots.facilityId, facilityId));
    blockedConditions.push(eq(invoiceReadinessSnapshots.facilityId, facilityId));
  }
  const [ready, blocked] = await Promise.all([
    db.select().from(invoiceReadinessSnapshots).where(and(...readyConditions)),
    db.select().from(invoiceReadinessSnapshots).where(and(...blockedConditions)),
  ]);
  sum.ready_to_invoice = ready.length;
  for (const b of blocked) {
    const list = Array.isArray(b.blockers) ? (b.blockers as unknown[]) : [];
    for (const code of list) {
      if (typeof code !== "string") continue;
      const q = READINESS_BLOCKER_TO_QUEUE[code];
      if (q) sum[q] += 1;
    }
  }

  // invoice approval/delivery state.
  const invConditions = facilityId ? [eq(invoices.facility, facilityId)] : [];
  const invList = await (invConditions.length > 0
    ? db.select().from(invoices).where(and(...invConditions))
    : db.select().from(invoices));
  for (const i of invList) {
    const approval = (i as any).approvalStatus as string | undefined;
    const delivery = (i as any).deliveryStatus as string | undefined;
    if (approval === "pending_review") sum.invoice_draft_needs_review += 1;
    if (approval === "approved" && delivery === "ready_to_send") sum.invoice_approved_ready_to_send += 1;
    if (delivery === "failed") sum.invoice_delivery_failed += 1;
    if (i.status === "Sent" || i.status === "Partially Paid") {
      const due = (i as any).dueDate as string | null;
      if (due) {
        const dueDate = new Date(due);
        if (!Number.isNaN(dueDate.getTime()) && dueDate.getTime() < Date.now()) {
          sum.payment_overdue += 1;
        }
      }
      const last = (i as any).lastRemindedAt as Date | string | null;
      const lastTime = last ? new Date(last as any).getTime() : 0;
      const terms = (i as any).paymentTerms ?? "net_15";
      const reminderDays = 7; // fallback; policy bundle reminderIntervalDays could override per facility
      if (lastTime + reminderDays * 24 * 3600 * 1000 < Date.now()) {
        sum.reminder_due += 1;
      }
    }
  }

  // open denials.
  const denialConditions = [eq(invoiceDenials.status, "open")];
  const denials = await db.select().from(invoiceDenials).where(and(...denialConditions));
  sum.denial_open = denials.length;

  return sum;
}

export async function getWorklistItems(
  queueId: WorklistQueueId,
  facilityId?: string | null,
  limit = 200,
): Promise<WorklistItem[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);

  if (queueId === "ready_to_invoice") {
    const conditions = [eq(invoiceReadinessSnapshots.readinessStatus, "ready_to_invoice")];
    if (facilityId) conditions.push(eq(invoiceReadinessSnapshots.facilityId, facilityId));
    const rows = await db.select().from(invoiceReadinessSnapshots).where(and(...conditions)).orderBy(desc(invoiceReadinessSnapshots.evaluatedAt)).limit(safeLimit);
    return rows.map((r) => ({
      queueId,
      itemId: r.id,
      invoiceId: r.invoiceId,
      patientName: r.patientName,
      facilityId: r.facilityId,
      testType: r.serviceType,
      label: r.patientName ?? `Case #${r.executionCaseId}`,
      reason: "ready to invoice",
      createdAt: (r.evaluatedAt as unknown as string) ?? null,
    }));
  }

  if (queueId === "invoice_draft_needs_review" || queueId === "invoice_approved_ready_to_send" || queueId === "invoice_delivery_failed") {
    const allInvoices = await (facilityId
      ? db.select().from(invoices).where(eq(invoices.facility, facilityId))
      : db.select().from(invoices));
    return allInvoices
      .filter((i) => {
        const approval = (i as any).approvalStatus;
        const delivery = (i as any).deliveryStatus;
        if (queueId === "invoice_draft_needs_review") return approval === "pending_review";
        if (queueId === "invoice_approved_ready_to_send") return approval === "approved" && delivery === "ready_to_send";
        if (queueId === "invoice_delivery_failed") return delivery === "failed";
        return false;
      })
      .slice(0, safeLimit)
      .map((i) => ({
        queueId,
        itemId: i.id,
        invoiceId: i.id,
        facilityId: i.facility,
        label: i.invoiceNumber,
        reason: `${(i as any).approvalStatus} · ${(i as any).deliveryStatus}`,
        createdAt: i.createdAt as unknown as string ?? null,
      }));
  }

  if (queueId === "denial_open") {
    const rows = await db.select().from(invoiceDenials).where(eq(invoiceDenials.status, "open")).orderBy(desc(invoiceDenials.createdAt)).limit(safeLimit);
    return rows.map((d) => ({
      queueId,
      itemId: d.id,
      invoiceId: d.invoiceId,
      label: d.denialCode ?? `Denial #${d.id}`,
      reason: d.denialReason ?? undefined,
      detail: d.payer ?? undefined,
      createdAt: d.createdAt as unknown as string ?? null,
    }));
  }

  // Readiness-blocker queues.
  if (READINESS_BLOCKER_TO_QUEUE) {
    const targetBlocker = Object.keys(READINESS_BLOCKER_TO_QUEUE).find((b) => READINESS_BLOCKER_TO_QUEUE[b] === queueId);
    if (targetBlocker) {
      const conditions = [eq(invoiceReadinessSnapshots.readinessStatus, "blocked")];
      if (facilityId) conditions.push(eq(invoiceReadinessSnapshots.facilityId, facilityId));
      const rows = await db.select().from(invoiceReadinessSnapshots).where(and(...conditions)).orderBy(desc(invoiceReadinessSnapshots.evaluatedAt)).limit(safeLimit * 4);
      return rows
        .filter((r) => Array.isArray(r.blockers) && (r.blockers as unknown[]).includes(targetBlocker))
        .slice(0, safeLimit)
        .map((r) => ({
          queueId,
          itemId: r.id,
          patientName: r.patientName,
          facilityId: r.facilityId,
          testType: r.serviceType,
          label: r.patientName ?? `Case #${r.executionCaseId}`,
          reason: targetBlocker,
          createdAt: (r.evaluatedAt as unknown as string) ?? null,
        }));
    }
  }

  return [];
}
