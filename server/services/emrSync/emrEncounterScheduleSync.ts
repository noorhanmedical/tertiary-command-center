// EMR Encounter schedule sync service (Batch: EMR roster sync).
//
// Orchestrates: parse FHIR Encounter records → scope to planned+recent →
// resolve clinic + patient_directory → UPSERT into global_schedule_events.
//
// Designed to be called from the admin sync route AFTER the bulk NDJSON has
// been parsed into Encounter objects by the existing import pipeline. This
// module does NOT fetch from S3 itself — it takes already-parsed Encounters
// so it stays testable and free of network deps.
//
// Safety (see emrEncounterSchedule.repo.ts header + read-path trace):
//   - Only ingests planned + recent encounters (scopeEncounters()).
//   - Never sets patientScreeningId (handled in the repo).
//   - clinicId is resolved explicitly; an unresolved facility is reported as
//     a per-row error, not silently written.
//   - Feature-flagged OFF by default (USE_EMR_SCHEDULE_SYNC).
//   - Supports dryRun: resolve + map + report, write nothing.

import {
  upsertEmrEncounterScheduleEvent,
  mapEncounterStatus,
} from "../../repositories/emrEncounterSchedule.repo";
import {
  resolveClinicIdForFacility,
  resolvePatientDirectoryId,
} from "../../repositories/emrEncounterResolvers";

export function isEmrScheduleSyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.USE_EMR_SCHEDULE_SYNC;
  return v === "1" || v === "true" || v === "yes";
}

// Minimal shape of a parsed FHIR Encounter we depend on. The upstream parser
// may pass richer objects; we read only these paths.
export type ParsedEncounter = {
  id?: string;
  status?: string;
  period?: { start?: string; end?: string };
  type?: Array<{ text?: string }>;
  subject?: { reference?: string };
  participant?: Array<{ individual?: { reference?: string } }>;
  reasonCode?: Array<{ text?: string }>;
  location?: Array<{ location?: { reference?: string } }>;
  // Resolved patient identity (supplied by the pipeline from the Patient
  // resource the subject points to). Optional — when absent we cannot link.
  resolvedPatient?: {
    name?: string | null;
    dob?: string | null;
    mrn?: string | null;
    facility?: string | null;
    phoneNumber?: string | null;
  };
};

export type EmrScheduleSyncOptions = {
  dryRun?: boolean;
  // ISO date (YYYY-MM-DD) treated as "today" for scope; defaults to now.
  today?: string;
  // How many days back to keep non-planned encounters (show/no-show window).
  recentWindowDays?: number;
};

export type EmrScheduleSyncResult = {
  dryRun: boolean;
  totalReceived: number;
  inScope: number;
  created: number;
  updated: number;
  skippedNoId: number;
  unresolvedClinic: number;
  unlinkedPatient: number;
  errors: Array<{ encounterId: string | null; message: string }>;
  statusBreakdown: Record<string, number>;
};

function startOf(e: ParsedEncounter): string {
  return e.period?.start ?? "";
}

/** Scope rule: keep planned encounters dated today-or-later, plus any
 *  encounter within the recent window (so show/no-show transitions land).
 *  Deliberately excludes the deep finished history. */
export function scopeEncounters(
  encounters: ReadonlyArray<ParsedEncounter>,
  today: string,
  recentWindowDays: number,
): ParsedEncounter[] {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - recentWindowDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return encounters.filter((e) => {
    const st = startOf(e).slice(0, 10);
    if (!st) return false;
    const status = (e.status ?? "").toLowerCase();
    if (status === "planned" && st >= today) return true; // upcoming roster
    if (st >= cutoffStr) return true; // recent window (show/no-show)
    return false;
  });
}

function firstRef(e: ParsedEncounter): string | null {
  for (const p of e.participant ?? []) {
    if (p.individual?.reference) return p.individual.reference;
  }
  return null;
}

function firstLocation(e: ParsedEncounter): string | null {
  for (const l of e.location ?? []) {
    if (l.location?.reference) return l.location.reference;
  }
  return null;
}

function firstReason(e: ParsedEncounter): string | null {
  for (const r of e.reasonCode ?? []) {
    if (r.text) return r.text;
  }
  return null;
}

function firstType(e: ParsedEncounter): string | null {
  for (const t of e.type ?? []) {
    if (t.text) return t.text;
  }
  return null;
}

/** Main entry: ingest a batch of parsed Encounters into
 *  global_schedule_events. Honors dryRun (no writes). */
export async function syncEmrEncounterSchedule(
  encounters: ReadonlyArray<ParsedEncounter>,
  options: EmrScheduleSyncOptions = {},
): Promise<EmrScheduleSyncResult> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const recentWindowDays = options.recentWindowDays ?? 30;
  const dryRun = options.dryRun ?? false;

  const result: EmrScheduleSyncResult = {
    dryRun,
    totalReceived: encounters.length,
    inScope: 0,
    created: 0,
    updated: 0,
    skippedNoId: 0,
    unresolvedClinic: 0,
    unlinkedPatient: 0,
    errors: [],
    statusBreakdown: {},
  };

  const scoped = scopeEncounters(encounters, today, recentWindowDays);
  result.inScope = scoped.length;

  for (const e of scoped) {
    const encounterId = e.id ?? null;
    if (!encounterId) {
      result.skippedNoId++;
      continue;
    }

    const mappedStatus = mapEncounterStatus(e.status);
    result.statusBreakdown[mappedStatus] =
      (result.statusBreakdown[mappedStatus] ?? 0) + 1;

    const facility = e.resolvedPatient?.facility ?? null;

    // Resolve clinic (tenancy). Unresolved → per-row error, not a write.
    let clinicId: number;
    try {
      clinicId = await resolveClinicIdForFacility(facility);
    } catch (err) {
      result.unresolvedClinic++;
      result.errors.push({ encounterId, message: (err as Error).message });
      continue;
    }

    // Resolve patient_directory link (optional — null is allowed).
    let patientDirectoryId: number | null = null;
    if (e.resolvedPatient) {
      patientDirectoryId = await resolvePatientDirectoryId({
        name: e.resolvedPatient.name ?? null,
        dob: e.resolvedPatient.dob ?? null,
        mrn: e.resolvedPatient.mrn ?? null,
        facility,
        phoneNumber: e.resolvedPatient.phoneNumber ?? null,
      });
    }
    if (patientDirectoryId == null) result.unlinkedPatient++;

    const startStr = startOf(e);
    const startsAt = startStr ? new Date(startStr) : null;
    if (!startsAt || isNaN(startsAt.getTime())) {
      result.errors.push({ encounterId, message: "missing/invalid period.start" });
      continue;
    }
    const endStr = e.period?.end;
    const endsAt = endStr ? new Date(endStr) : null;

    if (dryRun) {
      // Count as created/updated unknown in dry-run; report as "would write".
      result.created++; // dry-run uses created as the would-write counter
      continue;
    }

    try {
      const { created } = await upsertEmrEncounterScheduleEvent({
        externalEncounterId: encounterId,
        clinicId,
        patientDirectoryId,
        patientName: e.resolvedPatient?.name ?? null,
        patientDob: e.resolvedPatient?.dob ?? null,
        facilityId: facility,
        serviceType: firstType(e),
        fhirStatus: e.status ?? null,
        startsAt,
        endsAt: endsAt && !isNaN(endsAt.getTime()) ? endsAt : null,
        providerNpi: firstRef(e),
        reasonText: firstReason(e),
        locationRef: firstLocation(e),
        source: "ecw_fhir_bulk",
      });
      if (created) result.created++;
      else result.updated++;
    } catch (err) {
      result.errors.push({ encounterId, message: (err as Error).message });
    }
  }

  return result;
}
