// billingReportService — Phase 4 PR 4.8.
//
// Read-only EOD / weekly / monthly billing rollups.

import { db } from "../../db";
import { and, eq, gte, lte, desc, sql } from "drizzle-orm";
import { invoiceReadinessSnapshots } from "@shared/schema/invoiceReadiness";
import { invoices, invoicePayments } from "@shared/schema/invoices";
import { invoiceBatches } from "@shared/schema/invoiceBatches";
import { invoiceDenials } from "@shared/schema/invoiceFinancialEvents";
import { invoiceDeliveryEvents } from "@shared/schema/invoiceDelivery";

function startOfDayIso(d: Date): string { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString(); }
function endOfDayIso(d: Date): string { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)).toISOString(); }

export type FacilityFilter = { facilityId?: string | null };

export type EodReport = {
  date: string;
  scope: FacilityFilter;
  readyToInvoice: number;
  blocked: number;
  blockedBreakdown: Record<string, number>;
  invoicesDrafted: number;
  invoicesApproved: number;
  invoicesSent: number;
  paymentsPosted: { count: number; total: number };
  denialsOpened: number;
  overdueInvoices: number;
  deliveryFailures: number;
  perFacility: Record<string, { ready: number; blocked: number; sent: number }>;
  perTestType: Record<string, { ready: number; blocked: number }>;
};

export async function buildEodReport(date: Date = new Date(), filter: FacilityFilter = {}): Promise<EodReport> {
  const start = startOfDayIso(date);
  const end = endOfDayIso(date);

  // Readiness snapshots evaluated today.
  const readinessConditions: any[] = [
    gte(invoiceReadinessSnapshots.evaluatedAt, new Date(start) as any),
    lte(invoiceReadinessSnapshots.evaluatedAt, new Date(end) as any),
  ];
  if (filter.facilityId) readinessConditions.push(eq(invoiceReadinessSnapshots.facilityId, filter.facilityId));
  const todays = await db.select().from(invoiceReadinessSnapshots).where(and(...readinessConditions));

  let ready = 0;
  let blocked = 0;
  const blockedBreakdown: Record<string, number> = {};
  const perFacility: Record<string, { ready: number; blocked: number; sent: number }> = {};
  const perTestType: Record<string, { ready: number; blocked: number }> = {};

  for (const s of todays) {
    if (s.readinessStatus === "ready_to_invoice") ready++;
    if (s.readinessStatus === "blocked") {
      blocked++;
      const list = Array.isArray(s.blockers) ? (s.blockers as unknown[]) : [];
      for (const code of list) if (typeof code === "string") blockedBreakdown[code] = (blockedBreakdown[code] ?? 0) + 1;
    }
    if (s.facilityId) {
      perFacility[s.facilityId] ??= { ready: 0, blocked: 0, sent: 0 };
      if (s.readinessStatus === "ready_to_invoice") perFacility[s.facilityId].ready++;
      if (s.readinessStatus === "blocked") perFacility[s.facilityId].blocked++;
    }
    if (s.serviceType) {
      perTestType[s.serviceType] ??= { ready: 0, blocked: 0 };
      if (s.readinessStatus === "ready_to_invoice") perTestType[s.serviceType].ready++;
      if (s.readinessStatus === "blocked") perTestType[s.serviceType].blocked++;
    }
  }

  // Invoices touched today.
  const invConditions: any[] = [
    gte(invoices.createdAt, new Date(start) as any),
    lte(invoices.createdAt, new Date(end) as any),
  ];
  if (filter.facilityId) invConditions.push(eq(invoices.facility, filter.facilityId));
  const invsToday = await db.select().from(invoices).where(and(...invConditions));
  let drafted = 0;
  let approved = 0;
  let sent = 0;
  let overdueInvoices = 0;
  let deliveryFailures = 0;
  for (const i of invsToday) {
    if ((i as any).approvalStatus === "draft" || (i as any).approvalStatus === "pending_review") drafted++;
    if ((i as any).approvalStatus === "approved") approved++;
    if ((i as any).deliveryStatus === "sent") {
      sent++;
      if (i.facility) perFacility[i.facility] ??= { ready: 0, blocked: 0, sent: 0 };
      if (i.facility) perFacility[i.facility].sent++;
    }
    if ((i as any).deliveryStatus === "failed") deliveryFailures++;
    if (i.status === "Sent" || i.status === "Partially Paid") {
      const due = (i as any).dueDate as string | null;
      if (due) {
        const dueDate = new Date(due);
        if (!Number.isNaN(dueDate.getTime()) && dueDate.getTime() < Date.now()) overdueInvoices++;
      }
    }
  }

  // Payments today.
  const payConditions: any[] = [
    gte(invoicePayments.createdAt, new Date(start) as any),
    lte(invoicePayments.createdAt, new Date(end) as any),
  ];
  const pays = await db.select().from(invoicePayments).where(and(...payConditions));
  const paymentsPosted = pays.reduce((acc, p) => ({ count: acc.count + 1, total: acc.total + Number(p.amount ?? 0) }), { count: 0, total: 0 });

  // Denials opened today.
  const denConditions: any[] = [
    gte(invoiceDenials.createdAt, new Date(start) as any),
    lte(invoiceDenials.createdAt, new Date(end) as any),
  ];
  const denials = await db.select().from(invoiceDenials).where(and(...denConditions));

  return {
    date: date.toISOString().slice(0, 10),
    scope: filter,
    readyToInvoice: ready,
    blocked,
    blockedBreakdown,
    invoicesDrafted: drafted,
    invoicesApproved: approved,
    invoicesSent: sent,
    paymentsPosted,
    denialsOpened: denials.length,
    overdueInvoices,
    deliveryFailures,
    perFacility,
    perTestType,
  };
}

export type WeeklyReport = {
  weekStart: string;
  weekEnd: string;
  scope: FacilityFilter;
  invoicesGenerated: number;
  invoicesSent: number;
  totalBilled: number;
  paymentsReceived: number;
  outstandingBalance: number;
  denials: number;
  blockedAgingDays: number;
};

export async function buildWeeklyReport(weekStart: Date, filter: FacilityFilter = {}): Promise<WeeklyReport> {
  const start = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);

  const invConditions: any[] = [
    gte(invoices.createdAt, start as any),
    lte(invoices.createdAt, end as any),
  ];
  if (filter.facilityId) invConditions.push(eq(invoices.facility, filter.facilityId));
  const invs = await db.select().from(invoices).where(and(...invConditions));

  let totalBilled = 0;
  let invoicesSent = 0;
  let outstanding = 0;
  for (const i of invs) {
    totalBilled += Number(i.totalCharges ?? 0);
    if ((i as any).deliveryStatus === "sent") invoicesSent++;
    outstanding += Number(i.totalBalance ?? 0);
  }

  const payConditions: any[] = [gte(invoicePayments.createdAt, start as any), lte(invoicePayments.createdAt, end as any)];
  const pays = await db.select().from(invoicePayments).where(and(...payConditions));
  const paymentsReceived = pays.reduce((acc, p) => acc + Number(p.amount ?? 0), 0);

  const denials = await db.select().from(invoiceDenials).where(and(gte(invoiceDenials.createdAt, start as any), lte(invoiceDenials.createdAt, end as any)));

  // Blocked aging: oldest blocked readiness snapshot.
  const blockedQuery = await db.select().from(invoiceReadinessSnapshots).where(eq(invoiceReadinessSnapshots.readinessStatus, "blocked"));
  let oldest = Date.now();
  for (const b of blockedQuery) {
    const t = b.evaluatedAt instanceof Date ? b.evaluatedAt.getTime() : new Date(b.evaluatedAt as any).getTime();
    if (!Number.isNaN(t) && t < oldest) oldest = t;
  }
  const blockedAgingDays = blockedQuery.length === 0 ? 0 : Math.max(0, Math.floor((Date.now() - oldest) / (24 * 3600 * 1000)));

  return {
    weekStart: start.toISOString().slice(0, 10),
    weekEnd: end.toISOString().slice(0, 10),
    scope: filter,
    invoicesGenerated: invs.length,
    invoicesSent,
    totalBilled: Number(totalBilled.toFixed(2)),
    paymentsReceived: Number(paymentsReceived.toFixed(2)),
    outstandingBalance: Number(outstanding.toFixed(2)),
    denials: denials.length,
    blockedAgingDays,
  };
}

export type MonthlyReport = {
  month: string;
  scope: FacilityFilter;
  facilityTotals: Record<string, { invoices: number; totalBilled: number; outstanding: number }>;
  serviceTotals: Record<string, { invoices: number; totalBilled: number }>;
  unpaidInvoiceCount: number;
  denialSummary: Record<string, number>;
  scheduleCompliance: { batchesGenerated: number };
};

export async function buildMonthlyReport(month: string, filter: FacilityFilter = {}): Promise<MonthlyReport> {
  const [yearStr, monthStr] = month.split("-");
  const start = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
  const end = new Date(Date.UTC(Number(yearStr), Number(monthStr), 0, 23, 59, 59, 999));

  const invConditions: any[] = [gte(invoices.createdAt, start as any), lte(invoices.createdAt, end as any)];
  if (filter.facilityId) invConditions.push(eq(invoices.facility, filter.facilityId));
  const invs = await db.select().from(invoices).where(and(...invConditions));

  const facilityTotals: Record<string, { invoices: number; totalBilled: number; outstanding: number }> = {};
  for (const i of invs) {
    const f = i.facility;
    facilityTotals[f] ??= { invoices: 0, totalBilled: 0, outstanding: 0 };
    facilityTotals[f].invoices++;
    facilityTotals[f].totalBilled += Number(i.totalCharges ?? 0);
    facilityTotals[f].outstanding += Number(i.totalBalance ?? 0);
  }
  let unpaid = 0;
  for (const i of invs) if (i.status !== "Paid") unpaid++;

  // Service-type totals (best-effort via line-item-free approach: bucket by invoice batch's policy snapshot or skip if unknown).
  const serviceTotals: Record<string, { invoices: number; totalBilled: number }> = {};

  const denials = await db.select().from(invoiceDenials).where(and(gte(invoiceDenials.createdAt, start as any), lte(invoiceDenials.createdAt, end as any)));
  const denialSummary: Record<string, number> = {};
  for (const d of denials) {
    const key = d.status ?? "open";
    denialSummary[key] = (denialSummary[key] ?? 0) + 1;
  }

  const batches = await db.select().from(invoiceBatches).where(and(gte(invoiceBatches.createdAt, start as any), lte(invoiceBatches.createdAt, end as any)));

  return {
    month,
    scope: filter,
    facilityTotals,
    serviceTotals,
    unpaidInvoiceCount: unpaid,
    denialSummary,
    scheduleCompliance: { batchesGenerated: batches.length },
  };
}
