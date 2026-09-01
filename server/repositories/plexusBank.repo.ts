/**
 * Phase 10 — Plexus Bank Repository.
 *
 * Append-only financial event operations. Historical events are never
 * modified — corrections are represented as new events.
 */

import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  plexusBankEvents,
  type PlexusBankEvent,
  type InsertPlexusBankEvent,
} from "@shared/schema/plexusBankEvents";

// ─── Create ───────────────────────────────────────────────────────────────

export async function createBankEvent(
  input: InsertPlexusBankEvent,
): Promise<PlexusBankEvent> {
  const [result] = await db
    .insert(plexusBankEvents)
    .values(input)
    .returning();
  return result;
}

export async function createBankEventsBulk(
  inputs: InsertPlexusBankEvent[],
): Promise<PlexusBankEvent[]> {
  if (inputs.length === 0) return [];
  return db.insert(plexusBankEvents).values(inputs).returning();
}

// ─── Read ─────────────────────────────────────────────────────────────────

export type ListBankEventsFilters = {
  clinicId?: number;
  facilityId?: string;
  eventType?: string;
  ancillaryCaseId?: number;
  invoiceId?: number;
  reconciliationStatus?: string;
  counterpartyType?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
};

export async function listBankEvents(
  filters: ListBankEventsFilters = {},
): Promise<PlexusBankEvent[]> {
  const safeLimit = Math.min(Math.max(1, filters.limit ?? 200), 1000);
  const conditions = [];

  if (filters.clinicId != null) conditions.push(eq(plexusBankEvents.clinicId, filters.clinicId));
  if (filters.facilityId) conditions.push(eq(plexusBankEvents.facilityId, filters.facilityId));
  if (filters.eventType) conditions.push(eq(plexusBankEvents.eventType, filters.eventType));
  if (filters.ancillaryCaseId != null) conditions.push(eq(plexusBankEvents.ancillaryCaseId, filters.ancillaryCaseId));
  if (filters.invoiceId != null) conditions.push(eq(plexusBankEvents.invoiceId, filters.invoiceId));
  if (filters.reconciliationStatus) conditions.push(eq(plexusBankEvents.reconciliationStatus, filters.reconciliationStatus));
  if (filters.counterpartyType) conditions.push(eq(plexusBankEvents.counterpartyType, filters.counterpartyType));

  const query = db
    .select()
    .from(plexusBankEvents)
    .orderBy(desc(plexusBankEvents.createdAt))
    .limit(safeLimit);

  if (conditions.length > 0) return query.where(and(...conditions));
  return query;
}

export async function getBankEvent(id: number): Promise<PlexusBankEvent | undefined> {
  const [result] = await db
    .select()
    .from(plexusBankEvents)
    .where(eq(plexusBankEvents.id, id))
    .limit(1);
  return result;
}

// ─── Aggregations ─────────────────────────────────────────────────────────

export type FacilityBalanceSummary = {
  facilityId: string;
  totalReceived: string;
  totalPaidOut: string;
  netBalance: string;
  pendingReconciliation: number;
};

export async function getFacilityBalanceSummary(
  clinicId: number,
): Promise<FacilityBalanceSummary[]> {
  const rows = await db.execute(sql`
    SELECT
      facility_id,
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0)::text as total_received,
      COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)::text as total_paid_out,
      COALESCE(SUM(amount), 0)::text as net_balance,
      COUNT(*) FILTER (WHERE reconciliation_status = 'pending')::int as pending_reconciliation
    FROM plexus_bank_events
    WHERE clinic_id = ${clinicId}
    GROUP BY facility_id
    ORDER BY facility_id
  `);
  return (rows.rows as any[]).map((r: any) => ({
    facilityId: r.facility_id ?? "unknown",
    totalReceived: String(r.total_received ?? "0"),
    totalPaidOut: String(r.total_paid_out ?? "0"),
    netBalance: String(r.net_balance ?? "0"),
    pendingReconciliation: Number(r.pending_reconciliation ?? 0),
  }));
}

// ─── Reconciliation ───────────────────────────────────────────────────────

export async function reconcileBankEvent(
  id: number,
  userId: string,
): Promise<PlexusBankEvent | undefined> {
  const [result] = await db
    .update(plexusBankEvents)
    .set({
      reconciliationStatus: "reconciled",
      reconciledAt: new Date(),
      reconciledByUserId: userId,
    })
    .where(eq(plexusBankEvents.id, id))
    .returning();
  return result;
}
