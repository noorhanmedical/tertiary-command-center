import { db } from "../db";
import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import {
  screeningBatches,
  patientScreenings,
  type ScreeningBatch,
  type InsertScreeningBatch,
  type PatientScreening,
  type InsertPatientScreening,
} from "@shared/schema/screening";
import { patientTestHistory } from "@shared/schema/patientHistory";

export type PatientRosterAggregateRow = {
  representativeId: number;
  batchId: number;
  name: string;
  dob: string | null;
  age: number | null;
  gender: string | null;
  phoneNumber: string | null;
  insurance: string | null;
  clinic: string;
  lastVisit: string | null;
  screeningCount: number;
  testCount: number;
  generatedNoteCount: number;
  cooldownActiveCount: number;
  nextCooldownClearsAt: string | null;
  daysUntilNextClear: number | null;
};

export type PatientRosterAggregateFilters = {
  search?: string;
  clinic?: string;
  cooldownWindow?: string;
  page?: number;
  pageSize?: number;
};

export type PatientRosterClinicTotal = { clinic: string; count: number };

export type PatientRosterAggregateResult = {
  rows: PatientRosterAggregateRow[];
  total: number;
  clinicTotals: PatientRosterClinicTotal[];
};

export type PatientCooldownClinicCount = {
  clinic: string;
  oneDay: number;
  oneWeek: number;
  oneMonth: number;
};

export type PatientGroupTotals = { patients: number; clinics: number };

export type UnmatchedHistoryReportRow = {
  id: number;
  patientName: string;
  dob: string | null;
  testName: string;
  dateOfService: string;
  clinic: string | null;
};

function formatDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}

function parseTimeToMinutes(time: string | null | undefined): number {
  if (!time) return Infinity;
  const t = time.trim().toUpperCase();
  const match12 = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = parseInt(match12[2], 10);
    const period = match12[3];
    if (period === "AM") { if (h === 12) h = 0; }
    else { if (h !== 12) h += 12; }
    return h * 60 + m;
  }
  const match24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    return parseInt(match24[1], 10) * 60 + parseInt(match24[2], 10);
  }
  return Infinity;
}

export interface IScreeningRepository {
  createBatch(batch: InsertScreeningBatch): Promise<ScreeningBatch>;
  getBatch(id: number): Promise<ScreeningBatch | undefined>;
  listBatches(): Promise<ScreeningBatch[]>;
  updateBatch(id: number, updates: Partial<InsertScreeningBatch>): Promise<ScreeningBatch | undefined>;
  deleteBatch(id: number): Promise<void>;

  createScreening(screening: InsertPatientScreening): Promise<PatientScreening>;
  listAllScreenings(): Promise<PatientScreening[]>;
  listScreeningsByBatch(batchId: number): Promise<PatientScreening[]>;
  getScreening(id: number): Promise<PatientScreening | undefined>;
  updateScreening(id: number, updates: Partial<InsertPatientScreening>): Promise<PatientScreening | undefined>;
  deleteScreening(id: number): Promise<void>;

  searchPatientsByName(query: string): Promise<PatientScreening[]>;

  getRosterAggregates(filters?: PatientRosterAggregateFilters): Promise<PatientRosterAggregateResult>;
  getCooldownDashboard(): Promise<{ totals: PatientGroupTotals; counts: { oneDay: number; oneWeek: number; oneMonth: number }; byClinic: PatientCooldownClinicCount[]; allClinics: string[] }>;
  getHistoryImportReport(sampleLimit: number): Promise<{ totalHistoryRows: number; unmatchedCount: number; unmatched: UnmatchedHistoryReportRow[] }>;
  getGroupScreenings(name: string, dob: string | null): Promise<PatientScreening[]>;
}

export class DbScreeningRepository implements IScreeningRepository {
  async createBatch(batch: InsertScreeningBatch): Promise<ScreeningBatch> {
    const [result] = await db.insert(screeningBatches).values(batch).returning();
    return result;
  }

  async getBatch(id: number): Promise<ScreeningBatch | undefined> {
    const [result] = await db.select().from(screeningBatches).where(eq(screeningBatches.id, id));
    return result;
  }

  async listBatches(): Promise<ScreeningBatch[]> {
    return db.select().from(screeningBatches).orderBy(desc(screeningBatches.createdAt));
  }

  async updateBatch(id: number, updates: Partial<InsertScreeningBatch>): Promise<ScreeningBatch | undefined> {
    const [result] = await db.update(screeningBatches).set(updates).where(eq(screeningBatches.id, id)).returning();
    return result;
  }

  async deleteBatch(id: number): Promise<void> {
    await db.delete(patientScreenings).where(eq(patientScreenings.batchId, id));
    await db.delete(screeningBatches).where(eq(screeningBatches.id, id));
  }

  async createScreening(screening: InsertPatientScreening): Promise<PatientScreening> {
    const [result] = await db.insert(patientScreenings).values(screening).returning();
    return result;
  }

  async listScreeningsByBatch(batchId: number): Promise<PatientScreening[]> {
    const rows = await db.select().from(patientScreenings).where(eq(patientScreenings.batchId, batchId));
    return rows.sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time));
  }

  async listAllScreenings(): Promise<PatientScreening[]> {
    return db.select().from(patientScreenings);
  }

  async getScreening(id: number): Promise<PatientScreening | undefined> {
    const [result] = await db.select().from(patientScreenings).where(eq(patientScreenings.id, id));
    return result;
  }

  async updateScreening(id: number, updates: Partial<InsertPatientScreening>): Promise<PatientScreening | undefined> {
    const [result] = await db.update(patientScreenings).set(updates).where(eq(patientScreenings.id, id)).returning();
    return result;
  }

  async deleteScreening(id: number): Promise<void> {
    await db.delete(patientScreenings).where(eq(patientScreenings.id, id));
  }

  async searchPatientsByName(query: string): Promise<PatientScreening[]> {
    return db.select().from(patientScreenings)
      .where(sql`LOWER(${patientScreenings.name}) LIKE LOWER(${'%' + query + '%'})`)
      .limit(20);
  }

  async getRosterAggregates(filters: PatientRosterAggregateFilters = {}): Promise<PatientRosterAggregateResult> {
    const search = (filters.search ?? "").trim().toLowerCase();
    const clinic = (filters.clinic ?? "").trim();
    const cooldownWindow = (filters.cooldownWindow ?? "").trim();
    const cooldownLimit =
      cooldownWindow === "1d" ? 1
      : cooldownWindow === "1w" ? 7
      : cooldownWindow === "1m" ? 30
      : null;
    if (cooldownWindow && cooldownLimit === null) {
      return { rows: [], total: 0, clinicTotals: [] };
    }

    const requestedPageSize = Number.isFinite(filters.pageSize) ? Number(filters.pageSize) : 100;
    const pageSize = Math.max(1, Math.min(500, Math.trunc(requestedPageSize) || 100));
    const requestedPage = Number.isFinite(filters.page) ? Number(filters.page) : 1;
    const page = Math.max(1, Math.trunc(requestedPage) || 1);
    const offset = (page - 1) * pageSize;

    const baseCte = sql`
      WITH groups AS (
        SELECT name, dob, COUNT(*)::int AS screening_count
        FROM patient_screenings
        GROUP BY name, dob
      ),
      repr AS (
        SELECT DISTINCT ON (ps.name, ps.dob)
          ps.name, ps.dob, ps.id, ps.batch_id, ps.age, ps.gender,
          ps.phone_number, ps.insurance, ps.facility, ps.created_at,
          sb.facility AS batch_facility, sb.schedule_date AS batch_schedule_date
        FROM patient_screenings ps
        LEFT JOIN screening_batches sb ON sb.id = ps.batch_id
        ORDER BY ps.name, ps.dob, ps.created_at DESC
      ),
      notes AS (
        SELECT ps.name, ps.dob, COUNT(gn.id)::int AS note_count
        FROM patient_screenings ps
        LEFT JOIN generated_notes gn ON gn.patient_id = ps.id
        GROUP BY ps.name, ps.dob
      ),
      history AS (
        SELECT patient_name AS name, dob, COUNT(*)::int AS test_count
        FROM patient_test_history
        GROUP BY patient_name, dob
      ),
      last_visit AS (
        SELECT ps.name, ps.dob,
          MAX(NULLIF(GREATEST(
            COALESCE(sb.schedule_date, ''),
            COALESCE(to_char(ps.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'), '')
          ), '')) AS last_visit
        FROM patient_screenings ps
        LEFT JOIN screening_batches sb ON sb.id = ps.batch_id
        GROUP BY ps.name, ps.dob
      ),
      latest_test AS (
        SELECT DISTINCT ON (patient_name, dob, lower(btrim(test_name)))
          patient_name, dob, test_name, date_of_service, insurance_type
        FROM patient_test_history
        WHERE date_of_service ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        ORDER BY patient_name, dob, lower(btrim(test_name)), date_of_service DESC
      ),
      test_clears AS (
        SELECT patient_name AS name, dob,
          (date_of_service::date + (
            CASE WHEN lower(insurance_type) = 'medicare'
                 THEN INTERVAL '12 months' ELSE INTERVAL '6 months' END
          ))::date AS clears_at
        FROM latest_test
      ),
      patient_cooldown AS (
        SELECT name, dob,
          COUNT(*) FILTER (WHERE clears_at > CURRENT_DATE)::int AS active_count,
          MIN(clears_at) FILTER (WHERE clears_at > CURRENT_DATE) AS next_clear
        FROM test_clears
        GROUP BY name, dob
      ),
      filtered AS (
        SELECT
          r.id AS representative_id,
          r.batch_id,
          r.name,
          r.dob,
          r.age,
          r.gender,
          r.phone_number,
          r.insurance,
          COALESCE(NULLIF(r.facility, ''), NULLIF(r.batch_facility, ''), 'Unassigned') AS clinic,
          lv.last_visit,
          g.screening_count,
          COALESCE(h.test_count, 0)::int AS test_count,
          COALESCE(n.note_count, 0)::int AS note_count,
          COALESCE(pc.active_count, 0)::int AS cooldown_active_count,
          pc.next_clear,
          CASE WHEN pc.next_clear IS NULL THEN NULL
               ELSE (pc.next_clear - CURRENT_DATE)::int END AS days_until_next_clear
        FROM repr r
        JOIN groups g ON g.name = r.name AND g.dob IS NOT DISTINCT FROM r.dob
        LEFT JOIN notes n ON n.name = r.name AND n.dob IS NOT DISTINCT FROM r.dob
        LEFT JOIN history h ON h.name = r.name AND h.dob IS NOT DISTINCT FROM r.dob
        LEFT JOIN last_visit lv ON lv.name = r.name AND lv.dob IS NOT DISTINCT FROM r.dob
        LEFT JOIN patient_cooldown pc ON pc.name = r.name AND pc.dob IS NOT DISTINCT FROM r.dob
        WHERE
          (${search}::text = '' OR lower(r.name || ' ' || COALESCE(r.dob, '')) LIKE '%' || ${search}::text || '%')
          AND (${clinic}::text = '' OR COALESCE(NULLIF(r.facility, ''), NULLIF(r.batch_facility, ''), 'Unassigned') = ${clinic}::text)
          AND (
            ${cooldownLimit}::int IS NULL
            OR (pc.next_clear IS NOT NULL AND (pc.next_clear - CURRENT_DATE) <= ${cooldownLimit}::int)
          )
      )
    `;

    const [pageResult, totalsResult] = await Promise.all([
      db.execute(sql`
        ${baseCte}
        SELECT *
        FROM filtered
        ORDER BY (clinic = 'Unassigned'), clinic ASC, name ASC
        LIMIT ${pageSize}::int OFFSET ${offset}::int
      `),
      db.execute(sql`
        ${baseCte}
        SELECT
          (SELECT COUNT(*)::int FROM filtered) AS total,
          COALESCE((
            SELECT json_agg(row_to_json(t)) FROM (
              SELECT clinic, COUNT(*)::int AS count
              FROM filtered
              GROUP BY clinic
              ORDER BY (clinic = 'Unassigned'), clinic ASC
            ) t
          ), '[]'::json) AS clinic_totals
      `),
    ]);

    const rows = (pageResult.rows as any[]).map((row) => ({
      representativeId: Number(row.representative_id),
      batchId: Number(row.batch_id),
      name: String(row.name),
      dob: row.dob ?? null,
      age: row.age == null ? null : Number(row.age),
      gender: row.gender ?? null,
      phoneNumber: row.phone_number ?? null,
      insurance: row.insurance ?? null,
      clinic: String(row.clinic ?? "Unassigned"),
      lastVisit: row.last_visit ?? null,
      screeningCount: Number(row.screening_count),
      testCount: Number(row.test_count),
      generatedNoteCount: Number(row.note_count),
      cooldownActiveCount: Number(row.cooldown_active_count),
      nextCooldownClearsAt: row.next_clear ? formatDate(row.next_clear) : null,
      daysUntilNextClear: row.days_until_next_clear == null ? null : Number(row.days_until_next_clear),
    }));

    const totalsRow = (totalsResult.rows as any[])[0] ?? { total: 0, clinic_totals: [] };
    const clinicTotalsRaw = Array.isArray(totalsRow.clinic_totals) ? totalsRow.clinic_totals : [];
    const clinicTotals: PatientRosterClinicTotal[] = clinicTotalsRaw.map((t: any) => ({
      clinic: String(t.clinic ?? "Unassigned"),
      count: Number(t.count ?? 0),
    }));

    return { rows, total: Number(totalsRow.total ?? 0), clinicTotals };
  }

  async getCooldownDashboard(): Promise<{
    totals: PatientGroupTotals;
    counts: { oneDay: number; oneWeek: number; oneMonth: number };
    byClinic: PatientCooldownClinicCount[];
    allClinics: string[];
  }> {
    const result = await db.execute(sql`
      WITH patient_clinic AS (
        SELECT DISTINCT ON (ps.name, ps.dob)
          ps.name, ps.dob,
          COALESCE(NULLIF(ps.facility, ''), NULLIF(sb.facility, ''), 'Unassigned') AS clinic
        FROM patient_screenings ps
        LEFT JOIN screening_batches sb ON sb.id = ps.batch_id
        ORDER BY ps.name, ps.dob, ps.created_at DESC
      ),
      latest_test AS (
        SELECT DISTINCT ON (patient_name, dob, lower(btrim(test_name)))
          patient_name, dob, test_name, date_of_service, insurance_type
        FROM patient_test_history
        WHERE date_of_service ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        ORDER BY patient_name, dob, lower(btrim(test_name)), date_of_service DESC
      ),
      test_clears AS (
        SELECT patient_name AS name, dob,
          (date_of_service::date + (
            CASE WHEN lower(insurance_type) = 'medicare'
                 THEN INTERVAL '12 months' ELSE INTERVAL '6 months' END
          ))::date AS clears_at
        FROM latest_test
      ),
      patient_active AS (
        SELECT name, dob, MIN(clears_at) AS next_clear
        FROM test_clears
        WHERE clears_at > CURRENT_DATE
        GROUP BY name, dob
      ),
      joined AS (
        SELECT pa.name, pa.dob, pa.next_clear,
          (pa.next_clear - CURRENT_DATE)::int AS days_until,
          pc.clinic
        FROM patient_active pa
        JOIN patient_clinic pc ON pc.name = pa.name AND pc.dob IS NOT DISTINCT FROM pa.dob
      )
      SELECT
        (SELECT COUNT(*)::int FROM patient_clinic) AS total_patients,
        (SELECT COUNT(DISTINCT clinic)::int FROM patient_clinic) AS total_clinics,
        (SELECT COUNT(*)::int FROM joined WHERE days_until <= 1) AS one_day_total,
        (SELECT COUNT(*)::int FROM joined WHERE days_until <= 7) AS one_week_total,
        (SELECT COUNT(*)::int FROM joined WHERE days_until <= 30) AS one_month_total,
        COALESCE((
          SELECT json_agg(row_to_json(t)) FROM (
            SELECT
              clinic,
              COUNT(*) FILTER (WHERE days_until <= 1)::int AS one_day,
              COUNT(*) FILTER (WHERE days_until <= 7)::int AS one_week,
              COUNT(*) FILTER (WHERE days_until <= 30)::int AS one_month
            FROM joined
            GROUP BY clinic
            HAVING COUNT(*) FILTER (WHERE days_until <= 30) > 0
            ORDER BY clinic
          ) t
        ), '[]'::json) AS by_clinic,
        COALESCE((
          SELECT json_agg(clinic ORDER BY (clinic = 'Unassigned'), clinic ASC)
          FROM (SELECT DISTINCT clinic FROM patient_clinic) c
        ), '[]'::json) AS all_clinics
    `);
    const row: any = (result.rows as any[])[0] ?? {};
    const byClinic = Array.isArray(row.by_clinic) ? row.by_clinic : [];
    const allClinics = Array.isArray(row.all_clinics) ? row.all_clinics : [];
    return {
      totals: {
        patients: Number(row.total_patients ?? 0),
        clinics: Number(row.total_clinics ?? 0),
      },
      counts: {
        oneDay: Number(row.one_day_total ?? 0),
        oneWeek: Number(row.one_week_total ?? 0),
        oneMonth: Number(row.one_month_total ?? 0),
      },
      byClinic: byClinic.map((c: any) => ({
        clinic: String(c.clinic ?? "Unassigned"),
        oneDay: Number(c.one_day ?? 0),
        oneWeek: Number(c.one_week ?? 0),
        oneMonth: Number(c.one_month ?? 0),
      })),
      allClinics: allClinics.map((c: any) => String(c ?? "Unassigned")),
    };
  }

  async getHistoryImportReport(sampleLimit: number): Promise<{
    totalHistoryRows: number;
    unmatchedCount: number;
    unmatched: UnmatchedHistoryReportRow[];
  }> {
    const totalsRes = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM patient_test_history) AS total_rows,
        (SELECT COUNT(*)::int FROM patient_test_history h
           WHERE NOT EXISTS (
             SELECT 1 FROM patient_screenings ps
             WHERE ps.name = h.patient_name AND ps.dob IS NOT DISTINCT FROM h.dob
           )) AS unmatched_rows
    `);
    const totals: any = (totalsRes.rows as any[])[0] ?? {};

    const sampleRes = await db.execute(sql`
      SELECT h.id, h.patient_name, h.dob, h.test_name, h.date_of_service, h.clinic
      FROM patient_test_history h
      WHERE NOT EXISTS (
        SELECT 1 FROM patient_screenings ps
        WHERE ps.name = h.patient_name AND ps.dob IS NOT DISTINCT FROM h.dob
      )
      ORDER BY h.id DESC
      LIMIT ${sampleLimit}
    `);
    return {
      totalHistoryRows: Number(totals.total_rows ?? 0),
      unmatchedCount: Number(totals.unmatched_rows ?? 0),
      unmatched: (sampleRes.rows as any[]).map((r) => ({
        id: Number(r.id),
        patientName: String(r.patient_name),
        dob: r.dob ?? null,
        testName: String(r.test_name),
        dateOfService: String(r.date_of_service),
        clinic: r.clinic ?? null,
      })),
    };
  }

  async getGroupScreenings(name: string, dob: string | null): Promise<PatientScreening[]> {
    return db.select().from(patientScreenings).where(and(
      eq(patientScreenings.name, name),
      dob === null
        ? sql`${patientScreenings.dob} IS NULL`
        : eq(patientScreenings.dob, dob),
    ));
  }
}

export const screeningRepository: IScreeningRepository = new DbScreeningRepository();
