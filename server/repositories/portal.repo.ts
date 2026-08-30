// portal.repo.ts — Phase 5 architecture hardening.
//
// Extracted from server/routes/portal.ts. Every helper is either bounded
// by a clinic/facility filter, patient id, or an explicit limit. The two
// db.execute functions preserve the exact SQL from the route file so
// behavior is identical byte-for-byte at the query planner.

import { db } from "../db";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  ancillaryAppointments,
  clinics,
  documentSurfaceAssignments,
  documents as documentsTable,
  users as usersTable,
  type DocumentSurface,
} from "@shared/schema";

export async function listAncillaryAppointmentsForDate(
  date: string,
  facility?: string | null,
) {
  const conds = [eq(ancillaryAppointments.scheduledDate, date)];
  if (facility) conds.push(eq(ancillaryAppointments.facility, facility));
  return db.select().from(ancillaryAppointments).where(and(...conds));
}

export async function listAncillaryAppointmentsForRange(
  startDate: string,
  endDate: string,
  facility?: string | null,
) {
  const conds = [
    gte(ancillaryAppointments.scheduledDate, startDate),
    lte(ancillaryAppointments.scheduledDate, endDate),
  ];
  if (facility) conds.push(eq(ancillaryAppointments.facility, facility));
  return db.select().from(ancillaryAppointments).where(and(...conds));
}

export async function listDistinctAncillaryFacilities(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ facility: ancillaryAppointments.facility })
    .from(ancillaryAppointments);
  return rows.map((r) => r.facility);
}

// Canonical active clinic/facility names from the Admin Settings `clinics`
// table — the single source of truth for which facilities exist. Used by the
// Team Portal facility selector (admin sees all ACTIVE configured clinics)
// instead of the legacy distinct-ancillary-facility strings, which leaked
// non-canonical names (e.g. seeded "Plexus Imaging") into the picker.
export async function listActiveClinicNames(): Promise<string[]> {
  const rows = await db
    .select({ name: clinics.name })
    .from(clinics)
    .where(eq(clinics.active, true));
  return rows.map((r) => r.name).filter((n): n is string => !!n);
}

// User ids can be either numeric or the string form (session-derived),
// depending on the caller. `inArray` in drizzle handles both because
// `users.id` is a text column at the schema level.
export async function listActiveFacilityUsers(userIds: Array<string | number>) {
  if (userIds.length === 0) return [];
  return db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      active: usersTable.active,
    })
    .from(usersTable)
    .where(and(inArray(usersTable.id, userIds as any), eq(usersTable.active, true)));
}

export async function assignDocumentToPatientChart(documentId: number) {
  await db
    .insert(documentSurfaceAssignments)
    .values({
      documentId,
      surface: "patient_chart" as DocumentSurface,
    })
    .onConflictDoNothing();
}

// Rollback helper — called when a subsequent surface assignment / blob
// write fails after the parent document row was inserted. Named
// explicitly so the intent (compensating write) is unambiguous.
export async function rollbackDocumentInsert(documentId: number) {
  await db
    .delete(documentsTable)
    .where(eq(documentsTable.id, documentId));
}

// Facility-scoped patient search used by the portal command rail.
// Preserves the exact SQL text from the route so the query planner's
// path is unchanged.
export type AllowedFacilities = {
  all: boolean;
  facilities: Set<string>;
};

function buildFacilityConds(
  allowed: AllowedFacilities,
  facilityFilter: string,
) {
  if (facilityFilter) {
    return sql`AND COALESCE(ps.facility, sb.facility) = ${facilityFilter}`;
  }
  if (allowed.all) return sql``;
  return sql`AND COALESCE(ps.facility, sb.facility) IN (${sql.join(
    [...allowed.facilities].map((f) => sql`${f}`),
    sql`, `,
  )})`;
}

export async function searchPatientScreeningsScoped(args: {
  like: string;
  facilityFilter: string;
  allowed: AllowedFacilities;
  limit: number;
}) {
  const facilityConds = buildFacilityConds(args.allowed, args.facilityFilter);
  return db.execute<{
    id: number;
    name: string;
    dob: string | null;
    facility: string | null;
    insurance: string | null;
    phone: string | null;
    appointment_status: string | null;
    commit_status: string | null;
  }>(sql`
    SELECT ps.id, ps.name, ps.dob,
           COALESCE(ps.facility, sb.facility) AS facility,
           ps.insurance, ps.phone_number AS phone,
           ps.appointment_status, ps.commit_status
    FROM patient_screenings ps
    LEFT JOIN screening_batches sb ON sb.id = ps.batch_id
    WHERE ps.deleted_at IS NULL
      AND (
        ps.name ILIKE ${args.like}
        OR ps.dob ILIKE ${args.like}
        OR ps.phone_number ILIKE ${args.like}
        OR ps.insurance ILIKE ${args.like}
      )
      ${facilityConds}
    ORDER BY ps.name ASC, ps.id DESC
    LIMIT ${args.limit}
  `);
}

export async function listMyRecentPatientsScoped(args: {
  userId: string | number;
  query: string;
  facilityFilter: string;
  allowed: AllowedFacilities;
  limit: number;
}) {
  const facilityConds = buildFacilityConds(args.allowed, args.facilityFilter);
  const queryConds = args.query
    ? sql`AND (ps.name ILIKE ${`%${args.query}%`} OR ps.dob ILIKE ${`%${args.query}%`})`
    : sql``;
  return db.execute<{
    id: number;
    name: string;
    dob: string | null;
    facility: string | null;
    appointment_status: string | null;
    commit_status: string | null;
    last_at: string | null;
    last_type: string | null;
    last_summary: string | null;
  }>(sql`
    WITH touches AS (
      SELECT oc.patient_screening_id AS pid, oc.started_at AS at,
             'call'::text AS type, oc.outcome AS summary
      FROM outreach_calls oc
      WHERE oc.scheduler_user_id = ${args.userId}
      UNION ALL
      SELECT pje.patient_screening_id, pje.created_at,
             pje.event_type, pje.summary
      FROM patient_journey_events pje
      WHERE pje.actor_user_id = ${args.userId}
        AND pje.patient_screening_id IS NOT NULL
    ),
    latest AS (
      SELECT DISTINCT ON (pid) pid, at, type, summary
      FROM touches
      ORDER BY pid, at DESC
    )
    SELECT ps.id, ps.name, ps.dob,
           COALESCE(ps.facility, sb.facility) AS facility,
           ps.appointment_status, ps.commit_status,
           l.at AS last_at, l.type AS last_type, l.summary AS last_summary
    FROM latest l
    JOIN patient_screenings ps ON ps.id = l.pid AND ps.deleted_at IS NULL
    LEFT JOIN screening_batches sb ON sb.id = ps.batch_id
    WHERE TRUE
      ${facilityConds}
      ${queryConds}
    ORDER BY l.at DESC
    LIMIT ${args.limit}
  `);
}
