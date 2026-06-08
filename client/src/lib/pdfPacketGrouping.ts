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
      // null when the packet is an outreach group (single facility,
      // every patient has no scheduleDate). Consumers should render
      // "Outreach" in batch labels for this case.
      scheduleDate: string | null;
      // True when the packet is a single-facility group of
      // outreach patients (no scheduleDate). The PDF template
      // still renders a real packet; the date label falls back to
      // "Outreach" at the consumer site.
      isOutreachPacket: boolean;
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

// Validate a set of patients for combined-packet generation.
//
// Acceptable single-group shapes:
//   - same facility + same scheduleDate (a dated visit packet)
//   - same facility + every patient has no scheduleDate (an
//     outreach call-list packet) — scheduleDate is returned as
//     null and the caller renders "Outreach" in the batch label
//
// Rejected: missing facility, mixed facilities, mixed dates, or
// a mix of dated + outreach patients.
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
    if (only.facility === "(no facility)") {
      return {
        ok: false,
        reason:
          "PDF packet requires a facility. Generate individual PDFs for these patients instead.",
        groups: Array.from(groups.values()),
      };
    }
    // Outreach group: one facility, every patient has no
    // scheduleDate. Treat as valid outreach packet.
    const isOutreachPacket = only.scheduleDate === "(no date)";
    return {
      ok: true,
      facility: only.facility,
      scheduleDate: isOutreachPacket ? null : only.scheduleDate,
      isOutreachPacket,
      patients: only.patients,
    };
  }

  return {
    ok: false,
    reason:
      "PDF packet requires one facility and one date (or one facility with all-outreach patients). Pick a facility/date group below.",
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
