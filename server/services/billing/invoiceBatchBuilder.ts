// invoiceBatchBuilder — Phase 4 PR 4.3.
//
// Builds an invoice batch preview for a facility using:
//   - the facility's effective billing policy (PR 4.1)
//   - the invoice readiness snapshots (PR 4.2)
//
// Does NOT create invoice drafts. PR 4.4 owns that step.
// Does NOT mutate readiness snapshots. The preview is a separate
// row in invoice_batches + invoice_batch_items.

import { db } from "../../db";
import { and, eq, inArray } from "drizzle-orm";
import { invoiceReadinessSnapshots } from "@shared/schema/invoiceReadiness";
import { invoiceBatches, invoiceBatchItems } from "@shared/schema/invoiceBatches";
import { getEffectiveBillingPolicy } from "./billingPolicyService";

export type BuildPreviewInput = {
  facilityId: string;
  invoicePeriodStart?: string | null;
  invoicePeriodEnd?: string | null;
  cutoffAt?: string | Date | null;
  createdByUserId?: string | null;
};

export type BuildPreviewResult = {
  batchId: number;
  itemCount: number;
  blockedCount: number;
  totalCharges: number;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultPeriodFromPolicy(policy: Awaited<ReturnType<typeof getEffectiveBillingPolicy>>): {
  start: string;
  end: string;
} {
  const today = new Date();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  if (policy.schedule.frequency === "monthly") {
    const startDate = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    const endDate = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
    return { start: startDate, end: endDate };
  }
  if (policy.schedule.frequency === "weekly" || policy.schedule.frequency === "biweekly") {
    const dow = today.getUTCDay();
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - dow); // back to Sunday
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + (policy.schedule.frequency === "biweekly" ? 13 : 6));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  // daily / custom — default to today
  return { start: todayIsoDate(), end: todayIsoDate() };
}

export async function buildInvoiceBatchPreview(
  input: BuildPreviewInput,
): Promise<BuildPreviewResult> {
  const policy = await getEffectiveBillingPolicy({ facilityId: input.facilityId });
  const { start, end } = (() => {
    if (input.invoicePeriodStart && input.invoicePeriodEnd) {
      return { start: input.invoicePeriodStart, end: input.invoicePeriodEnd };
    }
    return defaultPeriodFromPolicy(policy);
  })();
  const cutoffAt = input.cutoffAt ? new Date(input.cutoffAt) : new Date();
  if (Number.isNaN(cutoffAt.getTime())) {
    throw new Error("cutoffAt is not a valid datetime");
  }

  // Pull ready + blocked snapshots for the facility (we record blocked
  // items too so the preview surfaces what's holding the period).
  const snapshots = await db
    .select()
    .from(invoiceReadinessSnapshots)
    .where(and(
      eq(invoiceReadinessSnapshots.facilityId, input.facilityId),
      inArray(invoiceReadinessSnapshots.readinessStatus, ["ready_to_invoice", "blocked", "not_ready"]),
    ));

  // De-dupe by (executionCaseId, serviceType). The snapshot table
  // already has a unique index — we use the most-recent row by id.
  const dedup: Record<string, typeof snapshots[number]> = {};
  for (const s of snapshots) {
    const key = `${s.executionCaseId ?? "x"}::${s.serviceType}`;
    if (!dedup[key] || dedup[key].id < s.id) dedup[key] = s;
  }

  const [batchRow] = await db
    .insert(invoiceBatches)
    .values({
      facilityId: input.facilityId,
      invoicePeriodStart: start,
      invoicePeriodEnd: end,
      cutoffAt,
      batchStatus: "draft_preview",
      policySnapshot: {
        readiness: policy.readiness,
        approval: policy.approval,
        deliveryMethod: policy.recipients.deliveryMethod,
        pricing: policy.pricing,
        paymentTerms: policy.paymentTerms,
        scheduleFrequency: policy.schedule.frequency,
        cutoffWindow: policy.schedule.cutoffWindow,
        timezone: policy.schedule.timezone,
        sources: policy.sources,
      },
      recipientSnapshot: {
        primaryEmail: policy.recipients.primaryEmail,
        ccEmails: policy.recipients.ccEmails,
        bccEmails: policy.recipients.bccEmails,
        deliveryMethod: policy.recipients.deliveryMethod,
        billingContactName: policy.recipients.billingContactName,
        escalationContactName: policy.recipients.escalationContactName,
      },
      totals: {},
      itemCount: 0,
      blockedCount: 0,
      createdByUserId: input.createdByUserId ?? null,
      metadata: {},
    })
    .returning();

  let itemCount = 0;
  let blockedCount = 0;
  let totalCharges = 0;

  for (const s of Object.values(dedup)) {
    const unitPrice = s.unitPrice ? Number(s.unitPrice) : null;
    const lineStatus = s.readinessStatus === "ready_to_invoice"
      ? "included"
      : s.readinessStatus === "blocked"
        ? "blocked"
        : "excluded";
    if (lineStatus === "included" && unitPrice != null) {
      totalCharges += Number(unitPrice);
      itemCount++;
    } else if (lineStatus === "blocked") {
      blockedCount++;
    }
    await db.insert(invoiceBatchItems).values({
      batchId: batchRow.id,
      invoiceReadinessSnapshotId: s.id,
      executionCaseId: s.executionCaseId ?? null,
      patientScreeningId: s.patientScreeningId ?? null,
      procedureEventId: s.procedureEventId ?? null,
      facilityId: s.facilityId ?? null,
      testType: s.serviceType,
      patientName: s.patientName ?? null,
      dateOfService: null,
      price: unitPrice != null ? String(unitPrice) : null,
      revenueSplit: (s.priceSnapshot as any)?.revenueSplit ?? {},
      lineStatus,
      blockers: s.blockers ?? [],
      metadata: {},
    });
  }

  await db
    .update(invoiceBatches)
    .set({
      totals: {
        totalCharges: Number(totalCharges.toFixed(2)),
        currency: "USD",
      },
      itemCount,
      blockedCount,
      updatedAt: new Date(),
    })
    .where(eq(invoiceBatches.id, batchRow.id));

  return { batchId: batchRow.id, itemCount, blockedCount, totalCharges };
}
