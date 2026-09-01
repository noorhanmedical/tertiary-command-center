// Engagement Call Results — the operational, searchable record list.
//
// Primary source: outreach_calls (the canonical call/communication log).
// Enriched with the minimal canonical execution-case context (assignment,
// engagement/bucket, facility) via the patient_screening_id → newest
// execution case join, and the acting staff member's display name.
//
// This is a READ MODEL. It never writes. It is the data behind the
// Engagement Center "Call Results" tab record list (distinct from the
// team-metrics KPI dashboard). Filtering + pagination are applied in SQL
// where possible; facility scoping is enforced by the CALLER (route) via
// the resolved facility allow-list — this service accepts an explicit
// facility filter and never widens it.

import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { outreachCalls } from "@shared/schema/outreach";
import { patientScreenings } from "@shared/schema/screening";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { users } from "@shared/schema/users";

export type CallResultRow = {
  id: number;
  startedAt: string;
  endedAt: string | null;
  outcome: string;
  disposition: string | null;
  channel: string;
  direction: string;
  attemptNumber: number;
  durationSeconds: number | null;
  callbackAt: string | null;
  hasCallback: boolean;
  notesPreview: string | null;
  // Patient / context
  patientScreeningId: number;
  patientName: string | null;
  facility: string | null;
  serviceType: string | null;
  // Canonical execution-case context
  executionCaseId: number | null;
  engagementBucket: string | null;
  engagementStatus: string | null;
  assignedTeamMemberId: number | null;
  // Staff attribution
  staffUserId: string | null;
  staffName: string | null;
};

export type CallResultsFilters = {
  /** Free-text search across patient name, outcome, disposition, notes. */
  search?: string;
  patientScreeningId?: number;
  /** Attributed staff (outreach_calls.scheduler_user_id). */
  staffUserId?: string;
  outcome?: string;
  /** Communication channel (phone/email/…). "Call type" in the UI. */
  channel?: string;
  /** ISO date (inclusive) lower/upper bound on started_at. */
  startDate?: string;
  endDate?: string;
  /** "with" = only rows that scheduled a callback; "without" = only rows without. */
  callbackStatus?: "with" | "without";
  /**
   * Facility allow-list. When provided, rows are limited to these facilities.
   * The ROUTE resolves this from the caller's authorization scope; an empty
   * array means "no facilities" (returns nothing) — never "all".
   * `undefined` means the caller is unrestricted (admin pass-through).
   */
  facilities?: string[];
  serviceType?: string;
};

export type CallResultsPage = {
  rows: CallResultRow[];
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
};

const NOTES_PREVIEW_MAX = 120;

function previewNotes(notes: string | null): string | null {
  if (!notes) return null;
  const trimmed = notes.trim();
  if (trimmed.length <= NOTES_PREVIEW_MAX) return trimmed;
  return `${trimmed.slice(0, NOTES_PREVIEW_MAX)}…`;
}

/**
 * List call results (paginated) from outreach_calls, enriched with canonical
 * execution-case + patient context and staff name. Facility scoping is applied
 * from `filters.facilities` (route-provided). Ordered newest-first.
 */
export async function listCallResults(
  filters: CallResultsFilters,
  limit = 50,
  offset = 0,
): Promise<CallResultsPage> {
  const safeLimit = Math.min(Math.max(1, limit), 200);
  const safeOffset = Math.max(0, offset);

  // Facility scope: empty allow-list → nothing (honest, not "all").
  if (filters.facilities && filters.facilities.length === 0) {
    return { rows: [], limit: safeLimit, offset: safeOffset, total: 0, hasMore: false };
  }

  const conds = [];

  // Facility comes from the enriched context; outreach_calls has no reliable
  // facility column of its own for legacy rows, so we scope on the screening's
  // facility (joined below). When restricted, constrain to the allow-list.
  if (filters.facilities && filters.facilities.length > 0) {
    conds.push(inArray(patientScreenings.facility, filters.facilities));
  }
  if (filters.patientScreeningId != null) {
    conds.push(eq(outreachCalls.patientScreeningId, filters.patientScreeningId));
  }
  if (filters.staffUserId) {
    conds.push(eq(outreachCalls.schedulerUserId, filters.staffUserId));
  }
  if (filters.outcome) {
    conds.push(eq(outreachCalls.outcome, filters.outcome));
  }
  if (filters.channel) {
    conds.push(eq(outreachCalls.channel, filters.channel));
  }
  if (filters.serviceType) {
    conds.push(eq(outreachCalls.serviceType, filters.serviceType));
  }
  if (filters.startDate) {
    const d = new Date(`${filters.startDate}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) conds.push(gte(outreachCalls.startedAt, d));
  }
  if (filters.endDate) {
    const d = new Date(`${filters.endDate}T23:59:59.999Z`);
    if (!Number.isNaN(d.getTime())) conds.push(lte(outreachCalls.startedAt, d));
  }
  if (filters.callbackStatus === "with") {
    conds.push(sql`${outreachCalls.callbackAt} IS NOT NULL`);
  } else if (filters.callbackStatus === "without") {
    conds.push(sql`${outreachCalls.callbackAt} IS NULL`);
  }
  if (filters.search) {
    const q = `%${filters.search.trim()}%`;
    const searchCond = or(
      ilike(patientScreenings.name, q),
      ilike(outreachCalls.outcome, q),
      ilike(sql`COALESCE(${outreachCalls.disposition}, '')`, q),
      ilike(sql`COALESCE(${outreachCalls.notes}, '')`, q),
    );
    if (searchCond) conds.push(searchCond);
  }

  const whereClause = conds.length > 0 ? and(...conds) : undefined;

  // Newest execution case per screening (correlated subquery) so a screening
  // with multiple historical cases resolves to the current operational one.
  const latestCaseId = sql<number>`(
    SELECT ec.id FROM patient_execution_cases ec
    WHERE ec.patient_screening_id = ${outreachCalls.patientScreeningId}
    ORDER BY ec.id DESC LIMIT 1
  )`;

  // Count (for pagination "total"). Same joins/filters, no limit.
  const countRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outreachCalls)
    .leftJoin(patientScreenings, eq(patientScreenings.id, outreachCalls.patientScreeningId))
    .where(whereClause);
  const total = countRows[0]?.n ?? 0;

  const rows = await db
    .select({
      id: outreachCalls.id,
      startedAt: outreachCalls.startedAt,
      endedAt: outreachCalls.endedAt,
      outcome: outreachCalls.outcome,
      disposition: outreachCalls.disposition,
      channel: outreachCalls.channel,
      direction: outreachCalls.direction,
      attemptNumber: outreachCalls.attemptNumber,
      durationSeconds: outreachCalls.durationSeconds,
      callbackAt: outreachCalls.callbackAt,
      notes: outreachCalls.notes,
      serviceType: outreachCalls.serviceType,
      patientScreeningId: outreachCalls.patientScreeningId,
      patientName: patientScreenings.name,
      facility: patientScreenings.facility,
      staffUserId: outreachCalls.schedulerUserId,
      staffName: users.username,
      executionCaseId: sql<number | null>`${latestCaseId}`,
      engagementBucket: sql<string | null>`(SELECT ec.engagement_bucket FROM patient_execution_cases ec WHERE ec.id = ${latestCaseId})`,
      engagementStatus: sql<string | null>`(SELECT ec.engagement_status FROM patient_execution_cases ec WHERE ec.id = ${latestCaseId})`,
      assignedTeamMemberId: sql<number | null>`(SELECT ec.assigned_team_member_id FROM patient_execution_cases ec WHERE ec.id = ${latestCaseId})`,
    })
    .from(outreachCalls)
    .leftJoin(patientScreenings, eq(patientScreenings.id, outreachCalls.patientScreeningId))
    .leftJoin(users, eq(users.id, outreachCalls.schedulerUserId))
    .where(whereClause)
    .orderBy(desc(outreachCalls.startedAt), desc(outreachCalls.id))
    .limit(safeLimit)
    .offset(safeOffset);

  const shaped: CallResultRow[] = rows.map((r) => ({
    id: r.id,
    startedAt: new Date(r.startedAt as unknown as string).toISOString(),
    endedAt: r.endedAt ? new Date(r.endedAt as unknown as string).toISOString() : null,
    outcome: r.outcome,
    disposition: r.disposition ?? null,
    channel: r.channel ?? "phone",
    direction: r.direction ?? "outbound",
    attemptNumber: r.attemptNumber ?? 1,
    durationSeconds: r.durationSeconds ?? null,
    callbackAt: r.callbackAt ? new Date(r.callbackAt as unknown as string).toISOString() : null,
    hasCallback: r.callbackAt != null,
    notesPreview: previewNotes(r.notes ?? null),
    patientScreeningId: r.patientScreeningId,
    patientName: r.patientName ?? null,
    facility: r.facility ?? null,
    serviceType: r.serviceType ?? null,
    executionCaseId: r.executionCaseId ?? null,
    engagementBucket: r.engagementBucket ?? null,
    engagementStatus: r.engagementStatus ?? null,
    assignedTeamMemberId: r.assignedTeamMemberId ?? null,
    staffUserId: r.staffUserId ?? null,
    staffName: r.staffName ?? null,
  }));

  return {
    rows: shaped,
    limit: safeLimit,
    offset: safeOffset,
    total,
    hasMore: safeOffset + shaped.length < total,
  };
}
