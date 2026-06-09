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

// Split a set of patients into the largest possible set of *valid*
// packet groups for PDF generation. Each returned packet satisfies
// the same single-facility / single-date (or single-facility /
// all-outreach) contract that `validateSameFacilityDatePacket`
// requires individually, so the caller can iterate the result and
// pass each packet straight into `generatePlexusPDFAsync` /
// `generateClinicianPDFAsync`.
//
// Used by the Engagement Center's Scheduler / Team Member tab — a
// scheduler's call list can legitimately contain rows from multiple
// facilities and/or multiple scheduled dates, so the single-packet
// validator would always reject the entire selection. Splitting
// first lets the same selection produce one PDF per facility/date
// without dropping any patient or requiring the operator to re-pick
// per facility.
//
// Patients with no facility are dropped — there is no safe way to
// title a packet for them and the caller should generate individual
// PDFs instead. The returned `skipped` list surfaces them so the UI
// can warn.
// SOURCE MARKER: Scheduler tab PDF splits selected patients by facility date
// SOURCE MARKER: Scheduler call list PDF generates one packet per facility date
// SOURCE MARKER: Scheduler PDF does not validate the entire scheduler group as one packet
export type SchedulerPdfPacket = {
  facility: string;
  // null when this is an outreach packet (all patients in the
  // packet share a facility but none have a scheduleDate).
  scheduleDate: string | null;
  isOutreachPacket: boolean;
  patients: PdfPacketSourcePatient[];
};

export type SchedulerPdfSplit = {
  packets: SchedulerPdfPacket[];
  // Patients dropped because they had no facility — caller should
  // surface a warning if non-empty.
  skipped: PdfPacketSourcePatient[];
};

export function splitPatientsByFacilityDate(
  patients: PdfPacketSourcePatient[],
  fallbackFacility: string | null = null,
  fallbackScheduleDate: string | null = null,
): SchedulerPdfSplit {
  const skipped: PdfPacketSourcePatient[] = [];
  const groups = new Map<
    string,
    {
      facility: string;
      scheduleDate: string;
      patients: PdfPacketSourcePatient[];
    }
  >();

  for (const p of patients) {
    const key = getPatientPdfPacketKey(p, fallbackFacility, fallbackScheduleDate);
    if (key.facility === "(no facility)") {
      skipped.push(p);
      continue;
    }
    const id = `${key.facility}::${key.scheduleDate}`;
    const cur =
      groups.get(id) ?? {
        facility: key.facility,
        scheduleDate: key.scheduleDate,
        patients: [],
      };
    cur.patients.push(p);
    groups.set(id, cur);
  }

  const packets: SchedulerPdfPacket[] = Array.from(groups.values())
    .map((g) => {
      const isOutreachPacket = g.scheduleDate === "(no date)";
      return {
        facility: g.facility,
        scheduleDate: isOutreachPacket ? null : g.scheduleDate,
        isOutreachPacket,
        patients: g.patients,
      };
    })
    // Sort dated packets first (newest date), then outreach packets;
    // ties broken by facility A-Z. Deterministic order keeps the
    // generated PDF download sequence predictable.
    .sort((a, b) => {
      if (a.isOutreachPacket !== b.isOutreachPacket) {
        return a.isOutreachPacket ? 1 : -1;
      }
      if (a.scheduleDate && b.scheduleDate && a.scheduleDate !== b.scheduleDate) {
        return b.scheduleDate.localeCompare(a.scheduleDate);
      }
      return a.facility.localeCompare(b.facility);
    });

  return { packets, skipped };
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
