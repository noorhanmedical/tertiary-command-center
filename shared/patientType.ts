// Derived patient classification.
//
// A patient is "visit" iff they have any qualifying clinic appointment within
// the next N days (default 90) from `asOfDate`. Otherwise we fall back to the
// stored `patientType` column (manual override / ingestion default), and only
// then to "outreach". The stored value acts as a floor: an upcoming
// appointment can promote an outreach-stored patient to visit, but the stored
// flag cannot demote a patient who has an appointment in window.
//
// Qualifying appointments:
//   • any `ancillary_appointments` row with status "scheduled" whose
//     `scheduledDate` falls within [asOfDate, asOfDate + windowDays].
//   • the patient's `screening_batches.scheduleDate` (their clinic visit
//     date) within the same window.

export type DerivedPatientType = "visit" | "outreach";

export const PATIENT_TYPE_WINDOW_DAYS = 90;

export type AppointmentLike = {
  scheduledDate: string;
  status: string;
};

function withinWindow(dateIso: string | null | undefined, asOfDate: string, windowDays: number): boolean {
  if (!dateIso) return false;
  const d = String(dateIso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return false;
  if (d < asOfDate) return false;
  const start = new Date(`${asOfDate}T00:00:00Z`).getTime();
  const dest = new Date(`${d}T00:00:00Z`).getTime();
  if (isNaN(start) || isNaN(dest)) return false;
  const diffDays = Math.round((dest - start) / 86_400_000);
  return diffDays <= windowDays;
}

export function derivePatientType(opts: {
  appointments: AppointmentLike[];
  batchScheduleDate: string | null | undefined;
  storedPatientType?: string | null;
  asOfDate: string;
  windowDays?: number;
}): DerivedPatientType {
  const windowDays = opts.windowDays ?? PATIENT_TYPE_WINDOW_DAYS;
  // 1) In-window qualifying appointment promotes to visit.
  if (withinWindow(opts.batchScheduleDate, opts.asOfDate, windowDays)) return "visit";
  let hasAnyScheduledAppt = false;
  for (const a of opts.appointments) {
    if ((a.status || "").toLowerCase() !== "scheduled") continue;
    hasAnyScheduledAppt = true;
    if (withinWindow(a.scheduledDate, opts.asOfDate, windowDays)) return "visit";
  }
  // 2) The patient has appointment records (batch date or scheduled appts)
  //    but none fall in the window — they are unambiguously outreach now.
  //    Stored value is *not* consulted in this case.
  const hasAnyApptRecord = !!opts.batchScheduleDate || hasAnyScheduledAppt;
  if (hasAnyApptRecord) return "outreach";
  // 3) No appointment records at all — fall back to manual override, then default.
  const stored = (opts.storedPatientType || "").trim().toLowerCase();
  if (stored === "visit" || stored === "outreach") return stored;
  return "outreach";
}
