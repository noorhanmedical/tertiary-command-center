// Canonical clinical reference domains repository.
//
// Reads the six clinical domains (providers, allergies, labs, imaging, vitals,
// encounters) for a patient. The chart fetches by patient_screening_id (the
// same id the rest of the EHR chart uses), so every list function filters on
// that id. `replace*` helpers give the seed an idempotent path (delete-then-
// insert for a single screening) without duplicating rows on re-run.

import { db } from "../db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  patientClinicalProviders,
  patientAllergies,
  patientLabs,
  patientImagingStudies,
  patientVitals,
  patientEncounters,
  type PatientClinicalProvider,
  type PatientAllergy,
  type PatientLab,
  type PatientImagingStudy,
  type PatientVital,
  type PatientEncounter,
  type InsertPatientClinicalProvider,
  type InsertPatientAllergy,
  type InsertPatientLab,
  type InsertPatientImagingStudy,
  type InsertPatientVital,
  type InsertPatientEncounter,
  patientEpisodeDocuments,
  patientDocumentVersions,
  type PatientEpisodeDocument,
  type PatientDocumentVersion,
} from "@shared/schema/clinicalData";
import { patientTestHistory, type PatientTestHistory } from "@shared/schema/patientHistory";
import { ancillaryCaseAdminReviewEvents } from "@shared/schema/adminReviewEvents";
import { listAncillaryCasesForScreening } from "./ancillaryCases.repo";
import { inArray } from "drizzle-orm";

export interface EncounterPage {
  rows: PatientEncounter[];
  total: number;
  limit: number;
  offset: number;
}

export interface PatientClinicalData {
  providers: PatientClinicalProvider[];
  allergies: PatientAllergy[];
  labs: PatientLab[];
  imaging: PatientImagingStudy[];
  vitals: PatientVital[];
  encounters: PatientEncounter[];
  encounterTotal: number;
}

// ── Reads ─────────────────────────────────────────────────────────────────

export async function listProviders(screeningId: number): Promise<PatientClinicalProvider[]> {
  return db.select().from(patientClinicalProviders)
    .where(eq(patientClinicalProviders.patientScreeningId, screeningId))
    .orderBy(asc(patientClinicalProviders.sortOrder), asc(patientClinicalProviders.id));
}

export async function listAllergies(screeningId: number): Promise<PatientAllergy[]> {
  return db.select().from(patientAllergies)
    .where(eq(patientAllergies.patientScreeningId, screeningId))
    .orderBy(asc(patientAllergies.sortOrder), asc(patientAllergies.id));
}

export async function listLabs(screeningId: number): Promise<PatientLab[]> {
  return db.select().from(patientLabs)
    .where(eq(patientLabs.patientScreeningId, screeningId))
    .orderBy(asc(patientLabs.sortOrder), desc(patientLabs.collectedAt), asc(patientLabs.id));
}

export async function listImaging(screeningId: number): Promise<PatientImagingStudy[]> {
  return db.select().from(patientImagingStudies)
    .where(eq(patientImagingStudies.patientScreeningId, screeningId))
    .orderBy(asc(patientImagingStudies.sortOrder), desc(patientImagingStudies.performedAt), asc(patientImagingStudies.id));
}

export async function listVitals(screeningId: number): Promise<PatientVital[]> {
  return db.select().from(patientVitals)
    .where(eq(patientVitals.patientScreeningId, screeningId))
    .orderBy(asc(patientVitals.sortOrder), desc(patientVitals.measuredAt), asc(patientVitals.id));
}

export async function listEncounters(
  screeningId: number,
  opts: { limit?: number; offset?: number } = {},
): Promise<EncounterPage> {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(patientEncounters)
    .where(eq(patientEncounters.patientScreeningId, screeningId));

  const rows = await db.select().from(patientEncounters)
    .where(eq(patientEncounters.patientScreeningId, screeningId))
    .orderBy(desc(patientEncounters.occurredAt), asc(patientEncounters.sortOrder), asc(patientEncounters.id))
    .limit(limit)
    .offset(offset);

  return { rows, total: Number(count ?? 0), limit, offset };
}

export interface EpisodeDocumentsView {
  documents: PatientEpisodeDocument[];
  versions: PatientDocumentVersion[];
}

/** Per-episode canonical document set + note version lineage for a patient.
 *  documents are episode-keyed (zero cross-episode leakage); versions carry the
 *  edit/diff lineage for clinician-editable notes. */
export async function getEpisodeDocumentsView(screeningId: number): Promise<EpisodeDocumentsView> {
  const documents = await db.select().from(patientEpisodeDocuments)
    .where(eq(patientEpisodeDocuments.patientScreeningId, screeningId))
    .orderBy(asc(patientEpisodeDocuments.sortOrder), asc(patientEpisodeDocuments.id));
  const docIds = documents.map((d) => d.id);
  let versions: PatientDocumentVersion[] = [];
  if (docIds.length > 0) {
    versions = await db.select().from(patientDocumentVersions)
      .where(inArray(patientDocumentVersions.episodeDocumentId, docIds))
      .orderBy(asc(patientDocumentVersions.episodeDocumentId), asc(patientDocumentVersions.version));
  }
  return { documents, versions };
}

export interface AdminReviewServiceRow {
  ancillaryCaseId: number;
  serviceType: string;
  adminReviewStatus: string;
  qualificationStatus: string;
  lifecycleStatus: string;
  episodeSequence: number | null;
}
export interface AdminReviewView {
  services: AdminReviewServiceRow[];
  events: Array<{
    id: number;
    ancillaryCaseId: number;
    serviceType: string;
    previousStatus: string | null;
    newStatus: string;
    reviewerRole: string | null;
    actualReviewedAt: string | null;
    rationale: string | null;
  }>;
}

/** Canonical Admin Review view for a patient: the per-service admin-review
 *  status straight off patient_ancillary_cases (the single source the Plexus IQ
 *  workspace writes) plus the append-only review event timeline. Replaces the
 *  legacy single patient_screenings.adminApprovalStatus mock in the chart. */
export async function getAdminReviewView(screeningId: number): Promise<AdminReviewView> {
  const cases = await listAncillaryCasesForScreening(screeningId);
  const services: AdminReviewServiceRow[] = cases.map((c) => ({
    ancillaryCaseId: c.id,
    serviceType: c.serviceType,
    adminReviewStatus: c.adminReviewStatus,
    qualificationStatus: c.qualificationStatus,
    lifecycleStatus: c.lifecycleStatus,
    episodeSequence: c.episodeSequence ?? null,
  }));

  const caseIds = cases.map((c) => c.id);
  let events: AdminReviewView["events"] = [];
  if (caseIds.length > 0) {
    const rows = await db.select().from(ancillaryCaseAdminReviewEvents)
      .where(inArray(ancillaryCaseAdminReviewEvents.ancillaryCaseId, caseIds))
      .orderBy(desc(ancillaryCaseAdminReviewEvents.actualReviewedAt));
    events = rows.map((r) => ({
      id: r.id,
      ancillaryCaseId: r.ancillaryCaseId,
      serviceType: r.serviceType,
      previousStatus: r.previousStatus,
      newStatus: r.newStatus,
      reviewerRole: r.reviewerRole,
      actualReviewedAt: r.actualReviewedAt ? new Date(r.actualReviewedAt).toISOString() : null,
      rationale: r.rationale,
    }));
  }
  return { services, events };
}

/** Prior ancillary test episodes for a patient (patient_test_history rows
 *  linked to this screening). Powers the "Previous Episodes" view in the
 *  Ancillary Journey + Plexus Notes — each row is a prior performance of a
 *  service with its result summary + report/procedure-note linkage. */
export async function listPriorTests(screeningId: number): Promise<PatientTestHistory[]> {
  return db.select().from(patientTestHistory)
    .where(eq(patientTestHistory.patientScreeningId, screeningId))
    .orderBy(desc(patientTestHistory.dateOfService));
}

/** Fetch all six domains for a patient in one round-trip. Encounters are
 *  capped to `encounterLimit` (first page); `encounterTotal` reports the full
 *  count so the UI can offer Load More. */
export async function getPatientClinicalData(
  screeningId: number,
  opts: { encounterLimit?: number } = {},
): Promise<PatientClinicalData> {
  // Encounters are paginated by the dedicated /encounters endpoint; the chart
  // payload only carries a recent page (never the full history) so the EHR
  // does not preload hundreds of notes. encounterTotal reports the full count.
  const [providers, allergies, labs, imaging, vitals, encPage] = await Promise.all([
    listProviders(screeningId),
    listAllergies(screeningId),
    listLabs(screeningId),
    listImaging(screeningId),
    listVitals(screeningId),
    listEncounters(screeningId, { limit: opts.encounterLimit ?? 20, offset: 0 }),
  ]);
  return {
    providers, allergies, labs, imaging, vitals,
    encounters: encPage.rows,
    encounterTotal: encPage.total,
  };
}

// ── Idempotent replace (seed helpers) ──────────────────────────────────────
// Each replace deletes the existing rows for a single screening then inserts
// the provided set, so re-running the seed never duplicates.

export async function replaceProviders(screeningId: number, rows: InsertPatientClinicalProvider[]): Promise<number> {
  await db.delete(patientClinicalProviders).where(eq(patientClinicalProviders.patientScreeningId, screeningId));
  if (rows.length === 0) return 0;
  const inserted = await db.insert(patientClinicalProviders).values(rows).returning({ id: patientClinicalProviders.id });
  return inserted.length;
}

export async function replaceAllergies(screeningId: number, rows: InsertPatientAllergy[]): Promise<number> {
  await db.delete(patientAllergies).where(eq(patientAllergies.patientScreeningId, screeningId));
  if (rows.length === 0) return 0;
  const inserted = await db.insert(patientAllergies).values(rows).returning({ id: patientAllergies.id });
  return inserted.length;
}

export async function replaceLabs(screeningId: number, rows: InsertPatientLab[]): Promise<number> {
  await db.delete(patientLabs).where(eq(patientLabs.patientScreeningId, screeningId));
  if (rows.length === 0) return 0;
  const inserted = await db.insert(patientLabs).values(rows).returning({ id: patientLabs.id });
  return inserted.length;
}

export async function replaceImaging(screeningId: number, rows: InsertPatientImagingStudy[]): Promise<number> {
  await db.delete(patientImagingStudies).where(eq(patientImagingStudies.patientScreeningId, screeningId));
  if (rows.length === 0) return 0;
  const inserted = await db.insert(patientImagingStudies).values(rows).returning({ id: patientImagingStudies.id });
  return inserted.length;
}

export async function replaceVitals(screeningId: number, rows: InsertPatientVital[]): Promise<number> {
  await db.delete(patientVitals).where(eq(patientVitals.patientScreeningId, screeningId));
  if (rows.length === 0) return 0;
  const inserted = await db.insert(patientVitals).values(rows).returning({ id: patientVitals.id });
  return inserted.length;
}

export async function replaceEncounters(screeningId: number, rows: InsertPatientEncounter[]): Promise<number> {
  await db.delete(patientEncounters).where(eq(patientEncounters.patientScreeningId, screeningId));
  if (rows.length === 0) return 0;
  const inserted = await db.insert(patientEncounters).values(rows).returning({ id: patientEncounters.id });
  return inserted.length;
}
