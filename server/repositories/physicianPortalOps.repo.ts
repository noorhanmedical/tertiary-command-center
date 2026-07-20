// Physician Portal Operations — reports + ancillary metrics repository.
//
// Every SQL statement that backs the Reports and Ancillary Metrics tabs
// lives here. Route + service layers must not issue raw db.select /
// db.execute. All reads are scoped (bounded rows, indexed WHERE) —
// nothing here does an unfiltered getAll() on a large table.

import { and, count, desc, eq, gte, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { procedureEvents } from "@shared/schema/procedureEvents";
import { patientScreenings } from "@shared/schema/screening";
import { invoices } from "@shared/schema/invoices";

// ─── Reports ────────────────────────────────────────────────────────────────

// A "report" is a case_document_readiness row of type 'report'. This is
// the canonical source of truth for whether a procedure has a report.

export type PhysicianReportRow = {
  id: number;
  executionCaseId: number | null;
  patientScreeningId: number | null;
  patientName: string | null;
  patientFacility: string | null;
  serviceType: string | null;
  documentStatus: string | null;
  blocksBilling: boolean | null;
  updatedAt: Date | null;
  createdAt: Date | null;
};

export type ListPhysicianReportsFilters = {
  facilityId?: string;
  serviceType?: string;
  documentStatus?: string;
  /** When true, only rows whose document_status is not one of the
   *  "complete" family (uploaded/approved/completed) are returned. */
  onlyOpen?: boolean;
};

const REPORT_COMPLETE_STATUSES = ["uploaded", "approved", "completed"] as const;

export async function listPhysicianReports(
  filters: ListPhysicianReportsFilters = {},
  limit = 100,
): Promise<PhysicianReportRow[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [eq(caseDocumentReadiness.documentType, "report")];
  if (filters.facilityId) {
    conditions.push(eq(caseDocumentReadiness.facilityId, filters.facilityId));
  }
  if (filters.serviceType) {
    conditions.push(eq(caseDocumentReadiness.serviceType, filters.serviceType));
  }
  if (filters.documentStatus) {
    conditions.push(eq(caseDocumentReadiness.documentStatus, filters.documentStatus));
  }
  if (filters.onlyOpen) {
    // Scoped negative — either NULL or NOT IN the complete set.
    conditions.push(
      sql`(${caseDocumentReadiness.documentStatus} IS NULL OR ${caseDocumentReadiness.documentStatus} NOT IN (${sql.join(
        REPORT_COMPLETE_STATUSES.map((s) => sql`${s}`),
        sql`, `,
      )}))`,
    );
  }

  const rows = await db
    .select({
      id: caseDocumentReadiness.id,
      executionCaseId: caseDocumentReadiness.executionCaseId,
      patientScreeningId: caseDocumentReadiness.patientScreeningId,
      patientName: patientScreenings.name,
      patientFacility: patientScreenings.facility,
      serviceType: caseDocumentReadiness.serviceType,
      documentStatus: caseDocumentReadiness.documentStatus,
      blocksBilling: caseDocumentReadiness.blocksBilling,
      updatedAt: caseDocumentReadiness.updatedAt,
      createdAt: caseDocumentReadiness.createdAt,
    })
    .from(caseDocumentReadiness)
    .leftJoin(
      patientScreenings,
      eq(caseDocumentReadiness.patientScreeningId, patientScreenings.id),
    )
    .where(and(...conditions))
    .orderBy(desc(caseDocumentReadiness.createdAt))
    .limit(safeLimit);
  return rows;
}

// ─── Ancillary Metrics ──────────────────────────────────────────────────────

// Aggregates that a physician cares about across a window of ancillary
// activity. All queries are bounded by a scoped date range on
// procedure_events.completed_at (indexed).

export type AncillaryMetricsWindow = {
  startsAt: Date;
  endsAt: Date;
  /** Optional facility filter (applied by joining to the parent screening). */
  facilityId?: string;
};

export type AncillaryMetricsRow = {
  serviceType: string;
  proceduresCompleted: number;
  reportsUploaded: number;
  notesSigned: number;
  reportsOutstanding: number;
};

/** Number of procedure_events rows completed in the window, grouped by service. */
async function countProceduresCompletedByService(
  window: AncillaryMetricsWindow,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const rows = await db
    .select({
      serviceType: procedureEvents.serviceType,
      n: count(procedureEvents.id),
    })
    .from(procedureEvents)
    .where(
      and(
        eq(procedureEvents.procedureStatus, "complete"),
        isNotNull(procedureEvents.completedAt),
        gte(procedureEvents.completedAt, window.startsAt),
        lt(procedureEvents.completedAt, window.endsAt),
      ),
    )
    .groupBy(procedureEvents.serviceType);
  for (const r of rows) {
    if (r.serviceType) out.set(r.serviceType, Number(r.n));
  }
  return out;
}

/** Reports uploaded (case_document_readiness.document_type=report, complete
 *  status) grouped by service, within the window on updated_at. */
async function countReportsUploadedByService(
  window: AncillaryMetricsWindow,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const rows = await db
    .select({
      serviceType: caseDocumentReadiness.serviceType,
      n: count(caseDocumentReadiness.id),
    })
    .from(caseDocumentReadiness)
    .where(
      and(
        eq(caseDocumentReadiness.documentType, "report"),
        inArray(
          caseDocumentReadiness.documentStatus,
          [...REPORT_COMPLETE_STATUSES],
        ),
        gte(caseDocumentReadiness.updatedAt, window.startsAt),
        lt(caseDocumentReadiness.updatedAt, window.endsAt),
      ),
    )
    .groupBy(caseDocumentReadiness.serviceType);
  for (const r of rows) {
    if (r.serviceType) out.set(r.serviceType, Number(r.n));
  }
  return out;
}

/** Reports still outstanding (report row exists but status not in the
 *  complete set) grouped by service. Not date-scoped — it's the current
 *  backlog. */
async function countReportsOutstandingByService(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const rows = await db
    .select({
      serviceType: caseDocumentReadiness.serviceType,
      n: count(caseDocumentReadiness.id),
    })
    .from(caseDocumentReadiness)
    .where(
      and(
        eq(caseDocumentReadiness.documentType, "report"),
        sql`(${caseDocumentReadiness.documentStatus} IS NULL OR ${caseDocumentReadiness.documentStatus} NOT IN (${sql.join(
          REPORT_COMPLETE_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )}))`,
      ),
    )
    .groupBy(caseDocumentReadiness.serviceType);
  for (const r of rows) {
    if (r.serviceType) out.set(r.serviceType, Number(r.n));
  }
  return out;
}

/** Notes signed in the window (procedure_notes.signature_status='signed'
 *  where signed_at is within the range) grouped by service. */
async function countNotesSignedByService(
  window: AncillaryMetricsWindow,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const rows = await db
    .select({
      serviceType: procedureNotes.serviceType,
      n: count(procedureNotes.id),
    })
    .from(procedureNotes)
    .where(
      and(
        eq(procedureNotes.signatureStatus, "signed"),
        isNotNull(procedureNotes.signedAt),
        gte(procedureNotes.signedAt, window.startsAt),
        lt(procedureNotes.signedAt, window.endsAt),
      ),
    )
    .groupBy(procedureNotes.serviceType);
  for (const r of rows) {
    if (r.serviceType) out.set(r.serviceType, Number(r.n));
  }
  return out;
}

export async function buildAncillaryMetrics(
  window: AncillaryMetricsWindow,
): Promise<AncillaryMetricsRow[]> {
  const [procedures, reports, notes, outstanding] = await Promise.all([
    countProceduresCompletedByService(window),
    countReportsUploadedByService(window),
    countNotesSignedByService(window),
    countReportsOutstandingByService(),
  ]);
  const serviceTypes = new Set<string>([
    ...procedures.keys(),
    ...reports.keys(),
    ...notes.keys(),
    ...outstanding.keys(),
  ]);
  return Array.from(serviceTypes)
    .sort()
    .map((serviceType) => ({
      serviceType,
      proceduresCompleted: procedures.get(serviceType) ?? 0,
      reportsUploaded: reports.get(serviceType) ?? 0,
      notesSigned: notes.get(serviceType) ?? 0,
      reportsOutstanding: outstanding.get(serviceType) ?? 0,
    }));
}

// ─── Physician Portal Summary tile counts ───────────────────────────────────
//
// Three bounded counts + one bounded sum drive the physician DashboardHome /
// HomeDashboard summary card:
//   - notes needing signature
//   - reports pending upload / review
//   - open A/R total (invoices with status != 'Paid')
//
// Every query is a single COUNT / SUM against an indexed column. No row
// materialisation. No getAll. Facility filter is optional and applied at
// the SQL level.

export type PhysicianPortalSummary = {
  needsSignature: number;
  reportsPending: number;
  pendingAR: number;
};

export type PhysicianSummaryFilters = {
  facilityId?: string | null;
};

export async function countProcedureNotesNeedingSignature(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(procedureNotes)
    .where(
      and(
        inArray(procedureNotes.generationStatus, ["generated", "approved"]),
        or(
          sql`${procedureNotes.signatureStatus} IS NULL`,
          ne(procedureNotes.signatureStatus, "signed"),
        ),
      ),
    );
  return row?.n ?? 0;
}

export async function countReportsPending(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(caseDocumentReadiness)
    .where(
      and(
        eq(caseDocumentReadiness.documentType, "report"),
        inArray(caseDocumentReadiness.documentStatus, ["uploaded", "pending"]),
      ),
    );
  return row?.n ?? 0;
}

export async function sumOpenAR(filters: PhysicianSummaryFilters = {}): Promise<number> {
  const conditions = [ne(invoices.status, "Paid")];
  if (filters.facilityId) {
    conditions.push(eq(invoices.facility, filters.facilityId));
  }
  const [row] = await db
    .select({ n: sql<number>`COALESCE(SUM(${invoices.totalBalance}), 0)::numeric` })
    .from(invoices)
    .where(and(...conditions));
  const raw = row?.n as unknown as string | number | null | undefined;
  const num = typeof raw === "number" ? raw : parseFloat(String(raw ?? "0"));
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0;
}

// ─── Physician Portal Financial Health (overall section only) ─────────────
//
// Aggregates the invoices table for the OVERALL snapshot displayed at the
// top of FinancialHealthTab. Each metric is a scoped SUM / COUNT against
// an indexed column. The Plexus Ancillary Contribution breakdown is
// intentionally NOT computed here — it requires a full pricing lookup +
// service-type matching that has not been audited safe against
// fabrication. The service returns { unavailable: true } for that section
// until a follow-up PR delivers it lane-by-lane with tests.

export type FinancialHealthOverall = {
  totalBilled: number;
  totalPaid: number;
  pendingAR: number;
  invoiceCount: number;
  collectionRate: number;
};

export async function buildFinancialHealthOverall(
  filters: PhysicianSummaryFilters = {},
): Promise<FinancialHealthOverall> {
  const conditions = filters.facilityId
    ? [eq(invoices.facility, filters.facilityId)]
    : [];
  const [row] = await db
    .select({
      totalBilled: sql<string>`COALESCE(SUM(${invoices.totalCharges}), 0)::numeric`,
      totalPaid: sql<string>`COALESCE(SUM(${invoices.totalPaid}), 0)::numeric`,
      pendingAR: sql<string>`COALESCE(SUM(CASE WHEN ${invoices.status} <> 'Paid' THEN ${invoices.totalBalance} ELSE 0 END), 0)::numeric`,
      invoiceCount: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(conditions.length > 0 ? and(...conditions) : sql`true`);

  const round2 = (v: string | number | null | undefined): number => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  };
  const totalBilled = round2(row?.totalBilled);
  const totalPaid = round2(row?.totalPaid);
  const pendingAR = round2(row?.pendingAR);
  const invoiceCount = row?.invoiceCount ?? 0;
  const collectionRate =
    totalBilled > 0 ? round2((totalPaid / totalBilled) * 100) : 0;

  return { totalBilled, totalPaid, pendingAR, invoiceCount, collectionRate };
}
