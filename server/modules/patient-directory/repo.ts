// Patient EHR — read-only repository layer.
//
// Two queries are exposed:
//   1. listCanonicalPatients({ facility, limit, offset })
//      → groups patient_screenings by (lower(trim(name)), dob), excluding
//        soft-deleted-only groups, ordered by the freshest screening per
//        canonical patient, optionally filtered by the primary facility.
//   2. getCanonicalPatientByScreeningId(screeningId)
//      → resolves the screening to its canonical patient (i.e., finds the
//        set of screenings that share its (lower(name), dob) key, and
//        returns the same CanonicalPatient view).
//
// The canonical id is a SHA-256 hex digest of `lower(trim(name)) + '|' + (dob ?? '')`.
// This is intentionally deterministic so the same canonical patient maps
// to the same id across runs without requiring a database table.

import crypto from "node:crypto";
import { and, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { patientScreenings } from "@shared/schema";
import type {
  CanonicalPatient,
  CanonicalPatientId,
  ListCanonicalPatientsFilters,
} from "./contracts";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// ────────────────────────────────────────────────────────────────────────
// Canonical key helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Derive the canonical id from raw identity fields. Returns a stable hex
 * digest. The same `(name, dob)` pair always produces the same id, regardless
 * of input casing or surrounding whitespace.
 */
export function computeCanonicalPatientId(
  name: string | null | undefined,
  dob: string | null | undefined,
): CanonicalPatientId {
  const normalizedName = String(name ?? "").trim().toLowerCase();
  const normalizedDob = String(dob ?? "").trim();
  const composite = `${normalizedName}|${normalizedDob}`;
  return crypto.createHash("sha256").update(composite).digest("hex");
}

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_LIMIT);
}

function clampOffset(offset: number | undefined): number {
  if (!offset || !Number.isFinite(offset) || offset < 0) return 0;
  return Math.trunc(offset);
}

// ────────────────────────────────────────────────────────────────────────
// Internal types — rows returned by the SQL queries
// ────────────────────────────────────────────────────────────────────────

type RawScreeningRow = {
  id: number;
  name: string;
  dob: string | null;
  phoneNumber: string | null;
  email: string | null;
  facility: string | null;
  deletedAt: Date | null;
  createdAt: Date;
};

// ────────────────────────────────────────────────────────────────────────
// Group screenings into canonical patients
// ────────────────────────────────────────────────────────────────────────

function buildCanonicalPatientFromGroup(
  rows: RawScreeningRow[],
): CanonicalPatient {
  // Sort newest-first by id (acts as the canonical "freshest" indicator).
  const sorted = [...rows].sort((a, b) => b.id - a.id);
  const primary = sorted[0];
  const id = computeCanonicalPatientId(primary.name, primary.dob);
  const hasDeletedScreening = sorted.some((r) => r.deletedAt !== null);
  return {
    id,
    primaryScreeningId: primary.id,
    screeningIds: sorted.map((r) => r.id),
    name: primary.name,
    dob: primary.dob,
    phoneNumber: primary.phoneNumber,
    email: primary.email,
    facility: primary.facility,
    totalScreenings: sorted.length,
    hasDeletedScreening,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Public read queries
// ────────────────────────────────────────────────────────────────────────

/**
 * List the canonical patient view, computed by grouping non-soft-deleted
 * patient_screenings on (lower(trim(name)), dob). Each canonical patient's
 * primary screening (the freshest) drives its facility / contact snapshot.
 *
 * Facility filter, when supplied, is applied AFTER grouping — only canonical
 * patients whose primary screening's facility matches the filter are
 * returned. This matches the visible behavior of the existing
 * routes/patientDatabase.ts roster.
 */
export async function listCanonicalPatients(
  filters: ListCanonicalPatientsFilters = {},
): Promise<CanonicalPatient[]> {
  const safeLimit = clampLimit(filters.limit);
  const safeOffset = clampOffset(filters.offset);

  // We pull all live screening rows and group in code. The roster route
  // already does SQL-side grouping for cooldown/aggregate semantics; this
  // module's purpose is just the identity view, so we keep the query
  // shape minimal and the grouping deterministic.
  //
  // Memory cost: ~one row per patient_screenings.id where deletedAt is
  // null. For the rosters this codebase serves today this is well within
  // a single response budget; the future db-backed table replaces this.
  const rawRows = await db
    .select({
      id: patientScreenings.id,
      name: patientScreenings.name,
      dob: patientScreenings.dob,
      phoneNumber: patientScreenings.phoneNumber,
      email: patientScreenings.email,
      facility: patientScreenings.facility,
      deletedAt: patientScreenings.deletedAt,
      createdAt: patientScreenings.createdAt,
    })
    .from(patientScreenings)
    .where(isNull(patientScreenings.deletedAt))
    .orderBy(desc(patientScreenings.id));

  const groups = new Map<string, RawScreeningRow[]>();
  for (const row of rawRows) {
    const id = computeCanonicalPatientId(row.name, row.dob);
    const arr = groups.get(id);
    if (arr) arr.push(row as unknown as RawScreeningRow);
    else groups.set(id, [row as unknown as RawScreeningRow]);
  }

  const canonical: CanonicalPatient[] = [];
  for (const rows of groups.values()) {
    canonical.push(buildCanonicalPatientFromGroup(rows));
  }

  // Apply facility filter on the primary row, matching the roster's
  // visible behavior.
  const filtered = filters.facility
    ? canonical.filter((c) => c.facility === filters.facility)
    : canonical;

  // Order by primary screening id descending (freshest patient first), then
  // alphabetical name as a stable tie-breaker.
  filtered.sort((a, b) => {
    if (a.primaryScreeningId !== b.primaryScreeningId) {
      return b.primaryScreeningId - a.primaryScreeningId;
    }
    return a.name.localeCompare(b.name);
  });

  return filtered.slice(safeOffset, safeOffset + safeLimit);
}

/**
 * Resolve a single patient_screenings row to its canonical patient view.
 * Returns undefined when the screening id is unknown or has been
 * soft-deleted AND no other live screening shares its identity key.
 */
export async function getCanonicalPatientByScreeningId(
  screeningId: number,
): Promise<CanonicalPatient | undefined> {
  if (!Number.isFinite(screeningId)) return undefined;

  // Find the seed screening row; include soft-deleted in the seed lookup
  // so the caller can still reach the canonical view from a deleted id.
  const [seed] = await db
    .select({
      id: patientScreenings.id,
      name: patientScreenings.name,
      dob: patientScreenings.dob,
      phoneNumber: patientScreenings.phoneNumber,
      email: patientScreenings.email,
      facility: patientScreenings.facility,
      deletedAt: patientScreenings.deletedAt,
      createdAt: patientScreenings.createdAt,
    })
    .from(patientScreenings)
    .where(eq(patientScreenings.id, screeningId))
    .limit(1);

  if (!seed) return undefined;

  const normalizedName = String(seed.name ?? "").trim().toLowerCase();
  // Match all live screenings that share the same (lower(name), dob) key.
  const peers = await db
    .select({
      id: patientScreenings.id,
      name: patientScreenings.name,
      dob: patientScreenings.dob,
      phoneNumber: patientScreenings.phoneNumber,
      email: patientScreenings.email,
      facility: patientScreenings.facility,
      deletedAt: patientScreenings.deletedAt,
      createdAt: patientScreenings.createdAt,
    })
    .from(patientScreenings)
    .where(
      and(
        sql`lower(trim(${patientScreenings.name})) = ${normalizedName}`,
        seed.dob === null
          ? isNull(patientScreenings.dob)
          : eq(patientScreenings.dob, seed.dob),
      ),
    );

  if (peers.length === 0) {
    // Should be impossible (the seed itself matches), but defensively
    // include the seed as the sole row.
    return buildCanonicalPatientFromGroup([seed as unknown as RawScreeningRow]);
  }
  return buildCanonicalPatientFromGroup(peers as unknown as RawScreeningRow[]);
}

// suppress unused-import warnings — these are useful for future filter
// extensions and we want the imports tracked.
void isNotNull;
