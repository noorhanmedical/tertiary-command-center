// Helpers for validating that a multi-patient PDF packet is being
// generated from a single facility + single schedule-date group.
//
// Individual patient PDFs are not guarded — a single patient is
// trivially "one facility, one date". The packet guard only blocks
// combined PDFs that would mix facilities or dates.
//
// The existing `generateClinicianPDF` / `generatePlexusPDF` helpers
// in `client/src/lib/pdfGeneration.ts` are shape-agnostic: they
// accept any array of PatientScreening rows. This module enforces
// the safe-grouping contract above them.

import type { PatientScreening } from "@shared/schema";

export type PdfPacketSourcePatient = PatientScreening & {
  facility?: string | null;
};

export type PdfPacketKey = {
  facility: string;
  scheduleDate: string;
};

export function getPatientPdfPacketKey(
  patient: PdfPacketSourcePatient,
  fallbackFacility: string | null = null,
  fallbackScheduleDate: string | null = null,
): PdfPacketKey {
  const facility = (patient.facility ?? fallbackFacility ?? "").trim();
  const scheduleDate = (fallbackScheduleDate ?? "").trim();
  return {
    facility: facility || "(no facility)",
    scheduleDate: scheduleDate || "(no date)",
  };
}

export type PdfPacketValidation =
  | {
      ok: true;
      facility: string;
      scheduleDate: string;
      patients: PdfPacketSourcePatient[];
    }
  | {
      ok: false;
      reason: string;
      groups: Array<{
        facility: string;
        scheduleDate: string;
        patients: PdfPacketSourcePatient[];
      }>;
    };

// Validate a set of patients for combined-packet generation. All
// patients must share the same facility AND the same scheduleDate.
// Missing facility/date is treated as a fatal mismatch; the caller
// should use individual PDFs for those rows.
export function validateSameFacilityDatePacket(
  patients: PdfPacketSourcePatient[],
  fallbackFacility: string | null = null,
  fallbackScheduleDate: string | null = null,
): PdfPacketValidation {
  if (patients.length === 0) {
    return {
      ok: false,
      reason: "No patients selected for packet.",
      groups: [],
    };
  }

  const groups = new Map<
    string,
    { facility: string; scheduleDate: string; patients: PdfPacketSourcePatient[] }
  >();
  for (const p of patients) {
    const key = getPatientPdfPacketKey(p, fallbackFacility, fallbackScheduleDate);
    const id = `${key.facility}::${key.scheduleDate}`;
    const cur =
      groups.get(id) ?? { facility: key.facility, scheduleDate: key.scheduleDate, patients: [] };
    cur.patients.push(p);
    groups.set(id, cur);
  }

  if (groups.size === 1) {
    const only = groups.values().next().value!;
    if (only.facility === "(no facility)" || only.scheduleDate === "(no date)") {
      return {
        ok: false,
        reason:
          "PDF packet requires one facility and one date. Generate individual PDFs for these patients instead.",
        groups: Array.from(groups.values()),
      };
    }
    return {
      ok: true,
      facility: only.facility,
      scheduleDate: only.scheduleDate,
      patients: only.patients,
    };
  }

  return {
    ok: false,
    reason:
      "PDF packet requires one facility and one date. Pick a facility/date group below.",
    groups: Array.from(groups.values()),
  };
}

// "Completed" predicate used by the PDF buttons. A row only qualifies
// for PDF when AI qualification has populated `qualifyingTests` /
// `reasoning` — otherwise the PDF body would be empty.
export function isPatientPdfEligible(p: PatientScreening): boolean {
  if (p.status === "completed") return true;
  if (Array.isArray(p.qualifyingTests) && p.qualifyingTests.length > 0) return true;
  if (p.reasoning && typeof p.reasoning === "object" && Object.keys(p.reasoning).length > 0) {
    return true;
  }
  return false;
}
